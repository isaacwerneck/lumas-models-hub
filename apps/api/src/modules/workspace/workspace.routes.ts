import { Role, WorksheetCellType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ensureRoomAccess, modelRoomName } from "../chat/chat.shared";

const MAX_ROWS = 20;
const MAX_COLUMNS = 6;
const paramsSchema = z.object({ modelTagId: z.string().min(1) });
const cellsSchema = z.object({
  cells: z.array(z.object({
    rowIndex: z.number().int().min(0).max(MAX_ROWS - 1),
    columnIndex: z.number().int().min(0).max(MAX_COLUMNS - 1),
    value: z.string().max(2_000),
    valueType: z.nativeEnum(WorksheetCellType).default(WorksheetCellType.TEXT)
  })).min(1).max(MAX_ROWS * MAX_COLUMNS)
});
const dimensionsSchema = z.object({
  rowCount: z.literal(MAX_ROWS),
  columnCount: z.literal(MAX_COLUMNS)
});

const workspaceRoutes: FastifyPluginAsync = async (fastify) => {
  const access = async (request: { user: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }, modelTagId: string) => {
    const user = request.user as { sub: string; role: Role };
    if (!await ensureRoomAccess(fastify, user.sub, user.role, modelTagId)) {
      return reply.code(403).send({ message: "Sem acesso à planilha deste modelo." });
    }
    return null;
  };

  fastify.get("/model-workspaces/:modelTagId/sheet", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { modelTagId } = paramsSchema.parse(request.params);
    const denied = await access(request, reply, modelTagId);
    if (denied) return denied;
    const sheet = await fastify.prisma.modelWorksheet.upsert({
      where: { modelTagId },
      create: { modelTagId, rowCount: MAX_ROWS, columnCount: MAX_COLUMNS },
      update: {},
      include: {
        cells: {
          where: { rowIndex: { lt: MAX_ROWS }, columnIndex: { lt: MAX_COLUMNS } },
          orderBy: [{ rowIndex: "asc" }, { columnIndex: "asc" }]
        }
      }
    });
    return { sheet: { ...sheet, rowCount: MAX_ROWS, columnCount: MAX_COLUMNS } };
  });

  fastify.patch("/model-workspaces/:modelTagId/sheet/cells", {
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const authUser = request.user as { sub: string };
    const { modelTagId } = paramsSchema.parse(request.params);
    const denied = await access(request, reply, modelTagId);
    if (denied) return denied;
    const body = cellsSchema.parse(request.body);
    const sheet = await fastify.prisma.modelWorksheet.upsert({ where: { modelTagId }, create: { modelTagId, rowCount: MAX_ROWS, columnCount: MAX_COLUMNS }, update: {} });
    if (body.cells.some((cell) => cell.rowIndex >= MAX_ROWS || cell.columnIndex >= MAX_COLUMNS)) {
      return reply.code(400).send({ message: "Há células fora dos limites atuais da planilha." });
    }
    const changed = await fastify.prisma.$transaction(async (tx) => {
      const items = [];
      for (const cell of body.cells) {
        if (!cell.value.length) {
          await tx.modelWorksheetCell.deleteMany({ where: { worksheetId: sheet.id, rowIndex: cell.rowIndex, columnIndex: cell.columnIndex } });
          items.push({ ...cell, deleted: true, updatedById: authUser.sub });
        } else {
          const item = await tx.modelWorksheetCell.upsert({
            where: { worksheetId_rowIndex_columnIndex: { worksheetId: sheet.id, rowIndex: cell.rowIndex, columnIndex: cell.columnIndex } },
            create: { worksheetId: sheet.id, rowIndex: cell.rowIndex, columnIndex: cell.columnIndex, value: cell.value, valueType: cell.valueType, updatedById: authUser.sub },
            update: { value: cell.value, valueType: cell.valueType, updatedById: authUser.sub, version: { increment: 1 } }
          });
          items.push(item);
        }
      }
      const worksheet = await tx.modelWorksheet.update({ where: { id: sheet.id }, data: { revision: { increment: 1 } } });
      return { cells: items, revision: worksheet.revision };
    });
    const payload = { modelTagId, ...changed };
    fastify.io.to(modelRoomName(modelTagId)).emit("worksheet:updated", payload);
    return payload;
  });

  fastify.patch("/model-workspaces/:modelTagId/sheet/dimensions", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { modelTagId } = paramsSchema.parse(request.params);
    const denied = await access(request, reply, modelTagId);
    if (denied) return denied;
    const body = dimensionsSchema.parse(request.body);
    const current = await fastify.prisma.modelWorksheet.upsert({ where: { modelTagId }, create: { modelTagId, rowCount: MAX_ROWS, columnCount: MAX_COLUMNS }, update: {} });
    const sheet = await fastify.prisma.$transaction(async (tx) => {
      return tx.modelWorksheet.update({ where: { id: current.id }, data: { rowCount: body.rowCount, columnCount: body.columnCount, revision: { increment: 1 } } });
    });
    fastify.io.to(modelRoomName(modelTagId)).emit("worksheet:dimensions", { modelTagId, rowCount: sheet.rowCount, columnCount: sheet.columnCount, revision: sheet.revision });
    return { sheet };
  });
};

export default workspaceRoutes;
