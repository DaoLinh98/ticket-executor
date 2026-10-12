// Public facade for the execution engine. API routes import from here only; the
// implementation is split across `lib/execution/*`:
//   graph/types.ts    — Node / Edge / Graph / NodeResult / RunContext / LiveRun
//   graph/schemas.ts  — the JSON Schema each agent node must answer with
//   graph/graphs.ts   — the graph definitions themselves (pure data + pure edges)
//   graph/prompts.ts  — the prompt each node sends
//   graph/exec.ts     — one node execution (per-turn MCP, spawn, contract check)
//   graph/drive.ts    — the driver loop, gates, the hop guard, termination
//   graph/persist.ts  — every DB write the walk makes (all allowed to throw)
//   claudeCli.ts      — CLI args and the NDJSON stream-json turn runner
//   git.ts            — post-run diff collection against the worktree's base commit
//   queries.ts        — read models and the dashboard aggregate
//   runner.ts         — worktree isolation, run lifecycle, limit and crash recovery
//   store.ts          — the globalThis-backed in-process Map of live runs
//   triage.ts         — the sprint-triage turn (no run, no worktree, one contract)
//   planStore.ts      — reads/writes for the sprint plan and the automation log
//   release.ts        — publishing a draft PR, assigning reviewers, moving status
//   scheduler.ts      — the server-side tick that acts on an active plan
export {
  cancelRun,
  recoverInterruptedRuns,
  resumeRateLimitedRuns,
  startRun,
  type StartRunInput,
  type StartRunResult,
} from "./execution/runner";
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
export { IMPLEMENT_SKILL, KNOWN_SKILLS, QA_FIX_SKILL, REVIEW_FIX_SKILL } from "./execution/graph/graphs";
export {
  getTriage,
  latestTriage,
  startTriage,
  TRIAGE_SKILL,
  type TriageInput,
  type TriageResult,
  type TriagedTicket,
} from "./execution/triage";
export {
  claimedSprint,
  findPlan,
  logAutomation,
  planById,
  planInputs,
  addTicketToPlan,
  recentAutomation,
  rebuildPlan,
  removeTicketFromPlan,
  retryPlannedTicket,
  setPlanAutomation,
  setPlanStatus,
  setTicketUnblocked,
  type PlanKey,
} from "./execution/planStore";
export {
  dueForRelease,
  releasePlannedTicket,
  RELEASE_STATUS,
  type ReleaseOutcome,
} from "./execution/release";
export { startQaFix, startReviewRun, startScheduler, tickNow, type TickReport } from "./execution/scheduler";
export { moveToQa, QA_STATUS } from "./execution/lifecycle";
export { dismissQaReply, listQaDrafts, postQaReply, startQaReply } from "./execution/qaReply";
export { translateToVietnamese, TRANSLATE_MODEL, type TranslateResult } from "./execution/translate";
