-- Retire the Ticket Execution ("classic") engine: every run is a D-Agent run now.
-- Data first, while the classic tables still exist; then the drops.

-- 1. Keep the pull requests classic runs opened. The bell resolves a ticket's PR from
--    DagentRun.prUrl and TicketPullRequest; without this, those tickets would pay the
--    provider's full PR resolution again.
INSERT INTO "TicketPullRequest" ("id", "provider", "ticketId", "prUrl", "updatedAt")
SELECT gen_random_uuid()::text, r."provider", r."ticketId", r."prUrl", NOW()
FROM (
  SELECT DISTINCT ON ("provider", "ticketId") "provider", "ticketId", "prUrl"
  FROM "Run"
  WHERE "prUrl" <> '' AND "provider" <> ''
  ORDER BY "provider", "ticketId", "startedAt" DESC
) r
ON CONFLICT ("provider", "ticketId") DO NOTHING;

-- 2. A plan row still waiting on a classic run would wait forever: reconcile reads
--    D-Agent runs only. Settle it as failed, and say why in the scheduler log.
INSERT INTO "AutomationEvent" ("id", "planId", "ticketId", "action", "outcome", "reason", "detail", "createdAt")
SELECT gen_random_uuid()::text, "planId", "ticketId", 'implement', 'failed', 'classic-engine-retired',
       'Its run was on the retired Ticket Execution engine. Retry it to run on D-Agent.', NOW()
FROM "PlannedTicket"
WHERE "implementState" = 'running' AND "runEngine" = 'classic';

UPDATE "PlannedTicket" SET "implementState" = 'failed'
WHERE "implementState" = 'running' AND "runEngine" = 'classic';

INSERT INTO "AutomationEvent" ("id", "planId", "ticketId", "action", "outcome", "reason", "detail", "createdAt")
SELECT gen_random_uuid()::text, "planId", "ticketId", 'review', 'failed', 'classic-engine-retired',
       'Its review fix was on the retired Ticket Execution engine. Start it again from Flow Runner, or it runs on D-Agent at the next new comment.', NOW()
FROM "PlannedTicket"
WHERE "reviewState" = 'running' AND "reviewEngine" = 'classic';

UPDATE "PlannedTicket" SET "reviewState" = 'failed', "reviewError" = 'classic-engine-retired'
WHERE "reviewState" = 'running' AND "reviewEngine" = 'classic';

-- DropForeignKey
ALTER TABLE "Step" DROP CONSTRAINT "Step_runId_fkey";

-- DropForeignKey
ALTER TABLE "Artifact" DROP CONSTRAINT "Artifact_runId_fkey";

-- DropForeignKey
ALTER TABLE "Transition" DROP CONSTRAINT "Transition_runId_fkey";

-- AlterTable
ALTER TABLE "Setting" DROP COLUMN "agentPausedUntil",
DROP COLUMN "hourlyRateUsd",
DROP COLUMN "multiTicketMode";

-- AlterTable
ALTER TABLE "SprintPlan" DROP COLUMN "engine";

-- AlterTable
ALTER TABLE "PlannedTicket" DROP COLUMN "reviewEngine",
DROP COLUMN "runEngine";

-- DropTable
DROP TABLE "Run";

-- DropTable
DROP TABLE "Step";

-- DropTable
DROP TABLE "Artifact";

-- DropTable
DROP TABLE "Transition";

-- DropTable
DROP TABLE "BlockedAttempt";
