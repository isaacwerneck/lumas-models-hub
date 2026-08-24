ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIFT_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIFT_UNVERIFIED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'STATEMENT_IMPORTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RECONCILIATION_OVERRIDDEN';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PAYMENT_RECEIPT_UPLOADED';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SHIFT_OPEN_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MIDNIGHT_SHIFT_WARNING';

CREATE TYPE "ReconciliationStatus" AS ENUM ('MATCHED', 'MISMATCH', 'OUT_OF_RANGE', 'AMBIGUOUS', 'OVERRIDDEN');
CREATE TYPE "WorksheetCellType" AS ENUM ('TEXT', 'NUMBER');

ALTER TABLE "User"
  ADD COLUMN "shiftReminderIntervalMinutes" INTEGER NOT NULL DEFAULT 60;

ALTER TABLE "User"
  ADD CONSTRAINT "User_shiftReminderIntervalMinutes_check"
  CHECK ("shiftReminderIntervalMinutes" IN (15, 30, 45, 60));

ALTER TABLE "Shift"
  ADD COLUMN "chatterVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "reviewRevision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Notification"
  ADD COLUMN "isTransient" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PaymentReceipt" (
  "id" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "attachedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PaymentHistory" ADD COLUMN "receiptId" TEXT;

CREATE TABLE "SalesStatementImport" (
  "id" TEXT NOT NULL,
  "managerId" TEXT NOT NULL,
  "modelTagId" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "fileSha256" TEXT NOT NULL,
  "vendorName" TEXT NOT NULL,
  "coverageStart" TIMESTAMP(3) NOT NULL,
  "coverageEnd" TIMESTAMP(3) NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "confirmedRowCount" INTEGER NOT NULL,
  "excludedRowCount" INTEGER NOT NULL,
  "totalSalesCents" INTEGER NOT NULL,
  "totalCommissionCents" INTEGER NOT NULL,
  "unmatchedRowCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesStatementImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShiftReconciliation" (
  "id" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "shiftReviewRevision" INTEGER NOT NULL,
  "statementCommissionCents" INTEGER NOT NULL,
  "reportedGrossCents" INTEGER NOT NULL,
  "deltaCents" INTEGER NOT NULL,
  "matchedRowCount" INTEGER NOT NULL,
  "status" "ReconciliationStatus" NOT NULL,
  "overriddenById" TEXT,
  "overrideReason" TEXT,
  "overriddenAt" TIMESTAMP(3),
  "paymentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShiftReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelWorksheet" (
  "id" TEXT NOT NULL,
  "modelTagId" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL DEFAULT 200,
  "columnCount" INTEGER NOT NULL DEFAULT 26,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelWorksheet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModelWorksheet_dimensions_check" CHECK ("rowCount" BETWEEN 1 AND 1000 AND "columnCount" BETWEEN 1 AND 52)
);

CREATE TABLE "ModelWorksheetCell" (
  "id" TEXT NOT NULL,
  "worksheetId" TEXT NOT NULL,
  "rowIndex" INTEGER NOT NULL,
  "columnIndex" INTEGER NOT NULL,
  "value" TEXT NOT NULL,
  "valueType" "WorksheetCellType" NOT NULL DEFAULT 'TEXT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedById" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelWorksheetCell_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModelWorksheetCell_position_check" CHECK ("rowIndex" BETWEEN 0 AND 999 AND "columnIndex" BETWEEN 0 AND 51)
);

CREATE UNIQUE INDEX "PaymentReceipt_storageKey_key" ON "PaymentReceipt"("storageKey");
CREATE INDEX "PaymentReceipt_uploadedById_createdAt_idx" ON "PaymentReceipt"("uploadedById", "createdAt");
CREATE INDEX "PaymentReceipt_attachedAt_createdAt_idx" ON "PaymentReceipt"("attachedAt", "createdAt");
CREATE UNIQUE INDEX "PaymentHistory_receiptId_key" ON "PaymentHistory"("receiptId");
CREATE INDEX "SalesStatementImport_modelTagId_createdAt_idx" ON "SalesStatementImport"("modelTagId", "createdAt");
CREATE INDEX "SalesStatementImport_managerId_createdAt_idx" ON "SalesStatementImport"("managerId", "createdAt");
CREATE UNIQUE INDEX "ShiftReconciliation_importId_shiftId_key" ON "ShiftReconciliation"("importId", "shiftId");
CREATE INDEX "ShiftReconciliation_shiftId_shiftReviewRevision_createdAt_idx" ON "ShiftReconciliation"("shiftId", "shiftReviewRevision", "createdAt");
CREATE INDEX "ShiftReconciliation_paymentId_idx" ON "ShiftReconciliation"("paymentId");
CREATE UNIQUE INDEX "ModelWorksheet_modelTagId_key" ON "ModelWorksheet"("modelTagId");
CREATE UNIQUE INDEX "ModelWorksheetCell_worksheetId_rowIndex_columnIndex_key" ON "ModelWorksheetCell"("worksheetId", "rowIndex", "columnIndex");
CREATE INDEX "ModelWorksheetCell_worksheetId_updatedAt_idx" ON "ModelWorksheetCell"("worksheetId", "updatedAt");

ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentHistory" ADD CONSTRAINT "PaymentHistory_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "PaymentReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesStatementImport" ADD CONSTRAINT "SalesStatementImport_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesStatementImport" ADD CONSTRAINT "SalesStatementImport_modelTagId_fkey"
  FOREIGN KEY ("modelTagId") REFERENCES "ModelTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftReconciliation" ADD CONSTRAINT "ShiftReconciliation_importId_fkey"
  FOREIGN KEY ("importId") REFERENCES "SalesStatementImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftReconciliation" ADD CONSTRAINT "ShiftReconciliation_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftReconciliation" ADD CONSTRAINT "ShiftReconciliation_overriddenById_fkey"
  FOREIGN KEY ("overriddenById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftReconciliation" ADD CONSTRAINT "ShiftReconciliation_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "PaymentHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModelWorksheet" ADD CONSTRAINT "ModelWorksheet_modelTagId_fkey"
  FOREIGN KEY ("modelTagId") REFERENCES "ModelTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelWorksheetCell" ADD CONSTRAINT "ModelWorksheetCell_worksheetId_fkey"
  FOREIGN KEY ("worksheetId") REFERENCES "ModelWorksheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelWorksheetCell" ADD CONSTRAINT "ModelWorksheetCell_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "Shift" AS s
SET "chatterVerifiedAt" = e."paidAt"
FROM "Earnings" AS e
WHERE e."shiftId" = s."id" AND e."status" = 'PAID';
