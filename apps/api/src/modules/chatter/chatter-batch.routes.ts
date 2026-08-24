import { randomUUID } from "node:crypto";
import { AuditAction, EarningsStatus, EvidenceStatus, NotificationType, Prisma, Role, ShiftStatus } from "@prisma/client";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../config/env";
import { queueEvidencePurge } from "../../services/evidence-cleanup";
import { auditRequestMetadata } from "../../utils/audit";
import { brlStringToCents, centsToBrl, resolveOcrValueCents } from "../../utils/currency";
import { calculatePayoutCents } from "../../utils/payout";
import { ANALYTICS_UPDATED_EVENT, MANAGER_ROOM } from "../manager/manager.events";
import { assertNoShiftOverlap, assertOpenShiftLimit, lockShiftChatter, lockShiftModels, ShiftOverlapError } from "./shift-overlap";

const moneyMetadataSchema = z.object({
  currency: z.enum(["BRL", "USD"]).default("BRL"),
  originalAmountCents: z.number().int().nonnegative().safe().optional(),
  fxRate: z.number().positive().optional(),
  fxProvider: z.string().max(80).optional(),
  fxQuotedAt: z.string().datetime().optional()
}).optional();

const valueSchema = z.object({
  evidenceId: z.string().min(1),
  ocrRawText: z.string().optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
  ocrDetectedValue: z.string().optional(),
  manualConfirmedValue: z.string().optional(),
  moneyMetadata: moneyMetadataSchema
});

const startBatchSchema = z.object({
  startedAt: z.string().datetime().optional(),
  notificationsEnabled: z.boolean().default(false),
  shifts: z.array(valueSchema.extend({ modelTagId: z.string().min(1) })).min(1).max(2)
});

const endBatchSchema = z.object({
  endedAt: z.string().datetime().optional(),
  shifts: z.array(valueSchema.extend({
    shiftId: z.string().min(1),
    negativeJustification: z.string().max(500).optional()
  })).min(1).max(2)
});

const retroactiveBatchSchema = z.object({
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  shifts: z.array(z.object({
    modelTagId: z.string().min(1),
    start: valueSchema,
    end: valueSchema,
    negativeJustification: z.string().max(500).optional()
  })).min(1).max(2)
});

const batchParamsSchema = z.object({ batchId: z.string().uuid() });

type ValueInput = z.infer<typeof valueSchema>;

class BatchValidationError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

const ensureDistinct = (values: string[], message: string) => {
  if (new Set(values).size !== values.length) throw new BatchValidationError(400, message);
};

const resolveValue = (input: ValueInput, label: string) => {
  const detectedCents = resolveOcrValueCents({ detectedValue: input.ocrDetectedValue, rawText: input.ocrRawText });
  const manualCents = input.manualConfirmedValue ? brlStringToCents(input.manualConfirmedValue) : null;
  if (input.manualConfirmedValue && manualCents === null) {
    throw new BatchValidationError(400, `${label}: valor manual inválido. Use formato brasileiro, ex: R$ 1.234,56.`);
  }
  const confidence = input.ocrConfidence ?? null;
  if (confidence !== null && confidence < env.OCR_LOW_CONFIDENCE_THRESHOLD && manualCents === null) {
    throw new BatchValidationError(422, `${label}: OCR com baixa confiança. Confirme o valor manualmente.`);
  }
  const valueCents = manualCents ?? detectedCents;
  if (valueCents === null) {
    throw new BatchValidationError(400, `${label}: não foi possível determinar o valor. Confirme-o manualmente.`);
  }
  return { valueCents, confidence };
};

const ensureChatterTags = async (prisma: Prisma.TransactionClient, chatterId: string, modelTagIds: string[]) => {
  const count = await prisma.chatterModelTag.count({
    where: { chatterId, modelTagId: { in: modelTagIds }, modelTag: { isActive: true } }
  });
  if (count !== modelTagIds.length) throw new BatchValidationError(403, "Você não está vinculado a uma das modelos selecionadas.");
};

const claimEvidence = async (tx: Prisma.TransactionClient, chatterId: string, evidenceId: string) => {
  const claimed = await tx.evidence.updateMany({
    where: { id: evidenceId, uploadedById: chatterId, status: EvidenceStatus.AVAILABLE, attachedAt: null },
    data: { attachedAt: new Date() }
  });
  if (claimed.count !== 1) throw new BatchValidationError(409, "Um comprovante é inválido, já foi utilizado ou pertence a outro usuário.");
};

const syncEarnings = async (tx: Prisma.TransactionClient, chatterId: string, shiftId: string, amountCents: number) => {
  if (amountCents > 0) {
    await tx.earnings.upsert({
      where: { shiftId },
      create: { chatterId, shiftId, amountCents },
      update: { amountCents }
    });
  } else {
    await tx.earnings.deleteMany({ where: { shiftId } });
  }
};

const emitBatchUpdate = (fastify: Parameters<FastifyPluginAsync>[0], shiftIds: string[], operation: string) => {
  for (const shiftId of shiftIds) {
    fastify.io.to(MANAGER_ROOM).emit(ANALYTICS_UPDATED_EVENT, { shiftId, operation });
  }
};

const requestMeta = (request: FastifyRequest) => auditRequestMetadata(request);

const chatterBatchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/shifts/start-batch", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };
    if (authUser.role !== Role.CHATTER) return reply.code(403).send({ message: "Acesso restrito a chatters." });

    try {
      const body = startBatchSchema.parse(request.body);
      if (!body.notificationsEnabled) {
        return reply.code(403).send({ message: "Ative as notificações do navegador nas Preferências antes de abrir o ponto." });
      }
      ensureDistinct(body.shifts.map((item) => item.modelTagId), "Selecione modelos diferentes.");
      ensureDistinct(body.shifts.map((item) => item.evidenceId), "Cada modelo precisa de um comprovante próprio.");
      const startedAt = body.startedAt ? new Date(body.startedAt) : new Date();
      if (Number.isNaN(startedAt.getTime())) throw new BatchValidationError(400, "Data/hora de início inválida.");
      const prepared = body.shifts.map((item) => ({ ...item, ...resolveValue(item, "Entrada") }));
      const batchId = randomUUID();

      const shifts = await fastify.prisma.$transaction(async (tx) => {
        const modelTagIds = prepared.map((item) => item.modelTagId);
        await lockShiftChatter(tx, authUser.sub);
        await lockShiftModels(tx, modelTagIds);
        await assertOpenShiftLimit(tx, authUser.sub, prepared.length);
        await ensureChatterTags(tx, authUser.sub, modelTagIds);
        for (const item of prepared) {
          await assertNoShiftOverlap(tx, { modelTagId: item.modelTagId, startedAt });
        }
        const created = [];
        for (const item of prepared) {
          await claimEvidence(tx, authUser.sub, item.evidenceId);
          const shift = await tx.shift.create({
            data: {
              batchId, chatterId: authUser.sub, modelTagId: item.modelTagId, status: ShiftStatus.OPEN, startedAt,
              startEvidenceId: item.evidenceId, startOcrRawText: item.ocrRawText,
              startOcrConfidence: item.confidence, startValueCents: item.valueCents,
              startValueConfirmedAt: item.manualConfirmedValue ? startedAt : null,
              startOriginalCurrency: item.moneyMetadata?.currency ?? "BRL",
              startOriginalAmountCents: item.moneyMetadata?.originalAmountCents ?? item.valueCents,
              startFxRate: item.moneyMetadata?.fxRate, startFxProvider: item.moneyMetadata?.fxProvider,
              startFxQuotedAt: item.moneyMetadata?.fxQuotedAt ? new Date(item.moneyMetadata.fxQuotedAt) : null
            },
            include: { modelTag: { select: { id: true, name: true } } }
          });
          await tx.auditLog.create({
            data: { actorId: authUser.sub, action: AuditAction.SHIFT_STARTED, targetType: "Shift", targetId: shift.id,
              metadata: { batchId, modelTagId: shift.modelTagId, startValueCents: shift.startValueCents, ...requestMeta(request) } }
          });
          created.push(shift);
        }
        return created;
      });
      emitBatchUpdate(fastify, shifts.map((item) => item.id), "started");
      return reply.code(201).send({ batchId, shifts });
    } catch (error) {
      if (error instanceof ShiftOverlapError) return reply.code(409).send({ message: "Já existe um turno sobreposto para uma das modelos selecionadas.", conflictingShiftId: error.conflictingShiftId });
      if (error instanceof BatchValidationError) return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
  });

  fastify.post("/shifts/end-batch", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };
    if (authUser.role !== Role.CHATTER) return reply.code(403).send({ message: "Acesso restrito a chatters." });
    try {
      const body = endBatchSchema.parse(request.body);
      ensureDistinct(body.shifts.map((item) => item.shiftId), "Um turno foi enviado mais de uma vez.");
      ensureDistinct(body.shifts.map((item) => item.evidenceId), "Cada modelo precisa de um comprovante próprio.");
      const endedAt = body.endedAt ? new Date(body.endedAt) : new Date();
      if (Number.isNaN(endedAt.getTime())) throw new BatchValidationError(400, "Data/hora final inválida.");
      const shiftIds = body.shifts.map((item) => item.shiftId);
      const existing = await fastify.prisma.shift.findMany({
        where: { id: { in: shiftIds }, chatterId: authUser.sub, status: ShiftStatus.OPEN },
        include: { chatter: { select: { payoutPercentage: true } } }
      });
      if (existing.length !== shiftIds.length) throw new BatchValidationError(404, "Um dos turnos abertos não foi encontrado.");
      const batchIds = [...new Set(existing.map((item) => item.batchId).filter((id): id is string => Boolean(id)))];
      if (batchIds.length === 1) {
        const openInBatch = await fastify.prisma.shift.count({ where: { batchId: batchIds[0], chatterId: authUser.sub, status: ShiftStatus.OPEN } });
        if (openInBatch !== existing.length) throw new BatchValidationError(409, "Todos os turnos abertos juntos precisam ser encerrados na mesma operação.");
      }
      const byId = new Map(existing.map((item) => [item.id, item]));
      const prepared = body.shifts.map((item) => {
        const shift = byId.get(item.shiftId)!;
        if (endedAt <= shift.startedAt) throw new BatchValidationError(400, "O horário final deve ser posterior ao início de todos os turnos.");
        const resolved = resolveValue(item, `Saída de ${shift.modelTagId}`);
        const grossAmountCents = resolved.valueCents - shift.startValueCents;
        if (grossAmountCents < 0 && !item.negativeJustification?.trim()) {
          throw new BatchValidationError(400, "Saldo negativo exige uma justificativa para cada modelo afetada.");
        }
        return { ...item, ...resolved, shift, grossAmountCents, payoutPercentage: shift.chatter.payoutPercentage,
          payoutAmountCents: calculatePayoutCents(grossAmountCents, shift.chatter.payoutPercentage) };
      });
      const managerIds = prepared.some((item) => item.grossAmountCents < 0)
        ? (await fastify.prisma.user.findMany({ where: { role: Role.MANAGER, isActive: true }, select: { id: true } })).map((item) => item.id)
        : [];

      const closed = await fastify.prisma.$transaction(async (tx) => {
        await lockShiftModels(tx, prepared.map((item) => item.shift.modelTagId));
        for (const item of prepared) {
          await assertNoShiftOverlap(tx, { modelTagId: item.shift.modelTagId, startedAt: item.shift.startedAt, endedAt, excludeShiftIds: shiftIds });
        }
        const results = [];
        for (const item of prepared) {
          await claimEvidence(tx, authUser.sub, item.evidenceId);
          const updated = await tx.shift.update({ where: { id: item.shift.id }, data: {
            status: ShiftStatus.CLOSED, endedAt, endEvidenceId: item.evidenceId,
            endOcrRawText: item.ocrRawText, endOcrConfidence: item.confidence, endValueCents: item.valueCents,
            endValueConfirmedAt: item.manualConfirmedValue ? endedAt : null,
            grossAmountCents: item.grossAmountCents, commissionDivisor: null,
            payoutPercentage: item.payoutPercentage, payoutAmountCents: item.payoutAmountCents,
            negativeJustification: item.grossAmountCents < 0 ? item.negativeJustification?.trim() : null,
            endOriginalCurrency: item.moneyMetadata?.currency ?? "BRL",
            endOriginalAmountCents: item.moneyMetadata?.originalAmountCents ?? item.valueCents,
            endFxRate: item.moneyMetadata?.fxRate, endFxProvider: item.moneyMetadata?.fxProvider,
            endFxQuotedAt: item.moneyMetadata?.fxQuotedAt ? new Date(item.moneyMetadata.fxQuotedAt) : null
          } });
          await syncEarnings(tx, authUser.sub, updated.id, item.payoutAmountCents);
          await tx.auditLog.create({ data: { actorId: authUser.sub, action: AuditAction.SHIFT_CLOSED,
            targetType: "Shift", targetId: updated.id, metadata: { batchId: updated.batchId, modelTagId: updated.modelTagId,
              grossAmountCents: item.grossAmountCents, payoutPercentage: item.payoutPercentage,
              payoutAmountCents: item.payoutAmountCents, ...requestMeta(request) } } });
          if (item.grossAmountCents < 0) {
            await tx.notification.createMany({ data: [...new Set([authUser.sub, ...managerIds])].map((userId) => ({
              userId, type: NotificationType.NEGATIVE_SHIFT, title: "Turno com saldo negativo",
              message: "Um turno foi encerrado com produção negativa e requer acompanhamento.", sourceType: "Shift", sourceId: updated.id,
              metadata: { chatterId: authUser.sub, modelTagId: updated.modelTagId, grossAmountCents: item.grossAmountCents }
            })), skipDuplicates: true });
          }
          results.push(updated);
        }
        return results;
      });
      emitBatchUpdate(fastify, closed.map((item) => item.id), "closed");
      return { shifts: closed.map((item) => ({ ...item,
        grossAmountFormatted: item.grossAmountCents !== null ? centsToBrl(item.grossAmountCents) : null,
        payoutAmountFormatted: item.payoutAmountCents !== null ? centsToBrl(item.payoutAmountCents) : null })) };
    } catch (error) {
      if (error instanceof ShiftOverlapError) return reply.code(409).send({ message: "O período informado se sobrepõe a outro turno da mesma modelo.", conflictingShiftId: error.conflictingShiftId });
      if (error instanceof BatchValidationError) return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
  });

  fastify.post("/shifts/retroactive-batch", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };
    if (authUser.role !== Role.CHATTER) return reply.code(403).send({ message: "Acesso restrito a chatters." });
    try {
      const body = retroactiveBatchSchema.parse(request.body);
      const startedAt = new Date(body.startedAt);
      const endedAt = new Date(body.endedAt);
      if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime()) || endedAt <= startedAt) {
        throw new BatchValidationError(400, "Informe um período anterior válido, com a saída depois da entrada.");
      }
      if (endedAt > new Date()) throw new BatchValidationError(400, "O encerramento do turno anterior não pode estar no futuro.");
      ensureDistinct(body.shifts.map((item) => item.modelTagId), "Selecione modelos diferentes.");
      ensureDistinct(body.shifts.flatMap((item) => [item.start.evidenceId, item.end.evidenceId]), "Cada captura precisa usar um comprovante próprio.");
      const chatter = await fastify.prisma.user.findUnique({ where: { id: authUser.sub }, select: { payoutPercentage: true } });
      if (!chatter) throw new BatchValidationError(404, "Chatter não encontrado.");
      const prepared = body.shifts.map((item) => {
        const start = resolveValue(item.start, `Entrada de ${item.modelTagId}`);
        const end = resolveValue(item.end, `Saída de ${item.modelTagId}`);
        const grossAmountCents = end.valueCents - start.valueCents;
        if (grossAmountCents < 0 && !item.negativeJustification?.trim()) {
          throw new BatchValidationError(400, "Saldo negativo exige uma justificativa para cada modelo afetada.");
        }
        return { ...item, start: { ...item.start, ...start }, end: { ...item.end, ...end }, grossAmountCents,
          payoutAmountCents: calculatePayoutCents(grossAmountCents, chatter.payoutPercentage) };
      });
      const batchId = randomUUID();
      const managerIds = prepared.some((item) => item.grossAmountCents < 0)
        ? (await fastify.prisma.user.findMany({ where: { role: Role.MANAGER, isActive: true }, select: { id: true } })).map((item) => item.id)
        : [];
      const shifts = await fastify.prisma.$transaction(async (tx) => {
        const modelTagIds = prepared.map((item) => item.modelTagId);
        await lockShiftModels(tx, modelTagIds);
        await ensureChatterTags(tx, authUser.sub, modelTagIds);
        for (const item of prepared) await assertNoShiftOverlap(tx, { modelTagId: item.modelTagId, startedAt, endedAt });
        const created = [];
        for (const item of prepared) {
          await claimEvidence(tx, authUser.sub, item.start.evidenceId);
          await claimEvidence(tx, authUser.sub, item.end.evidenceId);
          const shift = await tx.shift.create({ data: {
            batchId, chatterId: authUser.sub, modelTagId: item.modelTagId, status: ShiftStatus.CLOSED, startedAt, endedAt,
            startEvidenceId: item.start.evidenceId, startOcrRawText: item.start.ocrRawText,
            startOcrConfidence: item.start.confidence, startValueCents: item.start.valueCents,
            startValueConfirmedAt: item.start.manualConfirmedValue ? startedAt : null,
            startOriginalCurrency: item.start.moneyMetadata?.currency ?? "BRL",
            startOriginalAmountCents: item.start.moneyMetadata?.originalAmountCents ?? item.start.valueCents,
            startFxRate: item.start.moneyMetadata?.fxRate, startFxProvider: item.start.moneyMetadata?.fxProvider,
            startFxQuotedAt: item.start.moneyMetadata?.fxQuotedAt ? new Date(item.start.moneyMetadata.fxQuotedAt) : null,
            endEvidenceId: item.end.evidenceId, endOcrRawText: item.end.ocrRawText,
            endOcrConfidence: item.end.confidence, endValueCents: item.end.valueCents,
            endValueConfirmedAt: item.end.manualConfirmedValue ? endedAt : null,
            endOriginalCurrency: item.end.moneyMetadata?.currency ?? "BRL",
            endOriginalAmountCents: item.end.moneyMetadata?.originalAmountCents ?? item.end.valueCents,
            endFxRate: item.end.moneyMetadata?.fxRate, endFxProvider: item.end.moneyMetadata?.fxProvider,
            endFxQuotedAt: item.end.moneyMetadata?.fxQuotedAt ? new Date(item.end.moneyMetadata.fxQuotedAt) : null,
            grossAmountCents: item.grossAmountCents, commissionDivisor: null, payoutPercentage: chatter.payoutPercentage,
            payoutAmountCents: item.payoutAmountCents,
            negativeJustification: item.grossAmountCents < 0 ? item.negativeJustification?.trim() : null
          }, include: { modelTag: { select: { id: true, name: true } } } });
          await syncEarnings(tx, authUser.sub, shift.id, item.payoutAmountCents);
          await tx.auditLog.createMany({ data: [
            { actorId: authUser.sub, action: AuditAction.SHIFT_STARTED, targetType: "Shift", targetId: shift.id,
              metadata: { batchId, retroactive: true, modelTagId: shift.modelTagId, startValueCents: shift.startValueCents, ...requestMeta(request) } },
            { actorId: authUser.sub, action: AuditAction.SHIFT_CLOSED, targetType: "Shift", targetId: shift.id,
              metadata: { batchId, retroactive: true, modelTagId: shift.modelTagId, grossAmountCents: item.grossAmountCents,
                payoutPercentage: chatter.payoutPercentage, payoutAmountCents: item.payoutAmountCents, ...requestMeta(request) } }
          ] });
          if (item.grossAmountCents < 0) {
            await tx.notification.createMany({ data: [...new Set([authUser.sub, ...managerIds])].map((userId) => ({
              userId, type: NotificationType.NEGATIVE_SHIFT, title: "Turno com saldo negativo",
              message: "Um turno anterior foi lançado com produção negativa e requer acompanhamento.", sourceType: "Shift", sourceId: shift.id,
              metadata: { chatterId: authUser.sub, modelTagId: shift.modelTagId, grossAmountCents: item.grossAmountCents }
            })), skipDuplicates: true });
          }
          created.push(shift);
        }
        return created;
      });
      emitBatchUpdate(fastify, shifts.map((item) => item.id), "created-retroactive");
      return reply.code(201).send({ batchId, shifts });
    } catch (error) {
      if (error instanceof ShiftOverlapError) return reply.code(409).send({ message: "O período informado se sobrepõe a outro turno da mesma modelo.", conflictingShiftId: error.conflictingShiftId });
      if (error instanceof BatchValidationError) return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
  });

  fastify.delete("/shifts/batches/:batchId", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };
    if (authUser.role !== Role.CHATTER) return reply.code(403).send({ message: "Acesso restrito a chatters." });
    const { batchId } = batchParamsSchema.parse(request.params);
    const shifts = await fastify.prisma.shift.findMany({
      where: { batchId, chatterId: authUser.sub, status: ShiftStatus.OPEN },
      include: { earnings: true }
    });
    if (!shifts.length) return reply.code(404).send({ message: "Lote de turnos abertos não encontrado." });
    if (shifts.some((item) => item.earnings?.status === EarningsStatus.PAID)) return reply.code(409).send({ message: "Turno pago não pode ser apagado." });
    const evidenceIds = shifts.flatMap((item) => [item.startEvidenceId, item.endEvidenceId]).filter((id): id is string => Boolean(id));
    await fastify.prisma.$transaction(async (tx) => {
      await queueEvidencePurge(tx, evidenceIds);
      await tx.shift.deleteMany({ where: { id: { in: shifts.map((item) => item.id) } } });
      await tx.auditLog.createMany({ data: shifts.map((item) => ({ actorId: authUser.sub, action: AuditAction.SHIFT_DELETED,
        targetType: "Shift", targetId: item.id, metadata: { batchId, modelTagId: item.modelTagId, status: item.status, ...requestMeta(request) } })) });
    });
    emitBatchUpdate(fastify, shifts.map((item) => item.id), "deleted");
    return { success: true };
  });
};

export default chatterBatchRoutes;
