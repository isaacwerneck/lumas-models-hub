ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EVIDENCE_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EVIDENCE_PURGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SESSIONS_REVOKED';

CREATE TYPE "EvidenceStatus" AS ENUM ('AVAILABLE', 'PURGE_PENDING', 'PURGED', 'MISSING_LEGACY');
CREATE TYPE "StorageDeletionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "User"
  ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Shift"
  ALTER COLUMN "startImageUrl" DROP NOT NULL,
  ADD COLUMN "startEvidenceId" TEXT,
  ADD COLUMN "endEvidenceId" TEXT,
  ADD COLUMN "startOriginalCurrency" TEXT NOT NULL DEFAULT 'BRL',
  ADD COLUMN "startOriginalAmountCents" INTEGER,
  ADD COLUMN "startFxRate" DECIMAL(18,8),
  ADD COLUMN "startFxProvider" TEXT,
  ADD COLUMN "startFxQuotedAt" TIMESTAMP(3),
  ADD COLUMN "endOriginalCurrency" TEXT,
  ADD COLUMN "endOriginalAmountCents" INTEGER,
  ADD COLUMN "endFxRate" DECIMAL(18,8),
  ADD COLUMN "endFxProvider" TEXT,
  ADD COLUMN "endFxQuotedAt" TIMESTAMP(3);

ALTER TABLE "Earnings" ADD COLUMN "paymentId" TEXT;
ALTER TABLE "PaymentHistory" ADD COLUMN "requestKey" TEXT;

CREATE TABLE "Evidence" (
  "id" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "storageKey" TEXT,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT,
  "status" "EvidenceStatus" NOT NULL DEFAULT 'AVAILABLE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attachedAt" TIMESTAMP(3),
  "purgedAt" TIMESTAMP(3),
  CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StorageDeletionJob" (
  "id" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "status" "StorageDeletionStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorageDeletionJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Evidence_storageKey_key" ON "Evidence"("storageKey");
CREATE INDEX "Evidence_uploadedById_createdAt_idx" ON "Evidence"("uploadedById", "createdAt");
CREATE INDEX "Evidence_status_createdAt_idx" ON "Evidence"("status", "createdAt");
CREATE UNIQUE INDEX "StorageDeletionJob_evidenceId_key" ON "StorageDeletionJob"("evidenceId");
CREATE INDEX "StorageDeletionJob_status_nextAttemptAt_idx" ON "StorageDeletionJob"("status", "nextAttemptAt");
CREATE UNIQUE INDEX "Shift_startEvidenceId_key" ON "Shift"("startEvidenceId");
CREATE UNIQUE INDEX "Shift_endEvidenceId_key" ON "Shift"("endEvidenceId");
CREATE INDEX "Earnings_paymentId_idx" ON "Earnings"("paymentId");
CREATE UNIQUE INDEX "PaymentHistory_requestKey_key" ON "PaymentHistory"("requestKey");

ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StorageDeletionJob" ADD CONSTRAINT "StorageDeletionJob_evidenceId_fkey"
  FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_startEvidenceId_fkey"
  FOREIGN KEY ("startEvidenceId") REFERENCES "Evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_endEvidenceId_fkey"
  FOREIGN KEY ("endEvidenceId") REFERENCES "Evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Earnings" ADD CONSTRAINT "Earnings_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "PaymentHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Evidence" ("id", "uploadedById", "originalName", "mimeType", "sizeBytes", "status", "createdAt", "attachedAt")
SELECT 'legacy-start-' || s."id", s."chatterId",
       regexp_replace(s."startImageUrl", '^upload:', ''), 'application/octet-stream', 0,
       'MISSING_LEGACY', s."createdAt", s."createdAt"
FROM "Shift" s WHERE s."startImageUrl" IS NOT NULL;

INSERT INTO "Evidence" ("id", "uploadedById", "originalName", "mimeType", "sizeBytes", "status", "createdAt", "attachedAt")
SELECT 'legacy-end-' || s."id", s."chatterId",
       regexp_replace(s."endImageUrl", '^upload:', ''), 'application/octet-stream', 0,
       'MISSING_LEGACY', s."createdAt", s."updatedAt"
FROM "Shift" s WHERE s."endImageUrl" IS NOT NULL;

UPDATE "Shift" SET "startEvidenceId" = 'legacy-start-' || "id" WHERE "startImageUrl" IS NOT NULL;
UPDATE "Shift" SET "endEvidenceId" = 'legacy-end-' || "id" WHERE "endImageUrl" IS NOT NULL;

CREATE UNIQUE INDEX "Shift_one_open_per_model_idx" ON "Shift"("modelTagId") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "Shift_one_open_per_chatter_idx" ON "Shift"("chatterId") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "User_username_lower_key" ON "User" (lower("username"));
CREATE UNIQUE INDEX "ModelTag_name_lower_key" ON "ModelTag" (lower("name"));
