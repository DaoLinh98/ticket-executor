export type Tone = "accent" | "success" | "danger" | "warning" | "info" | "indigo" | "muted";

export type Effects = "pure" | "local" | "external";

export type NodeKind = "agent" | "check" | "harness" | "gate" | "terminal";

export type PhaseKey = "prepare" | "understand" | "build" | "verify" | "publish";

export type FlowNodeDef = {
  id: string;
  label: string;
  phase: string;
  kind: NodeKind;
  effects: Effects;
  context: "" | "fresh" | "resume";
  next: string[];
  maxVisits?: number;
};

export type StepStatus = "running" | "succeeded" | "failed" | "refused" | "skipped";

export type NodeStatus =
  | StepStatus
  | "pending"
  | "abandoned"
  | "parked"
  | "exhausted"
  | "passed"
  | "reached";

export type Refusal = { source: string; file?: string; issue: string };

export type PullRequestRef = {
  repo: string;
  number: number;
  url: string;
  draft: boolean;
  reusedExisting: boolean;
};

export type Verification = { tests: string; build: string; acceptanceCriteria: string };

export type NodeOutput =
  | { node: "setup"; mode: string; branch: string; baseSha: string; repos: { name: string; path: string }[] }
  | {
      node: "readiness";
      ready: boolean;
      missing: string[];
      ambiguities: string[];
      questions: string[];
      delivery?: { status: "none" | "partial" | "done"; evidence: { ac: string; repo: string; proof: string }[] };
    }
  | { node: "plan"; acMap: { ac: string; files: string[]; test: string }[]; repos: string[]; risks: string[]; planMd: string }
  | { node: "planCheck" | "prePublish"; passed: boolean; issues: string[] }
  | {
      node: "implement" | "fix";
      commitSha: string;
      summary: string;
      filesChanged: number;
      testExemption: string;
      verification: Verification;
      addressed?: Refusal[];
    }
  | { node: "syncBase"; rebased: boolean; behindBy: number; conflicts: string[] }
  | {
      node: "testGate";
      passed: boolean;
      results: { repo: string; branch: string; files: number; tests: string[]; passed: boolean; issue: string }[];
    }
  | { node: "diffGuard"; passed: boolean; violations: { rule: string; file: string }[] }
  | { node: "evaluate"; verdict: "pass" | "changes-required"; blockers: Refusal[]; reviewedDelta: boolean }
  | { node: "reflect"; recorded: boolean; lesson: string }
  | { node: "publish"; prs: PullRequestRef[] }
  | { node: "verifyPublish"; passed: boolean; checks: { name: string; ok: boolean }[] }
  | {
      node: "reviewTriage";
      threads: { threadId: string; file: string; comment: string; decision: "fix" | "reject" | "informational"; reason: string }[];
      planMd: string;
    }
  | { node: "qaTriage"; outcome: "fix" | "no-fix-needed"; findings: { finding: string; kind?: string; defect: boolean; reason: string; files: string[] }[]; qaReply: string; planMd: string }
  | { node: "respond"; pushed: boolean; threadsReplied: number };

export type Step = {
  id: string;
  nodeId: string;
  attempt: number;
  status: StepStatus;
  startedAt: number;
  endedAt: number | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  numTurns: number;
  errorMessage: string;
  output: NodeOutput | null;
  logFrom: number;
  logTo: number;
  input: Refusal[] | null;
};

export type Transition = { seq: number; fromNode: string; toNode: string; reason: string; at: number };

export type RunState = "preparing" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";

export type WaitReason = "needs-input" | "needs-review" | "rate-limited";

export type RunFailure = { reason: string; refusals: Refusal[]; lesson: string; retryableFrom: string[] };

export type KnowledgeDiff = { added: string[]; removed: string[] };

export type RefusalBundle = { title: string; sub: string; items: Refusal[] };

export type Run = {
  id: string;
  flow: string;
  state: RunState;
  waitReason?: WaitReason;
  resumeAt?: number;
  currentNodeId: string;
  fixAttempts: number;
  maxFixAttempts: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: number;
  endedAt: number | null;
  costByPhase: Record<PhaseKey, number>;
  failure?: RunFailure;
  knowledge?: KnowledgeDiff;
  defs: FlowNodeDef[];
  steps: Step[];
  transitions: Transition[];
  bundle: RefusalBundle | null;
  logs?: LogLine[];
};

export type GateResult = {
  gate: "preflight" | "admission";
  status: "passed" | "refused";
  reason: string;
  at: string;
  howTo?: string;
};

export type StageStatus = "done" | "active" | "blocked" | "todo" | "skipped";

export type RunChip = { key: string; flow: string; state: string; cost: number };

export type StageTick = { t: string; short: string; ok: boolean };

export type LifecycleStage = {
  id: string;
  label: string;
  status: StageStatus;
  at: string;
  detail: string;
  action?: string;
  runs: RunChip[];
  ticks?: StageTick[];
};

export type Cell = string | { t: string; tone?: Tone; mono?: boolean };

export type ListItem = {
  icon?: string;
  mark?: string;
  tone?: Tone;
  text: string;
  textTone?: Tone;
  sub?: string;
  mono?: boolean;
};

export type Section =
  | { kind: "kv"; title?: string; rows: { k: string; v: string; tone?: Tone; mono?: boolean }[] }
  | { kind: "list"; title?: string; icon?: string; tone?: Tone; items: ListItem[] }
  | { kind: "table"; title?: string; cols: string[]; rows: Cell[][] }
  | { kind: "md"; title?: string; icon?: string; tone?: Tone; text: string }
  | { kind: "prs"; title?: string; prs: { repo: string; num: number; url: string; meta: string; draft: boolean }[] }
  | { kind: "copy"; questions: string[] }
  | { kind: "bar"; title?: string; bars: { k: string; v: string; w: number; phase: PhaseKey }[] }
  | {
      kind: "retry";
      title?: string;
      icon?: string;
      options: { id: string; label: string; external: boolean; enabled: boolean }[];
      defaultId: string;
      /** The node `retryNodeFor()` picked, marked "Suggested"; null = a fresh start is suggested. */
      suggestedId: string | null;
      advice: { title: string; text: string; tone: Tone };
    };

export type LogLevel = "INFO" | "WARN" | "ERROR";

export type LogLine = { ts: number; lvl: LogLevel; node: string; text: string; attempt: number };
