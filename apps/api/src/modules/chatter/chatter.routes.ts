import { AuditAction, EarningsStatus, EvidenceStatus, NotificationType, Prisma, Role, ShiftStatus } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../../config/env";
import { paginationArgs, paginationMeta, paginationSchema } from "../../utils/pagination";
import { auditRequestMetadata } from "../../utils/audit";
import { brlStringToCents, centsToBrl, resolveOcrValueCents } from "../../utils/currency";
import { getMonthRangeInBusinessTz, nowInBusinessTz } from "../../utils/time";
import { calculatePayoutCents } from "../../utils/payout";
import { ANALYTICS_UPDATED_EVENT, MANAGER_ROOM } from "../manager/manager.events";
import { queueEvidencePurge } from "../../services/evidence-cleanup";
import { modelRoomName } from "../chat/chat.shared";
import { createShiftChatEvent } from "./shift-chat";
import {
  assertModelsHaveNoOpenShift,
  assertNoShiftOverlap,
  assertOpenShiftLimit,
  ChatterUnavailableError,
  lockShiftChatter,
  lockShiftModels,
  ModelOpenShiftError,
  ShiftOverlapError
} from "./shift-overlap";

const moneyMetadataSchema = z.object({
  currency: z.enum(["BRL", "USD"]).default("BRL"),
  originalAmountCents: z.number().int().nonnegative().safe().optional(),
  fxRate: z.number().positive().optional(),
  fxProvider: z.string().max(80).optional(),
  fxQuotedAt: z.string().datetime().optional()
}).optional();

const startShiftSchema = z.object({
  modelTagId: z.string().min(1),
  startedAt: z.string().datetime().optional(),
  startImageUrl: z.string().min(1).optional(),
  startEvidenceId: z.string().min(1).optional(),
  moneyMetadata: moneyMetadataSchema,
  ocrRawText: z.string().optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
  ocrDetectedValue: z.string().optional(),
  manualConfirmedValue: z.string().optional(),
  notificationsEnabled: z.boolean().optional().default(false)
});

const closeShiftSchema = z.object({
  endedAt: z.string().datetime().optional(),
  endImageUrl: z.string().min(1).optional(),
  endEvidenceId: z.string().min(1).optional(),
  moneyMetadata: moneyMetadataSchema,
  ocrRawText: z.string().optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
  ocrDetectedValue: z.string().optional(),
  manualConfirmedValue: z.string().optional(),
  negativeJustification: z.string().optional()
});

const shiftParamsSchema = z.object({
  shiftId: z.string().min(1)
});

const historyQuerySchema = paginationSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  search: z.string().trim().max(100).optional(),
  status: z.enum([ShiftStatus.OPEN, ShiftStatus.CLOSED]).optional(),
  modelTagId: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

const paymentHistoryQuerySchema = paginationSchema.extend({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

const updateShiftSchema = z
  .object({
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().optional(),
    startImageUrl: z.string().min(1).optional(),
    endImageUrl: z.string().min(1).optional(),
    startValue: z.string().optional(),
    endValue: z.string().optional(),
    negativeJustification: z.string().optional(),
    notes: z.string().max(500).optional()
  })
  .refine(
    (value) =>
      value.startedAt !== undefined ||
      value.endedAt !== undefined ||
      value.startImageUrl !== undefined ||
      value.endImageUrl !== undefined ||
      value.startValue !== undefined ||
      value.endValue !== undefined ||
      value.negativeJustification !== undefined ||
      value.notes !== undefined,
    { message: "Informe pelo menos um campo para atualizacao." }
  );

const ensureChatterRole = (role: Role) => {
  if (role !== Role.CHATTER) {
    return false;
  }

  return true;
};

const chatterRoutes: FastifyPluginAsync = async (fastify) => {
  const ensureEditableEarnings = async (chatterId: string, shiftId: string) => {
    const shift = await fastify.prisma.shift.findFirst({
      where: { id: shiftId, chatterId },
      include: { earnings: true }
    });

    if (shift?.earnings?.status === EarningsStatus.PAID) {
      return {
        editable: false,
        message: "Lancamentos de ganho ja pago nao podem ser editados ou apagados."
      };
    }

    if (shift?.chatterVerifiedAt) {
      return {
        editable: false,
        message: "Desfaça a confirmação dos honorários antes de editar ou apagar este lançamento."
      };
    }

    return { editable: true };
  };

  const syncEarningsForShift = async (
    tx: Prisma.TransactionClient,
    chatterId: string,
    shiftId: string,
    payoutAmountCents: number
  ) => {
    if (payoutAmountCents > 0) {
      await tx.earnings.upsert({
        where: { shiftId },
        create: { chatterId, shiftId, amountCents: payoutAmountCents },
        update: { amountCents: payoutAmountCents }
      });
    } else {
      await tx.earnings.deleteMany({ where: { shiftId } });
    }
  };

  fastify.get("/shifts/current", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (!ensureChatterRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a chatters." });
    }

    const shifts = await fastify.prisma.shift.findMany({
      where: {
        chatterId: authUser.sub,
        status: ShiftStatus.OPEN
      },
      include: {
        modelTag: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        startedAt: "desc"
      }
    });

    return { shifts, shift: shifts[0] ?? null };
  });

  fastify.get("/shifts/history", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (!ensureChatterRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a chatters." });
    }

    const query = historyQuerySchema.parse(request.query);

    const where: Prisma.ShiftWhereInput = {
      chatterId: authUser.sub,
      ...(query.status ? { status: query.status } : {}),
      ...(query.modelTagId ? { modelTagId: query.modelTagId } : {}),
      ...(query.search ? { modelTag: { name: { contains: query.search, mode: "insensitive" } } } : {}),
      ...(query.from || query.to
        ? { startedAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) } }
        : {})
    };
    const isV1 = request.url.startsWith("/api/v1/");
    const [shifts, total] = await fastify.prisma.$transaction([
      fastify.prisma.shift.findMany({
      where,
      include: {
        modelTag: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      ...(isV1 ? paginationArgs(query.page, query.pageSize) : { take: query.limit })
      }),
      fastify.prisma.shift.count({ where })
    ]);

    const items = shifts.map((shift) => ({
        ...shift,
        startValueFormatted: centsToBrl(shift.startValueCents),
        endValueFormatted: shift.endValueCents !== null ? centsToBrl(shift.endValueCents) : null,
        grossAmountFormatted: shift.grossAmountCents !== null ? centsToBrl(shift.grossAmountCents) : null,
        payoutAmountFormatted: shift.payoutAmountCents !== null ? centsToBrl(shift.payoutAmountCents) : null
      }));
    return { shifts: items, items, pagination: paginationMeta(query.page, isV1 ? query.pageSize : query.limit, total) };
  });

  fastify.get("/payment/review", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };
    if (!ensureChatterRole(authUser.role)) return reply.code(403).send({ message: "Acesso restrito a chatters." });
    const query = paginationSchema.parse(request.query);
    const where: Prisma.ShiftWhereInput = {
      chatterId: authUser.sub,
      status: ShiftStatus.CLOSED,
      OR: [
        { earnings: { is: null } },
        { earnings: { is: { status: EarningsStatus.PENDING } } }
      ]
    };
    const [shifts, total] = await fastify.prisma.$transaction([
      fastify.prisma.shift.findMany({
        where,
        include: {
          modelTag: { select: { id: true, name: true } },
          earnings: true,
          startEvidence: { select: { id: true, originalName: true, status: true, purgedAt: true, sha256: true } },
          endEvidence: { select: { id: true, originalName: true, status: true, purgedAt: true, sha256: true } },
          reconciliations: {
            include: { statementImport: { select: { id: true, originalName: true, vendorName: true, createdAt: true } } },
            orderBy: { createdAt: "desc" },
            take: 10
          }
        },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        ...paginationArgs(query.page, query.pageSize)
      }),
      fastify.prisma.shift.count({ where })
    ]);
    const items = shifts.map((shift) => {
      const reconciliation = shift.reconciliations.find((item) => item.shiftReviewRevision === shift.reviewRevision) ?? null;
      return {
        ...shift,
        reconciliations: undefined,
        reconciliation,
        startValueFormatted: centsToBrl(shift.startValueCents),
        endValueFormatted: shift.endValueCents !== null ? centsToBrl(shift.endValueCents) : null,
        grossAmountFormatted: shift.grossAmountCents !== null ? centsToBrl(shift.grossAmountCents) : null,
        payoutAmountFormatted: shift.payoutAmountCents !== null ? centsToBrl(shift.payoutAmountCents) : null,
        earnings: shift.earnings ? { ...shift.earnings, amountFormatted: centsToBrl(shift.earnings.amountCents) } : null
      };
    });
    return { items, shifts: items, pagination: paginationMeta(query.page, query.pageSize, total) };
  });

  fastify.post("/shifts/:shiftId/verify", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };
    if (!ensureChatterRole(authUser.role)) return reply.code(403).send({ message: "Acesso restrito a chatters." });
    const { shiftId } = shiftParamsSchema.parse(request.params);
    const shift = await fastify.prisma.shift.findFirst({
      where: { id: shiftId, chatterId: authUser.sub, status: ShiftStatus.CLOSED },
      include: { earnings: true }
    });
    if (!shift) return reply.code(404).send({ message: "Lançamento fechado não encontrado." });
    if (shift.earnings?.status === EarningsStatus.PAID) return reply.code(409).send({ message: "Este lançamento já foi pago." });
    if (shift.chatterVerifiedAt) return { shiftId, chatterVerifiedAt: shift.chatterVerifiedAt, reviewRevision: shift.reviewRevision };
    const verifiedAt = new Date();
    await fastify.prisma.$transaction([
      fastify.prisma.shift.update({ where: { id: shift.id }, data: { chatterVerifiedAt: verifiedAt } }),
      fastify.prisma.auditLog.create({ data: {
        actorId: authUser.sub, action: AuditAction.SHIFT_VERIFIED, targetType: "Shift", targetId: shift.id,
        metadata: { reviewRevision: shift.reviewRevision, ...auditRequestMetadata(request) }
      } })
    ]);
    fastify.io.to(MANAGER_ROOM).emit("payments:updated", { chatterId: authUser.sub, shiftId: shift.id });
    return { shiftId, chatterVerifiedAt: verifiedAt, reviewRevision: shift.reviewRevision };
  });

  fastify.delete("/shifts/:shiftId/verify", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };
    if (!ensureChatterRole(authUser.role)) return reply.code(403).send({ message: "Acesso restrito a chatters." });
    const { shiftId } = shiftParamsSchema.parse(request.params);
    const shift = await fastify.prisma.shift.findFirst({ where: { id: shiftId, chatterId: authUser.sub, status: ShiftStatus.CLOSED }, include: { earnings: true } });
    if (!shift) return reply.code(404).send({ message: "Lançamento fechado não encontrado." });
    if (shift.earnings?.status === EarningsStatus.PAID) return reply.code(409).send({ message: "Este lançamento já foi pago." });
    if (!shift.chatterVerifiedAt) return { success: true };
    await fastify.prisma.$transaction([
      fastify.prisma.shift.update({ where: { id: shift.id }, data: { chatterVerifiedAt: null } }),
      fastify.prisma.auditLog.create({ data: {
        actorId: authUser.sub, action: AuditAction.SHIFT_UNVERIFIED, targetType: "Shift", targetId: shift.id,
        metadata: { reviewRevision: shift.reviewRevision, ...auditRequestMetadata(request) }
      } })
    ]);
    fastify.io.to(MANAGER_ROOM).emit("payments:updated", { chatterId: authUser.sub, shiftId: shift.id });
    return { success: true };
  });

  fastify.patch("/shifts/:shiftId", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (!ensureChatterRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a chatters." });
    }

    const params = shiftParamsSchema.parse(request.params);
    const body = updateShiftSchema.parse(request.body);

    const shift = await fastify.prisma.shift.findFirst({
      where: {
        id: params.shiftId,
        chatterId: authUser.sub,
        status: ShiftStatus.CLOSED
      },
      include: {
        modelTag: {
          select: {
            id: true,
            name: true
          }
        },
        chatter: { select: { payoutPercentage: true } }
      }
    });

    if (!shift) {
      return reply.code(404).send({ message: "Lancamento fechado nao encontrado." });
    }

    const editable = await ensureEditableEarnings(authUser.sub, shift.id);
    if (!editable.editable) {
      return reply.code(409).send({ message: editable.message });
    }

    const startedAt = body.startedAt ? new Date(body.startedAt) : shift.startedAt;
    const endedAt = body.endedAt ? new Date(body.endedAt) : shift.endedAt;

    if (!endedAt) {
      return reply.code(400).send({ message: "Lancamento fechado precisa de data/hora final." });
    }

    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
      return reply.code(400).send({ message: "Data/hora invalida." });
    }

    if (endedAt <= startedAt) {
      return reply.code(400).send({ message: "Data/hora final precisa ser posterior ao inicio." });
    }

    const startValueCents = body.startValue !== undefined ? brlStringToCents(body.startValue) : shift.startValueCents;
    const endValueCents = body.endValue !== undefined ? brlStringToCents(body.endValue) : shift.endValueCents;

    if (startValueCents === null || endValueCents === null) {
      return reply.code(400).send({ message: "Valor invalido. Use formato brasileiro, ex: R$ 1.234,56." });
    }

    const grossAmountCents = endValueCents - startValueCents;
    const recalculatesPayout = body.startValue !== undefined || body.endValue !== undefined;
    const payoutPercentage = recalculatesPayout
      ? shift.chatter.payoutPercentage
      : shift.payoutPercentage
        ?? (shift.commissionDivisor ? Math.trunc(100 / shift.commissionDivisor) : shift.chatter.payoutPercentage);
    const payoutAmountCents = recalculatesPayout
      ? calculatePayoutCents(grossAmountCents, payoutPercentage)
      : shift.payoutAmountCents ?? calculatePayoutCents(grossAmountCents, payoutPercentage);
    const negativeJustification = body.negativeJustification ?? shift.negativeJustification ?? null;

    if (grossAmountCents < 0 && !(negativeJustification && negativeJustification.trim().length > 0)) {
      return reply.code(400).send({ message: "Saldo negativo exige justificativa." });
    }

    const updatedShift = await fastify.prisma.$transaction(async (tx) => {
      await lockShiftChatter(tx, authUser.sub);
      const activeChatter = await tx.user.findFirst({
        where: { id: authUser.sub, role: Role.CHATTER, isActive: true, deletedAt: null },
        select: { id: true }
      });
      if (!activeChatter) throw new ChatterUnavailableError();
      await lockShiftModels(tx, [shift.modelTagId]);
      await assertNoShiftOverlap(tx, {
        modelTagId: shift.modelTagId,
        startedAt,
        endedAt,
        excludeShiftIds: [shift.id]
      });
      const updated = await tx.shift.update({
        where: {
          id: shift.id
        },
        data: {
          startedAt,
          endedAt,
          startImageUrl: body.startImageUrl ?? shift.startImageUrl,
          endImageUrl: body.endImageUrl ?? shift.endImageUrl,
          startValueCents,
          endValueCents,
          startValueConfirmedAt: new Date(),
          endValueConfirmedAt: new Date(),
          grossAmountCents,
          commissionDivisor: recalculatesPayout ? null : shift.commissionDivisor,
          payoutPercentage,
          payoutAmountCents,
          negativeJustification: grossAmountCents < 0 ? negativeJustification?.trim() ?? null : null,
          notes: body.notes !== undefined ? (body.notes.trim() === "" ? null : body.notes.trim()) : shift.notes,
          reviewRevision: { increment: 1 }
        },
        include: {
          modelTag: {
            select: {
              id: true,
              name: true
            }
          },
          startEvidence: { select: { id: true, originalName: true, status: true, purgedAt: true, sha256: true } },
          endEvidence: { select: { id: true, originalName: true, status: true, purgedAt: true, sha256: true } }
        }
      });

      await syncEarningsForShift(tx, authUser.sub, shift.id, payoutAmountCents);

      await tx.auditLog.create({
        data: {
          actorId: authUser.sub,
          action: AuditAction.SHIFT_UPDATED,
          targetType: "Shift",
          targetId: shift.id,
          metadata: { fields: Object.keys(body), grossAmountCents, payoutPercentage, payoutAmountCents, ...auditRequestMetadata(request) }
        }
      });

      return updated;
    });

    fastify.io.to(MANAGER_ROOM).emit(ANALYTICS_UPDATED_EVENT, {
      shiftId: updatedShift.id,
      operation: "updated"
    });

    return {
      shift: {
        ...updatedShift,
        startValueFormatted: centsToBrl(updatedShift.startValueCents),
        endValueFormatted: updatedShift.endValueCents !== null ? centsToBrl(updatedShift.endValueCents) : null,
        grossAmountFormatted:
          updatedShift.grossAmountCents !== null ? centsToBrl(updatedShift.grossAmountCents) : null,
        payoutAmountFormatted:
          updatedShift.payoutAmountCents !== null ? centsToBrl(updatedShift.payoutAmountCents) : null
      }
    };
  });

  fastify.delete("/shifts/:shiftId", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (!ensureChatterRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a chatters." });
    }

    const params = shiftParamsSchema.parse(request.params);

    const shift = await fastify.prisma.shift.findFirst({
      where: {
        id: params.shiftId,
        chatterId: authUser.sub
      }
    });

    if (!shift) {
      return reply.code(404).send({ message: "Lancamento nao encontrado." });
    }

    if (shift.status === ShiftStatus.CLOSED) {
      const editable = await ensureEditableEarnings(authUser.sub, shift.id);
      if (!editable.editable) {
        return reply.code(409).send({ message: editable.message });
      }
    }

    const evidence = await fastify.prisma.evidence.findMany({
      where: { id: { in: [shift.startEvidenceId, shift.endEvidenceId].filter((id): id is string => Boolean(id)) } },
      select: { id: true, sha256: true }
    });
    await fastify.prisma.$transaction(async (tx) => {
      await queueEvidencePurge(tx, evidence.map((item) => item.id));
      await tx.shift.delete({ where: { id: shift.id } });
      await tx.auditLog.create({
        data: {
          actorId: authUser.sub,
          action: AuditAction.SHIFT_DELETED,
          targetType: "Shift",
          targetId: shift.id,
          metadata: {
            modelTagId: shift.modelTagId, status: shift.status,
            grossAmountCents: shift.grossAmountCents,
            evidence: evidence.map((item) => ({ id: item.id, sha256: item.sha256 })),
            ...auditRequestMetadata(request)
          }
        }
      });
    });

    fastify.io.to(MANAGER_ROOM).emit(ANALYTICS_UPDATED_EVENT, {
      shiftId: shift.id,
      operation: "deleted"
    });

    return {
      success: true
    };
  });

  fastify.post("/shifts/start", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (!ensureChatterRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a chatters." });
    }

    const body = startShiftSchema.parse(request.body);
    const isV1 = request.url.startsWith("/api/v1/");
    if (isV1 && !body.startEvidenceId) return reply.code(400).send({ message: "Envie o comprovante inicial antes de iniciar o turno." });
    if (!isV1 && !body.startEvidenceId && !body.startImageUrl) return reply.code(400).send({ message: "Envie o comprovante inicial antes de iniciar o turno." });
    if (!body.notificationsEnabled) return reply.code(403).send({ message: "Ative as notificações do navegador nas Preferências antes de abrir o ponto.", code: "NOTIFICATIONS_REQUIRED" });
    const startedAt = body.startedAt ? new Date(body.startedAt) : nowInBusinessTz().toDate();

    if (Number.isNaN(startedAt.getTime())) {
      return reply.code(400).send({ message: "Data/hora de inicio invalida." });
    }

    const resolvedCents = resolveOcrValueCents({
      detectedValue: body.ocrDetectedValue,
      rawText: body.ocrRawText
    });

    const manualCents = body.manualConfirmedValue ? brlStringToCents(body.manualConfirmedValue) : null;
    if (body.manualConfirmedValue && manualCents === null) {
      return reply.code(400).send({ message: "Valor manual inválido. Use formato brasileiro, ex: R$ 1.234,56." });
    }

    const confidence = body.ocrConfidence ?? null;
    const needsManualConfirmation = confidence !== null && confidence < env.OCR_LOW_CONFIDENCE_THRESHOLD;

    if (needsManualConfirmation && manualCents === null) {
      return reply.code(422).send({
        message: "OCR com baixa confiança. Confirme o valor manualmente para continuar.",
        requiresManualConfirmation: true,
        detectedValue: resolvedCents !== null ? centsToBrl(resolvedCents) : null,
        confidence
      });
    }

    const finalStartValueCents = manualCents ?? resolvedCents;
    if (finalStartValueCents === null) {
      return reply.code(400).send({
        message: "Não foi possível determinar o saldo inicial pela imagem/OCR. Confirme manualmente o valor."
      });
    }

    let result;
    try {
      result = await fastify.prisma.$transaction(async (tx) => {
      await lockShiftChatter(tx, authUser.sub);
      await lockShiftModels(tx, [body.modelTagId]);
      const chatter = await tx.user.findFirst({
        where: { id: authUser.sub, role: Role.CHATTER, isActive: true, deletedAt: null },
        select: { id: true, displayName: true }
      });
      const chatterHasTag = chatter
        ? await tx.chatterModelTag.findFirst({
            where: { chatterId: authUser.sub, modelTagId: body.modelTagId, modelTag: { isActive: true } },
            select: { id: true }
          })
        : null;
      if (!chatter || !chatterHasTag) throw new Error("CHATTER_TAG_UNAVAILABLE");
      await assertOpenShiftLimit(tx, authUser.sub, 1);
      await assertModelsHaveNoOpenShift(tx, [body.modelTagId]);
      await assertNoShiftOverlap(tx, { modelTagId: body.modelTagId, startedAt });
      if (body.startEvidenceId) {
        const claimed = await tx.evidence.updateMany({
          where: { id: body.startEvidenceId, uploadedById: authUser.sub, status: EvidenceStatus.AVAILABLE, attachedAt: null },
          data: { attachedAt: new Date() }
        });
        if (claimed.count !== 1) throw new Error("EVIDENCE_NOT_ATTACHABLE");
      }
      const created = await tx.shift.create({ data: {
        chatterId: authUser.sub,
        modelTagId: body.modelTagId,
        status: ShiftStatus.OPEN,
        startedAt,
        startImageUrl: body.startImageUrl ?? null,
        startEvidenceId: body.startEvidenceId,
        startOcrRawText: body.ocrRawText,
        startOcrConfidence: confidence,
        startValueCents: finalStartValueCents,
        startValueConfirmedAt: body.manualConfirmedValue ? startedAt : null,
        startOriginalCurrency: body.moneyMetadata?.currency ?? "BRL",
        startOriginalAmountCents: body.moneyMetadata?.originalAmountCents ?? finalStartValueCents,
        startFxRate: body.moneyMetadata?.fxRate,
        startFxProvider: body.moneyMetadata?.fxProvider,
        startFxQuotedAt: body.moneyMetadata?.fxQuotedAt ? new Date(body.moneyMetadata.fxQuotedAt) : null
      }, include: {
        modelTag: {
          select: {
            id: true,
            name: true
          }
        }
      } });
      await tx.auditLog.create({ data: {
        actorId: authUser.sub,
        action: AuditAction.SHIFT_STARTED,
        targetType: "Shift",
        targetId: created.id,
        metadata: {
          modelTagId: created.modelTagId, startValueCents: created.startValueCents,
          ...auditRequestMetadata(request)
        }
      } });
      const chatMessage = await createShiftChatEvent(tx, {
        chatterId: chatter.id,
        chatterDisplayName: chatter.displayName,
        modelTagId: created.modelTagId,
        occurredAt: startedAt,
        event: "OPENED"
      });
      return { shift: created, chatMessage };
      });
    } catch (error) {
      if (error instanceof ModelOpenShiftError) {
        return reply.code(409).send({ message: error.message, conflictingShiftId: error.conflictingShiftId });
      }
      if (error instanceof ShiftOverlapError) {
        return reply.code(409).send({ message: error.message, conflictingShiftId: error.conflictingShiftId });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "Outro turno foi aberto ao mesmo tempo. Atualize a página e tente novamente." });
      }
      if ((error as Error).message === "CHATTER_TAG_UNAVAILABLE") return reply.code(403).send({ message: "Chatter não vinculado a essa modelo." });
      if ((error as Error).message === "EVIDENCE_NOT_ATTACHABLE") return reply.code(409).send({ message: "Comprovante inválido, já utilizado ou pertencente a outro usuário." });
      throw error;
    }

    const { shift, chatMessage } = result;
    fastify.io.to(modelRoomName(shift.modelTagId)).emit("chat:message", chatMessage);

    return reply.code(201).send({
      shift,
      startValueFormatted: centsToBrl(shift.startValueCents)
    });
  });

  fastify.post("/shifts/:shiftId/end", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (!ensureChatterRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a chatters." });
    }

    const params = shiftParamsSchema.parse(request.params);
    const body = closeShiftSchema.parse(request.body);
    const isV1 = request.url.startsWith("/api/v1/");
    if (isV1 && !body.endEvidenceId) return reply.code(400).send({ message: "Envie o comprovante final antes de encerrar o turno." });
    if (!isV1 && !body.endEvidenceId && !body.endImageUrl) return reply.code(400).send({ message: "Envie o comprovante final antes de encerrar o turno." });
    const endedAt = body.endedAt ? new Date(body.endedAt) : nowInBusinessTz().toDate();

    if (Number.isNaN(endedAt.getTime())) {
      return reply.code(400).send({ message: "Data/hora de batida invalida." });
    }

    const shift = await fastify.prisma.shift.findFirst({
      where: {
        id: params.shiftId,
        chatterId: authUser.sub,
        status: ShiftStatus.OPEN
      },
      include: { chatter: { select: { payoutPercentage: true, displayName: true } } }
    });

    if (!shift) {
      return reply.code(404).send({ message: "Turno aberto não encontrado para esse chatter." });
    }

    if (endedAt <= shift.startedAt) {
      return reply.code(400).send({ message: "Data/hora da batida final precisa ser posterior ao inicio do turno." });
    }

    const resolvedCents = resolveOcrValueCents({
      detectedValue: body.ocrDetectedValue,
      rawText: body.ocrRawText
    });

    const manualCents = body.manualConfirmedValue ? brlStringToCents(body.manualConfirmedValue) : null;
    if (body.manualConfirmedValue && manualCents === null) {
      return reply.code(400).send({ message: "Valor manual inválido. Use formato brasileiro, ex: R$ 1.234,56." });
    }

    const confidence = body.ocrConfidence ?? null;
    const needsManualConfirmation = confidence !== null && confidence < env.OCR_LOW_CONFIDENCE_THRESHOLD;

    if (needsManualConfirmation && manualCents === null) {
      return reply.code(422).send({
        message: "OCR com baixa confiança. Confirme o valor manualmente para continuar.",
        requiresManualConfirmation: true,
        detectedValue: resolvedCents !== null ? centsToBrl(resolvedCents) : null,
        confidence
      });
    }

    const endValueCents = manualCents ?? resolvedCents;
    if (endValueCents === null) {
      return reply.code(400).send({
        message: "Não foi possível determinar o saldo final pela imagem/OCR. Confirme manualmente o valor."
      });
    }

    const grossAmountCents = endValueCents - shift.startValueCents;
    const payoutPercentage = shift.chatter.payoutPercentage;
    const payoutAmountCents = calculatePayoutCents(grossAmountCents, payoutPercentage);

    if (grossAmountCents < 0 && !(body.negativeJustification && body.negativeJustification.trim().length > 0)) {
      return reply.code(400).send({
        message: "Saldo final menor que o inicial exige justificativa obrigatória."
      });
    }

    const managerIds = grossAmountCents < 0
      ? (await fastify.prisma.user.findMany({
          where: { role: Role.MANAGER, isActive: true }, select: { id: true }
        })).map((manager) => manager.id)
      : [];

    const closedResult = await fastify.prisma.$transaction(async (tx) => {
      await lockShiftModels(tx, [shift.modelTagId]);
      const stillOpen = await tx.shift.count({
        where: { id: shift.id, chatterId: authUser.sub, status: ShiftStatus.OPEN }
      });
      if (stillOpen !== 1) throw new Error("SHIFT_NO_LONGER_OPEN");
      await assertNoShiftOverlap(tx, {
        modelTagId: shift.modelTagId,
        startedAt: shift.startedAt,
        endedAt,
        excludeShiftIds: [shift.id]
      });
      if (body.endEvidenceId) {
        const claimed = await tx.evidence.updateMany({
          where: { id: body.endEvidenceId, uploadedById: authUser.sub, status: EvidenceStatus.AVAILABLE, attachedAt: null },
          data: { attachedAt: new Date() }
        });
        if (claimed.count !== 1) throw new Error("EVIDENCE_NOT_ATTACHABLE");
      }
      const updatedShift = await tx.shift.update({
        where: {
          id: shift.id
        },
        data: {
          status: ShiftStatus.CLOSED,
          endedAt,
          endImageUrl: body.endImageUrl ?? null,
          endEvidenceId: body.endEvidenceId,
          endOcrRawText: body.ocrRawText,
          endOcrConfidence: confidence,
          endValueCents,
          endValueConfirmedAt: body.manualConfirmedValue ? endedAt : null,
          grossAmountCents,
          commissionDivisor: null,
          payoutPercentage,
          payoutAmountCents,
          negativeJustification: grossAmountCents < 0 ? body.negativeJustification?.trim() : null,
          endOriginalCurrency: body.moneyMetadata?.currency ?? "BRL",
          endOriginalAmountCents: body.moneyMetadata?.originalAmountCents ?? endValueCents,
          endFxRate: body.moneyMetadata?.fxRate,
          endFxProvider: body.moneyMetadata?.fxProvider,
          endFxQuotedAt: body.moneyMetadata?.fxQuotedAt ? new Date(body.moneyMetadata.fxQuotedAt) : null
        }
      });

      await syncEarningsForShift(tx, authUser.sub, shift.id, payoutAmountCents);

      await tx.auditLog.create({ data: {
        actorId: authUser.sub,
        action: AuditAction.SHIFT_CLOSED,
        targetType: "Shift",
        targetId: shift.id,
        metadata: {
          modelTagId: shift.modelTagId, grossAmountCents, payoutPercentage, payoutAmountCents,
          ...auditRequestMetadata(request)
        }
      } });

      if (grossAmountCents < 0) {
        await tx.notification.createMany({
          data: [...new Set([authUser.sub, ...managerIds])].map((userId) => ({
            userId,
            type: NotificationType.NEGATIVE_SHIFT,
            title: "Turno com saldo negativo",
            message: "Um turno foi encerrado com produção negativa e requer acompanhamento.",
            sourceType: "Shift",
            sourceId: shift.id,
            metadata: { chatterId: authUser.sub, modelTagId: shift.modelTagId, grossAmountCents }
          })),
          skipDuplicates: true
        });
      }

      const chatMessage = await createShiftChatEvent(tx, {
        chatterId: authUser.sub,
        chatterDisplayName: shift.chatter.displayName,
        modelTagId: shift.modelTagId,
        occurredAt: endedAt,
        event: "CLOSED"
      });
      return { shift: updatedShift, chatMessage };
    }).catch((error: unknown) => {
      if ((error as Error).message === "EVIDENCE_NOT_ATTACHABLE") return "EVIDENCE_NOT_ATTACHABLE" as const;
      if ((error as Error).message === "SHIFT_NO_LONGER_OPEN") return "SHIFT_NO_LONGER_OPEN" as const;
      throw error;
    });

    if (closedResult === "EVIDENCE_NOT_ATTACHABLE") {
      return reply.code(409).send({ message: "Comprovante inválido, já utilizado ou pertencente a outro usuário." });
    }
    if (closedResult === "SHIFT_NO_LONGER_OPEN") {
      return reply.code(409).send({ message: "Este ponto já foi encerrado. Atualize a página." });
    }

    const { shift: closedShift, chatMessage } = closedResult;
    fastify.io.to(modelRoomName(closedShift.modelTagId)).emit("chat:message", chatMessage);

    fastify.io.to(MANAGER_ROOM).emit(ANALYTICS_UPDATED_EVENT, {
      shiftId: closedShift.id,
      operation: "closed"
    });

    return {
      shift: closedShift,
      grossAmountFormatted: centsToBrl(grossAmountCents),
      payoutAmountFormatted: centsToBrl(payoutAmountCents)
    };
  });

  fastify.get("/payment/summary", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (!ensureChatterRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a chatters." });
    }

    const thisMonth = getMonthRangeInBusinessTz();
    const lastMonth = getMonthRangeInBusinessTz(-1);

    const [pendingAgg, lifetimeAgg, thisMonthAgg, lastMonthAgg] = await Promise.all([
      fastify.prisma.earnings.aggregate({
        where: { chatterId: authUser.sub, status: EarningsStatus.PENDING },
        _sum: { amountCents: true }
      }),
      fastify.prisma.paymentHistory.aggregate({
        where: { chatterId: authUser.sub },
        _sum: { totalCents: true }
      }),
      fastify.prisma.paymentHistory.aggregate({
        where: { chatterId: authUser.sub, paidAt: thisMonth },
        _sum: { totalCents: true }
      }),
      fastify.prisma.paymentHistory.aggregate({
        where: { chatterId: authUser.sub, paidAt: lastMonth },
        _sum: { totalCents: true }
      })
    ]);

    const pendingCents = pendingAgg._sum.amountCents ?? 0;
    const lifetimePaidCents = lifetimeAgg._sum.totalCents ?? 0;
    const thisMonthPaidCents = thisMonthAgg._sum.totalCents ?? 0;
    const lastMonthPaidCents = lastMonthAgg._sum.totalCents ?? 0;

    return {
      pendingCents,
      pendingFormatted: centsToBrl(pendingCents),
      lifetimePaidCents,
      lifetimePaidFormatted: centsToBrl(lifetimePaidCents),
      thisMonthPaidCents,
      thisMonthPaidFormatted: centsToBrl(thisMonthPaidCents),
      lastMonthPaidCents,
      lastMonthPaidFormatted: centsToBrl(lastMonthPaidCents)
    };
  });

  fastify.get("/payment/history", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (!ensureChatterRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a chatters." });
    }

    const query = paymentHistoryQuerySchema.parse(request.query);
    const where: Prisma.PaymentHistoryWhereInput = {
      chatterId: authUser.sub,
      ...(query.from || query.to
        ? { paidAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) } }
        : {})
    };
    const isV1 = request.url.startsWith("/api/v1/");
    const [history, total] = await fastify.prisma.$transaction([
      fastify.prisma.paymentHistory.findMany({
      where,
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      include: {
        manager: { select: { id: true, displayName: true } },
        receipt: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } }
      },
      ...(isV1 ? paginationArgs(query.page, query.pageSize) : {})
      }),
      fastify.prisma.paymentHistory.count({ where })
    ]);

    const items = history.map((item) => ({
        id: item.id,
        totalCents: item.totalCents,
        totalFormatted: centsToBrl(item.totalCents),
        paidAt: item.paidAt,
        manager: item.manager,
        receipt: item.receipt
      }));
    return { history: items, items, pagination: paginationMeta(query.page, isV1 ? query.pageSize : Math.max(total, 1), total) };
  });
};

export default chatterRoutes;
