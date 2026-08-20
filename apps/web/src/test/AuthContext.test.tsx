import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../auth/AuthContext";
import { LoginPage } from "../pages/LoginPage";
import { ProtectedRoute } from "../components/ProtectedRoute";

const apiMocks = vi.hoisted(() => ({
  post: vi.fn(),
  refreshSession: vi.fn(),
  getAccessToken: vi.fn(),
  setAccessToken: vi.fn(),
  subscribeSessionExpired: vi.fn()
}));

vi.mock("../lib/api", () => ({
  api: { post: apiMocks.post },
  refreshSession: apiMocks.refreshSession,
  getAccessToken: apiMocks.getAccessToken,
  setAccessToken: apiMocks.setAccessToken,
  subscribeSessionExpired: apiMocks.subscribeSessionExpired
}));

const USER = {
  id: "manager-1",
  username: "manager",
  displayName: "Manager",
  role: "MANAGER" as const
};

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  readonly name: string;
  onmessage: ((event: MessageEvent<{ type: string }>) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  emit(type: "login" | "logout" | "session-expired") {
    this.onmessage?.({ data: { type } } as MessageEvent<{ type: string }>);
  }
}

const ProtectedApp = ({ withLoginPage = false }: { withLoginPage?: boolean }) => (
  <Routes>
    <Route path="/login" element={withLoginPage ? <LoginPage /> : <div>Tela de login</div>} />
    <Route
      path="/home"
      element={
        <ProtectedRoute>
          <div>Área autenticada</div>
        </ProtectedRoute>
      }
    />
  </Routes>
);

const LogoutButton = () => {
  const { logout } = useAuth();
  return <button onClick={() => void logout()}>Sair</button>;
};

const LoginButton = () => {
  const { login } = useAuth();
  return <button onClick={() => void login("manager", "Password@123")}>Entrar</button>;
};

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    FakeBroadcastChannel.instances = [];
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
    apiMocks.subscribeSessionExpired.mockImplementation(() => () => undefined);
    apiMocks.getAccessToken.mockReturnValue("access");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("restaura a sessão antes de exibir o login e segue direto para a área autenticada", async () => {
    let resolveRefresh!: (value: unknown) => void;
    apiMocks.refreshSession.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <AuthProvider>
          <ProtectedApp withLoginPage />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByText("Verificando sessão")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Nome")).not.toBeInTheDocument();

    await act(async () => resolveRefresh({ status: "authenticated", session: { accessToken: "access", user: USER } }));

    expect(await screen.findByText("Área autenticada")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Nome")).not.toBeInTheDocument();
  });

  it("diferencia indisponibilidade e permite tentar restaurar novamente", async () => {
    apiMocks.refreshSession
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValueOnce({ status: "authenticated", session: { accessToken: "access", user: USER } });

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <AuthProvider>
          <ProtectedApp />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText("Não foi possível verificar sua sessão")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByText("Área autenticada")).toBeInTheDocument();
    expect(apiMocks.refreshSession).toHaveBeenCalledTimes(2);
  });

  it("trata ausência de cookie como sessão anônima", async () => {
    apiMocks.refreshSession.mockResolvedValue({ status: "anonymous" });

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <AuthProvider>
          <ProtectedApp />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText("Tela de login")).toBeInTheDocument();
    expect(apiMocks.setAccessToken).toHaveBeenCalledWith(null);
  });

  it("sincroniza logout recebido de outra aba", async () => {
    apiMocks.refreshSession.mockResolvedValue({ status: "authenticated", session: { accessToken: "access", user: USER } });

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <AuthProvider>
          <ProtectedApp />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText("Área autenticada")).toBeInTheDocument();
    act(() => FakeBroadcastChannel.instances[0].emit("logout"));

    expect(await screen.findByText("Tela de login")).toBeInTheDocument();
    expect(apiMocks.setAccessToken).toHaveBeenLastCalledWith(null);
  });

  it("mantém o logout local mesmo quando a API está indisponível", async () => {
    apiMocks.refreshSession.mockResolvedValue({ status: "authenticated", session: { accessToken: "access", user: USER } });
    apiMocks.post.mockRejectedValue(new Error("offline"));

    const firstRender = render(
      <AuthProvider>
        <LogoutButton />
      </AuthProvider>
    );

    await act(async () => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(localStorage.getItem("lumas_persistent_login_suppressed")).toBe("1");
    expect(FakeBroadcastChannel.instances[0].postMessage).toHaveBeenCalledWith({ type: "logout" });
    const refreshCallsBeforeReload = apiMocks.refreshSession.mock.calls.length;

    firstRender.unmount();
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <AuthProvider>
          <ProtectedApp />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText("Tela de login")).toBeInTheDocument();
    expect(apiMocks.refreshSession).toHaveBeenCalledTimes(refreshCallsBeforeReload);
  });

  it("remove a supressão persistente depois de um novo login válido", async () => {
    localStorage.setItem("lumas_persistent_login_suppressed", "1");
    apiMocks.post.mockResolvedValue({ data: { accessToken: "access", user: USER } });

    render(
      <AuthProvider>
        <LoginButton />
      </AuthProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await act(async () => undefined);
    expect(localStorage.getItem("lumas_persistent_login_suppressed")).toBeNull();
    expect(apiMocks.setAccessToken).toHaveBeenLastCalledWith("access");
    expect(FakeBroadcastChannel.instances[0].postMessage).toHaveBeenCalledWith({ type: "login" });
  });
});
