import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toast";
import { ManagerChatterDetailPage } from "../pages/ManagerChatterDetailPage";

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn()
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
});
