import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "../pages/LoginPage";

const authMock = vi.hoisted(() => ({
  user: null as null | { id: string },
  status: "anonymous",
  login: vi.fn()
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => authMock }));

const renderLogin = () => render(<MemoryRouter initialEntries={["/login"]}><Routes>
  <Route path="/login" element={<LoginPage />} />
  <Route path="/home" element={<h1>Área inicial</h1>} />
</Routes></MemoryRouter>);

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    authMock.user = null;
    authMock.status = "anonymous";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "(flor)" }));
  });
  afterEach(() => cleanup());

  it("normaliza o usuário, autentica e navega", async () => {
    authMock.login.mockResolvedValue(undefined);
    renderLogin();
    fireEvent.change(screen.getByLabelText("Login"), { target: { value: "  JULIA  " } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "Julia@123" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { name: "Área inicial" })).toBeInTheDocument();
    expect(authMock.login).toHaveBeenCalledWith("julia", "Julia@123");
  });

  it("mostra sessão expirada, falha de login e tolera arte indisponível", async () => {
    sessionStorage.setItem("lumas_session_expired", "1");
    authMock.login.mockRejectedValue(new Error("invalid"));
    vi.mocked(fetch).mockResolvedValue({ ok: false, text: async () => "" } as Response);
    renderLogin();
    expect(await screen.findByText("Sua sessão expirou. Entre novamente.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Login"), { target: { value: "julia" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "errada" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Credenciais inválidas.")).toBeInTheDocument();
  });

  it("exibe restauração e redireciona sessão autenticada", async () => {
    authMock.status = "restoring";
    const view = renderLogin();
    expect(screen.getByText("Verificando sessão")).toBeInTheDocument();
    view.unmount();
    authMock.status = "authenticated";
    authMock.user = { id: "manager-1" };
    renderLogin();
    expect(await screen.findByRole("heading", { name: "Área inicial" })).toBeInTheDocument();
  });
});
