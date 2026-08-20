import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toast";
import { ShiftsPage } from "../pages/ShiftsPage";

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock("../lib/api", () => ({ api: apiMocks }));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "chatter-1", role: "CHATTER" } })
}));

describe("ShiftsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const startedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/chat/rooms") return Promise.resolve({ data: { rooms: [{ id: "tag-1", name: "Annie" }] } });
      if (url === "/chatter/shifts/current") {
        return Promise.resolve({
          data: {
            shift: {
              id: "shift-1",
              modelTagId: "tag-1",
              startedAt,
              startValueCents: 10_000,
              startOriginalCurrency: "BRL",
              modelTag: { id: "tag-1", name: "Annie" }
            }
          }
        });
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`));
    });
  });

  afterEach(() => cleanup());

  it("restaura o valor inicial e só mostra a justificativa quando o saldo fica negativo", async () => {
    render(<ToastProvider><ShiftsPage /></ToastProvider>);

    expect(await screen.findByRole("heading", { name: /Encerrar turno/ })).toBeInTheDocument();
    const endValue = screen.getByLabelText("Valor do faturamento");
    expect(screen.queryByLabelText("Justificativa para saldo negativo")).not.toBeInTheDocument();

    fireEvent.change(endValue, { target: { value: "50,00" } });
    expect(await screen.findByLabelText("Justificativa para saldo negativo")).toBeRequired();

    fireEvent.change(endValue, { target: { value: "150,00" } });
    await waitFor(() => expect(screen.queryByLabelText("Justificativa para saldo negativo")).not.toBeInTheDocument());
  });
});
