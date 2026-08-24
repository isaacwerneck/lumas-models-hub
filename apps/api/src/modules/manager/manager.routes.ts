import { AuditAction, EarningsStatus, Prisma, ReconciliationStatus, Role } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { hashPassword } from "../../utils/password";
import { centsToBrl } from "../../utils/currency";
import { computeMph, formatHours, getReportedShiftDurationMs } from "../mph/mph";
import { paginationArgs, paginationMeta, paginationSchema } from "../../utils/pagination";
import { auditRequestMetadata } from "../../utils/audit";
import { processStorageDeletionJobs, queueEvidencePurge } from "../../services/evidence-cleanup";
import { ANALYTICS_UPDATED_EVENT, MANAGER_ROOM, PAYMENTS_UPDATED_EVENT } from "./manager.events";
import { businessDateKey, businessDateKeysInclusive } from "../../utils/time";
import { MAX_PAYOUT_PERCENTAGE, MIN_PAYOUT_PERCENTAGE } from "../../utils/payout";

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
  password: z.string().min(8).max(128).optional(),
  payoutPercentage: z.number().int().min(MIN_PAYOUT_PERCENTAGE).max(MAX_PAYOUT_PERCENTAGE).optional()
});

const userIdParamsSchema = z.object({
  userId: z.string().min(1)
});

const resetPasswordSchema = z.object({ password: z.string().min(8).max(128) });

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

const paySchema = z.object({
  chatterId: z.string().min(1),
  earningIds: z.array(z.string().min(1)).min(1).max(500).optional(),
  expectedTotalCents: z.number().int().nonnegative().optional(),
  receiptId: z.string().min(1).optional()
});

const analyticsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  modelTagId: z.string().min(1).optional(),
  chatterId: z.string().min(1).optional()
});

const shiftNotesSchema = z.object({
  notes: z.string().max(500)
});

const shiftIdParamsSchema = z.object({
  shiftId: z.string().min(1)
});

const chatterListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  modelTagId: z.string().min(1).optional()
});

const shiftListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["OPEN", "CLOSED"]).optional(),
  modelTagId: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

const paymentListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  chatterId: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

const auditListQuerySchema = paginationSchema.extend({
  action: z.nativeEnum(AuditAction).optional(),
  actorId: z.string().min(1).optional(),
  user: z.string().trim().max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

const managerRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/chatters", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const query = chatterListQuerySchema.parse(request.query);
    const where: Prisma.UserWhereInput = {
      role: Role.CHATTER,
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search, mode: "insensitive" } },
              { username: { contains: query.search, mode: "insensitive" } }
            ]
          }
        : {}),
      ...(query.status === "active" ? { isActive: true } : query.status === "inactive" ? { isActive: false } : {}),
      ...(query.modelTagId ? { chatterModelTags: { some: { modelTagId: query.modelTagId } } } : {})
    };
    const isV1 = request.url.startsWith("/api/v1/");
    const [chatters, total] = await fastify.prisma.$transaction([
      fastify.prisma.user.findMany({
      where,
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
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
      },
      ...(isV1 ? paginationArgs(query.page, query.pageSize) : {})
      }),
      fastify.prisma.user.count({ where })
    ]);

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

    const items = chatters.map((chatter) => {
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
      });

    return { chatters: items, items, pagination: paginationMeta(query.page, isV1 ? query.pageSize : Math.max(total, 1), total) };
  });

  fastify.get("/chatters/:userId/history", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const params = userIdParamsSchema.parse(request.params);

    const chatter = await fastify.prisma.user.findFirst({
      where: { id: params.userId, role: Role.CHATTER },
      select: {
        id: true,
        username: true,
        displayName: true,
        isActive: true,
        createdAt: true
      }
    });

    if (!chatter) {
      return reply.code(404).send({ message: "Chatter não encontrado." });
    }

    const [links, shifts, payments] = await Promise.all([
      fastify.prisma.chatterModelTag.findMany({
        where: { chatterId: chatter.id },
        include: {
          modelTag: {
            select: { id: true, name: true, isActive: true }
          }
        }
      }),
      fastify.prisma.shift.findMany({
        where: { chatterId: chatter.id },
        orderBy: { startedAt: "desc" },
        include: {
          modelTag: { select: { id: true, name: true } },
          earnings: true,
          startEvidence: { select: { id: true, originalName: true, status: true, purgedAt: true, sha256: true } },
          endEvidence: { select: { id: true, originalName: true, status: true, purgedAt: true, sha256: true } }
        }
      }),
      fastify.prisma.paymentHistory.findMany({
        where: { chatterId: chatter.id },
        orderBy: { paidAt: "desc" },
        include: {
          manager: { select: { id: true, displayName: true } }
        }
      })
    ]);

    return {
      chatter,
      modelTags: links.map((item) => item.modelTag),
      shifts: shifts.map((shift) => ({
        id: shift.id,
        modelTag: shift.modelTag,
        status: shift.status,
        startedAt: shift.startedAt,
        endedAt: shift.endedAt,
        startImageUrl: shift.startImageUrl,
        startEvidence: shift.startEvidence,
        startValueCents: shift.startValueCents,
        startValueFormatted: centsToBrl(shift.startValueCents),
        startValueConfirmedAt: shift.startValueConfirmedAt,
        endImageUrl: shift.endImageUrl,
        endEvidence: shift.endEvidence,
        endValueCents: shift.endValueCents,
        endValueFormatted: shift.endValueCents !== null ? centsToBrl(shift.endValueCents) : null,
        endValueConfirmedAt: shift.endValueConfirmedAt,
        grossAmountCents: shift.grossAmountCents,
        grossAmountFormatted: shift.grossAmountCents !== null ? centsToBrl(shift.grossAmountCents) : null,
        payoutAmountCents: shift.payoutAmountCents,
        payoutAmountFormatted: shift.payoutAmountCents !== null ? centsToBrl(shift.payoutAmountCents) : null,
        negativeJustification: shift.negativeJustification,
        notes: shift.notes,
        earnings: shift.earnings
          ? {
              amountCents: shift.earnings.amountCents,
              amountFormatted: centsToBrl(shift.earnings.amountCents),
              status: shift.earnings.status,
              paidAt: shift.earnings.paidAt
            }
          : null
      })),
      payments: payments.map((item) => ({
        id: item.id,
        totalCents: item.totalCents,
        totalFormatted: centsToBrl(item.totalCents),
        paidAt: item.paidAt,
        manager: item.manager
      }))
    };
  });

  fastify.get("/chatters/:userId", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };
    if (!ensureManagerRole(authUser.role)) return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    const params = userIdParamsSchema.parse(request.params);
    const chatter = await fastify.prisma.user.findFirst({
      where: { id: params.userId, role: Role.CHATTER },
      select: {
        id: true, username: true, displayName: true, isActive: true, payoutPercentage: true, createdAt: true,
        chatterModelTags: { include: { modelTag: { select: { id: true, name: true, isActive: true } } } }
      }
    });
    if (!chatter) return reply.code(404).send({ message: "Chatter não encontrado." });
    return { chatter: { ...chatter, modelTags: chatter.chatterModelTags.map((link) => link.modelTag), chatterModelTags: undefined } };
  });

  fastify.get("/chatters/:userId/shifts", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };
    if (!ensureManagerRole(authUser.role)) return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    const params = userIdParamsSchema.parse(request.params);
    const query = shiftListQuerySchema.parse(request.query);
    const where: Prisma.ShiftWhereInput = {
      chatterId: params.userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.modelTagId ? { modelTagId: query.modelTagId } : {}),
      ...(query.search ? { modelTag: { name: { contains: query.search, mode: "insensitive" } } } : {}),
      ...(query.from || query.to
        ? { startedAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) } }
        : {})
    };
    const [items, total, chatterExists] = await fastify.prisma.$transaction([
      fastify.prisma.shift.findMany({
        where,
        include: {
          modelTag: { select: { id: true, name: true } }, earnings: true,
          startEvidence: { select: { id: true, originalName: true, status: true, purgedAt: true, sha256: true } },
          endEvidence: { select: { id: true, originalName: true, status: true, purgedAt: true, sha256: true } }
        },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        ...paginationArgs(query.page, query.pageSize)
      }),
      fastify.prisma.shift.count({ where }),
      fastify.prisma.user.count({ where: { id: params.userId, role: Role.CHATTER } })
    ]);
    if (!chatterExists) return reply.code(404).send({ message: "Chatter não encontrado." });
    return {
      items: items.map((shift) => ({
        ...shift,
        startValueFormatted: centsToBrl(shift.startValueCents),
        endValueFormatted: shift.endValueCents === null ? null : centsToBrl(shift.endValueCents),
        grossAmountFormatted: shift.grossAmountCents === null ? null : centsToBrl(shift.grossAmountCents),
        payoutAmountFormatted: shift.payoutAmountCents === null ? null : centsToBrl(shift.payoutAmountCents),
        earnings: shift.earnings
          ? { ...shift.earnings, amountFormatted: centsToBrl(shift.earnings.amountCents) }
          : null
      })),
      pagination: paginationMeta(query.page, query.pageSize, total)
    };
  });

  fastify.get("/chatters/:userId/payments", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };
    if (!ensureManagerRole(authUser.role)) return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    const params = userIdParamsSchema.parse(request.params);
    const query = paymentListQuerySchema.parse(request.query);
    const where: Prisma.PaymentHistoryWhereInput = {
      chatterId: params.userId,
      ...(query.from || query.to
        ? { paidAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) } }
        : {})
    };
    const [items, total, chatterExists] = await fastify.prisma.$transaction([
      fastify.prisma.paymentHistory.findMany({
        where,
        include: { manager: { select: { id: true, displayName: true } } },
        orderBy: [{ paidAt: "desc" }, { id: "desc" }],
        ...paginationArgs(query.page, query.pageSize)
      }),
      fastify.prisma.paymentHistory.count({ where }),
      fastify.prisma.user.count({ where: { id: params.userId, role: Role.CHATTER } })
    ]);
    if (!chatterExists) return reply.code(404).send({ message: "Chatter não encontrado." });
    return {
      items: items.map((item) => ({ ...item, totalFormatted: centsToBrl(item.totalCents) })),
      pagination: paginationMeta(query.page, query.pageSize, total)
    };
  });

  fastify.post("/users", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role; sub: string };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const parsedBody = userCreateSchema.parse(request.body);
    const body = { ...parsedBody, username: parsedBody.username.trim().toLowerCase(), displayName: parsedBody.displayName.trim() };

    const existing = await fastify.prisma.user.findFirst({
      where: { username: { equals: body.username, mode: "insensitive" } }
    });

    if (existing) {
      return reply.code(409).send({ message: "Username já está em uso." });
    }

    const passwordHash = await hashPassword(body.password);

    const user = await fastify.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username: body.username,
          displayName: body.displayName,
          role: body.role,
          isActive: body.isActive,
          passwordHash,
          mustChangePassword: true
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          isActive: true,
          payoutPercentage: true,
          createdAt: true
        }
      });
      await tx.auditLog.create({ data: {
        actorId: authUser.sub,
        action: AuditAction.USER_CREATED,
        targetType: "User",
        targetId: created.id,
        metadata: { username: created.username, role: created.role, ...auditRequestMetadata(request) }
      } });
      return created;
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

    if (body.payoutPercentage !== undefined && (body.role ?? targetUser.role) !== Role.CHATTER) {
      return reply.code(400).send({ message: "A porcentagem de payout só pode ser definida para chatters." });
    }

    const data: {
      displayName?: string;
      role?: Role;
      isActive?: boolean;
      payoutPercentage?: number;
      passwordHash?: string;
      authVersion?: { increment: number };
      mustChangePassword?: boolean;
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
    if (body.payoutPercentage !== undefined) {
      data.payoutPercentage = body.payoutPercentage;
    }
    if (body.password) {
      data.passwordHash = await hashPassword(body.password);
      data.mustChangePassword = true;
    }
    if (body.password || body.role !== undefined || body.isActive === false) data.authVersion = { increment: 1 };

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
          payoutPercentage: true,
          updatedAt: true
        }
      });

      if (body.password || body.role !== undefined || body.isActive === false) {
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

      await tx.auditLog.create({
        data: {
          actorId: authUser.sub,
          action: AuditAction.USER_UPDATED,
          targetType: "User",
          targetId: targetUser.id,
          metadata: {
            username: targetUser.username,
            ...auditRequestMetadata(request),
            changes: {
              displayName: body.displayName,
              role: body.role,
              isActive: body.isActive,
              payoutPercentage: body.payoutPercentage === undefined
                ? undefined
                : { before: targetUser.payoutPercentage, after: body.payoutPercentage },
              passwordChanged: Boolean(body.password)
            }
          }
        }
      });

      return user;
    });

    if (body.password || body.role !== undefined || body.isActive === false) {
      fastify.io.in(`user:${targetUser.id}`).disconnectSockets(true);
    }

    return { user: updated };
  });

  fastify.post("/users/:userId/reset-password", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role; sub: string };
    if (!ensureManagerRole(authUser.role)) return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    const params = userIdParamsSchema.parse(request.params);
    const body = resetPasswordSchema.parse(request.body);
    const target = await fastify.prisma.user.findUnique({ where: { id: params.userId }, select: { id: true, username: true } });
    if (!target) return reply.code(404).send({ message: "Usuário não encontrado." });
    const passwordHash = await hashPassword(body.password);
    await fastify.prisma.$transaction([
      fastify.prisma.user.update({ where: { id: target.id }, data: { passwordHash, mustChangePassword: true, authVersion: { increment: 1 } } }),
      fastify.prisma.refreshSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      fastify.prisma.auditLog.create({ data: { actorId: authUser.sub, action: AuditAction.PASSWORD_RESET, targetType: "User", targetId: target.id, metadata: { username: target.username, ...auditRequestMetadata(request) } } })
    ]);
    fastify.io.in(`user:${target.id}`).disconnectSockets(true);
    return { success: true, mustChangePassword: true };
  });

  fastify.patch("/shifts/:shiftId/notes", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role; sub: string };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const params = shiftIdParamsSchema.parse(request.params);
    const body = shiftNotesSchema.parse(request.body);

    const shift = await fastify.prisma.shift.findFirst({
      where: { id: params.shiftId }
    });

    if (!shift) {
      return reply.code(404).send({ message: "Turno não encontrado." });
    }

    const notes = body.notes.trim() === "" ? null : body.notes.trim();
    const updated = await fastify.prisma.$transaction(async (tx) => {
      const result = await tx.shift.update({
        where: { id: shift.id }, data: { notes }, select: { id: true, notes: true }
      });
      await tx.auditLog.create({ data: {
        actorId: authUser.sub, action: AuditAction.SHIFT_NOTES_UPDATED,
        targetType: "Shift", targetId: shift.id,
        metadata: { notesPresent: Boolean(notes), ...auditRequestMetadata(request) }
      } });
      return result;
    });

    return { shift: updated };
  });

  fastify.delete("/shifts/:shiftId", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role; sub: string };
    if (!ensureManagerRole(authUser.role)) return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    const { shiftId } = shiftIdParamsSchema.parse(request.params);
    const shift = await fastify.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        earnings: true,
        chatter: { select: { id: true, displayName: true } },
        modelTag: { select: { id: true, name: true } },
        startEvidence: { select: { id: true, sha256: true } },
        endEvidence: { select: { id: true, sha256: true } }
      }
    });
    if (!shift) return reply.code(404).send({ message: "Turno não encontrado." });
    if (shift.earnings?.status === EarningsStatus.PAID || shift.earnings?.paymentId) {
      return reply.code(409).send({ message: "Turnos já pagos não podem ser apagados." });
    }
    const evidence = [shift.startEvidence, shift.endEvidence].filter((item): item is NonNullable<typeof item> => Boolean(item));
    await fastify.prisma.$transaction(async (tx) => {
      await queueEvidencePurge(tx, evidence.map((item) => item.id));
      await tx.shiftReconciliation.deleteMany({ where: { shiftId: shift.id } });
      await tx.earnings.deleteMany({ where: { shiftId: shift.id } });
      await tx.shift.delete({ where: { id: shift.id } });
      await tx.auditLog.create({ data: {
        actorId: authUser.sub,
        action: AuditAction.SHIFT_DELETED,
        targetType: "Shift",
        targetId: shift.id,
        metadata: {
          deletedByManager: true,
          batchId: shift.batchId,
          chatterId: shift.chatter.id,
          chatterName: shift.chatter.displayName,
          modelTagId: shift.modelTag.id,
          modelName: shift.modelTag.name,
          status: shift.status,
          startedAt: shift.startedAt.toISOString(),
          endedAt: shift.endedAt?.toISOString() ?? null,
          grossAmountCents: shift.grossAmountCents,
          payoutAmountCents: shift.payoutAmountCents,
          chatterVerifiedAt: shift.chatterVerifiedAt?.toISOString() ?? null,
          evidence: evidence.map((item) => ({ id: item.id, sha256: item.sha256 })),
          ...auditRequestMetadata(request)
        }
      } });
    });
    fastify.io.to(MANAGER_ROOM).emit(ANALYTICS_UPDATED_EVENT, { shiftId: shift.id, operation: "deleted" });
    fastify.io.to(MANAGER_ROOM).emit(PAYMENTS_UPDATED_EVENT, { chatterId: shift.chatter.id, shiftId: shift.id });
    return { success: true };
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
    const authUser = request.user as { role: Role; sub: string };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const parsedBody = tagCreateSchema.parse(request.body);
    const body = { ...parsedBody, name: parsedBody.name.trim() };

    const exists = await fastify.prisma.modelTag.findFirst({
      where: { name: { equals: body.name, mode: "insensitive" } }
    });

    if (exists) {
      return reply.code(409).send({ message: "Já existe uma tag com esse nome." });
    }

    const tag = await fastify.prisma.$transaction(async (tx) => {
      const created = await tx.modelTag.create({ data: { name: body.name, isActive: true } });
      await tx.auditLog.create({ data: {
        actorId: authUser.sub, action: AuditAction.TAG_CREATED,
        targetType: "ModelTag", targetId: created.id,
        metadata: { name: created.name, ...auditRequestMetadata(request) }
      } });
      return created;
    });

    return reply.code(201).send({ tag });
  });

  fastify.patch("/tags/:tagId", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role; sub: string };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const params = tagIdParamsSchema.parse(request.params);
    const parsedBody = tagUpdateSchema.parse(request.body);
    const body = { ...parsedBody, name: parsedBody.name?.trim() };

    const tag = await fastify.prisma.modelTag.findUnique({
      where: {
        id: params.tagId
      }
    });

    if (!tag) {
      return reply.code(404).send({ message: "Tag não encontrada." });
    }

    if (body.name && body.name !== tag.name) {
      const existingName = await fastify.prisma.modelTag.findFirst({
        where: { id: { not: tag.id }, name: { equals: body.name, mode: "insensitive" } }
      });

      if (existingName) {
        return reply.code(409).send({ message: "Já existe uma tag com esse nome." });
      }
    }

    const updated = await fastify.prisma.$transaction(async (tx) => {
      const result = await tx.modelTag.update({
        where: { id: tag.id }, data: { name: body.name, isActive: body.isActive }
      });
      await tx.auditLog.create({ data: {
        actorId: authUser.sub, action: AuditAction.TAG_UPDATED,
        targetType: "ModelTag", targetId: tag.id,
        metadata: {
          before: { name: tag.name, isActive: tag.isActive },
          after: { name: result.name, isActive: result.isActive },
          ...auditRequestMetadata(request)
        }
      } });
      return result;
    });

    return { tag: updated };
  });

  fastify.delete("/tags/:tagId", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role; sub: string };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const params = tagIdParamsSchema.parse(request.params);

    const tag = await fastify.prisma.modelTag.findUnique({
      where: { id: params.tagId },
      include: { _count: { select: { shifts: true, messages: true } } }
    });

    if (!tag) {
      return reply.code(404).send({ message: "Tag não encontrada." });
    }

    if (tag._count.shifts > 0 || tag._count.messages > 0) {
      return reply.code(409).send({
        message: "Esta tag possui turnos ou mensagens vinculados. Desative-a em vez de excluí-la."
      });
    }

    await fastify.prisma.$transaction([
      fastify.prisma.modelTag.delete({ where: { id: params.tagId } }),
      fastify.prisma.auditLog.create({ data: {
        actorId: authUser.sub, action: AuditAction.TAG_DELETED,
        targetType: "ModelTag", targetId: tag.id,
        metadata: { name: tag.name, ...auditRequestMetadata(request) }
      } })
    ]);

    return reply.code(204).send();
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
            id: { in: uniqueTagIds },
            isActive: true
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
            afterModelTagIds: uniqueTagIds,
            ...auditRequestMetadata(request)
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

  fastify.get("/payments/balances", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const query = chatterListQuerySchema.parse(request.query);
    const where: Prisma.UserWhereInput = {
      role: Role.CHATTER,
      ...(query.search ? { displayName: { contains: query.search, mode: "insensitive" } } : {}),
      ...(query.status === "active" ? { isActive: true } : query.status === "inactive" ? { isActive: false } : {})
    };
    const isV1 = request.url.startsWith("/api/v1/");
    const [chatters, total] = await fastify.prisma.$transaction([
      fastify.prisma.user.findMany({
        where, orderBy: [{ displayName: "asc" }, { id: "asc" }],
        select: { id: true, displayName: true, isActive: true },
        ...(isV1 ? paginationArgs(query.page, query.pageSize) : {})
      }),
      fastify.prisma.user.count({ where })
    ]);

    const chatterIds = chatters.map((chatter) => chatter.id);

    const pendingEarnings = await fastify.prisma.earnings.findMany({
      where: {
        chatterId: { in: chatterIds },
        status: EarningsStatus.PENDING
      },
      select: {
        id: true,
        chatterId: true,
        amountCents: true,
        shift: {
          select: {
            chatterVerifiedAt: true,
            reviewRevision: true,
            reconciliations: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { id: true, status: true, shiftReviewRevision: true, deltaCents: true }
            }
          }
        }
      }
    });

    const balances = new Map<string, { pending: number; verified: number; payable: number; blocked: number; payableIds: string[] }>();
    for (const earning of pendingEarnings) {
      const balance = balances.get(earning.chatterId) ?? { pending: 0, verified: 0, payable: 0, blocked: 0, payableIds: [] };
      balance.pending += earning.amountCents;
      if (earning.shift.chatterVerifiedAt) {
        balance.verified += earning.amountCents;
        const reconciliation = earning.shift.reconciliations[0];
        const hasBlockingReconciliation = reconciliation?.shiftReviewRevision === earning.shift.reviewRevision
          && reconciliation.status !== ReconciliationStatus.MATCHED
          && reconciliation.status !== ReconciliationStatus.OVERRIDDEN;
        const payable = !hasBlockingReconciliation;
        if (payable) {
          balance.payable += earning.amountCents;
          balance.payableIds.push(earning.id);
        } else {
          balance.blocked += earning.amountCents;
        }
      }
      balances.set(earning.chatterId, balance);
    }

    const items = chatters.map((chatter) => {
        const balance = balances.get(chatter.id) ?? { pending: 0, verified: 0, payable: 0, blocked: 0, payableIds: [] };
        return {
          id: chatter.id,
          displayName: chatter.displayName,
          isActive: chatter.isActive,
          pendingCents: balance.pending,
          pendingFormatted: centsToBrl(balance.pending),
          verifiedCents: balance.verified,
          verifiedFormatted: centsToBrl(balance.verified),
          payableCents: balance.payable,
          payableFormatted: centsToBrl(balance.payable),
          blockedCents: balance.blocked,
          blockedFormatted: centsToBrl(balance.blocked),
          payableEarningIds: balance.payableIds
        };
      });
    return { chatters: items, items, pagination: paginationMeta(query.page, isV1 ? query.pageSize : Math.max(total, 1), total) };
  });

  fastify.post("/payments/pay", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role; sub: string };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const body = paySchema.parse(request.body);
    const requestKeyHeader = request.headers["idempotency-key"];
    const requestKey = typeof requestKeyHeader === "string" && requestKeyHeader.length <= 100 ? requestKeyHeader : undefined;

    const chatter = await fastify.prisma.user.findFirst({
      where: { id: body.chatterId, role: Role.CHATTER }
    });

    if (!chatter) {
      return reply.code(404).send({ message: "Chatter não encontrado." });
    }

    const now = new Date();
    let result;
    try {
      result = await fastify.prisma.$transaction(async (tx) => {
      if (requestKey) {
        const previous = await tx.paymentHistory.findUnique({ where: { requestKey } });
        if (previous) return { payment: previous, purgedEvidenceCount: 0, idempotent: true };
      }
      const pending = await tx.earnings.findMany({
        where: { chatterId: chatter.id, status: EarningsStatus.PENDING },
        select: {
          id: true,
          shiftId: true,
          amountCents: true,
          shift: {
            select: {
              chatterVerifiedAt: true,
              reviewRevision: true,
              reconciliations: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
                select: { id: true, status: true, shiftReviewRevision: true }
              }
            }
          }
        },
        orderBy: { id: "asc" }
      });
      const eligible = pending.filter((item) => {
        const reconciliation = item.shift.reconciliations[0];
        const hasBlockingReconciliation = reconciliation?.shiftReviewRevision === item.shift.reviewRevision
          && reconciliation.status !== ReconciliationStatus.MATCHED
          && reconciliation.status !== ReconciliationStatus.OVERRIDDEN;
        return Boolean(item.shift.chatterVerifiedAt) && !hasBlockingReconciliation;
      });
      const requestedIds = body.earningIds ? new Set(body.earningIds) : null;
      const selected = requestedIds ? eligible.filter((item) => requestedIds.has(item.id)) : eligible;
      if (!selected.length) throw new Error("NO_PAYABLE_EARNINGS");
      if (requestedIds && (selected.length !== requestedIds.size || body.earningIds?.length !== requestedIds.size)) throw new Error("INVALID_EARNING_SELECTION");
      const totalCents = selected.reduce((acc, item) => acc + item.amountCents, 0);
      if (body.expectedTotalCents !== undefined && body.expectedTotalCents !== totalCents) throw new Error("TOTAL_CHANGED");
      if (body.receiptId) {
        const receipt = await tx.paymentReceipt.findFirst({
          where: { id: body.receiptId, uploadedById: authUser.sub, attachedAt: null, payment: { is: null } },
          select: { id: true }
        });
        if (!receipt) throw new Error("INVALID_RECEIPT");
      }
      const created = await tx.paymentHistory.create({
        data: {
          chatterId: chatter.id,
          managerId: authUser.sub,
          totalCents,
          requestKey,
          receiptId: body.receiptId
        }
      });
      if (body.receiptId) await tx.paymentReceipt.update({ where: { id: body.receiptId }, data: { attachedAt: now } });
      const paid = await tx.earnings.updateMany({
        where: { id: { in: selected.map((item) => item.id) }, status: EarningsStatus.PENDING },
        data: { status: EarningsStatus.PAID, paidAt: now, paymentId: created.id }
      });
      if (paid.count !== selected.length) throw new Error("CONCURRENT_PAYMENT");

      const reconciliationIds = selected
        .map((item) => item.shift.reconciliations[0])
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map((item) => item.id);
      if (reconciliationIds.length) {
        await tx.shiftReconciliation.updateMany({
          where: { id: { in: reconciliationIds } },
          data: { paymentId: created.id }
        });
      }

      const shifts = await tx.shift.findMany({
        where: { id: { in: selected.map((item) => item.shiftId) } },
        select: { startEvidenceId: true, endEvidenceId: true }
      });
      const evidenceIds = shifts.flatMap((item) => [item.startEvidenceId, item.endEvidenceId]).filter((id): id is string => Boolean(id));
      const purgedEvidenceCount = await queueEvidencePurge(tx, evidenceIds);

      await tx.auditLog.create({
        data: {
          actorId: authUser.sub,
          action: AuditAction.PAYMENT_MADE,
          targetType: "User",
          targetId: chatter.id,
          metadata: {
            chatterUsername: chatter.username,
            totalCents,
            paymentId: created.id,
            earningsCount: selected.length,
            purgedEvidenceCount,
            ...auditRequestMetadata(request)
          }
        }
      });

      return { payment: created, purgedEvidenceCount, idempotent: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if ((error as Error).message === "NO_PAYABLE_EARNINGS") return reply.code(400).send({ message: "Não há horários confirmados disponíveis para pagamento." });
      if ((error as Error).message === "INVALID_EARNING_SELECTION") return reply.code(409).send({ message: "A seleção contém horários não confirmados, com divergência no extrato ou já pagos. Atualize e tente novamente." });
      if ((error as Error).message === "TOTAL_CHANGED") return reply.code(409).send({ message: "O total disponível mudou. Atualize os dados antes de confirmar o pagamento." });
      if ((error as Error).message === "INVALID_RECEIPT") return reply.code(400).send({ message: "O comprovante é inválido, já foi utilizado ou pertence a outro gerente." });
      if ((error as Error).message === "CONCURRENT_PAYMENT" || (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))) {
        return reply.code(409).send({ message: "O saldo foi alterado por outro pagamento. Atualize e tente novamente." });
      }
      throw error;
    }

    void processStorageDeletionJobs(fastify);
    fastify.io.to(`user:${chatter.id}`).emit(PAYMENTS_UPDATED_EVENT, { chatterId: chatter.id, paymentId: result.payment.id });
    fastify.io.to("role:manager").emit(PAYMENTS_UPDATED_EVENT, { chatterId: chatter.id, paymentId: result.payment.id });

    return {
      payment: {
        id: result.payment.id,
        totalCents: result.payment.totalCents,
        totalFormatted: centsToBrl(result.payment.totalCents),
        paidAt: result.payment.paidAt
      },
      purgedEvidenceCount: result.purgedEvidenceCount,
      idempotent: result.idempotent
    };
  });

  fastify.get("/payments/history", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const query = paymentListQuerySchema.parse(request.query);
    const where: Prisma.PaymentHistoryWhereInput = {
      ...(query.chatterId ? { chatterId: query.chatterId } : {}),
      ...(query.search ? { chatter: { displayName: { contains: query.search, mode: "insensitive" } } } : {}),
      ...(query.from || query.to
        ? { paidAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) } }
        : {})
    };
    const isV1 = request.url.startsWith("/api/v1/");
    const [history, total] = await fastify.prisma.$transaction([
      fastify.prisma.paymentHistory.findMany({
      where,
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      include: {
        chatter: { select: { id: true, displayName: true } },
        manager: { select: { id: true, displayName: true } },
        receipt: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } }
      },
      ...(isV1 ? paginationArgs(query.page, query.pageSize) : {})
      }),
      fastify.prisma.paymentHistory.count({ where })
    ]);

    const items = history.map((item) => ({
        id: item.id,
        chatter: item.chatter,
        manager: item.manager,
        totalCents: item.totalCents,
        totalFormatted: centsToBrl(item.totalCents),
        paidAt: item.paidAt,
        receipt: item.receipt
      }));
    return { history: items, items, pagination: paginationMeta(query.page, isV1 ? query.pageSize : Math.max(total, 1), total) };
  });

  fastify.get("/audit-logs", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };
    if (!ensureManagerRole(authUser.role)) return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    const query = auditListQuerySchema.parse(request.query);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.user ? { actor: { OR: [
        { username: { contains: query.user, mode: "insensitive" } },
        { displayName: { contains: query.user, mode: "insensitive" } }
      ] } } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) } }
        : {})
    };
    const [items, total] = await fastify.prisma.$transaction([
      fastify.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, username: true, displayName: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...paginationArgs(query.page, query.pageSize)
      }),
      fastify.prisma.auditLog.count({ where })
    ]);
    return { items, pagination: paginationMeta(query.page, query.pageSize, total) };
  });

  fastify.get("/analytics", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { role: Role };

    if (!ensureManagerRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    }

    const query = analyticsQuerySchema.parse(request.query);

    const where: Prisma.ShiftWhereInput = {
      status: "CLOSED",
      grossAmountCents: { not: null }
    };

    if (query.from || query.to) {
      where.endedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lt: new Date(query.to) } : {})
      };
    } else {
      where.endedAt = { not: null };
    }

    if (query.modelTagId) {
      where.modelTagId = query.modelTagId;
    }
    if (query.chatterId) {
      where.chatterId = query.chatterId;
    }

    const shifts = await fastify.prisma.shift.findMany({
      where,
      select: {
        chatterId: true,
        modelTagId: true,
        startedAt: true,
        endedAt: true,
        grossAmountCents: true,
        payoutAmountCents: true,
        chatter: {
          select: { id: true, displayName: true, username: true, isActive: true }
        },
        modelTag: {
          select: { id: true, name: true, isActive: true }
        }
      }
    });

    const byModel = new Map<string, { modelTag: { id: string; name: string; isActive: boolean }; grossCents: number; payoutCents: number; hoursMs: number; shiftCount: number }>();
    const byChatter = new Map<string, { chatter: { id: string; displayName: string; username: string; isActive: boolean }; grossCents: number; payoutCents: number; hoursMs: number; shiftCount: number }>();
    const daily = new Map<string, { date: string; grossCents: number; payoutCents: number; hoursMs: number; shiftCount: number }>();

    let totalGrossCents = 0;
    let totalPayoutCents = 0;
    let totalHoursMs = 0;
    let shiftCount = 0;

    for (const shift of shifts) {
      if (!shift.endedAt || shift.grossAmountCents === null) {
        continue;
      }

      const hoursMs = getReportedShiftDurationMs(shift.startedAt, shift.endedAt);
      if (hoursMs === null) {
        continue;
      }

      const gross = shift.grossAmountCents;
      const payout = shift.payoutAmountCents ?? 0;

      totalGrossCents += gross;
      totalPayoutCents += payout;
      totalHoursMs += hoursMs;
      shiftCount += 1;

      const modelEntry = byModel.get(shift.modelTagId) ?? {
        modelTag: shift.modelTag,
        grossCents: 0,
        payoutCents: 0,
        hoursMs: 0,
        shiftCount: 0
      };
      modelEntry.grossCents += gross;
      modelEntry.payoutCents += payout;
      modelEntry.hoursMs += hoursMs;
      modelEntry.shiftCount += 1;
      byModel.set(shift.modelTagId, modelEntry);

      const chatterEntry = byChatter.get(shift.chatterId) ?? {
        chatter: shift.chatter,
        grossCents: 0,
        payoutCents: 0,
        hoursMs: 0,
        shiftCount: 0
      };
      chatterEntry.grossCents += gross;
      chatterEntry.payoutCents += payout;
      chatterEntry.hoursMs += hoursMs;
      chatterEntry.shiftCount += 1;
      byChatter.set(shift.chatterId, chatterEntry);

      const dayKey = businessDateKey(shift.endedAt);
      const dayEntry = daily.get(dayKey) ?? { date: dayKey, grossCents: 0, payoutCents: 0, hoursMs: 0, shiftCount: 0 };
      dayEntry.grossCents += gross;
      dayEntry.payoutCents += payout;
      dayEntry.hoursMs += hoursMs;
      dayEntry.shiftCount += 1;
      daily.set(dayKey, dayEntry);
    }

    const summary = {
      totalPayoutCents,
      totalPayoutFormatted: centsToBrl(totalPayoutCents),
      shiftCount,
      ...computeMph(totalGrossCents, totalHoursMs)
    };

    const byModelList = Array.from(byModel.values())
      .map((entry) => ({
        modelTag: entry.modelTag,
        grossCents: entry.grossCents,
        grossFormatted: centsToBrl(entry.grossCents),
        payoutCents: entry.payoutCents,
        payoutFormatted: centsToBrl(entry.payoutCents),
        hoursMs: entry.hoursMs,
        hoursFormatted: formatHours(entry.hoursMs),
        shiftCount: entry.shiftCount,
        ...computeMph(entry.grossCents, entry.hoursMs)
      }))
      .sort((a, b) => b.grossCents - a.grossCents);

    const byChatterList = Array.from(byChatter.values())
      .map((entry) => ({
        chatter: entry.chatter,
        grossCents: entry.grossCents,
        grossFormatted: centsToBrl(entry.grossCents),
        payoutCents: entry.payoutCents,
        payoutFormatted: centsToBrl(entry.payoutCents),
        hoursMs: entry.hoursMs,
        hoursFormatted: formatHours(entry.hoursMs),
        shiftCount: entry.shiftCount,
        ...computeMph(entry.grossCents, entry.hoursMs)
      }))
      .sort((a, b) => b.grossCents - a.grossCents);

    const dailyList = (() => {
      const entries = Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date));
      if (entries.length === 0) return [];
      const filled: { date: string; grossCents: number; payoutCents: number; hoursMs: number; shiftCount: number }[] = [];
      const byDate = new Map(entries.map((entry) => [entry.date, entry]));
      for (const key of businessDateKeysInclusive(entries[0].date, entries[entries.length - 1].date)) {
        filled.push(byDate.get(key) ?? { date: key, grossCents: 0, payoutCents: 0, hoursMs: 0, shiftCount: 0 });
      }
      return filled;
    })();

    return { summary, byModel: byModelList, byChatter: byChatterList, daily: dailyList };
  });
};

export default managerRoutes;
