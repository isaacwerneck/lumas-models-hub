import { Role } from "@prisma/client";
import type { FastifyInstance } from "fastify";

export const modelRoomName = (modelTagId: string) => `model:${modelTagId}`;

export const getAllowedModelTagIds = async (
  app: FastifyInstance,
  userId: string,
  role: Role
): Promise<string[]> => {
  if (role === Role.MANAGER) {
    const tags = await app.prisma.modelTag.findMany({
      where: { isActive: true },
      select: { id: true }
    });

    return tags.map((tag) => tag.id);
  }

  const links = await app.prisma.chatterModelTag.findMany({
    where: {
      chatterId: userId,
      modelTag: { isActive: true }
    },
    select: {
      modelTagId: true
    }
  });

  return links.map((link) => link.modelTagId);
};

export const ensureRoomAccess = async (
  app: FastifyInstance,
  userId: string,
  role: Role,
  modelTagId: string
): Promise<boolean> => {
  if (role === Role.MANAGER) {
    return Boolean(await app.prisma.modelTag.findFirst({ where: { id: modelTagId, isActive: true }, select: { id: true } }));
  }

  const link = await app.prisma.chatterModelTag.findFirst({
    where: {
      chatterId: userId,
      modelTagId,
      modelTag: { isActive: true }
    },
    select: {
      id: true
    }
  });

  return Boolean(link);
};
