-- The sprint plan remembers whether it was built from the developer's assigned
-- work wherever it lives, or from the current iteration alone.
ALTER TABLE "SprintPlan" ADD COLUMN "includeWider" BOOLEAN NOT NULL DEFAULT true;
