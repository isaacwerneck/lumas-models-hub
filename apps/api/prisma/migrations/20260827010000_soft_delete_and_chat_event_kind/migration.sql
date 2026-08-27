-- Additive production-safe fields: existing users remain visible and existing messages remain user messages.
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "ChatMessage" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'USER';

CREATE INDEX "User_role_deletedAt_idx" ON "User"("role", "deletedAt");
