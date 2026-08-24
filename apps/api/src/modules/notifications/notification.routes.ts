import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { paginationArgs, paginationMeta, paginationSchema } from "../../utils/pagination";

const listSchema = paginationSchema.extend({
  unreadOnly: z.coerce.boolean().default(false)
});

const paramsSchema = z.object({ notificationId: z.string().min(1) });
const preferencesSchema = z.object({ shiftReminderIntervalMinutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]) });

const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", { preHandler: [fastify.authenticate] }, async (request) => {
    const authUser = request.user as { sub: string };
    const query = listSchema.parse(request.query);
    const where = {
      userId: authUser.sub,
      isTransient: false,
      ...(query.unreadOnly ? { readAt: null } : {})
    };

    const [items, total, unreadCount] = await Promise.all([
      fastify.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...paginationArgs(query.page, query.pageSize)
      }),
      fastify.prisma.notification.count({ where }),
      fastify.prisma.notification.count({ where: { userId: authUser.sub, isTransient: false, readAt: null } })
    ]);

    return { items, pagination: paginationMeta(query.page, query.pageSize, total), unreadCount };
  });

  fastify.get("/preferences", { preHandler: [fastify.authenticate] }, async (request) => {
    const authUser = request.user as { sub: string };
    const user = await fastify.prisma.user.findUniqueOrThrow({ where: { id: authUser.sub }, select: { shiftReminderIntervalMinutes: true } });
    return { preferences: user };
  });

  fastify.patch("/preferences", { preHandler: [fastify.authenticate] }, async (request) => {
    const authUser = request.user as { sub: string };
    const body = preferencesSchema.parse(request.body);
    const user = await fastify.prisma.user.update({ where: { id: authUser.sub }, data: body, select: { shiftReminderIntervalMinutes: true } });
    return { preferences: user };
  });

  fastify.patch("/:notificationId/read", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string };
    const params = paramsSchema.parse(request.params);
    const result = await fastify.prisma.notification.updateMany({
      where: { id: params.notificationId, userId: authUser.sub },
      data: { readAt: new Date() }
    });
    if (!result.count) return reply.code(404).send({ message: "Notificação não encontrada." });
    return { success: true };
  });

  fastify.post("/read-all", { preHandler: [fastify.authenticate] }, async (request) => {
    const authUser = request.user as { sub: string };
    const result = await fastify.prisma.notification.updateMany({
      where: { userId: authUser.sub, readAt: null },
      data: { readAt: new Date() }
    });
    return { success: true, updated: result.count };
  });
};

export default notificationRoutes;
