import { readFileSync, rmSync } from "fs";
import path from "path";
import { evaluatePrompt, fixPrompt, IMPLEMENT_PROMPT, openingPrompt, publishPrompt, REPLAN_PROMPT, REVIEW_PUBLISH_PROMPT } from "./prompts";
import {
  blockedOf,
  EVALUATE_OUTPUT,
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

/**
 * Delete the whole `.te/` scratch directory from a working tree.
 *
 * These files are one run's drafting surface, not project files: what the agent
 * proposed and what the reviewer approved are both kept as Artifact rows, so
 * nothing is lost by removing them. Called at both ends of a run — an isolated
 * run's worktree is thrown away anyway, but a single-ticket-mode run executes
 * directly in the developer's repo, where a leftover `.te/plan.md` sat in the
 * file tree forever and, worse, was still there when the *next* ticket's plan
 * phase started: the agent then read another ticket's plan before overwriting
 * it, paying tokens to work out that it was stale.
 */
export function clearRunArtifacts(cwd: string) {
  try {
    rmSync(path.join(cwd, ".te"), { recursive: true, force: true });
  } catch {
    /* a file lock or a read-only tree — leaving the folder is harmless */
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
// `implement` stops at a local commit and `publish` is a leaf. With the
// evaluator switched on (Setting.evaluateBeforePublish) two nodes occupy exactly
// that gap:
//
//   implement ─► evaluate ─► publish
//                  │  ▲  (pure, FRESH)
//                  ▼  │
//                 fix ─┘   (local, resume) — bounded at MAX_FIX_ATTEMPTS
//
// The cycle is between a `pure` node and a `local` one; `publish` stays a leaf,
// so the invariant that nothing external is ever re-entered still holds.

// How many times the fix node may run before the harness gives up. A bounded
// loop is the point: an unbounded evaluate/fix cycle spends real money arguing
// with itself, and a reviewer that still refuses after two attempts is telling
// us a human is needed.
const MAX_FIX_ATTEMPTS = 2;

function twoPhaseGraph(review: boolean, evaluate: boolean): Graph {
  const publishSchema = review ? REVIEW_PUBLISH_OUTPUT : PUBLISH_OUTPUT;

  const afterPlan: Edge = (_c, r) => {
    const bad = turnGuard(r);
    if (bad) return bad;
    // The agent's own answer to "did you write the plan". Trusted only to fail
    // fast: a `false` here is the node telling us it produced nothing, and there
    // is no point paying planCheck to confirm it. A `true` proves nothing, which
    // is exactly why planCheck still reads the file — trust the claim, verify the
    // artifact.
    if (r.data.planWritten === false) {
      return { to: FAIL, reason: "the plan phase reported that no plan was written" };
    }
    return { to: "planCheck", reason: "plan turn finished" };
  };

  return {
    id: `${review ? "fix-review-v3" : "implement-v3"}${evaluate ? "-eval" : ""}`,
    entry: "plan",
    nodes: {
      plan: {
        kind: "agent",
        id: "plan",
        label: "Draft plan",
        effects: "local", // writes only .te/plan.md
        context: "fresh",
        prompt: (c) => openingPrompt(c, "plan", { review }),
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
      // Present only when the evaluator is switched on. Splitting `implement`
      // from `publish` in B2 is what left room for these two: an evaluator can
      // only sit between a node that has committed and a node that has not yet
      // pushed.
      ...(evaluate
        ? {
            evaluate: {
              kind: "agent" as const,
              id: "evaluate",
              label: "Independent review",
              // Reads only. Safe to re-run, and safe to sit on a cycle.
              effects: "pure" as const,
              // The single most important field on this node. A reviewer that
              // resumed the implementer's session would inherit its conclusions
              // and confirm them; a fresh one has to look at the diff itself.
              context: "fresh" as const,
              prompt: evaluatePrompt,
              output: EVALUATE_OUTPUT as unknown as Record<string, unknown>,
            },
            fix: {
              kind: "agent" as const,
              id: "fix",
              label: "Fix review findings",
              effects: "local" as const,
              context: "resume" as const,
              prompt: fixPrompt,
              output: IMPLEMENT_OUTPUT as unknown as Record<string, unknown>,
            },
          }
        : {}),
      publish: {
        kind: "agent",
        id: "publish",
        label: review ? "Push & resolve threads" : "Push & open PR",
        // The one node that leaves this machine. Leaf by construction.
        effects: "external",
        // Asymmetric on purpose, and the asymmetry is load-bearing — see the two
        // prompt definitions. Opening a PR needs four facts the harness already
        // holds (branch, ticket, plan file, git log), so it runs `fresh` and skips
        // replaying a transcript it would never read: that replay was ~20% of a
        // run's cost. Answering review threads needs to know *which threads this
        // run addressed*, which lives nowhere but the session that addressed
        // them, so that one still resumes.
        context: review ? "resume" : "fresh",
        prompt: review ? () => REVIEW_PUBLISH_PROMPT : publishPrompt,
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
        return evaluate
          ? { to: "evaluate", reason: "committed, verification clear" }
          : { to: "publish", reason: "committed, verification clear" };
      },
      ...(evaluate
        ? {
            evaluate: ((_c, r) => {
              const bad = turnGuard(r);
              if (bad) return bad;
              if (r.data.verdict === "pass") return { to: "publish", reason: "review passed" };
              const blockers = Array.isArray(r.data.blockers) ? r.data.blockers.length : 0;
              // Bounded, and terminal when the bound is reached. Publishing over a
              // standing objection would make the review decorative; looping past
              // it would just spend more to hear the same answer.
              const attempts = _c.visits.fix ?? 0;
              if (attempts >= MAX_FIX_ATTEMPTS) {
                return { to: FAIL, reason: `review still blocking after ${attempts} fix attempt(s)` };
              }
              return { to: "fix", reason: `review found ${blockers} blocker(s)` };
            }) as Edge,
            // A fix is an implement attempt with a narrower brief, so it answers
            // the same contract and is held to the same verification bar — then
            // goes back to the reviewer rather than straight to publish.
            fix: ((_c, r) => {
              const bad = turnGuard(r);
              if (bad) return bad;
              const failed = verificationFailed(verificationOf(r.data));
              if (failed) return { to: FAIL, reason: failed };
              if (!r.data.committed) return { to: FAIL, reason: "the fix committed nothing" };
              return { to: "evaluate", reason: "fix committed, re-reviewing" };
            }) as Edge,
          }
        : {}),
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
//
// It still writes `.te/plan.md` first, and declares `artifact: "plan"` so drive()
// captures it when the node ends. That is a *record*, not a gate: nothing waits
// on it and nothing routes on it — the node keeps going in the same turn. It
// exists so the Plan tab can answer "what did the agent decide to do" for an
// auto run afterwards, which is otherwise only recoverable by reading the diff —
// and for the review flow, by reading replies scattered across someone else's
// pull request.
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
        // Only the implement flow opens a pull request here; the review flow
        // answers threads on one that already exists and is already published.
        prompt: (c) => openingPrompt(c, "", { opensPr: !review, review }),
        output: (review ? REVIEW_ONESHOT_OUTPUT : ONESHOT_OUTPUT) as unknown as Record<string, unknown>,
        // Both v2 skills write one — the implement flow plans its changes, the
        // review flow plans its thread decisions. Same file, same capture.
        artifact: "plan",
      },
    },
    edges: {
      deliver: (_c, r) => {
        const bad = turnGuard(r);
        if (bad) return bad;
        if (!r.data.pushed) return { to: FAIL, reason: "branch was not pushed" };
        // The one-shot flow cannot *block* on verification — implement and publish
        // happen inside the same turn, so by the time the harness sees this the PR
        // already exists. What it can do is refuse to call the run a success: the
        // run ends `failed`, the dashboard scores it as one, and the UI does not
        // advance the ticket to Code Review. Saying "succeeded" over a reported
        // test failure would make the contract's most important field decorative.
        //
        // The reason deliberately does NOT start with "verification." — that
        // prefix is what dashboardMetrics() counts as "stopped *before*
        // publishing", and this run was not stopped in time.
        const failed = verificationFailed(verificationOf(r.data));
        if (failed) return { to: FAIL, reason: `PR was opened but ${failed}` };
        if (!r.data.committed) return { to: FAIL, reason: "PR was opened but nothing was committed" };
        return { to: END, reason: "delivered" };
      },
    },
  };
}

// ---- resolution ----

const REVIEW_SKILLS = new Set(["fix-code-review-v2", "fix-code-review-v3"]);
const TWO_PHASE_SKILLS = new Set(["implement-ticket-v3", "fix-code-review-v3"]);

/** Options that change the *shape* of a run's graph, not just its content. Each
 *  one is encoded into the graph id so a run resumed after a restart is driven
 *  by the shape it actually started on. */
export type GraphOptions = {
  /** Insert the independent `evaluate` node (and its bounded `fix` loop) between
   *  `implement` and `publish`. Off by default: it costs roughly one extra
   *  review turn per run plus whatever the fixes cost, and whether that pays for
   *  itself is a question for the dashboard, not for a default. */
  evaluate?: boolean;
};

/** The graph a skill runs on. This replaces the old `isTwoPhaseSkill` boolean:
 *  the shape of a run is now a graph, not a flag read in three places. */
export function graphForSkill(skill: string, opts: GraphOptions = {}): Graph {
  const review = REVIEW_SKILLS.has(skill);
  // The evaluator only exists in the gated flow. The one-shot flow has already
  // published by the time any node could review it, so bolting a reviewer on
  // there would produce an opinion nobody can act on.
  return TWO_PHASE_SKILLS.has(skill) ? twoPhaseGraph(review, !!opts.evaluate) : oneShotGraph(review);
}

/** Resolve a graph by the id persisted on the Run, so a run parked before a
 *  restart resumes on the shape it started on even if the skill were remapped —
 *  or, now, even if the evaluator setting was flipped while it was parked. */
export function graphById(graphId: string, skill: string): Graph {
  switch (graphId) {
    case "implement-v3":
      return twoPhaseGraph(false, false);
    case "implement-v3-eval":
      return twoPhaseGraph(false, true);
    case "fix-review-v3":
      return twoPhaseGraph(true, false);
    case "fix-review-v3-eval":
      return twoPhaseGraph(true, true);
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
export function graphOutline(skill: string, opts: GraphOptions = {}): { id: string; label: string; effects: string }[] {
  const g = graphForSkill(skill, opts);
  return Object.values(g.nodes).map((n) => ({ id: n.id, label: n.label, effects: n.effects }));
}

export const KNOWN_SKILLS = [
  "implement-ticket-v2",
  "implement-ticket-v3",
  "fix-code-review-v2",
  "fix-code-review-v3",
];

/** Which flow family a skill belongs to — the half of the request the caller
 *  legitimately owns ("implement this ticket" vs "resolve this PR's threads"). */
function familyOf(skill: string): "implement" | "review" {
  return REVIEW_SKILLS.has(skill) ? "review" : "implement";
}

/** The skill a run actually executes, decided **server-side**.
 *
 *  A caller says which *family* it wants; the stored settings say whether that
 *  family runs one-shot (v2) or through the plan gate (v3). The client never
 *  gets to pick that on its own: the difference between the two is whether a
 *  human sees the plan before code is written, and a stale bundle or a
 *  hand-rolled request must not be able to decide it.
 *
 *  `explicit` is the one exception — a skill hand-picked on the ticket's
 *  Overview tab — and it is honoured verbatim, because that *is* a human
 *  decision, just an earlier one.
 *
 *  Returns null for a skill this engine does not know; that used to fall
 *  through to the one-shot graph in silence. */
export function resolveSkill(
  requested: string,
  explicit: boolean,
  modes: { autoImplement: boolean; autoResolveCodeReview: boolean }
): string | null {
  if (!KNOWN_SKILLS.includes(requested)) return null;
  if (explicit) return requested;
  const review = familyOf(requested) === "review";
  const auto = review ? modes.autoResolveCodeReview : modes.autoImplement;
  if (review) return auto ? "fix-code-review-v2" : "fix-code-review-v3";
  return auto ? "implement-ticket-v2" : "implement-ticket-v3";
}

/** A run context needs `prUrl` only for the review skills. */
export function isReviewSkill(skill: string): boolean {
  return REVIEW_SKILLS.has(skill);
}
