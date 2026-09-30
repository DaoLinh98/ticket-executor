ALTER TABLE "PlannedTicket" ADD COLUMN "qaRounds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlannedTicket" ADD COLUMN "qaCommentAt" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SprintPlan" ADD COLUMN "autoDraftQaReply" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "QaReplyDraft" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "plannedTicketId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "answersUpTo" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "needsHuman" BOOLEAN NOT NULL DEFAULT false,
    "fixNeeded" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT NOT NULL DEFAULT '',
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    CONSTRAINT "QaReplyDraft_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QaReplyDraft_plannedTicketId_idx" ON "QaReplyDraft"("plannedTicketId");
CREATE INDEX "QaReplyDraft_status_idx" ON "QaReplyDraft"("status");
