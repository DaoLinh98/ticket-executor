import type { ChildProcess } from "child_process";
import type { ExecPhase, ExecStatus, FileChange, LogLine, PlanStatus } from "../types";

// One in-flight (or just-finished) execution as held in the in-process store.
export type Entry = {
  id: string;
  ticketId: string;
  project: string;
  skill: string;
  model: string;
  effort: string;
  command: string;
  status: ExecStatus;
  logLines: LogLine[];
  resultText: string;
  error: string;
  prUrl: string;
  branch: string;
  currentStep: number;
  cwd: string;
  baseSha: string;
  filesChanged: FileChange[];
  startedAt: number;
  completedAt: number | null;
  child: ChildProcess | null;
  cancelled: boolean;
  /** Why the run ended, when that is not plain success/error: "cancelled" (user
   *  killed the child) or "plan-rejected" (reviewer discarded the plan). The UI
   *  keeps treating both as `status: "failed"` — the run didn't deliver and is
   *  retryable — but the dashboard must not score a human's decision as an agent
   *  failure, so the distinction lives here rather than in ExecStatus. */
  endReason: string;
  // ---- two-phase (implement-ticket-v3) fields ----
  /** Pre-assigned CLI session id, so the implement phase can `--resume` the plan phase's session. */
  sessionId: string;
  /** Empty for single-phase runs (v2, fix-code-review-v2) — those never park at the plan gate. */
  phase: ExecPhase;
  planStatus: PlanStatus;
  planMarkdown: string;
  /** Timestamp the run parked at the plan gate, or null when it is not parked.
   *  Paired with humanWaitMs to separate "the agent is working" from "a human
   *  hasn't answered yet" — a run can park more than once (each revise round). */
  parkedAt: number | null;
  humanWaitMs: number;
  /** How many times the reviewer asked for changes before approving. */
  planRevisions: number;
  /** True when this run's Entry was rebuilt from the DB because the in-process
   *  store was lost (dev-server restart) — a session a bare terminal would have dropped. */
  resumedAfterRestart: boolean;
  /** Repo the worktree was created under — needed to resume/clean up after a restart. */
  rootRepo: string;
  provider: string;
  /** Generated MCP config handed to the CLI for the current turn, or "" when the
   *  run uses the machine's own MCP setup. In-memory only: it holds the PAT in
   *  clear text, is deleted as soon as the turn ends, and is rebuilt on resume. */
  mcpConfigPath: string;
  // ---- token & cost usage (accumulated across all turns of the run) ----
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  numTurns: number;
  durationMs: number;
};

// What one Claude turn produced, accumulated while its NDJSON stream is parsed.
// The usage fields are read from the final stream-json `result` event.
export type TurnState = {
  resultText: string;
  isError: boolean;
  errorDetail: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  numTurns: number;
  durationMs: number;
};
