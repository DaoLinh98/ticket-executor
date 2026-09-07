-- Sprint triage, the sprint plan it feeds, and the scheduler's audit log.
-- All four tables are new; there is nothing to backfill.

CREATE TABLE "SprintTriage" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "org" TEXT NOT NULL,
    "project" TEXT NOT NULL,
    "sprint" TEXT NOT NULL,
    "identityEmail" TEXT NOT NULL DEFAULT '',
    "ticketIds" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'running',
    "result" JSONB NOT NULL DEFAULT '{}',
    "errorMessage" TEXT NOT NULL DEFAULT '',
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "SprintTriage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SprintTriage_provider_org_project_sprint_idx" ON "SprintTriage"("provider", "org", "project", "sprint");

CREATE TABLE "SprintPlan" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "org" TEXT NOT NULL,
    "project" TEXT NOT NULL,
    "sprint" TEXT NOT NULL,
    "identityEmail" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startDate" TEXT NOT NULL DEFAULT '',
    "finishDate" TEXT NOT NULL DEFAULT '',
    "pointsPerDay" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "hoursPerDay" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "hoursPerPoint" DOUBLE PRECISION NOT NULL DEFAULT 4,
    "maxTicketsPerDay" INTEGER NOT NULL DEFAULT 0,
    "autoImplement" BOOLEAN NOT NULL DEFAULT false,
    "autoRelease" BOOLEAN NOT NULL DEFAULT false,
    "reviewers" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SprintPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SprintPlan_provider_org_project_sprint_identityEmail_key" ON "SprintPlan"("provider", "org", "project", "sprint", "identityEmail");

CREATE TABLE "PlannedTicket" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "implementOrder" INTEGER NOT NULL DEFAULT 0,
    "points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimateHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "releaseDay" TEXT NOT NULL DEFAULT '',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "implementState" TEXT NOT NULL DEFAULT 'pending',
    "runId" TEXT NOT NULL DEFAULT '',
    "prUrl" TEXT NOT NULL DEFAULT '',
    "prPublished" BOOLEAN NOT NULL DEFAULT false,
    "reviewersSet" BOOLEAN NOT NULL DEFAULT false,
    "statusMoved" BOOLEAN NOT NULL DEFAULT false,
    "releasedAt" TIMESTAMP(3),
    "releaseError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlannedTicket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlannedTicket_planId_ticketId_key" ON "PlannedTicket"("planId", "ticketId");
CREATE INDEX "PlannedTicket_releaseDay_idx" ON "PlannedTicket"("releaseDay");
ALTER TABLE "PlannedTicket" ADD CONSTRAINT "PlannedTicket_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SprintPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AutomationEvent" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL DEFAULT '',
    "ticketId" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AutomationEvent_createdAt_idx" ON "AutomationEvent"("createdAt");
CREATE INDEX "AutomationEvent_planId_idx" ON "AutomationEvent"("planId");
