import type { ChildProcess } from "child_process";
import type { LogLine, RunState } from "../../types";

// ---- effect classification ----

// What a node does to the world, and therefore what may be done with it after a
// crash and whether it may sit on a cycle.
//   pure     — reads only. Safe to re-run from scratch any number of times.
//   local    — writes inside the run's worktree (source edits, local commits).
//              Undone by throwing the worktree/branch away, so a retry is cheap.
//   external — leaves this machine (push, PR, tracker writes). Cannot be undone.
//
// The invariant the whole design rests on: **an `external` node is never on a
// cycle.** It is a leaf, entered once, after every loop has converged. Adding a
// retry edge into one would mean a second push or a duplicate PR.
export type EffectClass = "pure" | "local" | "external";

export type NodeId = string;

/** Terminal targets an edge may return instead of a node id. */
export const END = "END" as const;
export const FAIL = "FAIL" as const;
export type Target = NodeId | typeof END | typeof FAIL;

export type TurnUsage = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  numTurns: number;
  durationMs: number;
};

export const ZERO_USAGE: TurnUsage = {
  costUsd: 0, inputTokens: 0, outputTokens: 0,
  cacheReadTokens: 0, cacheCreationTokens: 0, numTurns: 0, durationMs: 0,
};

/** What one node execution produced. `data` is the node's *validated* structured
 *  output — for an agent node that is `result.structured_output` from the CLI,
 *  never text the harness parsed itself. */
export type NodeResult = {
  ok: boolean;
  data: Record<string, unknown>;
  error: string;
  usage: TurnUsage;
};

// ---- context policy ----

// What a node is allowed to see. This is the single most expensive knob in the
// system, so it is declared per node rather than left to whatever the CLI
// happens to remember:
//   resume — continue the run's Claude session; the node inherits everything
//            earlier nodes read. Cheap, but it also inherits their conclusions.
//   fresh  — a new session. The harness must hand it every artifact it needs, in
//            the prompt. Costs a fresh system prompt + re-reading, and buys the
//            only thing worth that price: a node that can disagree with the node
//            before it. Any node that *judges* another node's work must be fresh.
export type ContextPolicy = "resume" | "fresh";

/** Everything an edge or a prompt builder is allowed to read. Deliberately a
 *  plain value: edges must be pure functions of it. */
export type RunContext = {
  runId: string;
  ticketId: string;
  ticketUrl: string;
  provider: string;
  project: string;
  prUrl: string;
  skill: string;
  rootRepo: string;
  /** Where the run actually executes — the worktree, or rootRepo when not isolated. */
  cwd: string;
  /** Commit the worktree branched from; the run's diff is measured against it. */
  baseSha: string;
  /** What earlier runs against this `rootRepo` learned, already rendered as a
   *  prompt block (lib/execution/knowledge.ts). Resolved once at run start and
   *  carried here rather than fetched by the prompt builder — a builder is a
   *  pure synchronous function of this context, and it stays one. Empty when
   *  there is nothing learned yet, which is the normal state of a new repo. */
  knowledge: string;
  /** nodeId → that node's validated output. The only channel between nodes. */
  channels: Record<string, Record<string, unknown>>;
  /** nodeId → how many times it has been entered. Cycle accounting for edges. */
  visits: Record<string, number>;
};

// ---- nodes ----

type NodeBase = {
  id: NodeId;
  /** Shown in the UI's progress list. The list is derived from the graph, so
   *  adding a node adds a step — there is no separate STEPS array to keep in sync. */
  label: string;
  effects: EffectClass;
};

/** A node that spawns a Claude turn. `output` is required: a node that does not
 *  declare what it returns is not a node, it is a shell command — edges would
 *  have nothing to branch on but "the process exited 0". */
export type AgentNode = NodeBase & {
  kind: "agent";
  context: ContextPolicy;
  prompt: (c: RunContext) => string;
  output: Record<string, unknown>; // JSON Schema, passed to the CLI as --json-schema
};

/** A stop. The run parks here holding no child process until a human resolves it.
 *  `artifact` names what they are shown (an Artifact row of that kind). */
export type GateNode = NodeBase & {
  kind: "gate";
  effects: "pure";
  artifact: string;
};

/** Plain code, zero tokens — used where the harness can check something itself
 *  rather than paying an agent to report it. */
export type CheckNode = NodeBase & {
  kind: "check";
  effects: "pure";
  run: (c: RunContext) => Promise<NodeResult>;
};

export type Node = AgentNode | GateNode | CheckNode;

/** Where to go after a node, and why. The `reason` is not decoration: it is
 *  persisted as a Transition row and is the primary artifact for debugging a
 *  run — far more useful than the tool log it sits next to.
 *
 *  Edges are pure and synchronous on purpose. That is what makes a graph
 *  testable without spawning a CLI. */
export type Edge = (c: RunContext, r: NodeResult) => { to: Target; reason: string };

export type Graph = {
  id: string;
  entry: NodeId;
  nodes: Record<NodeId, Node>;
  edges: Record<NodeId, Edge>;
};

/** Node ids in declaration order, for the UI's progress list. */
export function nodeOrder(g: Graph): Node[] {
  return Object.values(g.nodes);
}

// ---- live (in-process) run ----

/** The in-process half of a run: the things that cannot be persisted (a child
 *  process handle) and the things it would be wasteful to re-read from Postgres
 *  on every poll. Everything durable lives in the Run/Step/Artifact/Transition
 *  rows; this is rebuilt from them by rehydrate() when a restart loses it. */
export type LiveRun = {
  id: string;
  graphId: string;
  ctx: RunContext;
  state: RunState;
  currentNodeId: string;
  /** Claude session the run's turns share, so a `resume` node keeps context. */
  sessionId: string;
  model: string;
  effort: string;
  isolate: boolean;
  child: ChildProcess | null;
  cancelled: boolean;
  /** The whole run's log, in order. A step persists the slice it produced. */
  logLines: LogLine[];
  mcpConfigPath: string;
  parkedAt: number | null;
  humanWaitMs: number;
  startedAt: number;
  endedAt: number | null;
  /** Monotonic counter for Transition.seq. */
  seq: number;
  /** Transitions taken so far, across every re-entry of drive(). Persisted: a
   *  gate resolution and a crash resume both call drive() again, and a hop
   *  counter that restarts there would never catch the loop it exists to catch. */
  hops: number;
  resumedAfterRestart: boolean;
  errorMessage: string;
  endReason: string;
  // Promoted out of node output as nodes report it (see promoteContractFields).
  prUrl: string;
  branch: string;
  resultText: string;
};
