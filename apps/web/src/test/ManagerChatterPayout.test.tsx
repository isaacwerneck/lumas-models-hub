import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toast";
import { ManagerChatterDetailPage } from "../pages/ManagerChatterDetailPage";

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  delete: vi.fn()
}));

vi.mock("../lib/api", () => ({
  api: apiMocks,
  downloadApiFile: vi.fn()
}));

const renderPage = () => render(
  <MemoryRouter initialEntries={["/chatters/chatter-1"]}>
    <ToastProvider>
      <Routes>
        <Route path="/chatters/:chatterId" element={<ManagerChatterDetailPage />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>
);

describe("configuração de payout do chatter", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("carrega, valida e salva a porcentagem individual", async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/manager/chatters/chatter-1") {
        return Promise.resolve({ data: { chatter: {
          id: "chatter-1",
          username: "julia",
          displayName: "Julia",
          isActive: true,
          payoutPercentage: 20,
          modelTags: []
        } } });
      }
      if (url.includes("/shifts")) {
        return Promise.resolve({ data: { items: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 } } });
      }
      if (url.includes("/payments")) {
        return Promise.resolve({ data: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } });
      }
      return Promise.resolve({ data: { tags: [] } });
    });
    apiMocks.patch.mockResolvedValue({ data: { user: { payoutPercentage: 35 } } });

    renderPage();

    const input = await screen.findByLabelText(/Porcentagem do chatter/);
    const saveButton = screen.getByRole("button", { name: "Salvar payout" });
    expect(input).toHaveValue(20);
    expect(saveButton).toBeDisabled();

    fireEvent.change(input, { target: { value: "20.5" } });
    expect(saveButton).toBeDisabled();

    fireEvent.change(input, { target: { value: "35" } });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(apiMocks.patch).toHaveBeenCalledWith(
      "/manager/users/chatter-1",
      { payoutPercentage: 35 }
    ));
    await waitFor(() => expect(saveButton).toBeDisabled());
  });

  it("configura um ponto extra para outro chatter ativo", async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/manager/chatters/chatter-1") return Promise.resolve({ data: { chatter: {
        id: "chatter-1", username: "julia", displayName: "Julia", isActive: true, payoutPercentage: 20,
        modelTags: [], extraPointRule: null
      } } });
      if (url === "/manager/chatters") return Promise.resolve({ data: { items: [
        { id: "chatter-1", displayName: "Julia" }, { id: "chatter-2", displayName: "Bernardo" }
      ] } });
      if (url.includes("/shifts")) return Promise.resolve({ data: { items: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 } } });
      if (url.includes("/payments")) return Promise.resolve({ data: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } });
      return Promise.resolve({ data: { tags: [] } });
    });
    apiMocks.put.mockResolvedValue({ data: { rule: { beneficiaryId: "chatter-2", percentage: 5 } } });
    renderPage();
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /Ponto extra/ }),
    );
    fireEvent.change(screen.getByLabelText("Chatter beneficiário"), { target: { value: "chatter-2" } });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: /Porcentagem adicional/ }),
      { target: { value: "5" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar ponto extra" }));
    await waitFor(() => expect(apiMocks.put).toHaveBeenCalledWith("/manager/chatters/chatter-1/extra-point-rule", {
      enabled: true, beneficiaryId: "chatter-2", percentage: 5
    }));
  });

  it("mostra no perfil do beneficiário o ponto extra com a origem e o valor recebido", async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/manager/chatters/chatter-1") return Promise.resolve({ data: { chatter: {
        id: "chatter-1", username: "julia.chatter", displayName: "Julia Chatter", isActive: true,
        payoutPercentage: 20, modelTags: [], extraPointRule: null
      } } });
      if (url === "/manager/chatters") return Promise.resolve({ data: { items: [
        { id: "chatter-1", displayName: "Julia Chatter" }, { id: "chatter-2", displayName: "Bernardo" }
      ] } });
      if (url.includes("/shifts")) return Promise.resolve({ data: { items: [{
        id: "shift-extra", isExtraPoint: true, sourceChatter: { id: "chatter-2", displayName: "Bernardo" },
        modelTag: { id: "tag-1", name: "Annie" }, status: "CLOSED",
        startedAt: "2026-09-14T12:00:00.000Z", endedAt: "2026-09-14T14:00:00.000Z",
        startImageUrl: null, endImageUrl: null, startValueFormatted: "R$ 0,00", endValueFormatted: "R$ 1.000,00",
        grossAmountFormatted: "R$ 1.000,00", payoutAmountFormatted: "R$ 200,00", chatterVerifiedAt: null,
        negativeJustification: null, notes: null,
        earnings: { kind: "EXTRA", payoutPercentage: 5, amountFormatted: "R$ 50,00", status: "PENDING", paidAt: null }
      }], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } } });
      if (url.includes("/payments")) return Promise.resolve({ data: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } });
      return Promise.resolve({ data: { tags: [] } });
    });

    renderPage();

    expect(await screen.findByText("Ponto extra de Bernardo")).toBeInTheDocument();
    expect(screen.getByText("Ponto extra (5%)")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 50,00").length).toBeGreaterThan(0);
    expect(screen.getByText(/somente leitura neste perfil/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apagar turno" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Observação")).toHaveAttribute("readonly");
  });

  it("pede confirmação e permite ao gerente apagar um turno não pago", async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/manager/chatters/chatter-1") return Promise.resolve({ data: { chatter: {
        id: "chatter-1", username: "julia", displayName: "Julia", isActive: true, payoutPercentage: 20, modelTags: []
      } } });
      if (url.includes("/shifts")) return Promise.resolve({ data: { items: [{
        id: "shift-1", modelTag: { id: "tag-1", name: "Annie" }, status: "CLOSED",
        startedAt: "2026-08-23T13:00:00.000Z", endedAt: "2026-08-23T20:00:00.000Z",
        startImageUrl: null, endImageUrl: null, startValueFormatted: "R$ 100,00", endValueFormatted: "R$ 200,00",
        grossAmountFormatted: "R$ 100,00", payoutAmountFormatted: "R$ 20,00", chatterVerifiedAt: new Date().toISOString(),
        negativeJustification: null, notes: null, earnings: { amountFormatted: "R$ 20,00", status: "PENDING", paidAt: null }
      }], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } } });
      if (url.includes("/payments")) return Promise.resolve({ data: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } });
      return Promise.resolve({ data: { tags: [] } });
    });
    apiMocks.delete.mockResolvedValue({ data: { success: true } });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Apagar turno" }));
    expect(screen.getByRole("heading", { name: "Apagar turno?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apagar definitivamente" }));
    await waitFor(() => expect(apiMocks.delete).toHaveBeenCalledWith("/manager/shifts/shift-1"));
  });

  it("edita apenas o nome exibido e exige o nome atual para excluir o perfil", async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/manager/chatters/chatter-1") return Promise.resolve({ data: { chatter: {
        id: "chatter-1", username: "julia", displayName: "Julia", isActive: true, payoutPercentage: 20, modelTags: []
      } } });
      if (url.includes("/shifts")) return Promise.resolve({ data: { items: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 } } });
      if (url.includes("/payments")) return Promise.resolve({ data: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } });
      return Promise.resolve({ data: { tags: [] } });
    });
    apiMocks.patch.mockResolvedValue({ data: { user: { displayName: "Ju" } } });
    apiMocks.delete.mockResolvedValue({ data: { success: true } });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Editar nome de Julia" }));
    const nameInput = screen.getByLabelText("Nome exibido");
    fireEvent.change(nameInput, { target: { value: "Ju" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nome" }));

    await waitFor(() => expect(apiMocks.patch).toHaveBeenCalledWith("/manager/users/chatter-1", { displayName: "Ju" }));
    expect(await screen.findByRole("heading", { name: "Ju", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText(/@julia/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Excluir perfil" }));
    const confirmation = screen.getByLabelText(/Digite Ju para confirmar/);
    const deleteButton = screen.getByRole("button", { name: "Excluir perfil definitivamente" });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: "Julia" } });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: "Ju" } });
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);
    await waitFor(() => expect(apiMocks.delete).toHaveBeenCalledWith("/manager/users/chatter-1"));
  });
});
