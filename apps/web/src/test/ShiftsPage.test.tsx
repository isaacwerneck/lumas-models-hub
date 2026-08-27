import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
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
    vi.stubGlobal("Notification", { permission: "granted" });
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

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("restaura o valor inicial e só mostra a justificativa quando o saldo fica negativo", async () => {
    render(<MemoryRouter><ToastProvider><ShiftsPage /></ToastProvider></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: /Encerrar turno/ })).toBeInTheDocument();
    const endValue = screen.getByLabelText("Valor do faturamento");
    expect(screen.queryByLabelText("Justificativa para saldo negativo")).not.toBeInTheDocument();

    fireEvent.change(endValue, { target: { value: "50,00" } });
    expect(await screen.findByLabelText("Justificativa para saldo negativo")).toBeRequired();

    fireEvent.change(endValue, { target: { value: "150,00" } });
    await waitFor(() => expect(screen.queryByLabelText("Justificativa para saldo negativo")).not.toBeInTheDocument());
  });

  it("mantém as ações de dois pontos em uma barra responsiva própria", async () => {
    const startedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/chat/rooms") return Promise.resolve({ data: { rooms: [{ id: "tag-1", name: "Annie" }, { id: "tag-2", name: "Bella" }] } });
      if (url === "/chatter/shifts/current") return Promise.resolve({ data: { shifts: [
        { id: "shift-1", batchId: "batch-1", modelTagId: "tag-1", startedAt, startValueCents: 10_000, startOriginalCurrency: "BRL", modelTag: { id: "tag-1", name: "Annie" } },
        { id: "shift-2", batchId: "batch-1", modelTagId: "tag-2", startedAt, startValueCents: 20_000, startOriginalCurrency: "BRL", modelTag: { id: "tag-2", name: "Bella" } }
      ] } });
      return Promise.reject(new Error(`GET inesperado: ${url}`));
    });

    render(<MemoryRouter><ToastProvider><ShiftsPage /></ToastProvider></MemoryRouter>);

    const actions = await screen.findByRole("group", { name: "Ações do ponto aberto" });
    expect(actions).toHaveClass("shift-close-actions");
    expect(screen.getByRole("button", { name: "Cancelar os dois pontos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Encerrar os dois pontos" })).toBeInTheDocument();
  });

  it("alterna para lançamento anterior e permite adicionar uma segunda modelo", async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/chat/rooms") return Promise.resolve({ data: { rooms: [{ id: "tag-1", name: "Annie" }, { id: "tag-2", name: "Bella" }] } });
      if (url === "/chatter/shifts/current") return Promise.resolve({ data: { shifts: [], shift: null } });
      return Promise.reject(new Error(`GET inesperado: ${url}`));
    });
    render(<MemoryRouter><ToastProvider><ShiftsPage /></ToastProvider></MemoryRouter>);
    await screen.findByRole("heading", { name: "Abrir ponto" });
    fireEvent.click(screen.getByRole("button", { name: "Lançar turno anterior" }));
    expect(screen.getByRole("heading", { name: "Lançar turno anterior" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Adicionar segunda modelo/ }));
    expect(screen.getAllByLabelText("Modelo")).toHaveLength(2);
  });

  it("cola imagem no campo ativo sem interceptar a colagem em campos de texto", async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/chat/rooms") return Promise.resolve({ data: { rooms: [{ id: "tag-1", name: "Annie" }] } });
      if (url === "/chatter/shifts/current") return Promise.resolve({ data: { shifts: [], shift: null } });
      return Promise.reject(new Error(`GET inesperado: ${url}`));
    });
    apiMocks.post.mockResolvedValue({ data: { evidence: { id: "evidence-1" }, detectedValue: "100,00", confidence: 0.95 } });
    render(<MemoryRouter><ToastProvider><ShiftsPage /></ToastProvider></MemoryRouter>);
    const dropzone = await screen.findByRole("button", { name: /Print do faturamento \(início\)/ });
    fireEvent.focus(dropzone);
    const image = new File(["image"], "captura.png", { type: "image/png" });
    fireEvent.paste(window, { clipboardData: { files: [image], items: [] } });
    await waitFor(() => expect(apiMocks.post).toHaveBeenCalledWith("/ocr/extract", expect.any(FormData)));

    apiMocks.post.mockClear();
    const money = screen.getByLabelText("Valor do faturamento");
    fireEvent.focus(money);
    fireEvent.paste(money, { clipboardData: { files: [image], items: [] } });
    expect(apiMocks.post).not.toHaveBeenCalled();
  });

  it("mantém comprovante e valor preenchidos quando outro chatter já está com o ponto aberto", async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === "/chat/rooms") return Promise.resolve({ data: { rooms: [{ id: "tag-1", name: "Annie" }] } });
      if (url === "/chatter/shifts/current") return Promise.resolve({ data: { shifts: [], shift: null } });
      return Promise.reject(new Error(`GET inesperado: ${url}`));
    });
    apiMocks.post.mockImplementation((url: string) => {
      if (url === "/ocr/extract") return Promise.resolve({ data: { evidence: { id: "evidence-1" }, detectedValue: "100,00", confidence: 0.95 } });
      if (url === "/chatter/shifts/start-batch") return Promise.reject({ response: { data: { error: { message: "Flávia já está com o ponto aberto em Annie desde 14:53." } } } });
      return Promise.reject(new Error(`POST inesperado: ${url}`));
    });

    render(<MemoryRouter><ToastProvider><ShiftsPage /></ToastProvider></MemoryRouter>);
    const dropzone = await screen.findByRole("button", { name: /Print do faturamento \(início\)/ });
    fireEvent.focus(dropzone);
    const image = new File(["image"], "captura.png", { type: "image/png" });
    fireEvent.paste(window, { clipboardData: { files: [image], items: [] } });
    await screen.findByText("captura.png");
    await waitFor(() => expect(screen.getByLabelText("Valor do faturamento")).toHaveValue("100,00"));

    const startForm = screen.getByRole("heading", { name: "Abrir ponto", level: 2 }).closest("form");
    const startButton = startForm?.querySelector<HTMLButtonElement>("button[type='submit']");
    expect(startButton).toBeTruthy();
    fireEvent.click(startButton!);
    const conflictText = await screen.findByText("Flávia já está com o ponto aberto em Annie desde 14:53.", { selector: ".shift-workflow-error" });
    const conflict = conflictText.closest<HTMLElement>("[role='alert']");
    expect(conflict).not.toBeNull();
    expect(conflict).toHaveTextContent("Flávia já está com o ponto aberto em Annie desde 14:53.");
    await waitFor(() => expect(conflict).toHaveFocus());
    expect(screen.getByText("captura.png")).toBeInTheDocument();
    expect(screen.getByLabelText("Valor do faturamento")).toHaveValue("100,00");
  });
});
