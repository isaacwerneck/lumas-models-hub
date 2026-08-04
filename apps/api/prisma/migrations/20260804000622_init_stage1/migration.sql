-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CHATTER', 'MANAGER');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CHATTER_CONFIRMED', 'PAID', 'FORCED_PAID');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('PAYMENT_CONFIRMED', 'PAYMENT_FORCED', 'CHATTER_MODEL_TAGS_UPDATED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatterModelTag" (
    "id" TEXT NOT NULL,
    "chatterId" TEXT NOT NULL,
    "modelTagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatterModelTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "chatterId" TEXT NOT NULL,
    "modelTagId" TEXT NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "startImageUrl" TEXT NOT NULL,
    "startOcrRawText" TEXT,
    "startOcrConfidence" DECIMAL(5,4),
    "startValueCents" INTEGER NOT NULL,
    "startValueConfirmedAt" TIMESTAMP(3),
    "endImageUrl" TEXT,
    "endOcrRawText" TEXT,
    "endOcrConfidence" DECIMAL(5,4),
    "endValueCents" INTEGER,
    "endValueConfirmedAt" TIMESTAMP(3),
    "grossAmountCents" INTEGER,
    "commissionDivisor" INTEGER,
    "payoutAmountCents" INTEGER,
    "negativeJustification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyPayout" (
    "id" TEXT NOT NULL,
    "chatterId" TEXT NOT NULL,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "weekEndDate" TIMESTAMP(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "weekGrossCents" INTEGER NOT NULL DEFAULT 0,
    "weekPayoutCents" INTEGER NOT NULL DEFAULT 0,
    "lifetimePaidCents" INTEGER NOT NULL DEFAULT 0,
    "chatterConfirmedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "forcedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "modelTagId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "replacedByTokenHash" TEXT,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "ModelTag_name_key" ON "ModelTag"("name");

-- CreateIndex
CREATE INDEX "ChatterModelTag_modelTagId_idx" ON "ChatterModelTag"("modelTagId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatterModelTag_chatterId_modelTagId_key" ON "ChatterModelTag"("chatterId", "modelTagId");

-- CreateIndex
CREATE INDEX "Shift_chatterId_startedAt_idx" ON "Shift"("chatterId", "startedAt");

-- CreateIndex
CREATE INDEX "Shift_modelTagId_status_idx" ON "Shift"("modelTagId", "status");

-- CreateIndex
CREATE INDEX "WeeklyPayout_status_weekStartDate_idx" ON "WeeklyPayout"("status", "weekStartDate");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPayout_chatterId_weekStartDate_key" ON "WeeklyPayout"("chatterId", "weekStartDate");

-- CreateIndex
CREATE INDEX "ChatMessage_modelTagId_createdAt_idx" ON "ChatMessage"("modelTagId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_expiresAt_idx" ON "RefreshSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "ChatterModelTag" ADD CONSTRAINT "ChatterModelTag_chatterId_fkey" FOREIGN KEY ("chatterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatterModelTag" ADD CONSTRAINT "ChatterModelTag_modelTagId_fkey" FOREIGN KEY ("modelTagId") REFERENCES "ModelTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_chatterId_fkey" FOREIGN KEY ("chatterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_modelTagId_fkey" FOREIGN KEY ("modelTagId") REFERENCES "ModelTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPayout" ADD CONSTRAINT "WeeklyPayout_chatterId_fkey" FOREIGN KEY ("chatterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPayout" ADD CONSTRAINT "WeeklyPayout_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPayout" ADD CONSTRAINT "WeeklyPayout_forcedById_fkey" FOREIGN KEY ("forcedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_modelTagId_fkey" FOREIGN KEY ("modelTagId") REFERENCES "ModelTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
