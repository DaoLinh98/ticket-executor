-- A ticket the developer added to the plan by hand is part of their sprint even
-- though the tracker does not list it under them.
ALTER TABLE "PlannedTicket" ADD COLUMN "addedByUser" BOOLEAN NOT NULL DEFAULT false;
