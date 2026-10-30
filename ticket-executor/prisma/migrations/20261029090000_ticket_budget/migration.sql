-- A soft per-ticket spend warning (Settings → Flow Runner); 0 = off.
ALTER TABLE "Setting" ADD COLUMN "ticketBudgetUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
