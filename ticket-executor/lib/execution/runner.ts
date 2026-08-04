import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { prisma } from "../prisma";
import type { LogLine, RunState } from "../types";
import { cleanPath } from "./format";
import { cancel, drive, finish, resolveGate, type GateAction } from "./graph/drive";
import { FEEDBACK_FILE, graphById, graphForSkill, PLAN_FILE } from "./graph/graphs";
import { latestArtifact, saveArtifact, saveRun } from "./graph/persist";
import type { LiveRun } from "./graph/types";
import { store } from "./store";

export type { GateAction };

// ---- repo hygiene ----

// The run writes two things into the developer's repo that must never reach a
// commit: the plan-gate contract (`.te/`) and the isolated worktrees
// (`.te-worktrees/`). Ignoring them is done here rather than left to the skill:
// an agent that forgets commits the plan, and a stale worktree left by a crashed
// run would otherwise show up as untracked noise in every later diff.
// `.git/info/exclude` (not `.gitignore`) because that file is the project's own
// tracked file — the app has no business editing it.
const TE_EXCLUDES = ["/.te/", "/.te-worktrees/"];

function excludeTeArtifacts(rootRepo: string) {
  try {
    const common = execSync(`git -C "${rootRepo}" rev-parse --path-format=absolute --git-common-dir`)
      .toString()
      .trim();
    if (!common) return;
    const file = path.join(common, "info", "exclude");
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    const lines = current.split(/\r?\n/).map((l) => l.trim());
    const missing = TE_EXCLUDES.filter((p) => !lines.includes(p));
    if (!missing.length) return;
    mkdirSync(path.dirname(file), { recursive: true });
    const prefix = current && !current.endsWith("\n") ? "\n" : "";
    writeFileSync(file, `${current}${prefix}# Ticket Executor run artifacts\n${missing.join("\n")}\n`, "utf8");
  } catch {
    /* not a git repo, or read-only .git — the skill's own exclude rule still applies */
  }
}

function writeWorktreeFile(cwd: string, rel: string, body: string) {
  mkdirSync(path.join(cwd, path.dirname(rel)), { recursive: true });
  writeFileSync(path.join(cwd, rel), body, "utf8");
}

// ---- start ----

export async function startRun(params: {
  ticketId: string;
  ticketUrl?: string;
  skill: string;
  project: string;
  rootRepo: string;
  prUrl?: string;
  provider?: string;
  model?: string;
  effort?: string;
  /** The team's estimate for this ticket in hours (0 = never sized). */
  estimateHours?: number;
  /** Ceiling for the whole run in USD; 0 leaves only the per-node ceilings. */
  budgetUsd?: number;
  // true (default) → isolate the run in its own git worktree, so it can run
  // concurrently with other tickets. false (single-ticket mode) → run directly
  // in rootRepo; the caller guarantees no other run is in flight.
  isolate?: boolean;
}): Promise<string> {
  const ticketId = cleanPath(params.ticketId);
  const skill = cleanPath(params.skill);
  const project = cleanPath(params.project);
  const rootRepo = cleanPath(params.rootRepo);
  const provider = cleanPath(params.provider || "azure-devops");
  const isolate = params.isolate ?? true;
  const graph = graphForSkill(skill);

  const row = await prisma.run.create({
    data: {
      ticketId,
      ticketUrl: params.ticketUrl ? cleanPath(params.ticketUrl) : "",
      provider,
      project,
      rootRepo,
      worktreePath: rootRepo,
      graphId: graph.id,
      skill,
      state: "running",
      currentNodeId: graph.entry,
      model: params.model ? cleanPath(params.model) : "",
      effort: params.effort ? cleanPath(params.effort) : "",
      estimateHours: Number.isFinite(params.estimateHours) ? Math.max(0, params.estimateHours!) : 0,
      budgetUsd: Number.isFinite(params.budgetUsd) ? Math.max(0, params.budgetUsd!) : 0,
    },
  });

  const live: LiveRun = {
    id: row.id,
    graphId: graph.id,
    ctx: {
      runId: row.id,
      ticketId,
      ticketUrl: row.ticketUrl,
      provider,
      project,
      prUrl: params.prUrl ? cleanPath(params.prUrl) : "",
      skill,
      rootRepo,
      cwd: rootRepo,
      baseSha: "",
      channels: {},
      visits: {},
    },
    state: "running",
    currentNodeId: graph.entry,
    sessionId: "",
    model: row.model,
    effort: row.effort,
    isolate,
    child: null,
    cancelled: false,
    logLines: [],
    mcpConfigPath: "",
    parkedAt: null,
    humanWaitMs: 0,
    startedAt: row.startedAt.getTime(),
    endedAt: null,
    seq: 0,
    spentUsd: 0,
    budgetUsd: row.budgetUsd,
    resumedAfterRestart: false,
    errorMessage: "",
    endReason: "",
    prUrl: "",
    branch: "",
    resultText: "",
  };
  store.set(row.id, live);

  if (!existsSync(rootRepo)) {
    await finish(live, "failed", `Project folder not found: ${rootRepo}. Set the correct Root repo on the Overview tab.`);
    return row.id;
  }

  excludeTeArtifacts(rootRepo);

  try {
    live.ctx.baseSha = execSync(`git -C "${rootRepo}" rev-parse HEAD`).toString().trim();
  } catch {
    /* not a git repo, or no commits yet — the run's diff will just be empty */
  }

  if (isolate) {
    // Isolate the run in a fresh git worktree so concurrent runs against the same
    // rootRepo never share one working tree, git index or HEAD (which would let
    // one run's uncommitted changes leak into another's commit). Checked out
    // detached — the skill's own "create a branch" step creates the one real
    // branch, from inside this worktree.
    try {
      const wt = path.join(rootRepo, ".te-worktrees", `${project}-${row.id}`);
      execSync(`git -C "${rootRepo}" worktree add --detach "${wt}" HEAD`, { stdio: "ignore" });
      live.ctx.cwd = wt;
      live.logLines.push({ text: `● Isolated worktree ${wt}`, kind: "step" });
    } catch (e) {
      await finish(
        live,
        "failed",
        `Failed to set up isolated git worktree: ${e instanceof Error ? e.message : e}. Concurrent runs require worktree isolation to avoid commit leakage between tickets.`
      );
      return row.id;
    }
  }

  await saveRun(live);
  // Fire-and-forget: the route returns immediately and the walk continues in the
  // background until it ends or parks at a gate.
  void drive(live, graph, graph.entry);
  return row.id;
}

// ---- rehydration ----

/** Rebuild a usable LiveRun from its rows. The in-process map is process-local:
 *  a run parked at a gate can outlive a dev-server restart, and its approval
 *  still has to work. */
export async function rehydrate(id: string): Promise<LiveRun | null> {
  const row = await prisma.run.findUnique({
    where: { id },
    include: { steps: { orderBy: { startedAt: "asc" } } },
  });
  if (!row) return null;

  const logLines: LogLine[] = [];
  for (const s of row.steps) {
    const ls = Array.isArray(s.logLines) ? (s.logLines as unknown as LogLine[]) : [];
    logLines.push(...ls);
  }
  const spentUsd = row.steps.reduce((a, s) => a + s.costUsd, 0);
  const seq = await prisma.transition.count({ where: { runId: id } });

  const live: LiveRun = {
    id: row.id,
    graphId: row.graphId,
    ctx: {
      runId: row.id,
      ticketId: row.ticketId,
      ticketUrl: row.ticketUrl,
      provider: row.provider,
      project: row.project,
      // Only the first turn addresses the PR by URL; a rehydrated run only ever
      // resumes with a Mode: prompt, so it is not needed again.
      prUrl: "",
      skill: row.skill || skillOfGraph(row.graphId),
      rootRepo: row.rootRepo,
      cwd: row.worktreePath || row.rootRepo,
      baseSha: row.baseSha,
      channels: (row.channels as Record<string, Record<string, unknown>>) ?? {},
      visits: {},
    },
    state: row.state as RunState,
    currentNodeId: row.currentNodeId,
    sessionId: row.sessionId,
    model: row.model,
    effort: row.effort,
    isolate: row.worktreePath !== row.rootRepo,
    child: null,
    cancelled: false,
    logLines,
    mcpConfigPath: "",
    parkedAt: row.parkedAt ? row.parkedAt.getTime() : null,
    humanWaitMs: row.humanWaitMs,
    startedAt: row.startedAt.getTime(),
    endedAt: row.endedAt ? row.endedAt.getTime() : null,
    seq,
    spentUsd,
    budgetUsd: row.budgetUsd,
    // This rebuild IS the recovery — the in-process entry was gone.
    resumedAfterRestart: true,
    errorMessage: row.errorMessage,
    endReason: row.endReason as LiveRun["endReason"],
    prUrl: row.prUrl,
    branch: row.branch,
    resultText: row.resultText,
  };
  store.set(id, live);
  return live;
}

/** The skill a graph id came from. The graph is what actually drives the run;
 *  the skill name only reappears in the prompt, and every graph maps to exactly
 *  one skill. */
function skillOfGraph(graphId: string): string {
  switch (graphId) {
    case "implement-v3":
      return "implement-ticket-v3";
    case "fix-review-v3":
      return "fix-code-review-v3";
    case "fix-review-v2":
      return "fix-code-review-v2";
    default:
      return "implement-ticket-v2";
  }
}

async function liveOf(id: string): Promise<LiveRun | null> {
  return store.get(id) ?? (await rehydrate(id));
}

// ---- gate resolution ----

/** Resolve a run parked at the plan gate. `plan` carries the reviewer's (possibly
 *  edited) markdown, which is written back to .te/plan.md *and* stored as a new
 *  human-authored Artifact version before the walk resumes — so what the agent
 *  proposed and what the human approved both survive. */
export async function resolvePlan(
  id: string,
  action: GateAction,
  opts?: { plan?: string; feedback?: string }
): Promise<{ ok: true } | { ok: false; error: string; code: number }> {
  const live = await liveOf(id);
  if (!live) return { ok: false, error: "Run not found", code: 404 };
  if (live.state !== "waiting") return { ok: false, error: `Run is not awaiting review (state: ${live.state})`, code: 409 };

  const graph = graphById(live.graphId, live.ctx.skill);
  const node = graph.nodes[live.currentNodeId];
  if (!node || node.kind !== "gate") {
    return { ok: false, error: `Run is parked on "${live.currentNodeId}", which is not a gate`, code: 409 };
  }
  if (action !== "cancel" && !live.sessionId) {
    return { ok: false, error: "This run has no Claude session to resume", code: 409 };
  }

  const edited = (opts?.plan ?? "").trim();
  if (edited) {
    const current = await latestArtifact(id, "plan");
    if (!current || current.body !== edited) {
      try {
        writeWorktreeFile(live.ctx.cwd, PLAN_FILE, edited);
      } catch (e) {
        return { ok: false, error: `Failed to write the edited plan: ${e instanceof Error ? e.message : e}`, code: 500 };
      }
      await saveArtifact(id, "plan", edited, "human");
      live.logLines.push({ text: "✎ Plan edited by reviewer", kind: "file" });
    }
  }

  if (action === "revise") {
    const feedback = (opts?.feedback ?? "").trim();
    if (!feedback) return { ok: false, error: "Feedback is required to request changes", code: 400 };
    try {
      writeWorktreeFile(live.ctx.cwd, FEEDBACK_FILE, feedback);
    } catch (e) {
      return { ok: false, error: `Failed to write feedback: ${e instanceof Error ? e.message : e}`, code: 500 };
    }
    await saveArtifact(id, "feedback", feedback, "human");
  }

  await resolveGate(live, graph, action);
  return { ok: true };
}

// ---- cancellation ----

export async function cancelRun(id: string): Promise<boolean> {
  const live = await liveOf(id);
  if (!live) return false;
  return cancel(live);
}

// ---- crash recovery ----

// Steps left `running` when the process died. What may be done with one is
// decided purely by its effect class, which is why that class is copied onto the
// Step row rather than resolved from the graph here:
//   pure     — nothing escaped; just re-run it.
//   local    — the worktree may be half-written, but nothing left the machine.
//              Resuming the same session is safe and cheap.
//   external — we cannot know whether the push or the PR landed before the crash.
//              Guessing is how duplicate PRs happen, so the run stops and waits
//              for a human.
let sweepDone = false;

export async function recoverInterruptedRuns(): Promise<number> {
  if (sweepDone) return 0;
  sweepDone = true;

  const stale = await prisma.run.findMany({
    where: { state: "running" },
    include: { steps: { where: { status: "running" }, orderBy: { startedAt: "desc" } } },
  });
  let recovered = 0;

  for (const row of stale) {
    if (store.has(row.id)) continue; // this process owns it — not stale
    const open = row.steps[0];
    const live = await rehydrate(row.id);
    if (!live) continue;

    if (open) {
      await prisma.step.update({
        where: { id: open.id },
        data: { status: "abandoned", claimedAt: null, endedAt: new Date(), errorMessage: "Interrupted by a server restart" },
      });
    }

    if (open?.effects === "external") {
      live.state = "waiting";
      live.endReason = "needs-review";
      live.errorMessage =
        `The server restarted while "${open.label}" was publishing. It may or may not have pushed or opened the PR — ` +
        `check the branch and the tracker, then retry or discard this run.`;
      live.logLines.push({ text: `⏸ ${live.errorMessage}`, kind: "err" });
      await saveRun(live);
      continue;
    }

    const graph = graphById(live.graphId, live.ctx.skill);
    const resumeFrom = open?.nodeId || live.currentNodeId || graph.entry;
    live.logLines.push({ text: `↻ Resuming "${resumeFrom}" after a server restart`, kind: "step" });
    void drive(live, graph, resumeFrom);
    recovered += 1;
  }
  return recovered;
}
