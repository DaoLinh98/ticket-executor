import {
  evaluatePrompt,
  fixInput,
  fixPrompt,
  implementPrompt,
  planPrompt,
  publishPrompt,
  qaImplementPrompt,
  qaTriagePrompt,
  readinessPrompt,
  reflectPrompt,
  respondPrompt,
  reviewImplementPrompt,
  reviewTriagePrompt,
} from "./prompts";
import { bundleOf, deliveryOf, followUpOf, threadsOf } from "./rules";
import {
  EVALUATE_OUTPUT,
  PLAN_OUTPUT,
  PUBLISH_OUTPUT,
  QA_TRIAGE_OUTPUT,
  READINESS_OUTPUT,
  REFLECT_OUTPUT,
  RESPOND_OUTPUT,
  REVIEW_TRIAGE_OUTPUT,
  STEP_OUTPUT,
} from "./schemas";
import { END, FAIL, NEEDS_INPUT, NEEDS_REVIEW, type AgentNode, type Edge, type Flow, type Graph, type Node, type NodeResult } from "./types";

export const GRAPH_ID = "dagent-implement-v3";
export const REVIEW_GRAPH_ID = "dagent-fix-review-v1";
export const QA_GRAPH_ID = "dagent-fix-qa-v3";
export const MAX_FIX_ATTEMPTS = 5;
export const MAX_PLAN_ATTEMPTS = 2;
export const MAX_PRE_PUBLISH = 3;
export const MAX_HOPS = 60;

const schema = (s: unknown) => s as Record<string, unknown>;

type Blocked = { is?: boolean; reason?: string };

function guard(r: NodeResult): { to: string; reason: string } | null {
  if (!r.ok) return { to: FAIL, reason: r.error || "step failed" };
  const b = (r.data.blocked ?? {}) as Blocked;
  if (b.is) return { to: FAIL, reason: `blocked: ${b.reason || "no reason given"}` };
  return null;
}

const NODES: Node[] = [
  { id: "setup", label: "Prepare workspace", phase: "prepare", kind: "harness", effects: "local", next: ["readiness", FAIL] },
  {
    id: "readiness", label: "Ticket readiness", phase: "understand", kind: "agent", agent: "analyst", effects: "pure",
    next: ["plan", END, NEEDS_INPUT, FAIL], output: schema(READINESS_OUTPUT), prompt: readinessPrompt,
  },
  {
    id: "plan", label: "Plan the change", phase: "understand", kind: "agent", agent: "planner", effects: "local",
    next: ["planCheck", FAIL], output: schema(PLAN_OUTPUT), prompt: planPrompt, maxVisits: MAX_PLAN_ATTEMPTS,
  },
  { id: "planCheck", label: "Plan check", phase: "understand", kind: "check", effects: "pure", next: ["implement", "plan", FAIL] },
  {
    id: "implement", label: "Implement", phase: "build", kind: "agent", agent: "implementer", effects: "local",
    next: ["syncBase", NEEDS_REVIEW, FAIL], output: schema(STEP_OUTPUT), prompt: implementPrompt,
  },
  { id: "syncBase", label: "Sync with base", phase: "build", kind: "harness", effects: "local", next: ["diffGuard", FAIL] },
  { id: "diffGuard", label: "Diff guard", phase: "verify", kind: "check", effects: "pure", next: ["evaluate", FAIL] },
  {
    id: "evaluate", label: "Independent review", phase: "verify", kind: "agent", agent: "reviewer", effects: "pure",
    next: ["prePublish", "fix", "reflect", FAIL], output: schema(EVALUATE_OUTPUT), prompt: evaluatePrompt,
  },
  {
    id: "fix", label: "Fix review blockers", phase: "verify", kind: "agent", agent: "fixer", effects: "local",
    next: ["syncBase", "reflect", FAIL], output: schema(STEP_OUTPUT), prompt: fixPrompt, input: fixInput, maxVisits: MAX_FIX_ATTEMPTS,
  },
  {
    id: "reflect", label: "Record lesson", phase: "verify", kind: "agent", agent: "reflector", effects: "local",
    next: [FAIL], output: schema(REFLECT_OUTPUT), prompt: reflectPrompt,
  },
  { id: "prePublish", label: "Pre-publish check", phase: "publish", kind: "check", effects: "pure", next: ["publish", "syncBase", FAIL] },
  {
    id: "publish", label: "Push & open draft PR", phase: "publish", kind: "agent", agent: "publisher", effects: "external",
    next: ["verifyPublish", FAIL], output: schema(PUBLISH_OUTPUT), prompt: publishPrompt, maxVisits: 1,
  },
  { id: "verifyPublish", label: "Verify PR", phase: "publish", kind: "check", effects: "pure", next: [END, NEEDS_REVIEW] },
];

const delivered: Edge = (_c, r) => {
  const bad = guard(r);
  if (bad) return bad;
  if (!r.data.committed) return { to: FAIL, reason: "nothing was committed" };
  return { to: "syncBase", reason: "committed locally" };
};

// Implement may rightly change nothing: the base already does what the ticket asks. Only a clean worktree with no
// commit, no changed file and no blocker counts — a person confirms it instead of the run failing a job it did.
const NO_CHANGE = "no code change needed — a person confirms";

const implemented: Edge = (c, r) => {
  const e = delivered(c, r);
  const b = (r.data.blocked ?? {}) as Blocked;
  const clean = !r.data.committed && Number(r.data.filesChanged ?? 0) === 0 && Number(r.data.uncommitted ?? 0) === 0;
  return e.to === FAIL && r.ok && !b.is && clean ? { to: NEEDS_REVIEW, reason: NO_CHANGE } : e;
};

const fixed: Edge = (c, r) => {
  const b = (r.data.blocked ?? {}) as Blocked;
  if (r.ok && b.is) return { to: "reflect", reason: `blocked: ${b.reason || "no reason given"}` };
  return delivered(c, r);
};

const passOn = (to: string, ok: string): Edge => (_c, r) => (r.ok ? { to, reason: ok } : { to: FAIL, reason: r.error || "check failed" });

const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);

const EDGES: Record<string, Edge> = {
  setup: (_c, r) => (r.ok ? { to: "readiness", reason: "workspace ready" } : { to: FAIL, reason: r.error || "workspace setup failed" }),
  readiness: (_c, r) => {
    const bad = guard(r);
    if (bad) return bad;
    if (!r.data.ready) return { to: NEEDS_INPUT, reason: `not ready · ${count(r.data.questions)} question(s) for the PO` };
    const d = deliveryOf({ channels: { readiness: r.data } });
    if (d.status === "done") return { to: END, reason: `already delivered · ${d.evidence.length} acceptance criteria on the base` };
    const part = d.status === "partial" ? ` · ${d.evidence.length} already delivered` : "";
    return { to: "plan", reason: `ready · ${count(r.data.acceptanceCriteria)} acceptance criteria${part}` };
  },
  plan: (_c, r) => guard(r) ?? { to: "planCheck", reason: `plan written · ${count(r.data.acMap)} AC mapped` },
  planCheck: (c, r) => {
    if (!r.ok) return { to: FAIL, reason: r.error || "plan check failed" };
    if (r.data.passed) return { to: "implement", reason: "plan accepted" };
    const n = count(r.data.issues);
    if ((c.visits.plan ?? 0) >= MAX_PLAN_ATTEMPTS) return { to: FAIL, reason: `plan still refused (${n} issue(s)) after ${c.visits.plan} attempt(s)` };
    return { to: "plan", reason: `${n} plan issue(s) → re-plan` };
  },
  implement: implemented,
  fix: fixed,
  syncBase: (_c, r) => {
    if (!r.ok) return { to: FAIL, reason: r.error || "sync failed" };
    const n = count(r.data.warnings);
    return { to: "diffGuard", reason: n ? `${n} warning(s) · for the reviewer` : r.data.rebased ? `rebased · was ${r.data.behindBy} behind` : "up to date" };
  },
  diffGuard: (_c, r) => {
    if (!r.ok) return { to: FAIL, reason: r.error || "diff guard failed to run" };
    const n = count(r.data.warnings);
    return { to: "evaluate", reason: n ? `${n} warning(s) · for the reviewer` : "diff clean" };
  },
  evaluate: (c, r) => {
    const bad = guard(r);
    if (bad) return bad;
    const bundle = bundleOf(c);
    if (!bundle.length) return { to: "prePublish", reason: "review passed" };
    const fixes = c.visits.fix ?? 0;
    if (fixes >= MAX_FIX_ATTEMPTS) return { to: "reflect", reason: `${bundle.length} refusal(s) stand after ${fixes} fix attempt(s)` };
    return { to: "fix", reason: `${bundle.length} blocker(s) → fix` };
  },
  reflect: (c) => {
    const b = (c.channels.fix?.blocked ?? {}) as Blocked;
    if (b.is) return { to: FAIL, reason: `blocked: ${b.reason || "no reason given"}` };
    return { to: FAIL, reason: `fix loop exhausted (${c.visits.fix ?? 0}/${MAX_FIX_ATTEMPTS}) · ${bundleOf(c).length} blocker(s) stand` };
  },
  prePublish: (c, r) => {
    if (!r.ok) return { to: FAIL, reason: r.error || "pre-publish check failed" };
    if (r.data.passed) return { to: "publish", reason: "branch clean · base unchanged" };
    if (r.data.baseMoved && (c.visits.prePublish ?? 0) < MAX_PRE_PUBLISH) return { to: "syncBase", reason: "base moved → re-sync and re-verify" };
    const issues = Array.isArray(r.data.issues) ? (r.data.issues as string[]) : [];
    return { to: FAIL, reason: issues[0] ?? "pre-publish check refused" };
  },
  publish: (_c, r) => {
    const bad = guard(r);
    if (bad) return bad;
    const prs = Array.isArray(r.data.prs) ? (r.data.prs as { repo?: string; pushed?: boolean; prUrl?: string }[]) : [];
    if (!prs.length) return { to: FAIL, reason: "nothing was published" };
    const missing = prs.find((p) => !p.pushed || !p.prUrl);
    if (missing) return { to: FAIL, reason: `${missing.repo ?? "repository"}: branch not pushed or no pull request` };
    return { to: "verifyPublish", reason: `${prs.length} pull request(s) reported` };
  },
  verifyPublish: (_c, r) => {
    if (r.ok && r.data.passed) return { to: END, reason: "pull requests verified" };
    const checks = Array.isArray(r.data.checks) ? (r.data.checks as { name: string; ok: boolean }[]) : [];
    const failed = checks.filter((x) => !x.ok).map((x) => x.name);
    return { to: NEEDS_REVIEW, reason: r.ok ? `read-back mismatch: ${failed.join("; ")}` : r.error || "read-back failed" };
  },
};

export const GRAPH: Graph = {
  id: GRAPH_ID,
  entry: "setup",
  nodes: Object.fromEntries(NODES.map((n) => [n.id, n])),
  edges: EDGES,
  retryEntries: ["plan", "implement", "syncBase"],
};

const nodeOf = (id: string) => NODES.find((n) => n.id === id)!;
const agentOf = (id: string) => nodeOf(id) as AgentNode;

// fix-review: the pull request already exists and has a reviewer, so its branch is never rebased (that would
// need a force-push) and nothing opens a pull request — the run commits on the PR branch, pushes, and answers
// the threads it judged. Base is the PR head at setup, so the review sees only this run's fixes.
const REVIEW_NODES: Node[] = [
  { ...nodeOf("setup"), next: ["reviewTriage", FAIL] },
  {
    id: "reviewTriage", label: "Judge review threads", phase: "understand", kind: "agent", agent: "review-triager", effects: "pure",
    next: ["implement", "respond", FAIL], output: schema(REVIEW_TRIAGE_OUTPUT), prompt: reviewTriagePrompt,
  },
  { ...agentOf("implement"), label: "Fix valid threads", prompt: reviewImplementPrompt, next: ["diffGuard", FAIL] },
  nodeOf("diffGuard"),
  nodeOf("evaluate"),
  { ...nodeOf("fix"), next: ["diffGuard", "reflect", FAIL] },
  nodeOf("reflect"),
  { ...nodeOf("prePublish"), next: ["respond", FAIL] },
  {
    id: "respond", label: "Push & answer threads", phase: "publish", kind: "agent", agent: "responder", effects: "external",
    next: [END, FAIL], output: schema(RESPOND_OUTPUT), prompt: respondPrompt, maxVisits: 1,
  },
];

const onPrBranch = (e: { to: string; reason: string }) => (e.to === "syncBase" ? { ...e, to: "diffGuard" } : e);

const REVIEW_EDGES: Record<string, Edge> = {
  ...EDGES,
  setup: (_c, r) => (r.ok ? { to: "reviewTriage", reason: `on ${String(r.data.branch || "the PR branch")}` } : { to: FAIL, reason: r.error || "workspace setup failed" }),
  reviewTriage: (_c, r) => {
    const bad = guard(r);
    if (bad) return bad;
    const threads = threadsOf({ channels: { reviewTriage: r.data } });
    if (!threads.length) return { to: FAIL, reason: "no open review thread to answer" };
    const fix = threads.filter((t) => t.decision === "fix").length;
    if (!fix) return { to: "respond", reason: `${threads.length} thread(s) · none needs a code change` };
    return { to: "implement", reason: `${fix} of ${threads.length} thread(s) to fix` };
  },
  implement: (c, r) => onPrBranch(delivered(c, r)),
  fix: (c, r) => onPrBranch(fixed(c, r)),
  prePublish: (_c, r) => {
    if (!r.ok) return { to: FAIL, reason: r.error || "pre-publish check failed" };
    if (r.data.passed) return { to: "respond", reason: "branch clean · verified HEAD unchanged" };
    const issues = Array.isArray(r.data.issues) ? (r.data.issues as string[]) : [];
    return { to: FAIL, reason: issues[0] ?? "pre-publish check refused" };
  },
  respond: (c, r) => {
    const bad = guard(r);
    if (bad) return bad;
    const changed = count(c.channels.diffGuard?.changed) > 0;
    if (changed && !r.data.pushed) return { to: FAIL, reason: "the fix was not pushed" };
    const replied = Number(r.data.threadsReplied ?? 0) || 0;
    if (!replied) return { to: FAIL, reason: "no thread was answered" };
    return { to: END, reason: `${replied} thread(s) answered${changed ? " · fix pushed" : ""}` };
  },
};

export const REVIEW_GRAPH: Graph = {
  id: REVIEW_GRAPH_ID,
  entry: "setup",
  nodes: Object.fromEntries(REVIEW_NODES.map((n) => [n.id, n])),
  edges: REVIEW_EDGES,
  retryEntries: [],
};

// fix-qa: QA sends a ticket back after its pull request merged, so the fix is new work on a new branch from the
// default branch and ships as a new draft PR — the implement loop, entered through a triage of QA's findings.
// Flow Runner runs it twice per QA follow-up case: first without a decision, ending after the triage so the
// developer decides on the analysis; then, once a fix is approved, seeded with that decision.
const QA_NODES: Node[] = [
  { ...nodeOf("setup"), next: ["qaTriage", FAIL] },
  {
    id: "qaTriage", label: "Judge QA findings", phase: "understand", kind: "agent", agent: "qa-triager", effects: "pure",
    next: ["implement", END, FAIL], output: schema(QA_TRIAGE_OUTPUT), prompt: qaTriagePrompt,
  },
  { ...agentOf("implement"), label: "Fix QA defects", prompt: qaImplementPrompt },
  ...NODES.filter((n) => !["setup", "readiness", "plan", "planCheck", "implement"].includes(n.id)),
];

const QA_EDGES: Record<string, Edge> = {
  ...EDGES,
  setup: (_c, r) => (r.ok ? { to: "qaTriage", reason: "workspace ready" } : { to: FAIL, reason: r.error || "workspace setup failed" }),
  qaTriage: (c, r) => {
    const bad = guard(r);
    if (bad) return bad;
    const f = followUpOf(c);
    if (f && !f.decision) return { to: END, reason: "analysis ready · the developer decides" };
    if (r.data.outcome === "no-fix-needed") return { to: END, reason: "no finding is a defect · reply to QA drafted" };
    const defects = (Array.isArray(r.data.findings) ? (r.data.findings as { defect?: boolean }[]) : []).filter((f) => f.defect).length;
    if (!defects) return { to: FAIL, reason: "outcome is fix but no finding is marked a defect" };
    if (!String(r.data.branch ?? "").trim()) return { to: FAIL, reason: "no branch was proposed for the fix" };
    return { to: "implement", reason: `${defects} defect(s) to fix` };
  },
};

export const QA_GRAPH: Graph = {
  id: QA_GRAPH_ID,
  entry: "setup",
  nodes: Object.fromEntries(QA_NODES.map((n) => [n.id, n])),
  edges: QA_EDGES,
  retryEntries: [],
};

export const GRAPHS: Record<Flow, Graph> = { implement: GRAPH, review: REVIEW_GRAPH, qa: QA_GRAPH };

// The shapes before implement could park a no-change result — kept so a run begun on one finishes on it.
const beforeNoChange = (g: Graph, id: string): Graph => ({
  ...g,
  id,
  nodes: { ...g.nodes, implement: { ...g.nodes.implement, next: g.nodes.implement.next.filter((t) => t !== NEEDS_REVIEW) } },
  edges: { ...g.edges, implement: delivered },
});

const LEGACY: Record<Flow, Graph[]> = {
  implement: [beforeNoChange(GRAPH, "dagent-implement-v2")],
  review: [],
  qa: [beforeNoChange(QA_GRAPH, "dagent-fix-qa-v1"), { ...QA_GRAPH, id: "dagent-fix-qa-v2" }],
};

export function graphById(id: string): Graph | null {
  return [...Object.values(GRAPHS), ...Object.values(LEGACY).flat()].find((g) => g.id === id) ?? null;
}

export function flowOf(graphId: string): Flow {
  return (Object.keys(GRAPHS) as Flow[]).find((f) => GRAPHS[f].id === graphId || LEGACY[f].some((g) => g.id === graphId)) ?? "implement";
}

export type NodeOutline = {
  id: string;
  label: string;
  phase: string;
  kind: string;
  agent: string;
  effects: string;
  context: "" | "fresh";
  next: string[];
  maxVisits?: number;
};

export function outline(g: Graph = GRAPH): NodeOutline[] {
  return Object.values(g.nodes).map((n) => ({
    id: n.id,
    label: n.label,
    phase: n.phase,
    kind: n.kind,
    agent: n.kind === "agent" ? n.agent : "",
    effects: n.effects,
    context: n.kind === "agent" ? "fresh" : "",
    next: n.next,
    maxVisits: n.maxVisits,
  }));
}

export function agentsOf(g: Graph = GRAPH): string[] {
  return [...new Set(Object.values(g.nodes).flatMap((n) => (n.kind === "agent" ? [n.agent] : [])))];
}

/** Every agent any D-Agent graph runs — what the repo must ship. */
export function allAgents(): string[] {
  return [...new Set(Object.values(GRAPHS).flatMap((g) => agentsOf(g)))];
}
