import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { reconcileSalesStatement } from "./sales-statement";

const headers = [
  "Data", "Hora", "Valor da venda", "Sua comissão", "Tipo de entrada", "Forma de pagamento",
  "ID usuário comprador", "Comprador", "Tipo venda", "Vendedor", "Situação"
];

const workbookBuffer = async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Extrato");
  sheet.addRow(headers);
  sheet.addRow([
    new Date(Date.UTC(2026, 7, 17)), new Date(Date.UTC(1899, 11, 30, 13, 30)), 250, 100,
    "Venda", "Cartão", "buyer-1", "Cliente", "Mensagem", "Chatter Test", "Pagamento confirmado"
  ]);
  sheet.addRow(["17/08/2026", "14:00", "50,00", "20,00", "Venda", "Pix", "buyer-2", "Cliente 2", "Mensagem", "Chatter Test", "Pendente"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

describe("reconcileSalesStatement", () => {
  it("preserva data e hora do Excel sem deslocamento de fuso e ignora vendas não confirmadas", async () => {
    let saved: any;
    const create = vi.fn(async ({ data }: { data: any }) => {
      saved = data;
      return { id: "import-1", ...data, reconciliations: data.reconciliations.create };
    });
    const tx = { salesStatementImport: { create }, auditLog: { create: vi.fn(async () => ({})) } };
    const fastify = {
      prisma: {
        shift: { findMany: vi.fn(async () => [{
          id: "shift-1", startedAt: new Date("2026-08-17T15:00:00.000Z"), endedAt: new Date("2026-08-17T17:00:00.000Z"),
          grossAmountCents: 10_000, reviewRevision: 1
        }]) },
        $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
      }
    } as unknown as FastifyInstance;

    await reconcileSalesStatement({
      fastify, buffer: await workbookBuffer(), originalName: "teste.xlsx", managerId: "manager-1", modelTagId: "tag-1",
      coverageStart: new Date("2026-08-17T03:00:00.000Z"), coverageEnd: new Date("2026-08-18T02:59:59.999Z")
    });

    expect(saved.confirmedRowCount).toBe(1);
    expect(saved.excludedRowCount).toBe(1);
    expect(saved.totalCommissionCents).toBe(10_000);
    expect(saved.reconciliations.create[0]).toMatchObject({ shiftId: "shift-1", matchedRowCount: 1, status: "MATCHED", deltaCents: 0 });
  });

  it("rejeita arquivos que não são XLSX", async () => {
    await expect(reconcileSalesStatement({
      fastify: {} as FastifyInstance, buffer: Buffer.from("csv"), originalName: "teste.xlsx", managerId: "manager-1", modelTagId: "tag-1",
      coverageStart: new Date(), coverageEnd: new Date()
    })).rejects.toThrow("INVALID_XLSX");
  });
});
