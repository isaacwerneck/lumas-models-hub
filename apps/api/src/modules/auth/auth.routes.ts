import crypto from "node:crypto";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { hashPassword, verifyPassword } from "../../utils/password";
import {
  buildAccessToken,
  buildRefreshToken,
  refreshCookieOptions,
  refreshTokenExpirationDate,
  tokenHash,
  verifyRefreshToken
} from "./auth.service";
import { env } from "../../config/env";

const loginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(8)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8).max(128)
});

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const user = await fastify.prisma.user.findFirst({
      where: {
        username: body.username,
        isActive: true
      }
    });

    if (!user) {
      return reply.code(401).send({ message: "Credenciais inválidas." });
    }

    const validPassword = await verifyPassword(body.password, user.passwordHash);
    if (!validPassword) {
      return reply.code(401).send({ message: "Credenciais inválidas." });
    }

    const sessionId = crypto.randomUUID();
    const refreshToken = buildRefreshToken({
      sub: user.id,
      sessionId,
      tokenType: "refresh"
    });

    await fastify.prisma.refreshSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: tokenHash(refreshToken),
        expiresAt: refreshTokenExpirationDate()
      }
    });

    reply.setCookie(env.REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);

    const accessToken = buildAccessToken(fastify, {
      sub: user.id,
      role: user.role,
      username: user.username
    });

    return {
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role
      }
    };
  });

  fastify.post("/refresh", async (request, reply) => {
    const refreshToken = request.cookies[env.REFRESH_COOKIE_NAME];

    if (!refreshToken) {
      return reply.code(401).send({ message: "Sessão expirada." });
    }

    try {
      const payload = verifyRefreshToken(refreshToken);
      const oldTokenHash = tokenHash(refreshToken);

      const session = await fastify.prisma.refreshSession.findFirst({
        where: {
          id: payload.sessionId,
          tokenHash: oldTokenHash,
          revokedAt: null,
          expiresAt: {
            gt: new Date()
          }
        },
        include: {
          user: true
        }
      });

      if (!session || !session.user.isActive) {
        reply.clearCookie(env.REFRESH_COOKIE_NAME, refreshCookieOptions);
        return reply.code(401).send({ message: "Sessão inválida." });
      }

      const newSessionId = crypto.randomUUID();
      const newRefreshToken = buildRefreshToken({
        sub: session.user.id,
        sessionId: newSessionId,
        tokenType: "refresh"
      });
      const newTokenHash = tokenHash(newRefreshToken);

      await fastify.prisma.$transaction([
        fastify.prisma.refreshSession.update({
          where: { id: session.id },
          data: {
            revokedAt: new Date(),
            replacedByTokenHash: newTokenHash
          }
        }),
        fastify.prisma.refreshSession.create({
          data: {
            id: newSessionId,
            userId: session.user.id,
            tokenHash: newTokenHash,
            expiresAt: refreshTokenExpirationDate()
          }
        })
      ]);

      reply.setCookie(env.REFRESH_COOKIE_NAME, newRefreshToken, refreshCookieOptions);

      const accessToken = buildAccessToken(fastify, {
        sub: session.user.id,
        role: session.user.role,
        username: session.user.username
      });

      return {
        accessToken,
        user: {
          id: session.user.id,
          username: session.user.username,
          displayName: session.user.displayName,
          role: session.user.role
        }
      };
    } catch {
      reply.clearCookie(env.REFRESH_COOKIE_NAME, refreshCookieOptions);
      return reply.code(401).send({ message: "Sessão inválida." });
    }
  });

  fastify.post("/logout", async (request, reply) => {
    const refreshToken = request.cookies[env.REFRESH_COOKIE_NAME];

    if (refreshToken) {
      await fastify.prisma.refreshSession.updateMany({
        where: {
          tokenHash: tokenHash(refreshToken),
          revokedAt: null
        },
        data: {
          revokedAt: new Date()
        }
      });
    }

    reply.clearCookie(env.REFRESH_COOKIE_NAME, refreshCookieOptions);
    return { success: true };
  });

  fastify.get("/me", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string };

    const user = await fastify.prisma.user.findFirst({
      where: {
        id: authUser.sub,
        isActive: true
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        createdAt: true
      }
    });

    if (!user) {
      return reply.code(404).send({ message: "Usuário não encontrado." });
    }

    return { user };
  });

  fastify.post("/change-password", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string };
    const body = changePasswordSchema.parse(request.body);

    const user = await fastify.prisma.user.findUnique({
      where: { id: authUser.sub }
    });

    if (!user || !user.isActive) {
      return reply.code(404).send({ message: "Usuário não encontrado." });
    }

    const validCurrentPassword = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!validCurrentPassword) {
      return reply.code(400).send({ message: "Senha atual inválida." });
    }

    const newHash = await hashPassword(body.newPassword);

    await fastify.prisma.$transaction([
      fastify.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash
        }
      }),
      fastify.prisma.refreshSession.updateMany({
        where: {
          userId: user.id,
          revokedAt: null
        },
        data: {
          revokedAt: new Date()
        }
      })
    ]);

    reply.clearCookie(env.REFRESH_COOKIE_NAME, refreshCookieOptions);

    return { success: true, message: "Senha alterada com sucesso. Faça login novamente." };
  });
};

export default authRoutes;
