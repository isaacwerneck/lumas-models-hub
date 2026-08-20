import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPage } from "../pages/ChatPage";

const mocks = vi.hoisted(() => {
  const socketOn = vi.fn();
  const socketOff = vi.fn();
  const managerOn = vi.fn();
  const managerOff = vi.fn();
  const socket = {
    connected: false,
    on: socketOn,
    off: socketOff,
    emit: vi.fn(),
    disconnect: vi.fn(),
    io: { on: managerOn, off: managerOff }
  };
  return { socket, socketOn, socketOff, managerOn, managerOff, io: vi.fn(() => socket), get: vi.fn(), post: vi.fn(), token: "access-token" as string | null };
});

vi.mock("socket.io-client", () => ({ io: mocks.io, Socket: class {} }));
vi.mock("../lib/api", () => ({
  getAccessToken: () => mocks.token,
  api: { get: mocks.get, post: mocks.post }
}));

const sender = { id: "user-1", displayName: "Isaac", username: "isaac", role: "CHATTER" };
const message = (id: string, content: string, modelTagId = "room-1") => ({
  id, content, modelTagId, sender, createdAt: "2026-08-19T12:00:00.000Z"
});

describe("ChatPage realtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.socket.connected = false;
    mocks.token = "access-token";
    mocks.get.mockResolvedValue({ data: { rooms: [], messages: [] } });
    mocks.post.mockResolvedValue({ data: { message: message("m-post", "Via HTTP") } });
  });
  afterEach(() => cleanup());

  it("registra reconnect no Manager e connect_error no Socket", async () => {
    render(<ChatPage />);
    await waitFor(() => expect(mocks.io).toHaveBeenCalledOnce());

    expect(mocks.socketOn).toHaveBeenCalledWith("connect_error", expect.any(Function));
    expect(mocks.managerOn).toHaveBeenCalledWith("reconnect_attempt", expect.any(Function));
    expect(mocks.managerOn).toHaveBeenCalledWith("reconnect", expect.any(Function));

    const reconnect = mocks.managerOn.mock.calls.find(([event]) => event === "reconnect")?.[1];
    await act(async () => reconnect());
    expect(mocks.get).toHaveBeenCalledWith("/chat/rooms");
  });

  it("carrega salas, deduplica eventos e envia online ou por fallback HTTP", async () => {
    mocks.get.mockImplementation((url: string) => Promise.resolve(url.endsWith("/messages")
      ? { data: { messages: [message("m-1", "Olá")] } }
      : { data: { rooms: [{ id: "room-1", name: "Annie" }] } }));
    render(<ChatPage />);

    expect(await screen.findByRole("button", { name: "Annie" })).toBeInTheDocument();
    expect(await screen.findByText("Olá")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Digite sua mensagem"), { target: { value: "Via HTTP" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/chat/rooms/room-1/messages", { content: "Via HTTP" }));
    expect(await screen.findByText("Via HTTP")).toBeInTheDocument();

    const onMessage = mocks.socketOn.mock.calls.find(([event]) => event === "chat:message")?.[1];
    act(() => {
      onMessage(message("m-post", "Via HTTP"));
      onMessage(message("m-other", "Outra sala", "room-2"));
    });
    expect(screen.getAllByText("Via HTTP")).toHaveLength(1);
    expect(screen.queryByText("Outra sala")).not.toBeInTheDocument();

    const onError = mocks.socketOn.mock.calls.find(([event]) => event === "chat:error")?.[1];
    act(() => onError({ message: "Sala indisponível" }));
    expect(screen.getByText("Sala indisponível")).toBeInTheDocument();

    const onConnect = mocks.socketOn.mock.calls.find(([event]) => event === "connect")?.[1];
    act(() => onConnect());
    expect(screen.getByText("Conectado")).toBeInTheDocument();
    const onDisconnect = mocks.socketOn.mock.calls.find(([event]) => event === "disconnect")?.[1];
    act(() => onDisconnect());
    expect(screen.getByText("Offline")).toBeInTheDocument();
    const onConnectError = mocks.socketOn.mock.calls.find(([event]) => event === "connect_error")?.[1];
    act(() => onConnectError());
    expect(screen.getByText("Reconectando...")).toBeInTheDocument();
    const onReconnectAttempt = mocks.managerOn.mock.calls.find(([event]) => event === "reconnect_attempt")?.[1];
    act(() => onReconnectAttempt());
    const onReconnect = mocks.managerOn.mock.calls.find(([event]) => event === "reconnect")?.[1];
    await act(async () => onReconnect());
    expect(mocks.get).toHaveBeenCalledWith("/chat/rooms/room-1/messages");
    mocks.socket.connected = true;
    fireEvent.change(screen.getByPlaceholderText("Digite sua mensagem"), { target: { value: "Via socket" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(mocks.socket.emit).toHaveBeenCalledWith("chat:send", { modelTagId: "room-1", content: "Via socket" });
  });

  it("orienta quando não há salas e ignora envio vazio", async () => {
    render(<ChatPage />);
    expect(await screen.findByText("Nenhuma sala disponível para seu usuário.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("mostra erro v1 quando o fallback HTTP falha", async () => {
    mocks.get.mockImplementation((url: string) => Promise.resolve(url.endsWith("/messages")
      ? { data: { messages: [] } }
      : { data: { rooms: [{ id: "room-1", name: "Annie" }] } }));
    mocks.post.mockRejectedValue({ response: { data: { error: { message: "Mensagem bloqueada" } } } });
    render(<ChatPage />);
    await screen.findByRole("button", { name: "Annie" });
    fireEvent.change(screen.getByPlaceholderText("Digite sua mensagem"), { target: { value: "Falha" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("Mensagem bloqueada")).toBeInTheDocument();
  });

  it("não abre Socket.IO antes de existir access token", async () => {
    mocks.token = null;
    render(<ChatPage />);
    await screen.findByText("Nenhuma sala disponível para seu usuário.");
    expect(mocks.io).not.toHaveBeenCalled();
  });
});
