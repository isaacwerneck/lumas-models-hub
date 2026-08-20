import ExcelJS from "exceljs";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { Prisma, Role, ShiftStatus } from "@prisma/client";
import { z } from "zod";

const reportQuerySchema = z.object({
  chatterId: z.string().min(1).optional(),
  modelTagId: z.string().min(1).optional(),
  search: z.string().trim().max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

const prepareSheet = (workbook: ExcelJS.Workbook, title: string, columns: Partial<ExcelJS.Column>[]) => {
  const sheet = workbook.addWorksheet(title, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B3FD6" } };
  header.alignment = { vertical: "middle" };
  header.height = 22;
  return sheet;
};

const sendWorkbook = async (reply: FastifyReply, workbook: ExcelJS.Workbook, filename: string) => {
  workbook.creator = "LumasModels Hub";
  workbook.created = new Date();
  const buffer = await workbook.xlsx.writeBuffer();
  return reply
    .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .send(Buffer.from(buffer));
};

const reportRoutes: FastifyPluginAsync = async (fastify) => {
  const ensureManager = (role: Role, reply: FastifyReply) => {
    if (role !== Role.MANAGER) {
      reply.code(403).send({ message: "Acesso restrito a gerentes." });
      return false;
    }
    return true;
  };

  fastify.get("/shifts.xlsx", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };
    if (!ensureManager(authUser.role, reply)) return;
    const query = reportQuerySchema.parse(request.query);
    const where: Prisma.ShiftWhereInput = {
      ...(query.chatterId ? { chatterId: query.chatterId } : {}),
      ...(query.modelTagId ? { modelTagId: query.modelTagId } : {}),
      ...(query.search ? { OR: [
        { chatter: { displayName: { contains: query.search, mode: "insensitive" } } },
        { modelTag: { name: { contains: query.search, mode: "insensitive" } } }
      ] } : {}),
      ...(query.from || query.to
        ? { startedAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) } }
        : {})
    };
    const shifts = await fastify.prisma.shift.findMany({
      where,
      include: { chatter: { select: { displayName: true } }, modelTag: { select: { name: true } } },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }]
    });
    const workbook = new ExcelJS.Workbook();
    const sheet = prepareSheet(workbook, "Turnos", [
      { header: "Chatter", key: "chatter", width: 24 }, { header: "Modelo", key: "model", width: 22 },
      { header: "Status", key: "status", width: 12 }, { header: "Início", key: "start", width: 20 },
      { header: "Fim", key: "end", width: 20 }, { header: "Valor inicial", key: "startValue", width: 16 },
      { header: "Valor final", key: "endValue", width: 16 }, { header: "Bruto", key: "gross", width: 16 },
      { header: "Payout", key: "payout", width: 16 }, { header: "Observação", key: "notes", width: 36 }
    ]);
    for (const shift of shifts) sheet.addRow({
      chatter: shift.chatter.displayName, model: shift.modelTag.name, status: shift.status,
      start: shift.startedAt, end: shift.endedAt, startValue: shift.startValueCents / 100,
      endValue: shift.endValueCents === null ? null : shift.endValueCents / 100,
      gross: shift.grossAmountCents === null ? null : shift.grossAmountCents / 100,
      payout: shift.payoutAmountCents === null ? null : shift.payoutAmountCents / 100, notes: shift.notes ?? ""
    });
    const lastShiftRow = shifts.length + 1;
    const totalRow = sheet.addRow({
      model: "Total",
      startValue: shifts.length ? { formula: `SUM(F2:F${lastShiftRow})` } : 0,
      endValue: shifts.length ? { formula: `SUM(G2:G${lastShiftRow})` } : 0,
      gross: shifts.length ? { formula: `SUM(H2:H${lastShiftRow})` } : 0,
      payout: shifts.length ? { formula: `SUM(I2:I${lastShiftRow})` } : 0
    });
    totalRow.font = { bold: true };
    [4, 5].forEach((column) => { sheet.getColumn(column).numFmt = "dd/mm/yyyy hh:mm"; });
    [6, 7, 8, 9].forEach((column) => { sheet.getColumn(column).numFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00'; });
    return sendWorkbook(reply, workbook, `turnos-${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  fastify.get("/payments.xlsx", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };
    if (!ensureManager(authUser.role, reply)) return;
    const query = reportQuerySchema.parse(request.query);
    const where: Prisma.PaymentHistoryWhereInput = {
      ...(query.chatterId ? { chatterId: query.chatterId } : {}),
      ...(query.search ? { chatter: { displayName: { contains: query.search, mode: "insensitive" } } } : {}),
      ...(query.from || query.to
        ? { paidAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) } }
        : {})
    };
    const payments = await fastify.prisma.paymentHistory.findMany({
      where,
      include: { chatter: { select: { displayName: true } }, manager: { select: { displayName: true } } },
      orderBy: [{ paidAt: "desc" }, { id: "desc" }]
    });
    const workbook = new ExcelJS.Workbook();
    const sheet = prepareSheet(workbook, "Pagamentos", [
      { header: "Data", key: "date", width: 20 }, { header: "Chatter", key: "chatter", width: 24 },
      { header: "Gerente", key: "manager", width: 24 }, { header: "Valor", key: "value", width: 16 }
    ]);
    for (const payment of payments) sheet.addRow({
      date: payment.paidAt, chatter: payment.chatter.displayName,
      manager: payment.manager.displayName, value: payment.totalCents / 100
    });
    sheet.getColumn(1).numFmt = "dd/mm/yyyy hh:mm";
    sheet.getColumn(4).numFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00';
    const totalRow = sheet.addRow({ manager: "Total", value: { formula: `SUM(D2:D${payments.length + 1})` } });
    totalRow.font = { bold: true };
    return sendWorkbook(reply, workbook, `pagamentos-${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  fastify.get("/analytics.xlsx", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };
    if (!ensureManager(authUser.role, reply)) return;
    const query = reportQuerySchema.parse(request.query);
    const shifts = await fastify.prisma.shift.findMany({
      where: {
        status: ShiftStatus.CLOSED,
        ...(query.chatterId ? { chatterId: query.chatterId } : {}),
        ...(query.modelTagId ? { modelTagId: query.modelTagId } : {}),
        ...(query.search ? { OR: [
          { chatter: { displayName: { contains: query.search, mode: "insensitive" } } },
          { modelTag: { name: { contains: query.search, mode: "insensitive" } } }
        ] } : {}),
        ...(query.from || query.to
          ? { endedAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) } }
          : {})
      },
      include: {
        modelTag: { select: { name: true } },
        chatter: { select: { displayName: true } }
      }
    });
    const byModel = new Map<string, { gross: number; payout: number; count: number }>();
    const byChatter = new Map<string, { gross: number; payout: number; count: number }>();
    for (const shift of shifts) {
      for (const [group, key] of [[byModel, shift.modelTag.name], [byChatter, shift.chatter.displayName]] as const) {
        const row = group.get(key) ?? { gross: 0, payout: 0, count: 0 };
        row.gross += shift.grossAmountCents ?? 0;
        row.payout += shift.payoutAmountCents ?? 0;
        row.count += 1;
        group.set(key, row);
      }
    }
    const workbook = new ExcelJS.Workbook();
    const addAnalyticsSheet = (
      title: string,
      firstHeader: string,
      grouped: Map<string, { gross: number; payout: number; count: number }>
    ) => {
      const sheet = prepareSheet(workbook, title, [
        { header: firstHeader, key: "name", width: 24 }, { header: "Turnos", key: "count", width: 12 },
        { header: "Bruto", key: "gross", width: 16 }, { header: "Payout", key: "payout", width: 16 }
      ]);
      for (const [name, row] of [...grouped.entries()].sort((a, b) => b[1].gross - a[1].gross)) {
        sheet.addRow({ name, count: row.count, gross: row.gross / 100, payout: row.payout / 100 });
      }
      const lastDataRow = grouped.size + 1;
      const totalRow = sheet.addRow({
        name: "Total",
        count: { formula: `SUM(B2:B${lastDataRow})` },
        gross: { formula: `SUM(C2:C${lastDataRow})` },
        payout: { formula: `SUM(D2:D${lastDataRow})` }
      });
      totalRow.font = { bold: true };
      [3, 4].forEach((column) => { sheet.getColumn(column).numFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00'; });
    };
    addAnalyticsSheet("Por modelo", "Modelo", byModel);
    addAnalyticsSheet("Por chatter", "Chatter", byChatter);
    return sendWorkbook(reply, workbook, `analytics-${new Date().toISOString().slice(0, 10)}.xlsx`);
  });
};

export default reportRoutes;
