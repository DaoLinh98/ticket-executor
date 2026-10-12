-- The plan-gated (v3) and one-shot (v2) flows are gone: every run walks the
-- same implement → check → evaluate → fix → publish loop, so nothing reads the
-- switches that used to choose between them.
ALTER TABLE "Setting" DROP COLUMN "autoImplement",
DROP COLUMN "autoResolveCodeReview",
DROP COLUMN "evaluateBeforePublish";
