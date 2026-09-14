import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../components/Toast";
import { PaymentPage } from "../pages/PaymentPage";

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() }));

vi.mock("../lib/api", () => ({ api: apiMocks }));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "chatter-1", role: "CHATTER" } })
}));

describe("PaymentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/chatter/payment/summary") return Promise.resolve({ data: {} });
      if (url === "/chatter/payment/history") return Promise.resolve({ data: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } });
      if (url === "/chatter/payment/review") return Promise.resolve({ data: { items: [{
        id: "shift-1",
        modelTag: { name: "Annie" },
        startedAt: "2026-08-26T12:00:00.000Z",
        endedAt: "2026-08-26T18:00:00.000Z",
        startValueCents: 10_000,
        endValueCents: 20_000,
        grossAmountFormatted: "R$ 100,00",
        payoutAmountFormatted: "R$ 20,00",
        negativeJustification: null,
        notes: null,
        chatterVerifiedAt: null,
        paymentPeriod: { referenceStart: "2026-08-24", referenceEnd: "2026-08-30", paymentDate: "2026-08-31" }
      }], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } } });
      return Promise.reject(new Error(`GET inesperado: ${url}`));
    });
  });

  afterEach(() => cleanup());

  it("mantém erros de validação dentro do modal sólido de edição", async () => {
    render(<MemoryRouter><ToastProvider><PaymentPage /></ToastProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Editar horário de Annie" }));
    const dialog = screen.getByRole("dialog", { name: "Editar lançamento" });
    expect(dialog).toHaveClass("shift-edit-modal");

    fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "2026-08-26T08:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    const alert = await screen.findByRole("alert");
    expect(dialog).toContainElement(alert);
    expect(alert).toHaveTextContent("A data/hora final precisa ser posterior ao início do lançamento.");
    expect(apiMocks.patch).not.toHaveBeenCalled();
    expect(screen.getByText("Pagamento em")).toBeInTheDocument();
    expect(screen.getByText("31/08/2026")).toBeInTheDocument();
    expect(screen.getByText(/Referência: 24\/08 a 30\/08\/2026/)).toBeInTheDocument();
  });

  it("mostra ponto extra e bloqueia sua confirmação durante a segunda-feira", async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/chatter/payment/summary") return Promise.resolve({ data: {} });
      if (url === "/chatter/payment/history") return Promise.resolve({ data: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } });
      if (url === "/chatter/payment/review") return Promise.resolve({ data: { items: [{
        id: "shift-extra", modelTag: { name: "Annie" }, startedAt: "2026-08-17T12:00:00.000Z", endedAt: "2026-08-17T18:00:00.000Z",
        startValueCents: 0, endValueCents: 10_000, grossAmountFormatted: "R$ 100,00", payoutAmountFormatted: "R$ 5,00",
        negativeJustification: null, notes: null, chatterVerifiedAt: null, earningKind: "EXTRA", earningPercentage: 5,
        sourceChatter: { id: "source-1", displayName: "Bernardo" }, canEdit: false, confirmationBlocked: true
      }], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } } });
      return Promise.reject(new Error(`GET inesperado: ${url}`));
    });
    render(<MemoryRouter><ToastProvider><PaymentPage /></ToastProvider></MemoryRouter>);
    expect(await screen.findByText("Ponto extra de Bernardo")).toBeInTheDocument();
    const warning = screen.getByRole("status");
    expect(warning).toHaveTextContent("Confirmação disponível amanhã");
    expect(warning).toHaveTextContent("podem ser confirmados a partir de terça-feira, às 00:00");
    const confirmButton = screen.getByRole("button", { name: "Confirmar" });
    expect(confirmButton).toBeDisabled();
    expect(confirmButton).toHaveAttribute("aria-describedby", "confirmation-lock-shift-extra");
    expect(confirmButton).toHaveAttribute("title", "Disponível na terça-feira, às 00:00");
    expect(screen.queryByRole("button", { name: /Editar horário/ })).not.toBeInTheDocument();
  });
});
