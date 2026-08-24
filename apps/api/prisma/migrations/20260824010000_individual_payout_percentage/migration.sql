ALTER TABLE "User"
  ADD COLUMN "payoutPercentage" INTEGER NOT NULL DEFAULT 20;

ALTER TABLE "User"
  ADD CONSTRAINT "User_payoutPercentage_check"
  CHECK ("payoutPercentage" BETWEEN 1 AND 100);

ALTER TABLE "Shift"
  ADD COLUMN "payoutPercentage" INTEGER;

ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_payoutPercentage_check"
  CHECK ("payoutPercentage" IS NULL OR "payoutPercentage" BETWEEN 1 AND 100);

UPDATE "Shift"
SET "payoutPercentage" = LEAST(100, GREATEST(1, ROUND(100.0 / "commissionDivisor")::INTEGER))
WHERE "commissionDivisor" IS NOT NULL AND "commissionDivisor" > 0;
