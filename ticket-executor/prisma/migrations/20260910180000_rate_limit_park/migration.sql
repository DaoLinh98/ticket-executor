-- A run interrupted by the Claude account's usage limit parks instead of failing,
-- and continues in the same CLI session when the quota resets.
ALTER TABLE "Run" ADD COLUMN "resumeAt" TIMESTAMP(3);
ALTER TABLE "Run" ADD COLUMN "limitWaitMs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Run" ADD COLUMN "limitParks" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Run_resumeAt_idx" ON "Run"("resumeAt");

-- No new run may start before this instant. Null = not paused, which is what
-- every existing row means.
ALTER TABLE "Setting" ADD COLUMN "agentPausedUntil" TIMESTAMP(3);
