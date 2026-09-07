-- Ownership of a ticket over the sprint, not at this instant.
--
-- A ticket handed to QA stops being assigned to the developer, and a sprint
-- report built from live assignment therefore shrinks every time they finish
-- something. These two columns let a plan row outlive the assignment that
-- created it: `claim` says where the developer's claim stands, `assigneeNow`
-- says who holds it instead.
--
-- The default is "mine" because that is what every existing row meant: it was
-- written from a list filtered by assignment in the first place.
ALTER TABLE "PlannedTicket" ADD COLUMN "claim" TEXT NOT NULL DEFAULT 'mine';
ALTER TABLE "PlannedTicket" ADD COLUMN "assigneeNow" TEXT NOT NULL DEFAULT '';

CREATE INDEX "PlannedTicket_claim_idx" ON "PlannedTicket"("claim");
