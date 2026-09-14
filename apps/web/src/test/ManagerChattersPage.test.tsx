import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManagerChattersPage } from "../pages/ManagerChattersPage";
import { ToastProvider } from "../components/Toast";

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("../lib/api", () => ({ api: apiMocks }));

describe("ManagerChattersPage", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("mostra skeleton durante a carga e empty state quando não há resultado", async () => {
    let resolveRequest!: (value: unknown) => void;
    apiMocks.get.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    const { container } = render(
      <MemoryRouter>
        <ToastProvider><ManagerChattersPage /></ToastProvider>
      </MemoryRouter>
    );

    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    await act(async () => resolveRequest({
      data: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } }
    }));
    expect(await screen.findByText("Nenhum chatter cadastrado.")).toBeInTheDocument();
  });

  it("mantém equipe, galeria e tags no mesmo gerenciamento", async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/manager/tags") {
        return Promise.resolve({ data: { tags: [] } });
      }

      return Promise.resolve({
        data: {
          items: [],
          chatters: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }
        }
      });
    });

    render(
      <MemoryRouter>
        <ToastProvider><ManagerChattersPage /></ToastProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText("Novo chatter")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Tags e vínculos" }));

    expect(await screen.findByText("Nova tag de modelo")).toBeInTheDocument();
    expect(screen.queryByText("Novo chatter")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Galeria" }));
    expect(await screen.findByText("Filtros")).toBeInTheDocument();
    expect(await screen.findByText("Nenhum ponto encontrado para os filtros selecionados.")).toBeInTheDocument();
  });

  it("mostra o total líquido do chatter em vez da produção bruta", async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/manager/tags") return Promise.resolve({ data: { tags: [] } });
      return Promise.resolve({ data: {
        items: [{ id: "chatter-1", username: "julia", displayName: "Julia", isActive: true,
          totalGrossFormatted: "R$ 1.000,00", totalPayoutFormatted: "R$ 200,00", modelTags: [] }],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
      } });
    });
    render(<MemoryRouter><ToastProvider><ManagerChattersPage /></ToastProvider></MemoryRouter>);
    expect(await screen.findByText("Total líquido")).toBeInTheDocument();
    expect(screen.getByText("R$ 200,00")).toBeInTheDocument();
    expect(screen.queryByText("R$ 1.000,00")).not.toBeInTheDocument();
  });

  it("mostra na galeria a data prevista e a referência do pagamento", async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/manager/shifts") return Promise.resolve({ data: {
        items: [{
          id: "shift-1", state: "CONFIRMED", chatter: { id: "isaac", displayName: "Isaac" },
          modelTag: { id: "model-1", name: "Modelo A" }, startedAt: "2026-09-10T13:00:00.000Z",
          endedAt: "2026-09-10T14:00:00.000Z", startValueFormatted: "R$ 0,00",
          endValueFormatted: "R$ 1.000,00", grossAmountFormatted: "R$ 1.000,00",
          payoutAmountFormatted: "R$ 200,00", negativeJustification: null, notes: null,
          paymentPeriod: { referenceStart: "2026-09-07", referenceEnd: "2026-09-13", paymentDate: "2026-09-14" }
        }], pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 }
      } });
      if (url === "/manager/tags") return Promise.resolve({ data: { items: [] } });
      return Promise.resolve({ data: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } });
    });

    render(<MemoryRouter initialEntries={["/?section=points"]}><ToastProvider><ManagerChattersPage /></ToastProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole("tab", { name: "Galeria" }));
    await waitFor(() => expect(apiMocks.get).toHaveBeenCalledWith("/manager/shifts", {
      params: expect.objectContaining({ businessDate: undefined })
    }));
    expect(await screen.findByText("14/09/2026")).toBeInTheDocument();
    expect(screen.getByText(/Referência: 07\/09 a 13\/09\/2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver detalhes" }));
    expect(screen.getByRole("dialog", { name: "Detalhes do ponto" })).toHaveClass("modal", "modal-solid", "point-gallery-modal");

    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-09-10" } });
    await waitFor(() => expect(apiMocks.get).toHaveBeenCalledWith("/manager/shifts", {
      params: expect.objectContaining({ businessDate: "2026-09-10" })
    }));
  });
});
