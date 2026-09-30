ALTER TABLE "PlannedTicket" ADD COLUMN "stage" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PlannedTicket" ADD COLUMN "prMerged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlannedTicket" ADD COLUMN "pendingAction" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PlannedTicket" ADD COLUMN "pendingSince" TIMESTAMP(3);
CREATE INDEX "PlannedTicket_pendingAction_idx" ON "PlannedTicket"("pendingAction");
