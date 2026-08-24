import crypto from "node:crypto";
import { AuditAction, ReconciliationStatus, ShiftStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import ExcelJS from "exceljs";
import { env } from "../../config/env";

dayjs.extend(utc);
dayjs.extend(timezone);

type ParsedSale = {
  occurredAt: Date;
  saleCents: number;
  commissionCents: number;
  confirmed: boolean;
  vendor: string;
};

const normalize = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f\uFFFD]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "");

const cellScalar = (value: ExcelJS.CellValue): string | number | Date | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || value instanceof Date) return value;
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  if (typeof value === "object" && "result" in value) {
    const result = value.result;
    if (typeof result === "string" || typeof result === "number" || result instanceof Date) return result;
  }
  return String(value);
};

const parseMoneyCents = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  const raw = String(value ?? "").trim().replace(/\s|R\$/gi, "");
  if (!raw) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
};

const parseOccurredAt = (dateValue: unknown, timeValue: unknown) => {
  if (dateValue instanceof Date) {
    const base = dayjs(dateValue).tz(env.TZ);
    if (timeValue instanceof Date) {
      const time = dayjs(timeValue).tz(env.TZ);
      return dayjs.tz(`${base.format("YYYY-MM-DD")}T${time.format("HH:mm:ss")}`, env.TZ).toDate();
    }
    const timeText = String(timeValue ?? "00:00:00").trim();
    return dayjs.tz(`${base.format("YYYY-MM-DD")}T${timeText}`, env.TZ).toDate();
  }
  const dateMatch = String(dateValue ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const timeMatch = String(timeValue ?? "").trim().match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateMatch || !timeMatch) return null;
  const [, day, month, year] = dateMatch;
  const [, hour, minute, second = "00"] = timeMatch;
  const parsed = dayjs.tz(`${year}-${month}-${day}T${hour}:${minute}:${second}`, env.TZ);
  return parsed.isValid() ? parsed.toDate() : null;
};

const expectedHeaders = [
  "data", "hora", "valordavenda", "suacomiss", "tipodeentrada", "formadepagamento",
  "idusuariocomprador", "comprador", "tipovenda", "vendedor", "situ"
];

export const reconcileSalesStatement = async (input: {
  fastify: FastifyInstance;
  buffer: Buffer;
  originalName: string;
  managerId: string;
  modelTagId: string;
  coverageStart: Date;
  coverageEnd: Date;
}) => {
  if (input.buffer.length < 4 || input.buffer[0] !== 0x50 || input.buffer[1] !== 0x4b) throw new Error("INVALID_XLSX");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.getWorksheet("Extrato");
  if (!sheet) throw new Error("MISSING_EXTRATO_SHEET");
  if (sheet.rowCount < 2 || sheet.rowCount > 50_001) throw new Error("INVALID_ROW_COUNT");

  const actualHeaders = Array.from({ length: 11 }, (_, index) => normalize(cellScalar(sheet.getRow(1).getCell(index + 1).value)));
  if (actualHeaders.some((header, index) => !header.startsWith(expectedHeaders[index]))) throw new Error("INVALID_HEADERS");

  const sales: ParsedSale[] = [];
  const vendors = new Set<string>();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = Array.from({ length: 11 }, (_, index) => cellScalar(row.getCell(index + 1).value));
    if (values.every((value) => value === null || String(value).trim() === "")) continue;
    const occurredAt = parseOccurredAt(values[0], values[1]);
    const saleCents = parseMoneyCents(values[2]);
    const commissionCents = parseMoneyCents(values[3]);
    const vendor = String(values[9] ?? "").trim();
    if (!occurredAt || saleCents === null || commissionCents === null || !vendor) throw new Error(`INVALID_ROW:${rowNumber}`);
    vendors.add(vendor);
    sales.push({
      occurredAt,
      saleCents,
      commissionCents,
      confirmed: normalize(values[10]) === "pagamentoconfirmado",
      vendor
    });
  }
  if (!sales.length) throw new Error("EMPTY_STATEMENT");
  if (vendors.size !== 1) throw new Error("MULTIPLE_VENDORS");
  if (sales.some((sale) => sale.occurredAt < input.coverageStart || sale.occurredAt > input.coverageEnd)) throw new Error("ROW_OUTSIDE_COVERAGE");

  const shifts = await input.fastify.prisma.shift.findMany({
    where: {
      modelTagId: input.modelTagId,
      status: ShiftStatus.CLOSED,
      startedAt: { lte: input.coverageEnd },
      endedAt: { gte: input.coverageStart }
    },
    select: { id: true, startedAt: true, endedAt: true, grossAmountCents: true, reviewRevision: true }
  });
  const confirmedSales = sales.filter((sale) => sale.confirmed);
  const assigned = new Map<string, ParsedSale[]>();
  const ambiguousShiftIds = new Set<string>();
  let unmatchedRowCount = 0;
  for (const sale of confirmedSales) {
    const candidates = shifts.filter((shift) => shift.endedAt && sale.occurredAt > shift.startedAt && sale.occurredAt <= shift.endedAt);
    if (!candidates.length) { unmatchedRowCount += 1; continue; }
    if (candidates.length > 1) candidates.forEach((shift) => ambiguousShiftIds.add(shift.id));
    candidates.forEach((shift) => assigned.set(shift.id, [...(assigned.get(shift.id) ?? []), sale]));
  }

  const reconciliationData = shifts.map((shift) => {
    const rows = assigned.get(shift.id) ?? [];
    const statementCommissionCents = rows.reduce((total, row) => total + row.commissionCents, 0);
    const reportedGrossCents = shift.grossAmountCents ?? 0;
    const deltaCents = statementCommissionCents - reportedGrossCents;
    let status: ReconciliationStatus;
    if (shift.startedAt < input.coverageStart || !shift.endedAt || shift.endedAt > input.coverageEnd) status = ReconciliationStatus.OUT_OF_RANGE;
    else if (ambiguousShiftIds.has(shift.id)) status = ReconciliationStatus.AMBIGUOUS;
    else status = Math.abs(deltaCents) <= 1 ? ReconciliationStatus.MATCHED : ReconciliationStatus.MISMATCH;
    return {
      shiftId: shift.id,
      shiftReviewRevision: shift.reviewRevision,
      statementCommissionCents,
      reportedGrossCents,
      deltaCents,
      matchedRowCount: rows.length,
      status
    };
  });

  const totalSalesCents = confirmedSales.reduce((total, sale) => total + sale.saleCents, 0);
  const totalCommissionCents = confirmedSales.reduce((total, sale) => total + sale.commissionCents, 0);
  const fileSha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const statementImport = await input.fastify.prisma.$transaction(async (tx) => {
    const created = await tx.salesStatementImport.create({ data: {
      managerId: input.managerId,
      modelTagId: input.modelTagId,
      originalName: input.originalName,
      fileSha256,
      vendorName: [...vendors][0],
      coverageStart: input.coverageStart,
      coverageEnd: input.coverageEnd,
      rowCount: sales.length,
      confirmedRowCount: confirmedSales.length,
      excludedRowCount: sales.length - confirmedSales.length,
      totalSalesCents,
      totalCommissionCents,
      unmatchedRowCount,
      reconciliations: { create: reconciliationData }
    }, include: { reconciliations: true } });
    await tx.auditLog.create({ data: {
      actorId: input.managerId,
      action: AuditAction.STATEMENT_IMPORTED,
      targetType: "SalesStatementImport",
      targetId: created.id,
      metadata: {
        modelTagId: input.modelTagId, fileSha256, vendorName: [...vendors][0], rowCount: sales.length,
        confirmedRowCount: confirmedSales.length, excludedRowCount: sales.length - confirmedSales.length,
        unmatchedRowCount
      }
    } });
    return created;
  });

  return statementImport;
};
