export const MIN_PAYOUT_PERCENTAGE = 1;
export const MAX_PAYOUT_PERCENTAGE = 100;
export const DEFAULT_PAYOUT_PERCENTAGE = 20;

export const calculatePayoutCents = (grossAmountCents: number, payoutPercentage: number) => {
  const wholeHundreds = Math.trunc(grossAmountCents / 100);
  const remainderCents = grossAmountCents - wholeHundreds * 100;
  return wholeHundreds * payoutPercentage + Math.trunc((remainderCents * payoutPercentage) / 100);
};
