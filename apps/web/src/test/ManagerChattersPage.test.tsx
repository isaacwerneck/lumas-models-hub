import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("mantém equipe e tags no mesmo gerenciamento", async () => {
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
});
