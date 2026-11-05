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

export type Refusal = { source: string; file?: string; issue: string; evidence?: string; expected?: string };

export type PullRequestRef = {
  repo: string;
  number: number;
  url: string;
  draft: boolean;
  reusedExisting: boolean;
};

export type Verification = { tests: string; build: string; acceptanceCriteria: string };

/** The judging role's reading of the work item, which every later brief carries as its Ticket section. */
export type TicketDigest = { summary: string; details: string[] };

export type NodeOutput =
  | { node: "setup"; branch: string; baseSha: string; repos: { name: string; path: string; base: string; from: string; branch: string }[]; warnings: string[] }
  | {
      node: "readiness";
      ready: boolean;
      acceptanceCriteria: string[];
      skills: { name: string; reason: string }[];
      baseBranch: string;
      missing: string[];
      ambiguities: string[];
      questions: string[];
      delivery?: { status: "none" | "partial" | "done"; evidence: { ac: string; repo: string; proof: string }[] };
      codeLeads: { at: string; what: string }[];
      digest?: TicketDigest;
    }
  | {
      node: "plan";
      acMap: { n: number; ac: string; change: "code" | "none"; files: string[]; test: string }[];
      repos: string[];
      risks: string[];
      decisions: { point: string; decision: string; why: string }[];
      planMd: string;
    }
  | {
      node: "planCheck" | "prePublish";
      passed: boolean;
      issues: string[];
      /** planCheck only: what the check covered. */
      checked?: { criteria: number; mapped: number; code: number; none: number; files: number; repos: string[] };
    }
  | {
      node: "implement" | "fix";
      commitSha: string;
      summary: string;
      filesChanged: number;
      verification: Verification;
      deviations: { what: string; why: string }[];
      manualChecks: { n: number; check: string }[];
      addressed?: Refusal[];
    }
  | {
      node: "syncBase";
      rebased: boolean;
      behindBy: number;
      conflicts: string[];
      /** Per repo; empty on runs before it was recorded. */
      repos: { name: string; upstream: string; behind: number; status: string; base: string }[];
    }
  | {
      node: "testGate";
      passed: boolean;
      results: { repo: string; branch: string; files: number; tests: string[]; passed: boolean; issue: string }[];
    }
  | {
      node: "diffGuard";
      passed: boolean;
      /** `hard`: blocks — went straight to the fixer; otherwise a warning for the reviewer. */
      violations: { rule: string; file: string; hard: boolean }[];
      summary?: { changed: number; planned: number; unplanned: string[] };
    }
  | {
      node: "evaluate";
      verdict: "pass" | "changes-required";
      blockers: Refusal[];
      reviewedDelta: boolean;
      /** The reviewer's evidence table: one row per AC and per bug-axis check. */
      checked: { subject: string; how: string; evidence: string; result: string }[];
      /** What it could not verify. */
      assumptions: string[];
      /** The harness's consistency notes (`checkReview`); any means an unproven verdict. */
      reviewNotes: string[];
    }
  | { node: "reflect"; recorded: boolean; lesson: string }
  | { node: "publish"; prs: PullRequestRef[] }
  | { node: "verifyPublish"; passed: boolean; checks: { name: string; ok: boolean }[] }
  | {
      node: "reviewTriage";
      threads: { threadId: string; file: string; comment: string; decision: "fix" | "reject" | "informational"; reason: string }[];
      planMd: string;
      digest?: TicketDigest;
    }
  | { node: "qaTriage"; outcome: "fix" | "no-fix-needed"; findings: { finding: string; kind?: string; defect: boolean; reason: string; files: string[] }[]; qaReply: string; planMd: string; digest?: TicketDigest }
  | { node: "respond"; pushed: boolean; threadsReplied: number };

/** How one step dealt with one skill: the picker `picked` it; a later role was told to follow it and `read` its
 *  SKILL.md, or left it `unread`; or the step `opened` a skill nobody assigned it. */
export type SkillUse = { name: string; state: "picked" | "read" | "unread" | "opened" };

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
  /** The brief an agent step was started with — the only context a fresh turn has. "" for a check/harness step. */
  brief?: string;
  /** The model and effort an agent step ran on, read from the step's own log. Absent for a check/harness step. */
  model?: string;
  effort?: string;
  /** The skills the step picked, was told to follow, or opened unasked (`skillUse()`). Empty for a check/harness step. */
  skills?: SkillUse[];
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
  /** The sub line is prose, not a path: no mono, no mid-word breaks. */
  subPlain?: boolean;
  mono?: boolean;
};

/** `folded`: debug detail a developer opens only when something went wrong — shown as its title row, body one tap away. */
export type Section = { folded?: boolean } & (
  | { kind: "kv"; title?: string; icon?: string; tone?: Tone; rows: { k: string; v: string; tone?: Tone; mono?: boolean }[] }
  | { kind: "list"; title?: string; icon?: string; tone?: Tone; items: ListItem[] }
  | { kind: "table"; title?: string; icon?: string; tone?: Tone; cols: string[]; rows: Cell[][]; /** The panel reads better given room: its icon opens it in a dialog. */ expandable?: boolean }
  | { kind: "md"; title?: string; icon?: string; tone?: Tone; text: string }
  | { kind: "prs"; title?: string; icon?: string; tone?: Tone; prs: { repo: string; num: number; url: string; meta: string; draft: boolean }[] }
  | { kind: "copy"; questions: string[] }
  | { kind: "bar"; title?: string; icon?: string; tone?: Tone; bars: { k: string; v: string; w: number; phase: PhaseKey }[] }
  | {
      kind: "retry";
      title?: string;
      icon?: string;
      options: { id: string; label: string; external: boolean; enabled: boolean }[];
      defaultId: string;
      /** The node `retryNodeFor()` picked, marked "Suggested"; null = a fresh start is suggested. */
      suggestedId: string | null;
      advice: { title: string; text: string; tone: Tone };
    }
);

export type LogLevel = "INFO" | "WARN" | "ERROR";

export type LogLine = { ts: number; lvl: LogLevel; node: string; text: string; attempt: number };
