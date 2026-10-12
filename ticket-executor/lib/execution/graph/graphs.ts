import { execSync } from "child_process";
import { readFileSync, rmSync } from "fs";
import path from "path";
import { evaluatePrompt, fixPrompt, openingPrompt, publishPrompt, reflectPrompt, REVIEW_PUBLISH_PROMPT } from "./prompts";
import {
  blockedOf,
  EVALUATE_OUTPUT,
  PUBLISH_OUTPUT,
  QA_IMPLEMENT_OUTPUT,
  REFLECT_OUTPUT,
  REVIEW_PUBLISH_OUTPUT,
  STEP_OUTPUT,
  verificationFailed,
  verificationOf,
} from "./schemas";
import { END, FAIL, ZERO_USAGE, type Edge, type Graph, type NodeResult, type RunContext } from "./types";

// Where the implement phase leaves its plan record, relative to the run's
// worktree. The file is the agent's drafting surface; the durable copy is an
// Artifact row.
export const PLAN_FILE = path.join(".te", "plan.md");

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
 * These files are one run's drafting surface, not project files: the plan
 * record is kept as an Artifact row, so nothing is lost by removing them.
 * Called at both ends of a run — an isolated run's worktree is thrown away
 * anyway, but a single-ticket-mode run executes directly in the developer's
 * repo, where a leftover `.te/plan.md` sat in the file tree forever and, worse,
 * was still there when the *next* ticket started: the agent then read another
 * ticket's plan before overwriting it, paying tokens to work out that it was
 * stale.
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

// ---- test gate ----

const TEST_PATH = /(^|\/)(tests?|__tests__|specs?)\/|[._-](spec|test|tests)\.[^/]+$|Tests?\.cs$|_test\.go$|(^|\/)test_[^/]+\.py$/i;

export function isTestPath(p: string): boolean {
  return TEST_PATH.test(p.replace(/\\/g, "/"));
}

export function testGap(changed: string[], exemption: string): string {
  const files = changed.filter((p) => !p.startsWith(".te/"));
  if (!files.length) return "The branch has no committed change against the base commit.";
  if (files.some(isTestPath) || exemption.trim()) return "";
  return "The change adds or updates no test and gives no reason in `testExemption`.";
}

function changedFiles(cwd: string, baseSha: string): string[] {
  return execSync(`git -C "${cwd}" diff --name-only "${baseSha}" HEAD`, { encoding: "utf8" })
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

// ---- the loop graph ----

// One shape for every flow. Nobody approves a plan: the run is judged on the
// finished diff instead, first by code (the test gate) and then by a reviewer
// that has never seen the implementer's reasoning.
//
// implement ─► check ─► evaluate ─► publish ─► END
//   (local)    (pure)   (pure, FRESH)  (external)
//                │  ▲      │
//                ▼  │      ▼
//                fix ◄─────┘   (local, resume) — bounded at MAX_FIX_ATTEMPTS
//
// Every cycle is between `pure` and `local` nodes; `publish` stays a leaf, so
// nothing that leaves the machine is ever re-entered.

// How many times the fix node may run before the harness gives up. A bounded
// loop is the point: an unbounded check/review/fix cycle spends real money
// arguing with itself, and a refusal that stands after two attempts is telling
// us a human is needed.
const MAX_FIX_ATTEMPTS = 2;

export type Flow = "implement" | "review" | "qa";

const FLOWS: Record<Flow, { id: string; legacyId: string; skill: string; label: string; evaluateMode: string }> = {
  implement: { id: "implement-v5", legacyId: "implement-v4", skill: "implement-ticket-v4", label: "Implement changes", evaluateMode: "" },
  review: { id: "fix-review-v5", legacyId: "fix-review-v4", skill: "fix-code-review-v4", label: "Resolve review threads", evaluateMode: "review-fix" },
  qa: { id: "fix-qa-v5", legacyId: "fix-qa-v4", skill: "fix-qa-v4", label: "Review QA findings & fix", evaluateMode: "qa-fix" },
};

function standingRefusal(c: RunContext): string {
  const check = c.channels.check;
  if (check && check.passed === false) {
    const issue = String((check.blockers as { issue?: string }[] | undefined)?.[0]?.issue ?? "test gate failed");
    return `test gate: ${issue}`;
  }
  const blockers = Array.isArray(c.channels.evaluate?.blockers) ? c.channels.evaluate.blockers.length : 0;
  return `review found ${blockers} blocker(s)`;
}

function loopGraph(flow: Flow, reflect: boolean): Graph {
  const { label, evaluateMode } = FLOWS[flow];
  const id = reflect ? FLOWS[flow].id : FLOWS[flow].legacyId;
  const review = flow === "review";

  const fixBound = (c: RunContext, why: string) => {
    const attempts = c.visits.fix ?? 0;
    if (attempts >= MAX_FIX_ATTEMPTS) return { to: reflect ? "reflect" : FAIL, reason: `${why} after ${attempts} fix attempt(s)` };
    return { to: "fix", reason: why };
  };
  const committedLocally: Edge = (_c, r) => {
    const bad = turnGuard(r);
    if (bad) return bad;
    const failed = verificationFailed(verificationOf(r.data));
    if (failed) return { to: FAIL, reason: failed };
    if (!r.data.committed) return { to: FAIL, reason: "nothing was committed" };
    return { to: "check", reason: "committed, verification clear" };
  };

  return {
    id,
    entry: "implement",
    nodes: {
      implement: {
        kind: "agent",
        id: "implement",
        label,
        // Local: source edits and a local commit. Undone by discarding the
        // worktree/branch, so re-entering this node costs nothing outside.
        effects: "local",
        context: "fresh",
        prompt: (c) => openingPrompt(c, "implement", { review }),
        output: (flow === "qa" ? QA_IMPLEMENT_OUTPUT : STEP_OUTPUT) as unknown as Record<string, unknown>,
        // A record, not a gate: nothing waits on it. It is how the Plan tab
        // answers "what did the agent decide to do", and what publish builds
        // the PR description (or, for a review, the replies) from.
        artifact: "plan",
      },
      check: {
        kind: "check",
        id: "check",
        label: "Check tests",
        effects: "pure",
        run: async (c) => {
          const exemption = String((c.channels.fix ?? c.channels.implement)?.testExemption ?? "");
          let gap: string;
          try {
            gap = testGap(changedFiles(c.cwd, c.baseSha), exemption);
          } catch (e) {
            return { ok: false, data: {}, error: `could not diff the branch: ${(e as Error).message}`, usage: ZERO_USAGE };
          }
          return {
            ok: true,
            data: { passed: !gap, blockers: gap ? [{ file: "", issue: gap }] : [] },
            error: "",
            usage: ZERO_USAGE,
          };
        },
      },
      evaluate: {
        kind: "agent",
        id: "evaluate",
        label: "Independent review",
        // Reads only. Safe to re-run, and safe to sit on a cycle.
        effects: "pure",
        // The single most important field on this node. A reviewer that
        // resumed the implementer's session would inherit its conclusions and
        // confirm them; a fresh one has to look at the diff itself.
        context: "fresh",
        prompt: (c) => evaluatePrompt(c, evaluateMode),
        output: EVALUATE_OUTPUT as unknown as Record<string, unknown>,
      },
      fix: {
        kind: "agent",
        id: "fix",
        label: "Fix review findings",
        effects: "local",
        context: "resume",
        prompt: fixPrompt,
        output: STEP_OUTPUT as unknown as Record<string, unknown>,
      },
      publish: {
        kind: "agent",
        id: "publish",
        label: review ? "Push & answer threads" : "Push & open PR",
        // The one node that leaves this machine. Leaf by construction.
        effects: "external",
        // Asymmetric on purpose. Opening a PR needs facts the harness already
        // holds (branch, ticket, plan file, git log), so it runs `fresh` and
        // skips replaying a transcript it would never read. Answering review
        // threads needs to know what was done about each, which lives in the
        // session that did it, so that one resumes.
        context: review ? "resume" : "fresh",
        prompt: review ? () => REVIEW_PUBLISH_PROMPT : publishPrompt,
        output: (review ? REVIEW_PUBLISH_OUTPUT : PUBLISH_OUTPUT) as unknown as Record<string, unknown>,
      },
      ...(reflect && {
        reflect: {
          kind: "agent" as const,
          id: "reflect",
          label: "Record lesson",
          effects: "local" as const,
          context: "resume" as const,
          prompt: reflectPrompt,
          output: REFLECT_OUTPUT as unknown as Record<string, unknown>,
        },
      }),
    },
    edges: {
      implement: (c, r) => {
        if (flow === "qa" && r.data.outcome === "no-fix-needed") {
          const bad = turnGuard(r);
          if (bad) return bad;
          if (r.data.committed) return { to: FAIL, reason: "reported no fix needed but changed the repository" };
          if (!String(r.data.qaReply ?? "").trim()) return { to: FAIL, reason: "reported no fix needed without a reply to QA" };
          return { to: END, reason: "no-fix-needed" };
        }
        // Every thread may legitimately be answered without a code change.
        // There is no diff to gate or review then, only replies to send.
        if (review && r.ok && !blockedOf(r.data).is && !r.data.committed) {
          return { to: "publish", reason: "no thread needs a code change — replies only" };
        }
        return committedLocally(c, r);
      },
      check: (c, r) => {
        if (!r.ok) return { to: FAIL, reason: r.error || "check failed" };
        if (r.data.passed) return { to: "evaluate", reason: "test gate passed" };
        const issue = String((r.data.blockers as { issue?: string }[] | undefined)?.[0]?.issue ?? "test gate failed");
        return fixBound(c, `test gate: ${issue}`);
      },
      evaluate: (c, r) => {
        const bad = turnGuard(r);
        if (bad) return bad;
        if (r.data.verdict === "pass") return { to: "publish", reason: "review passed" };
        const blockers = Array.isArray(r.data.blockers) ? r.data.blockers.length : 0;
        // Bounded, and terminal when the bound is reached. Publishing over a
        // standing objection would make the review decorative.
        return fixBound(c, `review found ${blockers} blocker(s)`);
      },
      // A fix is an implement attempt with a narrower brief, so it answers the
      // same contract, is held to the same verification bar, and goes back
      // through the test gate rather than straight to the reviewer.
      fix: (c, r) => {
        const next = committedLocally(c, r);
        return next.to === "check" ? { to: "check", reason: "fix committed, re-checking" } : next;
      },
      publish: (c, r) => {
        const bad = turnGuard(r);
        if (bad) return bad;
        // Only a reply-only review has nothing to push.
        const committed = !!(c.channels.fix?.committed || c.channels.implement?.committed);
        if ((!review || committed) && !r.data.pushed) return { to: FAIL, reason: "branch was not pushed" };
        return { to: END, reason: r.data.reusedExisting ? "published (reused existing PR)" : "published" };
      },
      ...(reflect && {
        reflect: (c: RunContext) => ({ to: FAIL, reason: `${standingRefusal(c)} after ${c.visits.fix ?? 0} fix attempt(s)` }),
      }),
    },
  };
}

// ---- resolution ----

export const QA_FIX_SKILL = FLOWS.qa.skill;
export const REVIEW_FIX_SKILL = FLOWS.review.skill;
export const IMPLEMENT_SKILL = FLOWS.implement.skill;

export const KNOWN_SKILLS = [IMPLEMENT_SKILL, REVIEW_FIX_SKILL, QA_FIX_SKILL];

function flowOfSkill(skill: string): Flow | null {
  return (Object.keys(FLOWS) as Flow[]).find((f) => FLOWS[f].skill === skill) ?? null;
}

/** The graph a skill runs on, or null for a skill this engine does not run. */
export function graphForSkill(skill: string): Graph | null {
  const flow = flowOfSkill(skill);
  return flow ? loopGraph(flow, true) : null;
}

/** A retired graph id (the one-shot and plan-gated shapes) maps to its flow by
 *  prefix — such a run is finished, so nothing routes on it any more. */
function flowOfGraphId(graphId: string): Flow {
  if (graphId.startsWith("fix-review")) return "review";
  if (graphId.startsWith("fix-qa")) return "qa";
  return "implement";
}

/** Resolve a graph by the id persisted on the Run, so a run resumed after a
 *  restart is driven by the shape it started on. */
export function graphById(graphId: string): Graph {
  const flow = flowOfGraphId(graphId);
  return loopGraph(flow, graphId === FLOWS[flow].id);
}

/** The skill a graph id runs, for a row that never recorded its skill. */
export function skillOfGraph(graphId: string): string {
  return FLOWS[flowOfGraphId(graphId)].skill;
}

/** The progress list for a skill: node ids + labels, in declaration order.
 *  The UI renders this instead of a hand-maintained STEPS array, so adding a
 *  node to a graph adds a step to the UI with no second place to update. */
export function graphOutline(skill: string): { id: string; label: string; effects: string }[] {
  const g = graphForSkill(skill);
  return g ? Object.values(g.nodes).map((n) => ({ id: n.id, label: n.label, effects: n.effects })) : [];
}

/** The skill a run executes, decided **server-side**: one per flow, so the
 *  only thing left to decide is whether the engine runs the one asked for.
 *  Returns null for a skill this engine does not know; that used to fall
 *  through to a default graph in silence. */
export function resolveSkill(requested: string): string | null {
  return KNOWN_SKILLS.includes(requested) ? requested : null;
}
