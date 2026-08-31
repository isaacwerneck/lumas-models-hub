ALTER TABLE "ChatMessage"
  ADD COLUMN "shiftId" TEXT,
  ADD COLUMN "eventType" TEXT,
  ADD COLUMN "occurredAt" TIMESTAMP(3);

CREATE INDEX "ChatMessage_modelTagId_occurredAt_idx"
  ON "ChatMessage"("modelTagId", "occurredAt");

CREATE UNIQUE INDEX "ChatMessage_shiftId_eventType_key"
  ON "ChatMessage"("shiftId", "eventType");
