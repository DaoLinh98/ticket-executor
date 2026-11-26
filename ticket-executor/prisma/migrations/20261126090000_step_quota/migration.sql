-- The Claude account's quota as each agent step began and ended, so a run can show the % of the session it used.
ALTER TABLE "DagentStep" ADD COLUMN "quotaStart" JSONB,
ADD COLUMN "quotaEnd" JSONB;
