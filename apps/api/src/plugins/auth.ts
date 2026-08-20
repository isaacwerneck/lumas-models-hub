import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import { env } from "../config/env";

export default fp(async (fastify) => {
  await fastify.register(fastifyJwt, {
    secret: env.JWT_ACCESS_SECRET
  });

  fastify.decorate("authenticate", async (request, reply) => {
    try {
      await request.jwtVerify();
      const tokenUser = request.user as { sub: string; role: string; authVersion?: number };
      const user = await fastify.prisma.user.findUnique({
        where: { id: tokenUser.sub },
        select: { isActive: true, role: true, authVersion: true, mustChangePassword: true }
      });
      if (!user?.isActive || user.role !== tokenUser.role || user.authVersion !== tokenUser.authVersion) {
        return reply.code(401).send({ message: "Sessão inválida ou revogada." });
      }
      const allowedWhileChanging = request.url.includes("/auth/change-password") || request.url.includes("/auth/logout") || request.url.includes("/auth/me");
      if (user.mustChangePassword && !allowedWhileChanging) {
        return reply.code(428).send({ message: "Altere sua senha temporária antes de continuar.", code: "PASSWORD_CHANGE_REQUIRED" });
      }
    } catch {
      return reply.code(401).send({ message: "Não autenticado." });
    }
  });
});
