# Run History page (`/runs`)

A table of every D-Agent run for developer review; a row opens `/workflow?run=<id>`.

## Constraints found
- `DagentRun` already carries ticket, `graphId` (flow), state, branch, PR, `retryOfId`, `errorMessage`, model,
  effort, start/end; `DagentStep` carries cost + tokens per step. **No migration needed for Phase 1.**
- `listRuns()` returns only the newest 30, and `/workflow` resolves a run only from that list (`?ticket=` only),
  so an older run could not be opened and no run had a direct link.

## Decisions (defaults taken)
- Own page `/runs` (Sidebar: "Run History"), one row per run; cost/tokens included in Phase 1; no schema change.

## Phase 1 — MVP
1. `/workflow?run=<id>` deep link; Retry/Cancel only on the ticket's newest run.
2. `GET /api/dagent/runs/history` (imports `lib/dagent` only): numbered pages (`page`, `size` 25/50/100, `total`), filters
   `state`, `flow`, `q` (ticket id/title); row = ticket, flow, state, stop node, branch, PR, duration, cost,
   tokens, fix count, retry-of. Cached with `cached()` (`DB_CACHE_PREFIX`, short TTL); live via `listFingerprint()`.
3. `app/(app)/runs/page.tsx`: filters on `PageToolbar`, table, row → `/workflow?run=`, TanStack query in
   `app/queries.ts`, pager under the table ("Showing a–b of n", rows per page, Page x / y), `useLiveInvalidate`, card layout at 390px, filters in the URL.

## Phase 2 — review speed
1. "Needs attention" tab: `waiting` + `failed` runs with no newer run for the ticket.
2. Group by ticket (chain via `retryOfId` + flow).
3. Fail reason inline (`errorMessage` + failed node).
4. Mini node timeline per row (fix loops visible).
5. Row actions: Retry / Cancel / Accept / open PR / copy branch.

## Phase 3 — Insights
Totals (runs, success rate, cost, mean duration) per week/sprint; per-node fail rate and cost; cost by
model/effort; cost and runs per day.

## Phase 4 — later
Compare two runs of a ticket; CSV export; developer notes/tags on a run (new table); "only mine" filter
(derive via `isMine()` or add an initiator column); trigger filter (scheduler vs manual — needs a `trigger` column).

## Verification
`node --import ./tests/register.mjs --test tests/dagent.test.ts tests/workflowLayout.test.ts` + a focused test for
the history query helpers; `npx tsc --noEmit`; look at 390×844 and desktop.
