import { readFileSync } from "fs";
import path from "path";
import { IMPLEMENT_PROMPT, invokeSkill, PUBLISH_PROMPT, REPLAN_PROMPT, REVIEW_PUBLISH_PROMPT } from "./prompts";
import {
  blockedOf,
  IMPLEMENT_OUTPUT,
  ONESHOT_OUTPUT,
  PLAN_OUTPUT,
  PUBLISH_OUTPUT,
  REVIEW_ONESHOT_OUTPUT,
  REVIEW_PUBLISH_OUTPUT,
  verificationFailed,
  verificationOf,
} from "./schemas";
import { END, FAIL, ZERO_USAGE, type Edge, type Graph, type NodeResult, type RunContext } from "./types";

// Where the plan phase leaves its deliverable, relative to the run's worktree.
// The file is the agent's drafting surface; the durable copy is an Artifact row.
export const PLAN_FILE = path.join(".te", "plan.md");
export const FEEDBACK_FILE = path.join(".te", "feedback.md");

export function readPlanFile(cwd: string): string {
  try {
    return readFileSync(path.join(cwd, PLAN_FILE), "utf8").trim();
  } catch {
    return "";
  }
}

// ---- shared edge fragments ----

// Every agent edge starts the same way: the turn itself has to have worked, and
// the agent has to not have declared a hard blocker.
function turnGuard(r: NodeResult): { to: typeof FAIL; reason: string } | null {
  if (!r.ok) return { to: FAIL, reason: r.error || "turn failed" };
  const b = blockedOf(r.data);
  if (b.is) return { to: FAIL, reason: `blocked: ${b.reason || "no reason given"}` };
  return null;
}

// ---- two-phase graph (implement-ticket-v3 / fix-code-review-v3) ----

// plan ─► planCheck ─► [review gate] ─► implement ─► publish ─► END
//  ▲                        │            (local)     (external)
//  └── replan ◄─────────────┘ request changes
//
// `implement` stops at a local commit and `publish` is a leaf: that boundary is
// what lets an evaluator be inserted between them later without any node that
// already pushed being re-run.
function twoPhaseGraph(review: boolean): Graph {
  const publishPrompt = review ? REVIEW_PUBLISH_PROMPT : PUBLISH_PROMPT;
  const publishSchema = review ? REVIEW_PUBLISH_OUTPUT : PUBLISH_OUTPUT;

  const afterPlan: Edge = (_c, r) => {
    const bad = turnGuard(r);
    if (bad) return bad;
    return { to: "planCheck", reason: "plan turn finished" };
  };

  return {
    id: review ? "fix-review-v3" : "implement-v3",
    entry: "plan",
    nodes: {
      plan: {
        kind: "agent",
        id: "plan",
        label: "Draft plan",
        effects: "local", // writes only .te/plan.md
        context: "fresh",
        prompt: (c) => invokeSkill(c, "plan"),
        output: PLAN_OUTPUT as unknown as Record<string, unknown>,
      },
      planCheck: {
        kind: "check",
        id: "planCheck",
        label: "Check plan",
        effects: "pure",
        run: async (c) => {
          const plan = readPlanFile(c.cwd);
          return {
            ok: !!plan,
            data: { planLength: plan.length },
            error: plan ? "" : "The plan phase finished without writing .te/plan.md — nothing to review.",
            usage: ZERO_USAGE,
          };
        },
      },
      review: {
        kind: "gate",
        id: "review",
        label: "Awaiting your review",
        effects: "pure",
        artifact: "plan",
      },
      replan: {
        kind: "agent",
        id: "replan",
        label: "Revise plan",
        effects: "local",
        context: "resume",
        prompt: () => REPLAN_PROMPT,
        output: PLAN_OUTPUT as unknown as Record<string, unknown>,
      },
      implement: {
        kind: "agent",
        id: "implement",
        label: "Implement changes",
        // Local: source edits and a local commit. Undone by discarding the
        // worktree/branch, so re-entering this node costs nothing outside.
        effects: "local",
        context: "resume",
        prompt: () => IMPLEMENT_PROMPT,
        output: IMPLEMENT_OUTPUT as unknown as Record<string, unknown>,
      },
      publish: {
        kind: "agent",
        id: "publish",
        label: review ? "Push & resolve threads" : "Push & open PR",
        // The one node that leaves this machine. Leaf by construction.
        effects: "external",
        context: "resume",
        prompt: () => publishPrompt,
        output: publishSchema as unknown as Record<string, unknown>,
      },
    },
    edges: {
      plan: afterPlan,
      replan: afterPlan,
      planCheck: (_c, r) =>
        r.ok ? { to: "review", reason: "plan written" } : { to: FAIL, reason: r.error },
      // Resolved by a human: resolveGate() supplies the action as this node's result.
      review: (_c, r) => {
        const action = String(r.data.action ?? "");
        if (action === "approve") return { to: "implement", reason: "plan approved" };
        if (action === "revise") return { to: "replan", reason: "changes requested" };
        return { to: FAIL, reason: "plan rejected" };
      },
      implement: (_c, r) => {
        const bad = turnGuard(r);
        if (bad) return bad;
        const failed = verificationFailed(verificationOf(r.data));
        // Deliberately terminal rather than a retry edge: nothing in this graph
        // knows how to fix a failing test yet, and looping without a fixer just
        // burns tokens. This is the edge an evaluator/fix pair replaces later.
        if (failed) return { to: FAIL, reason: failed };
        if (!r.data.committed) return { to: FAIL, reason: "nothing was committed" };
        return { to: "publish", reason: "committed, verification clear" };
      },
      publish: (_c, r) => {
        const bad = turnGuard(r);
        if (bad) return bad;
        if (!r.data.pushed) return { to: FAIL, reason: "branch was not pushed" };
        return { to: END, reason: r.data.reusedExisting ? "published (reused existing PR)" : "published" };
      },
    },
  };
}

// ---- one-shot graph (implement-ticket-v2 / fix-code-review-v2) ----

// A single node that runs the whole ticket to a PR. It is `external`, but it is
// also the only node and therefore a leaf — the invariant holds.
function oneShotGraph(review: boolean): Graph {
  return {
    id: review ? "fix-review-v2" : "implement-v2",
    entry: "deliver",
    nodes: {
      deliver: {
        kind: "agent",
        id: "deliver",
        label: review ? "Resolve review" : "Implement & open PR",
        effects: "external",
        context: "fresh",
        prompt: (c) => invokeSkill(c, ""),
        output: (review ? REVIEW_ONESHOT_OUTPUT : ONESHOT_OUTPUT) as unknown as Record<string, unknown>,
      },
    },
    edges: {
      deliver: (_c, r) => {
        const bad = turnGuard(r);
        if (bad) return bad;
        if (!r.data.pushed) return { to: FAIL, reason: "branch was not pushed" };
        return { to: END, reason: "delivered" };
      },
    },
  };
}

// ---- resolution ----

const REVIEW_SKILLS = new Set(["fix-code-review-v2", "fix-code-review-v3"]);
const TWO_PHASE_SKILLS = new Set(["implement-ticket-v3", "fix-code-review-v3"]);

/** The graph a skill runs on. This replaces the old `isTwoPhaseSkill` boolean:
 *  the shape of a run is now a graph, not a flag read in three places. */
export function graphForSkill(skill: string): Graph {
  const review = REVIEW_SKILLS.has(skill);
  return TWO_PHASE_SKILLS.has(skill) ? twoPhaseGraph(review) : oneShotGraph(review);
}

/** Resolve a graph by the id persisted on the Run, so a run parked before a
 *  restart resumes on the shape it started on even if the skill were remapped. */
export function graphById(graphId: string, skill: string): Graph {
  switch (graphId) {
    case "implement-v3":
      return twoPhaseGraph(false);
    case "fix-review-v3":
      return twoPhaseGraph(true);
    case "implement-v2":
      return oneShotGraph(false);
    case "fix-review-v2":
      return oneShotGraph(true);
    default:
      return graphForSkill(skill);
  }
}

/** The progress list for a skill: node ids + labels, in declaration order.
 *  The UI renders this instead of a hand-maintained STEPS array, so adding a
 *  node to a graph adds a step to the UI with no second place to update. */
export function graphOutline(skill: string): { id: string; label: string; effects: string }[] {
  const g = graphForSkill(skill);
  return Object.values(g.nodes).map((n) => ({ id: n.id, label: n.label, effects: n.effects }));
}

export const KNOWN_SKILLS = [
  "implement-ticket-v2",
  "implement-ticket-v3",
  "fix-code-review-v2",
  "fix-code-review-v3",
];

/** A run context needs `prUrl` only for the review skills. */
export function isReviewSkill(skill: string): boolean {
  return REVIEW_SKILLS.has(skill);
}

/** Whether the skill's graph has a human gate — used by the UI to decide whether
 *  to offer the Plan tab at all. Derived from the graph, not a second list. */
export function hasGate(skill: string): boolean {
  return Object.values(graphForSkill(skill).nodes).some((n) => n.kind === "gate");
}
