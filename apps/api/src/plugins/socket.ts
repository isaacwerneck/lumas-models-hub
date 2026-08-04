import fp from "fastify-plugin";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { z } from "zod";
import { env } from "../config/env";
import { ensureRoomAccess, getAllowedModelTagIds, modelRoomName } from "../modules/chat/chat.shared";

const sendMessageSchema = z.object({
  modelTagId: z.string().min(1),
  content: z.string().min(1).max(2000)
});

type AccessPayload = {
  sub: string;
  role: "CHATTER" | "MANAGER";
  username: string;
};

export default fp(async (fastify) => {
  const io = new Server(fastify.server, {
    cors: {
      origin: env.APP_ORIGIN,
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

    const allowedModelTagIds = await getAllowedModelTagIds(fastify, user.id, user.role);
    for (const tagId of allowedModelTagIds) {
      await socket.join(modelRoomName(tagId));
    }

    socket.on("chat:send", async (rawPayload) => {
      try {
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
