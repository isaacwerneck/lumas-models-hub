-- ExpandAuditAction
ALTER TYPE "AuditAction" ADD VALUE 'LOGIN_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'ACCOUNT_LOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'LOGOUT';
ALTER TYPE "AuditAction" ADD VALUE 'TAG_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'TAG_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'TAG_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'SHIFT_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'SHIFT_CLOSED';
ALTER TYPE "AuditAction" ADD VALUE 'SHIFT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'SHIFT_NOTES_UPDATED';

-- Failed authentication attempts may not have a matching user.
ALTER TABLE "AuditLog" ALTER COLUMN "actorId" DROP NOT NULL;

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('OCR_LOW_CONFIDENCE', 'NEGATIVE_SHIFT');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_userId_type_sourceId_key" ON "Notification"("userId", "type", "sourceId");
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
