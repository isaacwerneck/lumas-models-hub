import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { io, Socket } from "socket.io-client";
import { api, getAccessToken } from "../lib/api";
import type { ChatRoom } from "../types";

type ChatMessage = {
  id: string;
  content: string;
  createdAt: string;
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

  const socket = useMemo<Socket | null>(() => {
    const token = getAccessToken();
    if (!token) {
      return null;
    }

    return io(import.meta.env.VITE_API_URL ?? "http://localhost:3333", {
      auth: { token }
    });
  }, []);

  const loadRooms = async () => {
    const response = await api.get("/chat/rooms");
    setRooms(response.data.rooms);

    if (!roomId && response.data.rooms.length) {
      setRoomId(response.data.rooms[0].id);
    }
  };

  const loadMessages = async (targetRoomId: string) => {
    const response = await api.get(`/chat/rooms/${targetRoomId}/messages`);
    setMessages(response.data.messages);
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
      if (message.sender && roomId) {
        setMessages((current) => [...current, message]);
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
      socket.disconnect();
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
        await api.post(`/chat/rooms/${roomId}/messages`, { content });
      }

      setContent("");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message ?? "Nao foi possivel enviar a mensagem.");
    }
  };

  return (
    <section className="chat-layout">
      <div className="card room-list">
        <h2>Salas por modelo</h2>
        {rooms.map((room) => (
          <button
            key={room.id}
            className={room.id === roomId ? "room-button active" : "room-button"}
            onClick={() => setRoomId(room.id)}
          >
            {room.name}
          </button>
        ))}
      </div>

      <div className="card chat-box">
        <h2>Mensagens</h2>

        <div className="messages">
          {messages.map((message) => (
            <div key={message.id} className="message-item">
              <div className="meta">
                <strong>{message.sender.displayName}</strong>
                <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
              </div>
              <p>{message.content}</p>
            </div>
          ))}
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
