// Public facade for Flow Runner. API routes import from here only; the
// implementation is split across `lib/execution/*` (runs themselves are D-Agent's, `lib/dagent/`):
//   claudeCli.ts      — CLI args and the NDJSON stream-json turn runner
//   triage.ts         — the sprint-triage turn (no run, no worktree, one contract)
//   planStore.ts      — reads/writes for the sprint plan and the automation log
//   release.ts        — publishing a draft PR, assigning reviewers, moving status
//   scheduler.ts      — the server-side tick that acts on an active plan

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
  holdPlannedTicket,
  moveInQueue,
  previewRebuild,
  setReleaseDay,
  setRunOptions,
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
export { startReviewRun, startScheduler, tickNow, type TickReport } from "./execution/scheduler";
export { moveToQa, QA_STATUS } from "./execution/lifecycle";
export { analyzeCase, approveFix, dismissCase, lastClosedCases, listCases, postCaseReply } from "./execution/qaFollowUp";
export { translateToVietnamese, TRANSLATE_MODEL, type TranslateResult } from "./execution/translate";
