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
  // ---- two-phase (implement-ticket-v3) fields ----
  /** Pre-assigned CLI session id, so the implement phase can `--resume` the plan phase's session. */
  sessionId: string;
  /** Empty for single-phase runs (v2, fix-code-review-v2) — those never park at the plan gate. */
  phase: ExecPhase;
  planStatus: PlanStatus;
  planMarkdown: string;
  /** Repo the worktree was created under — needed to resume/clean up after a restart. */
  rootRepo: string;
  provider: string;
};

// What one Claude turn produced, accumulated while its NDJSON stream is parsed.
export type TurnState = { resultText: string; isError: boolean; errorDetail: string };
