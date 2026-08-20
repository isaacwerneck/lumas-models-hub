-- CreateEnum
CREATE TYPE "EarningsStatus" AS ENUM ('PENDING', 'PAID');

-- AlterEnum
BEGIN;
CREATE TYPE "AuditAction_new" AS ENUM ('CHATTER_MODEL_TAGS_UPDATED');
ALTER TABLE "AuditLog" ALTER COLUMN "action" TYPE "AuditAction_new" USING ("action"::text::"AuditAction_new");
ALTER TYPE "AuditAction" RENAME TO "AuditAction_old";
ALTER TYPE "AuditAction_new" RENAME TO "AuditAction";
DROP TYPE "public"."AuditAction_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "WeeklyPayout" DROP CONSTRAINT "WeeklyPayout_chatterId_fkey";

-- DropForeignKey
ALTER TABLE "WeeklyPayout" DROP CONSTRAINT "WeeklyPayout_forcedById_fkey";

-- DropForeignKey
ALTER TABLE "WeeklyPayout" DROP CONSTRAINT "WeeklyPayout_paidById_fkey";

-- DropTable
DROP TABLE "WeeklyPayout";

-- DropEnum
DROP TYPE "PaymentStatus";

-- CreateTable
CREATE TABLE "Earnings" (
    "id" TEXT NOT NULL,
    "chatterId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "EarningsStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentHistory" (
    "id" TEXT NOT NULL,
    "chatterId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Earnings_shiftId_key" ON "Earnings"("shiftId");

-- CreateIndex
CREATE INDEX "Earnings_chatterId_status_idx" ON "Earnings"("chatterId", "status");

-- CreateIndex
CREATE INDEX "Earnings_status_idx" ON "Earnings"("status");

-- CreateIndex
CREATE INDEX "PaymentHistory_chatterId_paidAt_idx" ON "PaymentHistory"("chatterId", "paidAt");

-- AddForeignKey
ALTER TABLE "Earnings" ADD CONSTRAINT "Earnings_chatterId_fkey" FOREIGN KEY ("chatterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Earnings" ADD CONSTRAINT "Earnings_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentHistory" ADD CONSTRAINT "PaymentHistory_chatterId_fkey" FOREIGN KEY ("chatterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentHistory" ADD CONSTRAINT "PaymentHistory_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
