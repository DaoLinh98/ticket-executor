export type Effects = "pure" | "local" | "external";

export type Phase = "prepare" | "understand" | "build" | "verify" | "publish";

export const END = "END";
/** Artifact kind prefix for an agent step's brief: `brief:<stepId>`. */
export const BRIEF_PREFIX = "brief:";
export const FAIL = "FAIL";
export const NEEDS_INPUT = "NEEDS_INPUT";
export const NEEDS_REVIEW = "NEEDS_REVIEW";

export const TERMINALS = [END, FAIL, NEEDS_INPUT, NEEDS_REVIEW];

export type Target = string;

/** `evidence` / `expected` come only from the reviewer, so the fixer starts from its proof instead of re-diagnosing. */
export type Refusal = { source: string; file: string; issue: string; evidence?: string; expected?: string };

export type Usage = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  numTurns: number;
};

export const ZERO_USAGE: Usage = { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, numTurns: 0 };

export type LogLevel = "INFO" | "WARN" | "ERROR";

export type LogEntry = { t: number; lvl: LogLevel; text: string };

export type NodeResult = {
  ok: boolean;
  data: Record<string, unknown>;
  error: string;
  usage: Usage;
  log?: LogEntry[];
};

export type Flow = "implement" | "review" | "qa";

export type Repo = { name: string; path: string; cwd: string; baseSha: string; note?: string };

export type Ctx = {
  runId: string;
  flow: Flow;
  prUrl: string;
  ticketId: string;
  ticketUrl: string;
  provider: string;
  project: string;
  rootRepo: string;
  cwd: string;
  baseSha: string;
  companions: Repo[];
  knowledgeFile: string;
  channels: Record<string, Record<string, unknown>>;
  visits: Record<string, number>;
  /** The work item as the harness read it for the judging role's brief — per turn, never persisted. */
  workItem?: WorkItem;
  /** Skills switched off in Settings, read for a skill-picking role's brief — per turn, never persisted. */
  skillsOff?: string[];
};

export type WorkItem = {
  title: string;
  type: string;
  state: string;
  description: string;
  criteria: string;
  comments: { author: string; date: string; text: string }[];
};

type NodeBase = {
  id: string;
  label: string;
  phase: Phase;
  effects: Effects;
  next: Target[];
  maxVisits?: number;
};

export type AgentNode = NodeBase & {
  kind: "agent";
  agent: string;
  output: Record<string, unknown>;
  prompt: (c: Ctx) => string;
  input?: (c: Ctx) => Refusal[];
};

export type CheckNode = NodeBase & { kind: "check" | "harness" };

export type Node = AgentNode | CheckNode;

export type Edge = (c: Ctx, r: NodeResult) => { to: Target; reason: string };

export type Graph = {
  id: string;
  entry: string;
  nodes: Record<string, Node>;
  edges: Record<string, Edge>;
  retryEntries: string[];
};

export type GateResult = {
  gate: "preflight" | "admission";
  status: "passed" | "refused";
  reason: string;
  at: string;
  howTo?: string;
};
