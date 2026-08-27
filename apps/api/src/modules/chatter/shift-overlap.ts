import { Prisma, ShiftStatus } from "@prisma/client";

type Interval = {
  modelTagId: string;
  startedAt: Date;
  endedAt?: Date | null;
  excludeShiftIds?: string[];
};

export class ShiftOverlapError extends Error {
  readonly statusCode = 409;
  constructor(public readonly conflictingShiftId: string) {
    super("O período informado se sobrepõe a outro turno da mesma modelo.");
  }
}

export class ShiftLimitError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("Você pode manter no máximo dois pontos abertos ao mesmo tempo.");
  }
}

export class ModelOpenShiftError extends Error {
  readonly statusCode = 409;
  constructor(
    public readonly conflictingShiftId: string,
    public readonly chatterDisplayName: string
  ) {
    super(`O chatter ${chatterDisplayName} está com o ponto aberto no momento.`);
  }
}

export class ChatterUnavailableError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("Este chatter foi arquivado e não pode criar ou recalcular ganhos.");
  }
}

export const lockShiftChatter = async (tx: Prisma.TransactionClient, chatterId: string) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shift:chatter:${chatterId}`}))`;
};

export const assertOpenShiftLimit = async (tx: Prisma.TransactionClient, chatterId: string, additional: number) => {
  const openCount = await tx.shift.count({ where: { chatterId, status: ShiftStatus.OPEN } });
  if (openCount + additional > 2) throw new ShiftLimitError();
};

export const lockShiftModels = async (tx: Prisma.TransactionClient, modelTagIds: string[]) => {
  const sortedIds = [...new Set(modelTagIds)].sort();
  for (const modelTagId of sortedIds) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shift:model:${modelTagId}`}))`;
  }
};

export const assertModelsHaveNoOpenShift = async (tx: Prisma.TransactionClient, modelTagIds: string[]) => {
  const conflict = await tx.shift.findFirst({
    where: { modelTagId: { in: [...new Set(modelTagIds)] }, status: ShiftStatus.OPEN },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    select: { id: true, chatter: { select: { displayName: true } } }
  });
  if (conflict) throw new ModelOpenShiftError(conflict.id, conflict.chatter.displayName);
};

export const findOverlappingShift = async (tx: Prisma.TransactionClient, interval: Interval) => {
  const exclude = interval.excludeShiftIds?.length ? { id: { notIn: interval.excludeShiftIds } } : {};
  const timeFilter: Prisma.ShiftWhereInput = interval.endedAt
    ? {
        startedAt: { lt: interval.endedAt },
        OR: [{ endedAt: null }, { endedAt: { gt: interval.startedAt } }]
      }
    : {
        OR: [
          { status: ShiftStatus.OPEN },
          { startedAt: { lte: interval.startedAt }, endedAt: { gt: interval.startedAt } }
        ]
      };

  return tx.shift.findFirst({
    where: { modelTagId: interval.modelTagId, ...exclude, ...timeFilter },
    select: { id: true }
  });
};

export const assertNoShiftOverlap = async (tx: Prisma.TransactionClient, interval: Interval) => {
  const conflict = await findOverlappingShift(tx, interval);
  if (conflict) throw new ShiftOverlapError(conflict.id);
};
