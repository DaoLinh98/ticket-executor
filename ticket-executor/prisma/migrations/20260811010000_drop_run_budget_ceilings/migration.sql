-- Remove the USD spend ceilings.
--
-- Neither column was ever reachable in practice: Setting.runBudgetUsd defaulted
-- to 0 (off) and no node ever declared a per-node ceiling, so the check between
-- nodes never fired and --max-budget-usd was never passed to the CLI. The
-- run-level check also sat at the worst possible boundary — it could refuse the
-- external `publish` leaf after `implement` had already committed, spending the
-- whole run and shipping nothing. Cost *accounting* (Step.costUsd, token counts,
-- the dashboard, the EmeHub ledger) is untouched; only enforcement is gone.
--
-- The remaining automatic stop is the hop limit (Run.hops, MAX_HOPS in
-- lib/execution/graph/drive.ts), which guards against a routing loop rather than
-- against spend.

ALTER TABLE "Setting" DROP COLUMN "runBudgetUsd";
ALTER TABLE "Run" DROP COLUMN "budgetUsd";
