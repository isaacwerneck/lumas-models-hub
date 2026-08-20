import { Prisma, Role, ShiftStatus } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { computeMph, getReportedShiftDurationMs, getWindowRange, MPH_WINDOWS } from "./mph";
import type { MphWindow } from "./mph";

const rankingQuerySchema = z.object({
  window: z.enum(MPH_WINDOWS).optional().default("month")
});

type ChatterAgg = {
  chatter: { id: string; displayName: string; username: string; isActive: boolean };
  totalGrossCents: number;
  totalHoursMs: number;
  shiftCount: number;
};

const mphRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/ranking", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (authUser.role !== Role.CHATTER && authUser.role !== Role.MANAGER) {
      return reply.code(403).send({ message: "Acesso restrito." });
    }

    const { window } = rankingQuerySchema.parse(request.query);
    const range = getWindowRange(window as MphWindow);

    const where: Prisma.ShiftWhereInput = {
      status: ShiftStatus.CLOSED,
      grossAmountCents: { not: null }
    };

    if (range.gte || range.lt) {
      where.endedAt = { gte: range.gte, lt: range.lt };
    } else {
      where.endedAt = { not: null };
    }

    const shifts = await fastify.prisma.shift.findMany({
      where,
      select: {
        chatterId: true,
        startedAt: true,
        endedAt: true,
        grossAmountCents: true,
        chatter: {
          select: { id: true, displayName: true, username: true, isActive: true }
        }
      }
    });

    const byChatter = new Map<string, ChatterAgg>();

    for (const shift of shifts) {
      if (!shift.endedAt || shift.grossAmountCents === null) {
        continue;
      }

      const hoursMs = getReportedShiftDurationMs(shift.startedAt, shift.endedAt);
      if (hoursMs === null) {
        continue;
      }

      const entry = byChatter.get(shift.chatterId) ?? {
        chatter: shift.chatter,
        totalGrossCents: 0,
        totalHoursMs: 0,
        shiftCount: 0
      };

      entry.totalGrossCents += shift.grossAmountCents;
      entry.totalHoursMs += hoursMs;
      entry.shiftCount += 1;
      byChatter.set(shift.chatterId, entry);
    }

    const ranking = Array.from(byChatter.values())
      .map((entry) => ({
        chatter: entry.chatter,
        shiftCount: entry.shiftCount,
        ...computeMph(entry.totalGrossCents, entry.totalHoursMs)
      }))
      .sort((a, b) =>
        b.mphCentsPerHour - a.mphCentsPerHour ||
        b.totalGrossCents - a.totalGrossCents ||
        a.chatter.displayName.localeCompare(b.chatter.displayName, "pt-BR") ||
        a.chatter.id.localeCompare(b.chatter.id)
      );

    return { window, ranking };
  });
};

export default mphRoutes;
