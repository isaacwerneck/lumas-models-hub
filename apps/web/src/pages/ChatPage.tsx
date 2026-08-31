import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { io, Socket } from "socket.io-client";
import { Clock3 } from "lucide-react";
import { api, getAccessToken } from "../lib/api";
import { SOCKET_URL } from "../lib/runtime";
import { formatDateTime, formatTime } from "../lib/dateTime";
import { getApiErrorMessage } from "../lib/apiError";
import type { ChatRoom } from "../types";

type ChatMessage = {
  id: string;
  content: string;
  createdAt: string;
  modelTagId: string;
  kind?: "USER" | "SHIFT_EVENT";
  shiftId?: string | null;
  eventType?: "OPENED" | "CLOSED" | "CANCELLED" | null;
  occurredAt?: string | null;
  sender?: {
    id: string;
    displayName: string;
    username: string;
    role: string;
  };
};

export const ChatPage = () => {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [roomId, setRoomId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const roomIdRef = useRef("");

  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      return;
    }

    const socketInstance = io(SOCKET_URL, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
      timeout: 10000
    });

    const onConnect = () => {
      setConnected(true);
      setReconnecting(false);
    };
    const onDisconnect = () => {
      setConnected(false);
    };
    const onReconnecting = () => {
      setReconnecting(true);
    };
    const onReconnect = () => {
      setConnected(true);
      setReconnecting(false);
      void api.get("/chat/rooms").then((response) => setRooms(response.data.rooms));
      if (roomIdRef.current) {
        void api.get(`/chat/rooms/${roomIdRef.current}/messages`).then((response) => setMessages(response.data.messages));
      }
    };
    const onConnectError = () => { setConnected(false); setReconnecting(true); };

    socketInstance.on("connect", onConnect);
    socketInstance.on("disconnect", onDisconnect);
    socketInstance.on("connect_error", onConnectError);
    socketInstance.io.on("reconnect_attempt", onReconnecting);
    socketInstance.io.on("reconnect", onReconnect);

    setSocket(socketInstance);

    return () => {
      socketInstance.off("connect", onConnect);
      socketInstance.off("disconnect", onDisconnect);
      socketInstance.off("connect_error", onConnectError);
      socketInstance.io.off("reconnect_attempt", onReconnecting);
      socketInstance.io.off("reconnect", onReconnect);
      socketInstance.disconnect();
    };
  }, []);

  const loadRooms = async () => {
    try {
      const response = await api.get("/chat/rooms");
      setRooms(response.data.rooms);

      if (!roomIdRef.current && response.data.rooms.length) setRoomId(response.data.rooms[0].id);
    } finally { setLoadingRooms(false); }
  };

  const loadMessages = useCallback(async (targetRoomId: string, silent = false) => {
    if (!silent) setLoadingMessages(true);
    try {
      const response = await api.get(`/chat/rooms/${targetRoomId}/messages`);
      const incoming = response.data.messages as ChatMessage[];
      setMessages((current) => {
        if (!silent) return incoming;
        const merged = new Map(current.map((item) => [item.id, item]));
        for (const item of incoming) merged.set(item.id, item);
        return [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      });
    } finally { if (!silent) setLoadingMessages(false); }
  }, []);

  useEffect(() => {
    void loadRooms();
  }, []);

  useEffect(() => {
    if (!roomId) {
      return;
    }
    void loadMessages(roomId);
  }, [roomId, loadMessages]);

  useEffect(() => {
    if (!roomId) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadMessages(roomId, true);
    };
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [roomId, loadMessages]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const onMessage = (message: ChatMessage) => {
      if (message.modelTagId === roomId) {
        setMessages((current) => current.some((item) => item.id === message.id)
          ? current
          : [...current, message].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
      }
    };

    const onError = (payload: { message: string }) => {
      setError(payload.message);
    };

    socket.on("chat:message", onMessage);
    socket.on("chat:error", onError);

    return () => {
      socket.off("chat:message", onMessage);
      socket.off("chat:error", onError);
    };
  }, [socket, roomId]);

  const onSend = async (event: FormEvent) => {
    event.preventDefault();

    if (!roomId || !content.trim()) {
      return;
    }

    setError(null);

    try {
      if (socket && socket.connected) {
        socket.emit("chat:send", {
          modelTagId: roomId,
          content
        });
      } else {
        const response = await api.post(`/chat/rooms/${roomId}/messages`, { content });
        const message = response.data.message as ChatMessage;
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      }

      setContent("");
    } catch (requestError: unknown) {
      setError(getApiErrorMessage(requestError, "Não foi possível enviar a mensagem."));
    }
  };

  return (
    <section className="chat-layout">
      <div className="page-header">
        <div>
          <h1>Chat</h1>
          <p>Converse com a equipe</p>
        </div>
        <span
          className={`conn-badge ${connected ? "online" : reconnecting ? "reconnecting" : "offline"}`}
          title={connected ? "Conectado" : reconnecting ? "Reconectando..." : "Desconectado"}
        >
          <span className="conn-dot" />
          {connected ? "Conectado" : reconnecting ? "Reconectando..." : "Offline"}
        </span>
      </div>
      <div className="card room-list">
        <h2>Salas por modelo</h2>
        {loadingRooms ? <div className="skeleton-list"><div className="skeleton" /><div className="skeleton" /></div> : null}
        {rooms.map((room) => (
          <button
            key={room.id}
            className={room.id === roomId ? "room-button active" : "room-button"}
            onClick={() => setRoomId(room.id)}
          >
            {room.name}
          </button>
        ))}
        {!loadingRooms && rooms.length === 0 ? <p className="empty-hint">Nenhuma sala disponível para seu usuário.</p> : null}
      </div>

      <div className="card chat-box">
        <h2>Mensagens</h2>

        <div className="messages" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Mensagens da sala">
          {loadingMessages ? <div className="skeleton-list"><div className="skeleton" /><div className="skeleton" /></div> : null}
          {messages.map((message) => message.kind === "SHIFT_EVENT" ? (
            <div key={message.id} className={`shift-event ${message.eventType ? `is-${message.eventType.toLowerCase()}` : "is-legacy"}`}>
              <span className="shift-event-rule" aria-hidden="true" />
              <Clock3 size={16} aria-hidden="true" />
              <p>{message.eventType ? message.content.replace(/\s+às\s+\d{2}:\d{2}h?\.$/, "") : message.content}</p>
              {message.eventType ? <span className="shift-event-badge">{message.eventType === "OPENED" ? "Entrada" : message.eventType === "CLOSED" ? "Saída" : "Cancelado"}</span> : null}
              <time dateTime={message.occurredAt ?? message.createdAt}>{message.occurredAt ? formatDateTime(message.occurredAt) : formatTime(message.createdAt)}</time>
              <span className="shift-event-rule" aria-hidden="true" />
            </div>
          ) : (
            <div key={message.id} className="message-item">
              <div className="meta">
                <strong>{message.sender?.displayName ?? "Sistema"}</strong>
                <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
              </div>
              <p>{message.content}</p>
            </div>
          ))}
          {!loadingMessages && messages.length === 0 ? <p className="empty-hint">Ainda não há mensagens nesta sala.</p> : null}
        </div>

        <form className="chat-form" onSubmit={onSend}>
          <label className="visually-hidden" htmlFor="chat-message-content">Mensagem</label>
          <input
            id="chat-message-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Digite sua mensagem"
          />
          <button className="primary-button" type="submit">
            Enviar
          </button>
        </form>

        {error ? <div className="error-box">{error}</div> : null}
      </div>
    </section>
  );
};
