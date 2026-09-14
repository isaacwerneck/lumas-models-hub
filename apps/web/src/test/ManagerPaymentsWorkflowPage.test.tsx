import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toast";
import { ManagerPaymentsWorkflowPage } from "../pages/ManagerPaymentsWorkflowPage";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), download: vi.fn() }));
vi.mock("../lib/api", () => ({ api: { get: mocks.get, post: mocks.post }, downloadApiFile: mocks.download }));

describe("ManagerPaymentsWorkflowPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation((url: string) => {
      if (url === "/manager/payments/balances") return Promise.resolve({ data: {
        items: [{
          id: "isaac", displayName: "Isaac", isActive: true,
          pendingCents: 20_000, pendingFormatted: "R$ 200,00",
          verifiedCents: 20_000, verifiedFormatted: "R$ 200,00",
          payableCents: 20_000, payableFormatted: "R$ 200,00",
          blockedCents: 0, blockedFormatted: "R$ 0,00", payableEarningIds: ["earning-1"],
          paymentPeriods: [{
            referenceStart: "2026-09-07", referenceEnd: "2026-09-13", paymentDate: "2026-09-14",
            pendingCents: 20_000, pendingFormatted: "R$ 200,00", verifiedCents: 20_000,
            verifiedFormatted: "R$ 200,00", payableCents: 20_000, payableFormatted: "R$ 200,00",
            blockedCents: 0, blockedFormatted: "R$ 0,00"
          }]
        }], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
      } });
      if (url === "/manager/payments/history") return Promise.resolve({ data: { items: [] } });
      if (url === "/manager/tags") return Promise.resolve({ data: { items: [] } });
      if (url === "/manager/reconciliations/imports") return Promise.resolve({ data: { items: [] } });
      return Promise.reject(new Error(`GET inesperado: ${url}`));
    });
    mocks.post.mockImplementation((url: string) => {
      if (url === "/manager/payment-receipts") return Promise.resolve({ data: { receipt: { id: "receipt-1" } } });
      if (url === "/manager/payments/pay") return Promise.resolve({ data: { payment: { id: "payment-1" } } });
      return Promise.reject(new Error(`POST inesperado: ${url}`));
    });
  });

  afterEach(() => cleanup());

  it("mostra a segunda de pagamento e o período trabalhado", async () => {
    render(<ToastProvider><ManagerPaymentsWorkflowPage /></ToastProvider>);
    expect(await screen.findByText("Isaac")).toBeInTheDocument();
    expect(screen.getByText("14/09/2026")).toBeInTheDocument();
    expect(screen.getByText(/Referência: 07\/09 a 13\/09\/2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pagar R$ 200,00" }));
    expect(screen.getByRole("dialog", { name: "Confirmar pagamento" })).toHaveClass("modal", "modal-solid", "payment-confirmation-modal");

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Confirmar pagamento" })).not.toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Buscar chatter…"), { target: { value: "Isaac" } });
    fireEvent.click(screen.getByRole("button", { name: "Exportar histórico" }));
    expect(mocks.download).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Pagar R$ 200,00" }));
    const receipt = new File(["receipt"], "pagamento.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Selecionar comprovante do pagamento"), { target: { files: [receipt] } });
    expect(screen.getByText("pagamento.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pagamento" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(
      "/manager/payments/pay",
      expect.objectContaining({ chatterId: "isaac", receiptId: "receipt-1" }),
      expect.any(Object)
    ));
  });
});
