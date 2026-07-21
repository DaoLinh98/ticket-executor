import type { ChildProcess } from "child_process";
import type { ExecStatus, FileChange, LogLine } from "../types";

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
};

// What one Claude turn produced, accumulated while its NDJSON stream is parsed.
export type TurnState = { resultText: string; isError: boolean; errorDetail: string };
