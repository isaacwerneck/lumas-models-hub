import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "../components/NotificationCenter";
import { ToastProvider } from "../components/Toast";
import { renderWithQuery } from "./renderWithQuery";

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn() }));
vi.mock("../lib/api", () => ({ api: apiMocks }));

const notification = (id: string, title: string) => ({
  id,
  type: "NEGATIVE_SHIFT",
  title,
  message: "Requer acompanhamento.",
  sourceType: "Shift",
  sourceId: `shift-${id}`,
  metadata: null,
  readAt: null,
  createdAt: "2026-08-19T12:00:00.000Z"
});

describe("NotificationCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get.mockResolvedValue({
      data: {
        items: [notification("1", "Saldo negativo"), notification("2", "OCR com baixa confiança")],
        pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        unreadCount: 2
      }
    });
    apiMocks.patch.mockResolvedValue({ data: { success: true } });
    apiMocks.post.mockResolvedValue({ data: { success: true } });
  });

  it("lista, atualiza no foco e permite marcar uma ou todas como lidas", async () => {
    renderWithQuery(<ToastProvider><NotificationCenter /></ToastProvider>);
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
    fireEvent.click(screen.getByRole("button", { name: /Saldo negativo/ }));
    await waitFor(() => expect(apiMocks.patch).toHaveBeenCalledWith("/notifications/1/read"));

    fireEvent.click(screen.getByRole("button", { name: "Marcar todas como lidas" }));
    await waitFor(() => expect(apiMocks.post).toHaveBeenCalledWith("/notifications/read-all"));

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(apiMocks.get.mock.calls.length).toBeGreaterThan(1));
  });
});
