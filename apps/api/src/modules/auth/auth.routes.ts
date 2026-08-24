import crypto from "node:crypto";
import { z } from "zod";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { AuditAction } from "@prisma/client";
import { hashPassword, verifyPassword } from "../../utils/password";
import {
  buildAccessToken,
  buildRefreshToken,
  refreshCookieOptions,
  refreshCookieScope,
  refreshTokenExpirationDate,
  tokenHash,
  verifyRefreshToken
} from "./auth.service";
import { env } from "../../config/env";

const loginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(8)
});

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const requestMetadata = (request: { ip: string; headers: Record<string, unknown> }) => ({
  ip: request.ip,
  userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8).max(128)
});

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const requireTrustedBrowserOrigin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (env.NODE_ENV !== "production") return;
    if (request.headers.origin !== env.APP_ORIGIN) {
      return reply.code(403).send({ message: "Origem da requisição não autorizada." });
    }
  };

  fastify.post(
    "/login",
    {
      config: {
        rateLimit: {
          max: env.LOGIN_RATE_LIMIT_MAX,
          timeWindow: "1 minute"
        }
      },
      preHandler: [requireTrustedBrowserOrigin]
    },
    async (request, reply) => {
      const parsedBody = loginSchema.parse(request.body);
      const body = { ...parsedBody, username: parsedBody.username.trim().toLowerCase() };

      const user = await fastify.prisma.user.findFirst({
        where: {
          username: body.username,
          isActive: true
        }
      });

      if (!user) {
        await fastify.prisma.auditLog.create({
          data: {
            actorId: null,
            action: AuditAction.LOGIN_FAILED,
            targetType: "User",
            metadata: { username: body.username, reason: "unknown_or_inactive", ...requestMetadata(request) }
          }
        });
        return reply.code(401).send({ message: "Credenciais inválidas." });
      }

      if (user.lockedUntil && user.lockedUntil > new Date()) {
        const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
        return reply.code(423).send({
          message: `Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em ${minutesLeft} min.`
        });
      }

      const validPassword = await verifyPassword(body.password, user.passwordHash);
      if (!validPassword) {
        const failure = await fastify.prisma.$transaction(async (tx) => {
          const failedUser = await tx.user.update({
            where: { id: user.id },
            data: { failedLoginAttempts: { increment: 1 } },
            select: { failedLoginAttempts: true }
          });
          const failedLoginAttempts = failedUser.failedLoginAttempts;
          let lockedUntil: Date | null = null;
          let newlyLocked = false;

          await tx.auditLog.create({
            data: {
              actorId: user.id,
              action: AuditAction.LOGIN_FAILED,
              targetType: "User",
              targetId: user.id,
              metadata: { username: user.username, reason: "invalid_password", ...requestMetadata(request) }
            }
          });

          if (failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
          const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
            const lockResult = await tx.user.updateMany({
              where: {
                id: user.id,
                failedLoginAttempts: { gte: MAX_FAILED_ATTEMPTS },
                OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }]
              },
              data: { lockedUntil }
            });
            newlyLocked = lockResult.count === 1;
            if (newlyLocked) {
              await tx.auditLog.create({
              data: {
                actorId: user.id,
                action: AuditAction.ACCOUNT_LOCKED,
                targetType: "User",
                targetId: user.id,
                metadata: { username: user.username, lockedUntil, ...requestMetadata(request) }
              }
              });
            }
            return { failedLoginAttempts, lockedUntil, newlyLocked };
          }

          return { failedLoginAttempts, lockedUntil, newlyLocked };
        });

        if (failure.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
          return reply.code(423).send({
            message: `Senha incorreta. Conta bloqueada por ${LOCKOUT_MINUTES} minutos após ${MAX_FAILED_ATTEMPTS} tentativas falhas.`
          });
        }

        return reply.code(401).send({
          message: `Credenciais inválidas. ${MAX_FAILED_ATTEMPTS - failure.failedLoginAttempts} tentativa(s) restante(s).`
        });
      }

      if (user.lockedUntil || user.failedLoginAttempts > 0) {
        await fastify.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: 0,
            lockedUntil: null
          }
        });
      }

    const sessionId = crypto.randomUUID();
    const refreshToken = buildRefreshToken({
      sub: user.id,
      sessionId,
      tokenType: "refresh"
    });

    await fastify.prisma.$transaction([
      fastify.prisma.refreshSession.create({
        data: {
          id: sessionId,
          userId: user.id,
          tokenHash: tokenHash(refreshToken),
          expiresAt: refreshTokenExpirationDate()
        }
      }),
      fastify.prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: AuditAction.LOGIN,
          targetType: "User",
          targetId: user.id,
          metadata: { username: user.username, ...requestMetadata(request) }
        }
      })
    ]);

    reply.setCookie(env.REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);

    const accessToken = buildAccessToken(fastify, {
      sub: user.id,
      role: user.role,
      username: user.username
      ,authVersion: user.authVersion
    });

    return {
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        mustChangePassword: user.mustChangePassword
      }
    };
  });

  fastify.post("/refresh", { preHandler: [requireTrustedBrowserOrigin] }, async (request, reply) => {
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
        reply.clearCookie(env.REFRESH_COOKIE_NAME, refreshCookieScope);
        return reply.code(401).send({ message: "Sessão inválida." });
      }

      const newSessionId = crypto.randomUUID();
      const newRefreshToken = buildRefreshToken({
        sub: session.user.id,
        sessionId: newSessionId,
        tokenType: "refresh"
      });
      const newTokenHash = tokenHash(newRefreshToken);

      await fastify.prisma.$transaction(async (tx) => {
        const revoked = await tx.refreshSession.updateMany({
          where: { id: session.id, tokenHash: oldTokenHash, revokedAt: null },
          data: { revokedAt: new Date(), replacedByTokenHash: newTokenHash }
        });
        if (revoked.count !== 1) throw new Error("REFRESH_ALREADY_USED");
        await tx.refreshSession.create({ data: {
          id: newSessionId, userId: session.user.id, tokenHash: newTokenHash,
          expiresAt: refreshTokenExpirationDate()
        } });
      });

      reply.setCookie(env.REFRESH_COOKIE_NAME, newRefreshToken, refreshCookieOptions);

      const accessToken = buildAccessToken(fastify, {
        sub: session.user.id,
        role: session.user.role,
        username: session.user.username
        ,authVersion: session.user.authVersion
      });

      return {
        accessToken,
        user: {
          id: session.user.id,
          username: session.user.username,
          displayName: session.user.displayName,
          role: session.user.role,
          mustChangePassword: session.user.mustChangePassword
        }
      };
    } catch {
      reply.clearCookie(env.REFRESH_COOKIE_NAME, refreshCookieScope);
      return reply.code(401).send({ message: "Sessão inválida." });
    }
  });

  fastify.post("/logout", { preHandler: [requireTrustedBrowserOrigin] }, async (request, reply) => {
    const refreshToken = request.cookies[env.REFRESH_COOKIE_NAME];

    if (refreshToken) {
      const session = await fastify.prisma.refreshSession.findFirst({
        where: { tokenHash: tokenHash(refreshToken), revokedAt: null },
        select: { userId: true }
      });
      if (session) {
        await fastify.prisma.$transaction([
          fastify.prisma.refreshSession.updateMany({
            where: { tokenHash: tokenHash(refreshToken), revokedAt: null },
            data: { revokedAt: new Date() }
          }),
          fastify.prisma.auditLog.create({
            data: {
              actorId: session.userId,
              action: AuditAction.LOGOUT,
              targetType: "User",
              targetId: session.userId,
              metadata: requestMetadata(request)
            }
          })
        ]);
      }
    }

    reply.clearCookie(env.REFRESH_COOKIE_NAME, refreshCookieScope);
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
        mustChangePassword: true,
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
          ,authVersion: { increment: 1 },
          mustChangePassword: false
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
      }),
      fastify.prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: AuditAction.PASSWORD_CHANGED,
          targetType: "User",
          targetId: user.id,
          metadata: { username: user.username, ...requestMetadata(request) }
        }
      })
    ]);

    reply.clearCookie(env.REFRESH_COOKIE_NAME, refreshCookieScope);

    return { success: true, message: "Senha alterada com sucesso. Faça login novamente." };
  });

  fastify.post("/logout-all", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string };
    await fastify.prisma.$transaction([
      fastify.prisma.refreshSession.updateMany({ where: { userId: authUser.sub, revokedAt: null }, data: { revokedAt: new Date() } }),
      fastify.prisma.user.update({ where: { id: authUser.sub }, data: { authVersion: { increment: 1 } } }),
      fastify.prisma.auditLog.create({ data: { actorId: authUser.sub, action: AuditAction.SESSIONS_REVOKED, targetType: "User", targetId: authUser.sub, metadata: requestMetadata(request) } })
    ]);
    reply.clearCookie(env.REFRESH_COOKIE_NAME, refreshCookieScope);
    fastify.io.in(`user:${authUser.sub}`).disconnectSockets(true);
    return { success: true };
  });
};

export default authRoutes;
