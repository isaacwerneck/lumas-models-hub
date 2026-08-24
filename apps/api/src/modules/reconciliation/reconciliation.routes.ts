import { AuditAction, ReconciliationStatus, Role } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { z } from "zod";
import { env } from "../../config/env";
import { auditRequestMetadata } from "../../utils/audit";
import { PAYMENTS_UPDATED_EVENT } from "../manager/manager.events";
import { reconcileSalesStatement } from "./sales-statement";

dayjs.extend(utc);
dayjs.extend(timezone);

const importQuerySchema = z.object({
  modelTagId: z.string().min(1),
  coverageStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coverageEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});
const listQuerySchema = z.object({ modelTagId: z.string().min(1).optional() });
const idSchema = z.object({ id: z.string().min(1) });
const overrideSchema = z.object({ reason: z.string().trim().min(10).max(500) });

const errorMessages: Record<string, string> = {
  INVALID_XLSX: "Arquivo inválido. Envie a planilha SalesStatement em XLSX.",
  MISSING_EXTRATO_SHEET: "A planilha precisa conter a aba 'Extrato'.",
  INVALID_ROW_COUNT: "A planilha está vazia ou ultrapassa 50 mil linhas.",
  INVALID_HEADERS: "As colunas não correspondem ao formato SalesStatement esperado.",
  EMPTY_STATEMENT: "A planilha não contém vendas.",
  MULTIPLE_VENDORS: "A planilha contém mais de um vendedor. Importe um extrato por chatter.",
  ROW_OUTSIDE_COVERAGE: "Há vendas fora do período de cobertura informado."
};

const reconciliationRoutes: FastifyPluginAsync = async (fastify) => {
  const requireManager = (request: { user: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    const user = request.user as { role: Role };
    if (user.role !== Role.MANAGER) return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    return null;
  };

  fastify.post("/manager/reconciliations/import", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const denied = requireManager(request, reply);
    if (denied) return denied;
    const authUser = request.user as { sub: string };
    const query = importQuerySchema.parse(request.query);
    const coverageStart = dayjs.tz(query.coverageStart, env.TZ).startOf("day");
    const coverageEnd = dayjs.tz(query.coverageEnd, env.TZ).endOf("day");
    if (!coverageStart.isValid() || !coverageEnd.isValid() || coverageEnd.isBefore(coverageStart)) {
      return reply.code(400).send({ message: "Período de cobertura inválido." });
    }
    const modelTag = await fastify.prisma.modelTag.findUnique({ where: { id: query.modelTagId } });
    if (!modelTag) return reply.code(404).send({ message: "Modelo não encontrado." });
    const file = await request.file();
    if (!file) return reply.code(400).send({ message: "Envie a planilha no campo 'file'." });
    const buffer = await file.toBuffer();
    if (buffer.length > 25 * 1024 * 1024) return reply.code(413).send({ message: "A planilha deve ter no máximo 25 MB." });
    try {
      const statementImport = await reconcileSalesStatement({
        fastify,
        buffer,
        originalName: file.filename || "SalesStatement.xlsx",
        managerId: authUser.sub,
        modelTagId: query.modelTagId,
        coverageStart: coverageStart.toDate(),
        coverageEnd: coverageEnd.toDate()
      });
      fastify.io.to("role:manager").emit(PAYMENTS_UPDATED_EVENT, { modelTagId: query.modelTagId });
      return reply.code(201).send({ statementImport });
    } catch (error) {
      const code = (error as Error).message;
      const message = code.startsWith("INVALID_ROW:")
        ? `A linha ${code.split(":")[1]} contém data, valor ou vendedor inválido.`
        : errorMessages[code];
      if (message) return reply.code(400).send({ message, code });
      throw error;
    }
  });

  fastify.get("/manager/reconciliations/imports", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const denied = requireManager(request, reply);
    if (denied) return denied;
    const query = listQuerySchema.parse(request.query);
    const items = await fastify.prisma.salesStatementImport.findMany({
      where: query.modelTagId ? { modelTagId: query.modelTagId } : undefined,
      include: { modelTag: { select: { id: true, name: true } }, manager: { select: { id: true, displayName: true } }, _count: { select: { reconciliations: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100
    });
    return { items };
  });

  fastify.get("/manager/reconciliations/imports/:id", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const denied = requireManager(request, reply);
    if (denied) return denied;
    const { id } = idSchema.parse(request.params);
    const item = await fastify.prisma.salesStatementImport.findUnique({
      where: { id },
      include: {
        modelTag: { select: { id: true, name: true } },
        reconciliations: { include: { shift: { include: { chatter: { select: { id: true, displayName: true } }, earnings: true } }, overriddenBy: { select: { id: true, displayName: true } } }, orderBy: { shift: { startedAt: "asc" } } }
      }
    });
    if (!item) return reply.code(404).send({ message: "Importação não encontrada." });
    return { item };
  });

  fastify.post("/manager/reconciliations/results/:id/override", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const denied = requireManager(request, reply);
    if (denied) return denied;
    const authUser = request.user as { sub: string };
    const { id } = idSchema.parse(request.params);
    const body = overrideSchema.parse(request.body);
    const result = await fastify.prisma.shiftReconciliation.findUnique({ where: { id }, include: { shift: { include: { earnings: true } } } });
    if (!result) return reply.code(404).send({ message: "Conciliação não encontrada." });
    if (result.shift.earnings?.status === "PAID") return reply.code(409).send({ message: "Um horário já pago não pode ser alterado." });
    if (result.shiftReviewRevision !== result.shift.reviewRevision) return reply.code(409).send({ message: "Este resultado ficou desatualizado após a edição do horário. Importe o extrato novamente." });
    const updated = await fastify.prisma.$transaction(async (tx) => {
      const value = await tx.shiftReconciliation.update({ where: { id }, data: {
        status: ReconciliationStatus.OVERRIDDEN,
        overrideReason: body.reason,
        overriddenAt: new Date(),
        overriddenById: authUser.sub
      } });
      await tx.auditLog.create({ data: {
        actorId: authUser.sub,
        action: AuditAction.RECONCILIATION_OVERRIDDEN,
        targetType: "ShiftReconciliation",
        targetId: id,
        metadata: { previousStatus: result.status, reason: body.reason, shiftId: result.shiftId, ...auditRequestMetadata(request) }
      } });
      return value;
    });
    fastify.io.to("role:manager").emit(PAYMENTS_UPDATED_EVENT, { chatterId: result.shift.chatterId });
    return { reconciliation: updated };
  });
};

export default reconciliationRoutes;
