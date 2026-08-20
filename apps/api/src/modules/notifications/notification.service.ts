import { NotificationType, Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";

type NotificationInput = {
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  sourceType: string;
  sourceId: string;
  metadata?: Prisma.InputJsonValue;
};

export const createNotifications = async (fastify: FastifyInstance, input: NotificationInput) => {
  const userIds = [...new Set(input.userIds)];
  if (!userIds.length) return;

  await fastify.prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: input.type,
      title: input.title,
      message: input.message,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      metadata: input.metadata
    })),
    skipDuplicates: true
  });
};
