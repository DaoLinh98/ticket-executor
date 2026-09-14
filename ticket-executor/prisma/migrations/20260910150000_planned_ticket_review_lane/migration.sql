ALTER TABLE "SprintPlan" ADD COLUMN "autoResolveReview" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PlannedTicket" ADD COLUMN "reviewState" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "PlannedTicket" ADD COLUMN "reviewRunId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PlannedTicket" ADD COLUMN "openComments" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlannedTicket" ADD COLUMN "threadsReplied" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlannedTicket" ADD COLUMN "threadsResolved" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlannedTicket" ADD COLUMN "lastCommentAt" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PlannedTicket" ADD COLUMN "reviewRounds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlannedTicket" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "PlannedTicket" ADD COLUMN "reviewError" TEXT NOT NULL DEFAULT '';

CREATE INDEX "PlannedTicket_reviewState_idx" ON "PlannedTicket"("reviewState");
