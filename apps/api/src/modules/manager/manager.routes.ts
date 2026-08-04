import { AuditAction, PaymentStatus, Role } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { hashPassword } from "../../utils/password";
import { centsToBrl } from "../../utils/currency";
import { getWeekRangeInBusinessTz, nowInBusinessTz } from "../../utils/time";

const ensureManagerRole = (role: Role) => role === Role.MANAGER;

const userCreateSchema = z.object({
  username: z.string().min(3).max(40),
  displayName: z.string().min(2).max(100),
  role: z.enum([Role.CHATTER, Role.MANAGER]),
  password: z.string().min(8).max(128),
  isActive: z.boolean().optional().default(true)
});

const userUpdateSchema = z.object({
  displayName: z.string().min(2).max(100).optional(),
  role: z.enum([Role.CHATTER, Role.MANAGER]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(128).optional()
});

const userIdParamsSchema = z.object({
  userId: z.string().min(1)
});

const tagCreateSchema = z.object({
  name: z.string().min(2).max(80)
});

const tagUpdateSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  isActive: z.boolean().optional()
});

const tagIdParamsSchema = z.object({
  tagId: z.string().min(1)
});

const chatterTagUpdateSchema = z.object({
  modelTagIds: z.array(z.string().min(1)).max(100)
});

const payoutParamsSchema = z.object({
  payoutId: z.string().min(1)
});

const forcePaySchema = z.object({
  reason: z.string().min(3).max(300)
});

const managerRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/chatters", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const chatters = await fastify.prisma.user.findMany({
      where: {
        role: Role.CHATTER
      },
      orderBy: {
        displayName: "asc"
      },
      include: {
        chatterModelTags: {
          include: {
            modelTag: {
              select: {
                id: true,
                name: true,
                isActive: true
              }
            }
          }
        },
        _count: {
          select: {
            shifts: true
          }
        }
      }
    });

    const chatterIds = chatters.map((chatter) => chatter.id);

    const shiftSums = await fastify.prisma.shift.groupBy({
      by: ["chatterId"],
      where: {
        chatterId: {
          in: chatterIds
        },
        grossAmountCents: {
          not: null
        }
      },
      _sum: {
        grossAmountCents: true,
        payoutAmountCents: true
      }
    });

    const sumByChatter = new Map(
      shiftSums.map((item) => [
        item.chatterId,
        {
          grossAmountCents: item._sum.grossAmountCents ?? 0,
          payoutAmountCents: item._sum.payoutAmountCents ?? 0
        }
      ])
    );

    return {
      chatters: chatters.map((chatter) => {
        const sums = sumByChatter.get(chatter.id) ?? {
          grossAmountCents: 0,
          payoutAmountCents: 0
        };

        return {
          id: chatter.id,
          username: chatter.username,
          displayName: chatter.displayName,
          isActive: chatter.isActive,
          createdAt: chatter.createdAt,
          updatedAt: chatter.updatedAt,
          totalShifts: chatter._count.shifts,
          totalGrossCents: sums.grossAmountCents,
          totalGrossFormatted: centsToBrl(sums.grossAmountCents),
          totalPayoutCents: sums.payoutAmountCents,
          totalPayoutFormatted: centsToBrl(sums.payoutAmountCents),
          modelTags: chatter.chatterModelTags.map((link) => ({
            id: link.modelTag.id,
            name: link.modelTag.name,
            isActive: link.modelTag.isActive
          }))
        };
      })
    };
  });

  fastify.post("/users", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const body = userCreateSchema.parse(request.body);

    const existing = await fastify.prisma.user.findUnique({
      where: {
        username: body.username
      }
    });

    if (existing) {
      return reply.code(409).send({ message: "Username já está em uso." });
    }

    const passwordHash = await hashPassword(body.password);

    const user = await fastify.prisma.user.create({
      data: {
        username: body.username,
        displayName: body.displayName,
        role: body.role,
        isActive: body.isActive,
        passwordHash
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        isActive: true,
        createdAt: true
      }
    });

    return reply.code(201).send({ user });
  });

  fastify.patch("/users/:userId", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role; sub: string };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const params = userIdParamsSchema.parse(request.params);
    const body = userUpdateSchema.parse(request.body);

    const targetUser = await fastify.prisma.user.findUnique({
      where: {
        id: params.userId
      }
    });

    if (!targetUser) {
      return reply.code(404).send({ message: "Usuário não encontrado." });
    }

    if (targetUser.id === authUser.sub && body.isActive === false) {
      return reply.code(400).send({ message: "Não é permitido desativar o próprio usuário." });
    }

    const data: {
      displayName?: string;
      role?: Role;
      isActive?: boolean;
      passwordHash?: string;
    } = {};

    if (body.displayName !== undefined) {
      data.displayName = body.displayName;
    }
    if (body.role !== undefined) {
      data.role = body.role;
    }
    if (body.isActive !== undefined) {
      data.isActive = body.isActive;
    }
    if (body.password) {
      data.passwordHash = await hashPassword(body.password);
    }

    const updated = await fastify.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: {
          id: targetUser.id
        },
        data,
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          isActive: true,
          updatedAt: true
        }
      });

      if (body.password || body.isActive === false) {
        await tx.refreshSession.updateMany({
          where: {
            userId: targetUser.id,
            revokedAt: null
          },
          data: {
            revokedAt: new Date()
          }
        });
      }

      return user;
    });

    return { user: updated };
  });

  fastify.get("/tags", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const tags = await fastify.prisma.modelTag.findMany({
      orderBy: {
        name: "asc"
      },
      include: {
        _count: {
          select: {
            chatterLinks: true
          }
        }
      }
    });

    return {
      tags: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        isActive: tag.isActive,
        chatterCount: tag._count.chatterLinks,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt
      }))
    };
  });

  fastify.post("/tags", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const body = tagCreateSchema.parse(request.body);

    const exists = await fastify.prisma.modelTag.findUnique({
      where: {
        name: body.name
      }
    });

    if (exists) {
      return reply.code(409).send({ message: "Já existe uma tag com esse nome." });
    }

    const tag = await fastify.prisma.modelTag.create({
      data: {
        name: body.name,
        isActive: true
      }
    });

    return reply.code(201).send({ tag });
  });

  fastify.patch("/tags/:tagId", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const params = tagIdParamsSchema.parse(request.params);
    const body = tagUpdateSchema.parse(request.body);

    const tag = await fastify.prisma.modelTag.findUnique({
      where: {
        id: params.tagId
      }
    });

    if (!tag) {
      return reply.code(404).send({ message: "Tag não encontrada." });
    }

    if (body.name && body.name !== tag.name) {
      const existingName = await fastify.prisma.modelTag.findUnique({
        where: {
          name: body.name
        }
      });

      if (existingName) {
        return reply.code(409).send({ message: "Já existe uma tag com esse nome." });
      }
    }

    const updated = await fastify.prisma.modelTag.update({
      where: {
        id: tag.id
      },
      data: {
        name: body.name,
        isActive: body.isActive
      }
    });

    return { tag: updated };
  });

  fastify.put("/chatters/:userId/tags", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role; sub: string };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const params = userIdParamsSchema.parse(request.params);
    const body = chatterTagUpdateSchema.parse(request.body);

    const chatter = await fastify.prisma.user.findFirst({
      where: {
        id: params.userId,
        role: Role.CHATTER
      }
    });

    if (!chatter) {
      return reply.code(404).send({ message: "Chatter não encontrado." });
    }

    const uniqueTagIds = [...new Set(body.modelTagIds)];

    const existingTags = uniqueTagIds.length
      ? await fastify.prisma.modelTag.findMany({
          where: {
            id: {
              in: uniqueTagIds
            }
          },
          select: {
            id: true
          }
        })
      : [];

    if (existingTags.length !== uniqueTagIds.length) {
      return reply.code(400).send({ message: "Uma ou mais tags informadas não existem." });
    }

    const beforeLinks = await fastify.prisma.chatterModelTag.findMany({
      where: {
        chatterId: chatter.id
      },
      select: {
        modelTagId: true
      }
    });

    await fastify.prisma.$transaction(async (tx) => {
      await tx.chatterModelTag.deleteMany({
        where: {
          chatterId: chatter.id
        }
      });

      if (uniqueTagIds.length) {
        await tx.chatterModelTag.createMany({
          data: uniqueTagIds.map((modelTagId) => ({
            chatterId: chatter.id,
            modelTagId
          }))
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: authUser.sub,
          action: AuditAction.CHATTER_MODEL_TAGS_UPDATED,
          targetType: "User",
          targetId: chatter.id,
          metadata: {
            beforeModelTagIds: beforeLinks.map((item) => item.modelTagId),
            afterModelTagIds: uniqueTagIds
          }
        }
      });
    });

    const links = await fastify.prisma.chatterModelTag.findMany({
      where: {
        chatterId: chatter.id
      },
      include: {
        modelTag: {
          select: {
            id: true,
            name: true,
            isActive: true
          }
        }
      }
    });

    return {
      chatterId: chatter.id,
      modelTags: links.map((item) => item.modelTag)
    };
  });

  fastify.get("/payments/confirmed", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const weekRange = getWeekRangeInBusinessTz();

    const payouts = await fastify.prisma.weeklyPayout.findMany({
      where: {
        weekStartDate: weekRange.weekStart,
        status: PaymentStatus.CHATTER_CONFIRMED
      },
      include: {
        chatter: {
          select: {
            id: true,
            username: true,
            displayName: true
          }
        }
      },
      orderBy: {
        chatterConfirmedAt: "asc"
      }
    });

    return {
      weekStartDate: weekRange.weekStart,
      weekEndDate: weekRange.weekEnd,
      payouts: payouts.map((payout) => ({
        id: payout.id,
        chatter: payout.chatter,
        status: payout.status,
        weekGrossCents: payout.weekGrossCents,
        weekGrossFormatted: centsToBrl(payout.weekGrossCents),
        weekPayoutCents: payout.weekPayoutCents,
        weekPayoutFormatted: centsToBrl(payout.weekPayoutCents),
        chatterConfirmedAt: payout.chatterConfirmedAt
      }))
    };
  });

  fastify.post("/payments/:payoutId/mark-paid", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role; sub: string };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const params = payoutParamsSchema.parse(request.params);

    const payout = await fastify.prisma.weeklyPayout.findUnique({
      where: {
        id: params.payoutId
      }
    });

    if (!payout) {
      return reply.code(404).send({ message: "Pagamento semanal não encontrado." });
    }

    if (payout.status !== PaymentStatus.CHATTER_CONFIRMED) {
      return reply.code(400).send({
        message: "Este endpoint só permite confirmar pagamentos já validados pelo chatter."
      });
    }

    const now = nowInBusinessTz().toDate();

    const updated = await fastify.prisma.weeklyPayout.update({
      where: {
        id: payout.id
      },
      data: {
        status: PaymentStatus.PAID,
        paidAt: now,
        paidById: authUser.sub,
        forcedById: null
      }
    });

    return { payout: updated };
  });

  fastify.post("/payments/:payoutId/force-pay", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role; sub: string };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const params = payoutParamsSchema.parse(request.params);
    const body = forcePaySchema.parse(request.body);

    const payout = await fastify.prisma.weeklyPayout.findUnique({
      where: {
        id: params.payoutId
      }
    });

    if (!payout) {
      return reply.code(404).send({ message: "Pagamento semanal não encontrado." });
    }

    if (payout.status === PaymentStatus.PAID || payout.status === PaymentStatus.FORCED_PAID) {
      return reply.code(400).send({ message: "Este pagamento já foi concluído." });
    }

    const now = nowInBusinessTz().toDate();

    const updated = await fastify.prisma.$transaction(async (tx) => {
      const forced = await tx.weeklyPayout.update({
        where: {
          id: payout.id
        },
        data: {
          status: PaymentStatus.FORCED_PAID,
          paidAt: now,
          paidById: authUser.sub,
          forcedById: authUser.sub
        }
      });

      await tx.auditLog.create({
        data: {
          actorId: authUser.sub,
          action: AuditAction.PAYMENT_FORCED,
          targetType: "WeeklyPayout",
          targetId: payout.id,
          metadata: {
            reason: body.reason,
            previousStatus: payout.status,
            forcedAt: now
          }
        }
      });

      return forced;
    });

    return { payout: updated };
  });
};

export default managerRoutes;
