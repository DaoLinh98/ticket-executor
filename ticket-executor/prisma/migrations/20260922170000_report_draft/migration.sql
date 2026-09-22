-- The Report page's per-day draft. Server-side so the same report is on the
-- phone and on the laptop; no backfill, because nothing stored one before.
CREATE TABLE "ReportDraft" (
    "key" TEXT NOT NULL,
    "reportDay" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportDraft_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "ReportDraft_reportDay_idx" ON "ReportDraft"("reportDay");
