-- Replace the old blanket "one open shift" rules with interval-aware validation
-- performed under a per-model PostgreSQL advisory lock by the API.
DROP INDEX IF EXISTS "Shift_one_open_per_model_idx";
DROP INDEX IF EXISTS "Shift_one_open_per_chatter_idx";

ALTER TABLE "Shift" ADD COLUMN "batchId" TEXT;

CREATE INDEX "Shift_batchId_idx" ON "Shift"("batchId");
CREATE INDEX "Shift_modelTagId_startedAt_endedAt_idx" ON "Shift"("modelTagId", "startedAt", "endedAt");
