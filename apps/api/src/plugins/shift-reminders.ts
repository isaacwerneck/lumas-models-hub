import { NotificationType, Prisma, ShiftStatus } from "@prisma/client";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env";

dayjs.extend(utc);
dayjs.extend(timezone);

const emitOnce = async (fastify: FastifyInstance, input: {
  userId: string;
  type: NotificationType;
  sourceId: string;
  title: string;
  message: string;
  shiftId: string;
}) => {
  try {
    const notification = await fastify.prisma.notification.create({ data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      sourceType: "Shift",
      sourceId: input.sourceId,
      metadata: { shiftId: input.shiftId },
      isTransient: true
    } });
    fastify.io.to(`user:${input.userId}`).emit("shift:reminder", notification);
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }
};

export default fp(async (fastify) => {
  let running = false;
  let timer: NodeJS.Timeout | undefined;
  const scan = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const openShifts = await fastify.prisma.shift.findMany({
        where: { status: ShiftStatus.OPEN, chatter: { isActive: true } },
        include: { chatter: { select: { id: true, shiftReminderIntervalMinutes: true } } }
      });
      for (const shift of openShifts) {
        if (!fastify.io.sockets.adapter.rooms.get(`user:${shift.chatterId}`)?.size) continue;
        const intervalMs = shift.chatter.shiftReminderIntervalMinutes * 60_000;
        const elapsedMs = now.getTime() - shift.startedAt.getTime();
        const bucket = Math.floor(elapsedMs / intervalMs);
        if (bucket >= 1) {
          await emitOnce(fastify, {
            userId: shift.chatterId,
            type: NotificationType.SHIFT_OPEN_REMINDER,
            sourceId: `${shift.id}:interval:${bucket}`,
            title: "Seu ponto continua aberto",
            message: `Você está com o ponto aberto há ${Math.max(1, Math.floor(elapsedMs / 3_600_000))}h.`,
            shiftId: shift.id
          });
        }
        const localNow = dayjs(now).tz(env.TZ);
        for (const minute of [55, 57, 59]) {
          const warningAt = localNow.hour(23).minute(minute).second(0).millisecond(0);
          const distanceMs = localNow.valueOf() - warningAt.valueOf();
          if (distanceMs >= 0 && distanceMs < Math.max(env.REMINDER_SCAN_INTERVAL_MS * 2, 65_000)) {
            await emitOnce(fastify, {
              userId: shift.chatterId,
              type: NotificationType.MIDNIGHT_SHIFT_WARNING,
              sourceId: `${shift.id}:midnight:${localNow.format("YYYY-MM-DD")}:${minute}`,
              title: `Atenção: faltam ${60 - minute} minuto${minute === 59 ? "" : "s"}`,
              message: "Feche o ponto e salve a captura antes da meia-noite para não perder a renda visível.",
              shiftId: shift.id
            });
          }
        }
      }
      await fastify.prisma.notification.deleteMany({ where: { isTransient: true, createdAt: { lt: new Date(now.getTime() - 48 * 60 * 60 * 1000) } } });
    } finally {
      running = false;
    }
  };
  fastify.addHook("onReady", async () => {
    if (env.NODE_ENV === "test") return;
    timer = setInterval(() => void scan().catch((error) => fastify.log.error({ err: error }, "Shift reminder scan failed")), env.REMINDER_SCAN_INTERVAL_MS);
    timer.unref();
    void scan();
  });
  fastify.addHook("onClose", async () => { if (timer) clearInterval(timer); });
});
