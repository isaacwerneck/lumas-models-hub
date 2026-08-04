import { Role } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ensureRoomAccess, getAllowedModelTagIds, modelRoomName } from "./chat.shared";

const roomParamsSchema = z.object({
  modelTagId: z.string().min(1)
});

const roomMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional()
});

const sendMessageSchema = z.object({
  content: z.string().min(1).max(2000)
});

const chatRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/rooms", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    const allowedIds = await getAllowedModelTagIds(fastify, authUser.sub, authUser.role);
    if (!allowedIds.length) {
      return { rooms: [] };
    }

    const tags = await fastify.prisma.modelTag.findMany({
      where: {
        id: { in: allowedIds }
      },
      orderBy: {
        name: "asc"
      }
    });

    return {
      rooms: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        isActive: tag.isActive
      }))
    };
  });

  fastify.get("/rooms/:modelTagId/messages", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };
    const params = roomParamsSchema.parse(request.params);
    const query = roomMessagesQuerySchema.parse(request.query);

    const hasAccess = await ensureRoomAccess(fastify, authUser.sub, authUser.role, params.modelTagId);
    if (!hasAccess) {
      return reply.code(403).send({ message: "Sem acesso a esta sala." });
    }

    const messages = await fastify.prisma.chatMessage.findMany({
      where: {
        modelTagId: params.modelTagId,
        ...(query.before
          ? {
              createdAt: {
                lt: new Date(query.before)
              }
            }
          : {})
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
      },
      orderBy: {
        createdAt: "desc"
      },
      take: query.limit
    });

    return {
      messages: messages.reverse()
    };
  });

  fastify.post("/rooms/:modelTagId/messages", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };
    const params = roomParamsSchema.parse(request.params);
    const body = sendMessageSchema.parse(request.body);

    const hasAccess = await ensureRoomAccess(fastify, authUser.sub, authUser.role, params.modelTagId);
    if (!hasAccess) {
      return reply.code(403).send({ message: "Sem acesso a esta sala." });
    }

    const message = await fastify.prisma.chatMessage.create({
      data: {
        modelTagId: params.modelTagId,
        senderId: authUser.sub,
        content: body.content.trim()
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

    fastify.io.to(modelRoomName(params.modelTagId)).emit("chat:message", message);

    return reply.code(201).send({ message });
  });
};

export default chatRoutes;
