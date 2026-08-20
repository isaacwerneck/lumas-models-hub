import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { io, Socket } from "socket.io-client";
import { api, getAccessToken } from "../lib/api";
import { formatTime } from "../lib/dateTime";
import { getApiErrorMessage } from "../lib/apiError";
import type { ChatRoom } from "../types";

type ChatMessage = {
  id: string;
  content: string;
  createdAt: string;
  modelTagId: string;
  sender: {
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

    const socketInstance = io(import.meta.env.VITE_API_URL ?? "http://localhost:3333", {
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

  const loadMessages = async (targetRoomId: string) => {
    setLoadingMessages(true);
    try {
      const response = await api.get(`/chat/rooms/${targetRoomId}/messages`);
      setMessages(response.data.messages);
    } finally { setLoadingMessages(false); }
  };

  useEffect(() => {
    void loadRooms();
  }, []);

  useEffect(() => {
    if (!roomId) {
      return;
    }
    void loadMessages(roomId);
  }, [roomId]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const onMessage = (message: ChatMessage) => {
      if (message.sender && message.modelTagId === roomId) {
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
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
      setError(getApiErrorMessage(requestError, "Nao foi possivel enviar a mensagem."));
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

        <div className="messages">
          {loadingMessages ? <div className="skeleton-list"><div className="skeleton" /><div className="skeleton" /></div> : null}
          {messages.map((message) => (
            <div key={message.id} className="message-item">
              <div className="meta">
                <strong>{message.sender.displayName}</strong>
                <span>{formatTime(message.createdAt)}</span>
              </div>
              <p>{message.content}</p>
            </div>
          ))}
          {!loadingMessages && messages.length === 0 ? <p className="empty-hint">Ainda não há mensagens nesta sala.</p> : null}
        </div>

        <form className="chat-form" onSubmit={onSend}>
          <input
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
