CREATE TYPE "EarningsKind" AS ENUM ('PRIMARY', 'EXTRA');

ALTER TABLE "Shift"
ADD COLUMN "extraBeneficiaryId" TEXT,
ADD COLUMN "extraPayoutPercentage" INTEGER;

ALTER TABLE "Earnings"
ADD COLUMN "kind" "EarningsKind" NOT NULL DEFAULT 'PRIMARY',
ADD COLUMN "payoutPercentage" INTEGER,
ADD COLUMN "verifiedAt" TIMESTAMP(3);

UPDATE "Earnings" AS earning
SET "payoutPercentage" = COALESCE(shift."payoutPercentage", chatter."payoutPercentage", 20),
    "verifiedAt" = shift."chatterVerifiedAt"
FROM "Shift" AS shift
JOIN "User" AS chatter ON chatter."id" = shift."chatterId"
WHERE earning."shiftId" = shift."id";

ALTER TABLE "Earnings" ALTER COLUMN "payoutPercentage" SET DEFAULT 20;
ALTER TABLE "Earnings" ALTER COLUMN "payoutPercentage" SET NOT NULL;

DROP INDEX "Earnings_shiftId_key";
CREATE UNIQUE INDEX "Earnings_shiftId_chatterId_key" ON "Earnings"("shiftId", "chatterId");

CREATE TABLE "ExtraPointRule" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "beneficiaryId" TEXT NOT NULL,
  "percentage" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExtraPointRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExtraPointRule_sourceId_key" ON "ExtraPointRule"("sourceId");
CREATE INDEX "ExtraPointRule_beneficiaryId_idx" ON "ExtraPointRule"("beneficiaryId");
CREATE INDEX "Shift_extraBeneficiaryId_idx" ON "Shift"("extraBeneficiaryId");

ALTER TABLE "ExtraPointRule" ADD CONSTRAINT "ExtraPointRule_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExtraPointRule" ADD CONSTRAINT "ExtraPointRule_beneficiaryId_fkey"
FOREIGN KEY ("beneficiaryId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_extraBeneficiaryId_fkey"
FOREIGN KEY ("extraBeneficiaryId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
