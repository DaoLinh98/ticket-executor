-- A QA reply draft becomes a QA follow-up case (model QaCase, same table): signals, analysis run, fix run, verdicts.
ALTER TABLE "QaReplyDraft" ALTER COLUMN "status" SET DEFAULT 'pending';
ALTER TABLE "QaReplyDraft" ADD COLUMN "triggers" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "QaReplyDraft" ADD COLUMN "since" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QaReplyDraft" ADD COLUMN "signalAt" TIMESTAMP(3);
ALTER TABLE "QaReplyDraft" ADD COLUMN "runId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QaReplyDraft" ADD COLUMN "fixRunId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QaReplyDraft" ADD COLUMN "findings" JSONB;
ALTER TABLE "QaReplyDraft" ADD COLUMN "recommendation" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QaReplyDraft" ADD COLUMN "decidedAt" TIMESTAMP(3);
