// Public facade for the execution engine. API routes import from here only; the
// implementation is split across `lib/execution/*`:
//   graph/types.ts    — Node / Edge / Graph / NodeResult / RunContext / LiveRun
//   graph/schemas.ts  — the JSON Schema each agent node must answer with
//   graph/graphs.ts   — the graph definitions themselves (pure data + pure edges)
//   graph/prompts.ts  — the prompt each node sends
//   graph/exec.ts     — one node execution (per-turn MCP, spawn, contract check)
//   graph/drive.ts    — the driver loop, gates, budget/hop guards, termination
//   graph/persist.ts  — every DB write the walk makes (all allowed to throw)
//   claudeCli.ts      — CLI args and the NDJSON stream-json turn runner
//   git.ts            — post-run diff collection against the worktree's base commit
//   queries.ts        — read models and the dashboard aggregate
//   runner.ts         — worktree isolation, run lifecycle, gate resolution, recovery
//   store.ts          — the globalThis-backed in-process Map of live runs
export { cancelRun, recoverInterruptedRuns, resolvePlan, startRun, type GateAction } from "./execution/runner";
export {
  dashboardMetrics,
  getPersistedRun,
  getRun,
  listRuns,
  outlineForSkill,
  type CountEntry,
  type DashboardMetrics,
  type NodeView,
  type RunView,
  type SkillConsistency,
} from "./execution/queries";
export { findOtherActiveTicketId } from "./execution/store";
