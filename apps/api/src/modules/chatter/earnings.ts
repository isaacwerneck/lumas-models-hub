import { EarningsKind, EarningsStatus, Prisma, Role } from "@prisma/client";
import { calculatePayoutCents } from "../../utils/payout";

export const resolveExtraPointSnapshot = async (tx: Prisma.TransactionClient, sourceId: string) => {
  const rule = await tx.extraPointRule.findUnique({
    where: { sourceId },
    include: { beneficiary: { select: { id: true, role: true, isActive: true, deletedAt: true } } }
  });
  if (!rule || rule.beneficiary.role !== Role.CHATTER || !rule.beneficiary.isActive || rule.beneficiary.deletedAt) {
    return { extraBeneficiaryId: null, extraPayoutPercentage: null };
  }
  return { extraBeneficiaryId: rule.beneficiaryId, extraPayoutPercentage: rule.percentage };
};

type EarningsSnapshot = {
  id: string;
  chatterId: string;
  grossAmountCents: number;
  payoutPercentage: number;
  payoutAmountCents: number;
  extraBeneficiaryId?: string | null;
  extraPayoutPercentage?: number | null;
};

export const syncShiftEarnings = async (tx: Prisma.TransactionClient, shift: EarningsSnapshot) => {
  const desired = [
    {
      chatterId: shift.chatterId,
      kind: EarningsKind.PRIMARY,
      payoutPercentage: shift.payoutPercentage,
      amountCents: shift.payoutAmountCents
    },
    ...(shift.extraBeneficiaryId && shift.extraPayoutPercentage
      ? [{
          chatterId: shift.extraBeneficiaryId,
          kind: EarningsKind.EXTRA,
          payoutPercentage: shift.extraPayoutPercentage,
          amountCents: calculatePayoutCents(shift.grossAmountCents, shift.extraPayoutPercentage)
        }]
      : [])
  ].filter((item) => item.amountCents > 0);

  const existing = await tx.earnings.findMany({ where: { shiftId: shift.id } });
  const desiredChatters = new Set(desired.map((item) => item.chatterId));
  const obsolete = existing.filter((item) => !desiredChatters.has(item.chatterId));
  if (obsolete.some((item) => item.status === EarningsStatus.PAID)) {
    throw new Error("PAID_EARNINGS_IMMUTABLE");
  }
  if (obsolete.length) await tx.earnings.deleteMany({ where: { id: { in: obsolete.map((item) => item.id) } } });

  for (const item of desired) {
    await tx.earnings.upsert({
      where: { shiftId_chatterId: { shiftId: shift.id, chatterId: item.chatterId } },
      create: { shiftId: shift.id, ...item },
      update: { amountCents: item.amountCents, kind: item.kind, payoutPercentage: item.payoutPercentage }
    });
  }
};

export const primaryEarning = <T extends { kind: EarningsKind }>(earnings: T[]) =>
  earnings.find((earning) => earning.kind === EarningsKind.PRIMARY) ?? null;
