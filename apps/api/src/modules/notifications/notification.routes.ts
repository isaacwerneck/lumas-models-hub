import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { paginationArgs, paginationMeta, paginationSchema } from "../../utils/pagination";

const listSchema = paginationSchema.extend({
  unreadOnly: z.coerce.boolean().default(false)
});

const paramsSchema = z.object({ notificationId: z.string().min(1) });

const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", { preHandler: [fastify.authenticate] }, async (request) => {
    const authUser = request.user as { sub: string };
    const query = listSchema.parse(request.query);
    const where = {
      userId: authUser.sub,
      ...(query.unreadOnly ? { readAt: null } : {})
    };

    const [items, total, unreadCount] = await Promise.all([
      fastify.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...paginationArgs(query.page, query.pageSize)
      }),
      fastify.prisma.notification.count({ where }),
      fastify.prisma.notification.count({ where: { userId: authUser.sub, readAt: null } })
    ]);

    return { items, pagination: paginationMeta(query.page, query.pageSize, total), unreadCount };
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
