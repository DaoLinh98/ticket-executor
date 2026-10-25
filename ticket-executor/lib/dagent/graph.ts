import { evaluatePrompt, fixInput, fixPrompt, implementPrompt, planPrompt, publishPrompt, readinessPrompt, reflectPrompt } from "./prompts";
import { bundleOf, deliveryOf } from "./rules";
import { EVALUATE_OUTPUT, PLAN_OUTPUT, PUBLISH_OUTPUT, READINESS_OUTPUT, REFLECT_OUTPUT, STEP_OUTPUT } from "./schemas";
import { END, FAIL, NEEDS_INPUT, NEEDS_REVIEW, type Edge, type Graph, type Node, type NodeResult } from "./types";

export const GRAPH_ID = "dagent-implement-v2";
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
    next: ["syncBase", FAIL], output: schema(STEP_OUTPUT), prompt: implementPrompt,
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
  implement: delivered,
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

export function graphById(id: string): Graph | null {
  return id === GRAPH_ID ? GRAPH : null;
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
