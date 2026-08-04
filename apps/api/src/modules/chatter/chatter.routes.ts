import { Role, ShiftStatus, PaymentStatus, AuditAction } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../../config/env";
import { brlStringToCents, centsToBrl, resolveOcrValueCents } from "../../utils/currency";
import {
  daysUntilNextMonday,
  getWeekRangeInBusinessTz,
  isMondayInBusinessTz,
  nowInBusinessTz
} from "../../utils/time";

const startShiftSchema = z.object({
  modelTagId: z.string().min(1),
  startImageUrl: z.string().min(1),
  ocrRawText: z.string().optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
  ocrDetectedValue: z.string().optional(),
  manualConfirmedValue: z.string().optional()
});

const closeShiftSchema = z.object({
  endImageUrl: z.string().min(1),
  ocrRawText: z.string().optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
  ocrDetectedValue: z.string().optional(),
  manualConfirmedValue: z.string().optional(),
  negativeJustification: z.string().optional()
});

const shiftParamsSchema = z.object({
  shiftId: z.string().min(1)
});

const ensureChatterRole = (role: Role) => {
  if (role !== Role.CHATTER) {
    return false;
  }

  return true;
};

const chatterRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/shifts/current", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (!ensureChatterRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a chatters." });
    }

    const shift = await fastify.prisma.shift.findFirst({
      where: {
        chatterId: authUser.sub,
        status: ShiftStatus.OPEN
      },
      include: {
        modelTag: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        startedAt: "desc"
      }
    });

    return { shift };
  });

  fastify.post("/shifts/start", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (!ensureChatterRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a chatters." });
    }

    const body = startShiftSchema.parse(request.body);

    const chatterHasTag = await fastify.prisma.chatterModelTag.findFirst({
      where: {
        chatterId: authUser.sub,
        modelTagId: body.modelTagId
      }
    });

    if (!chatterHasTag) {
      return reply.code(403).send({ message: "Chatter não vinculado a essa modelo." });
    }

    const existingOpenShift = await fastify.prisma.shift.findFirst({
      where: {
        modelTagId: body.modelTagId,
        status: ShiftStatus.OPEN
      },
      include: {
        chatter: {
          select: {
            id: true,
            displayName: true
          }
        }
      }
    });

    if (existingOpenShift) {
      return reply.code(409).send({
        message: "Já existe um chatter em turno aberto para essa modelo.",
        openShift: {
          id: existingOpenShift.id,
          chatter: existingOpenShift.chatter,
          startedAt: existingOpenShift.startedAt
        }
      });
    }

    const resolvedCents = resolveOcrValueCents({
      detectedValue: body.ocrDetectedValue,
      rawText: body.ocrRawText
    });

    const manualCents = body.manualConfirmedValue ? brlStringToCents(body.manualConfirmedValue) : null;
    if (body.manualConfirmedValue && manualCents === null) {
      return reply.code(400).send({ message: "Valor manual inválido. Use formato brasileiro, ex: R$ 1.234,56." });
    }

    const confidence = body.ocrConfidence ?? null;
    const needsManualConfirmation = confidence !== null && confidence < env.OCR_LOW_CONFIDENCE_THRESHOLD;

    if (needsManualConfirmation && manualCents === null) {
      return reply.code(422).send({
        message: "OCR com baixa confiança. Confirme o valor manualmente para continuar.",
        requiresManualConfirmation: true,
        detectedValue: resolvedCents !== null ? centsToBrl(resolvedCents) : null,
        confidence
      });
    }

    const finalStartValueCents = manualCents ?? resolvedCents;
    if (finalStartValueCents === null) {
      return reply.code(400).send({
        message: "Não foi possível determinar o saldo inicial pela imagem/OCR. Confirme manualmente o valor."
      });
    }

    const shift = await fastify.prisma.shift.create({
      data: {
        chatterId: authUser.sub,
        modelTagId: body.modelTagId,
        status: ShiftStatus.OPEN,
        startedAt: nowInBusinessTz().toDate(),
        startImageUrl: body.startImageUrl,
        startOcrRawText: body.ocrRawText,
        startOcrConfidence: confidence,
        startValueCents: finalStartValueCents,
        startValueConfirmedAt: body.manualConfirmedValue ? new Date() : null
      },
      include: {
        modelTag: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    return reply.code(201).send({
      shift,
      startValueFormatted: centsToBrl(shift.startValueCents)
    });
  });

  fastify.post("/shifts/:shiftId/end", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (!ensureChatterRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a chatters." });
    }

    const params = shiftParamsSchema.parse(request.params);
    const body = closeShiftSchema.parse(request.body);

    const shift = await fastify.prisma.shift.findFirst({
      where: {
        id: params.shiftId,
        chatterId: authUser.sub,
        status: ShiftStatus.OPEN
      }
    });

    if (!shift) {
      return reply.code(404).send({ message: "Turno aberto não encontrado para esse chatter." });
    }

    const resolvedCents = resolveOcrValueCents({
      detectedValue: body.ocrDetectedValue,
      rawText: body.ocrRawText
    });

    const manualCents = body.manualConfirmedValue ? brlStringToCents(body.manualConfirmedValue) : null;
    if (body.manualConfirmedValue && manualCents === null) {
      return reply.code(400).send({ message: "Valor manual inválido. Use formato brasileiro, ex: R$ 1.234,56." });
    }

    const confidence = body.ocrConfidence ?? null;
    const needsManualConfirmation = confidence !== null && confidence < env.OCR_LOW_CONFIDENCE_THRESHOLD;

    if (needsManualConfirmation && manualCents === null) {
      return reply.code(422).send({
        message: "OCR com baixa confiança. Confirme o valor manualmente para continuar.",
        requiresManualConfirmation: true,
        detectedValue: resolvedCents !== null ? centsToBrl(resolvedCents) : null,
        confidence
      });
    }

    const endValueCents = manualCents ?? resolvedCents;
    if (endValueCents === null) {
      return reply.code(400).send({
        message: "Não foi possível determinar o saldo final pela imagem/OCR. Confirme manualmente o valor."
      });
    }

    const grossAmountCents = endValueCents - shift.startValueCents;
    const payoutAmountCents = Math.trunc(grossAmountCents / env.COMMISSION_DIVISOR);

    if (grossAmountCents < 0 && !(body.negativeJustification && body.negativeJustification.trim().length > 0)) {
      return reply.code(400).send({
        message: "Saldo final menor que o inicial exige justificativa obrigatória."
      });
    }

    const now = nowInBusinessTz().toDate();

    const closedShift = await fastify.prisma.$transaction(async (tx) => {
      const updatedShift = await tx.shift.update({
        where: {
          id: shift.id
        },
        data: {
          status: ShiftStatus.CLOSED,
          endedAt: now,
          endImageUrl: body.endImageUrl,
          endOcrRawText: body.ocrRawText,
          endOcrConfidence: confidence,
          endValueCents,
          endValueConfirmedAt: body.manualConfirmedValue ? now : null,
          grossAmountCents,
          commissionDivisor: env.COMMISSION_DIVISOR,
          payoutAmountCents,
          negativeJustification: grossAmountCents < 0 ? body.negativeJustification?.trim() : null
        }
      });

      const weekRange = getWeekRangeInBusinessTz(now);

      await tx.weeklyPayout.upsert({
        where: {
          chatterId_weekStartDate: {
            chatterId: authUser.sub,
            weekStartDate: weekRange.weekStart
          }
        },
        create: {
          chatterId: authUser.sub,
          weekStartDate: weekRange.weekStart,
          weekEndDate: weekRange.weekEnd,
          weekGrossCents: grossAmountCents,
          weekPayoutCents: payoutAmountCents,
          status: PaymentStatus.PENDING
        },
        update: {
          weekEndDate: weekRange.weekEnd,
          weekGrossCents: {
            increment: grossAmountCents
          },
          weekPayoutCents: {
            increment: payoutAmountCents
          },
          // New/changed values require chatter confirmation again.
          status: PaymentStatus.PENDING,
          chatterConfirmedAt: null
        }
      });

      return updatedShift;
    });

    return {
      shift: closedShift,
      grossAmountFormatted: centsToBrl(grossAmountCents),
      payoutAmountFormatted: centsToBrl(payoutAmountCents)
    };
  });

  fastify.get("/payment/summary", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (!ensureChatterRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a chatters." });
    }

    const weekRange = getWeekRangeInBusinessTz();

    const weeklyPayout = await fastify.prisma.weeklyPayout.findUnique({
      where: {
        chatterId_weekStartDate: {
          chatterId: authUser.sub,
          weekStartDate: weekRange.weekStart
        }
      }
    });

    const lifetimePaid = await fastify.prisma.weeklyPayout.aggregate({
      where: {
        chatterId: authUser.sub,
        status: {
          in: [PaymentStatus.PAID, PaymentStatus.FORCED_PAID]
        }
      },
      _sum: {
        weekPayoutCents: true
      }
    });

    const status = weeklyPayout?.status ?? PaymentStatus.PENDING;

    return {
      timezone: env.TZ,
      weekStartDate: weekRange.weekStart,
      weekEndDate: weekRange.weekEnd,
      currentWeek: {
        grossCents: weeklyPayout?.weekGrossCents ?? 0,
        payoutCents: weeklyPayout?.weekPayoutCents ?? 0,
        grossFormatted: centsToBrl(weeklyPayout?.weekGrossCents ?? 0),
        payoutFormatted: centsToBrl(weeklyPayout?.weekPayoutCents ?? 0),
        status,
        chatterConfirmedAt: weeklyPayout?.chatterConfirmedAt ?? null,
        paidAt: weeklyPayout?.paidAt ?? null
      },
      lifetime: {
        paidCents: lifetimePaid._sum.weekPayoutCents ?? 0,
        paidFormatted: centsToBrl(lifetimePaid._sum.weekPayoutCents ?? 0)
      },
      daysUntilNextPayment: daysUntilNextMonday(),
      paymentDone: status === PaymentStatus.PAID || status === PaymentStatus.FORCED_PAID,
      canConfirmToday: isMondayInBusinessTz()
    };
  });

  fastify.get("/payment/review", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (!ensureChatterRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a chatters." });
    }

    const weekRange = getWeekRangeInBusinessTz();

    const shifts = await fastify.prisma.shift.findMany({
      where: {
        chatterId: authUser.sub,
        status: ShiftStatus.CLOSED,
        endedAt: {
          gte: weekRange.weekStart,
          lte: weekRange.weekEnd
        }
      },
      include: {
        modelTag: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        endedAt: "asc"
      }
    });

    return {
      timezone: env.TZ,
      weekStartDate: weekRange.weekStart,
      weekEndDate: weekRange.weekEnd,
      shifts: shifts.map((shift) => ({
        ...shift,
        grossAmountFormatted: shift.grossAmountCents !== null ? centsToBrl(shift.grossAmountCents) : null,
        payoutAmountFormatted: shift.payoutAmountCents !== null ? centsToBrl(shift.payoutAmountCents) : null
      }))
    };
  });

  fastify.post("/payment/confirm", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };

    if (!ensureChatterRole(authUser.role)) {
      return reply.code(403).send({ message: "Acesso restrito a chatters." });
    }

    if (!isMondayInBusinessTz()) {
      return reply.code(403).send({
        message: "A confirmação de honorários só pode ser feita às segundas-feiras (America/Sao_Paulo)."
      });
    }

    const now = nowInBusinessTz().toDate();
    const weekRange = getWeekRangeInBusinessTz(now);

    const payout = await fastify.prisma.weeklyPayout.upsert({
      where: {
        chatterId_weekStartDate: {
          chatterId: authUser.sub,
          weekStartDate: weekRange.weekStart
        }
      },
      create: {
        chatterId: authUser.sub,
        weekStartDate: weekRange.weekStart,
        weekEndDate: weekRange.weekEnd,
        status: PaymentStatus.CHATTER_CONFIRMED,
        chatterConfirmedAt: now
      },
      update: {
        status: PaymentStatus.CHATTER_CONFIRMED,
        chatterConfirmedAt: now,
        weekEndDate: weekRange.weekEnd
      }
    });

    await fastify.prisma.auditLog.create({
      data: {
        actorId: authUser.sub,
        action: AuditAction.PAYMENT_CONFIRMED,
        targetType: "WeeklyPayout",
        targetId: payout.id,
        metadata: {
          weekStartDate: weekRange.weekStart,
          weekEndDate: weekRange.weekEnd,
          confirmedAt: now
        }
      }
    });

    return {
      success: true,
      payout
    };
  });
};

export default chatterRoutes;
