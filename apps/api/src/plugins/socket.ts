import fp from "fastify-plugin";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { z } from "zod";
import { env } from "../config/env";
import { ensureRoomAccess, getAllowedModelTagIds, modelRoomName } from "../modules/chat/chat.shared";
import { MANAGER_ROOM } from "../modules/manager/manager.events";

const sendMessageSchema = z.object({
  modelTagId: z.string().min(1),
  content: z.string().trim().min(1).max(2000)
});

type AccessPayload = {
  sub: string;
  role: "CHATTER" | "MANAGER";
  username: string;
  authVersion: number;
};

export default fp(async (fastify) => {
  const io = new Server(fastify.server, {
    cors: {
      origin: env.NODE_ENV === "production"
        ? env.APP_ORIGIN
        : [env.APP_ORIGIN, /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/],
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const authToken =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.headers.authorization?.replace("Bearer ", "") as string | undefined);

      if (!authToken) {
        return next(new Error("Missing auth token."));
      }

      const payload = jwt.verify(authToken, env.JWT_ACCESS_SECRET) as AccessPayload;
      const activeUser = await fastify.prisma.user.findUnique({ where: { id: payload.sub }, select: { isActive: true, role: true, authVersion: true, username: true } });
      if (!activeUser?.isActive || activeUser.role !== payload.role || activeUser.authVersion !== payload.authVersion) {
        return next(new Error("Invalid auth token."));
      }
      socket.data.user = {
        id: payload.sub,
        role: payload.role,
        username: payload.username
      };

      return next();
    } catch {
      return next(new Error("Invalid auth token."));
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.data.user as { id: string; role: "CHATTER" | "MANAGER" };
    await socket.join(`user:${user.id}`);

    if (user.role === "MANAGER") {
      await socket.join(MANAGER_ROOM);
    }

    const allowedModelTagIds = await getAllowedModelTagIds(fastify, user.id, user.role);
    for (const tagId of allowedModelTagIds) {
      await socket.join(modelRoomName(tagId));
    }

    let messageWindowStartedAt = Date.now();
    let messagesInWindow = 0;
    socket.on("chat:send", async (rawPayload) => {
      try {
        if (Date.now() - messageWindowStartedAt >= 60_000) { messageWindowStartedAt = Date.now(); messagesInWindow = 0; }
        messagesInWindow += 1;
        if (messagesInWindow > 60) { socket.emit("chat:error", { message: "Muitas mensagens. Aguarde um instante." }); return; }
        const payload = sendMessageSchema.parse(rawPayload);

        const hasAccess = await ensureRoomAccess(fastify, user.id, user.role, payload.modelTagId);
        if (!hasAccess) {
          socket.emit("chat:error", { message: "Sem acesso a esta sala." });
          return;
        }

        const message = await fastify.prisma.chatMessage.create({
          data: {
            modelTagId: payload.modelTagId,
            senderId: user.id,
            content: payload.content.trim()
          },
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                displayName: true,
                role: true
              }
            }
          }
        });

        io.to(modelRoomName(payload.modelTagId)).emit("chat:message", message);
      } catch {
        socket.emit("chat:error", { message: "Mensagem inválida." });
      }
    });
  });

  fastify.decorate("io", io);

  fastify.addHook("onClose", async () => {
    io.removeAllListeners();
    await io.close();
  });
});
