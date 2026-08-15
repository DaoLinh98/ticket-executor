import { execSync } from "child_process";
import { prisma } from "../../prisma";
import type { EndReason } from "../../types";
import { fmtDuration } from "../format";
import { collectFileChanges, summarizeChanges } from "../git";
import { execNode, releaseMcp } from "./exec";
import { recordLessons } from "../knowledgeStore";
import { closeStep, openStep, saveArtifact, saveRun, saveTransition } from "./persist";
import { clearRunArtifacts, isReviewSkill, readPlanFile } from "./graphs";
import { END, FAIL, type Graph, type LiveRun, type NodeResult, type Target } from "./types";

// A backstop, not a policy. Cycles are legitimate (revise the plan, fix what an
// evaluator found), but a graph that has moved 40 times is looping, and a runaway
// loop spends real money. This is the *only* automatic stop left in the harness —
// the USD ceilings it used to sit beside were removed deliberately — so it catches
// the one failure nobody can catch by hand: a routing bug that re-enters a node
// forever. Human-driven cycles never come near it (three hops per plan revision).
const MAX_HOPS = 40;

// Recorded as a Transition's `toNode` when a run is stopped by a person. It is
// deliberately not part of the Target union: no edge may return it, because a
// cancellation is not a routing decision the graph made — it is one imposed on
// it. It exists so the Transition history still answers "why did this run leave
// the node it was on", which for a cancelled run it previously could not.
const CANCELLED = "CANCELLED";

// ---- termination ----

// A finished isolated run no longer needs its worktree: the diff is captured as
// an Artifact, and the branch/commits/PR it created live in the real repo, so
// removing the worktree never loses them. Best-effort — a lingering file lock on
// Windows can block removal, and leaving the folder is harmless. Never touches
// rootRepo (a non-isolated run executed there).
function removeWorktree(live: LiveRun) {
  const { cwd, rootRepo } = live.ctx;
  if (!cwd || !rootRepo || cwd === rootRepo) return;
  try {
    execSync(`git -C "${rootRepo}" worktree remove --force "${cwd}"`, { stdio: "ignore" });
  } catch {
    /* leave the worktree if git can't remove it right now */
  }
}

/** Capture what the run changed, as a diff Artifact plus the scalar summary the
 *  dashboard aggregates on. Pure code, zero tokens — the agent is never asked to
 *  describe its own diff. */
async function captureDiff(live: LiveRun) {
  if (!live.ctx.baseSha) return;
  const files = collectFileChanges(live.ctx.cwd, live.ctx.baseSha);
  if (!files.length) return;
  await saveArtifact(live.id, "diff", JSON.stringify(files), "agent");
  const sum = summarizeChanges(files);
  await prisma.run.update({ where: { id: live.id }, data: sum });
}

/** Stop a run because a person asked, leaving the audit trail intact. Every
 *  other way out of a node writes a Transition; a cancel used to write none, so
 *  the history simply stopped mid-node with no record of why. */
async function abort(live: LiveRun, nodeId: string) {
  try {
    if (nodeId) await saveTransition(live, nodeId, CANCELLED, "cancelled by user");
  } catch {
    /* the run is ending anyway — never let the audit write block the stop */
  }
  await finish(live, "cancelled", "Cancelled by user", "cancelled");
}

export async function finish(live: LiveRun, state: "succeeded" | "failed" | "cancelled", error: string, endReason: EndReason = "") {
  live.state = state;
  live.errorMessage = error;
  live.endReason = endReason;
  live.endedAt = Date.now();
  // A run killed while parked never resumes, so fold its outstanding wait in here
  // rather than losing it.
  if (live.parkedAt) {
    live.humanWaitMs += Math.max(0, Date.now() - live.parkedAt);
    live.parkedAt = null;
  }
  live.logLines.push(
    state === "succeeded"
      ? { text: `✔ Completed in ${fmtDuration(live.endedAt - live.startedAt)}`, kind: "done" }
      : { text: `✖ ${error || "Run failed"}`, kind: "fail" }
  );
  try {
    await captureDiff(live);
  } catch {
    /* the diff is a convenience; never fail a finished run over it */
  }
  await saveRun(live);
  // Order matters: the diff above is captured from the worktree, and `.te/` is
  // excluded from git anyway, so clearing the run's scratch files is the last
  // thing done to the tree before it is (for isolated runs) removed entirely.
  clearRunArtifacts(live.ctx.cwd);
  removeWorktree(live);
  releaseMcp(live);
}

/** Park at a gate: no child process is alive, and the run waits for
 *  resolveGate() to supply the human's decision. */
async function park(live: LiveRun, nodeId: string, artifactKind: string) {
  live.state = "waiting";
  live.currentNodeId = nodeId;
  live.parkedAt = Date.now();
  if (artifactKind === "plan") {
    const plan = readPlanFile(live.ctx.cwd);
    if (plan) await saveArtifact(live.id, "plan", plan, "agent");
  }
  live.logLines.push({ text: "⏸ Waiting for your review", kind: "step" });
  await saveRun(live);
}

/** Lift the handful of contract fields that have consumers outside the run's own
 *  routing onto the Run row. Only ever *set* by a node that reported one — a
 *  later node that says nothing about the branch must not blank it. */
function promoteContractFields(live: LiveRun, data: Record<string, unknown>) {
  if (typeof data.branch === "string" && data.branch) live.branch = data.branch;
  if (typeof data.prUrl === "string" && data.prUrl) live.prUrl = data.prUrl;
  // `resultText` is what the Result tab shows as "what this run did", so it must
  // come from the node that produced the deliverable — not from whichever node
  // happened to report a `summary` last. The plan nodes also carry one, and a run
  // that failed at `implement` used to end up displaying the *plan's* summary as
  // its result. Keyed off `committed` rather than a hard-coded list of node ids:
  // that field is exactly what distinguishes the delivering contracts
  // (IMPLEMENT_OUTPUT / ONESHOT_OUTPUT) from the planning one.
  const delivers = typeof data.committed === "boolean";
  if (delivers && typeof data.summary === "string" && data.summary) live.resultText = data.summary;
}

/** Bank whatever this node learned about the repository (lib/execution/knowledge.ts).
 *
 *  Unlike every other write in drive(), a failure here is swallowed — and that
 *  is not the old "persist() swallows everything" habit coming back. The rule
 *  above is that Postgres is the source of truth *between nodes*: a lost channel
 *  or transition means the run continues on a history that never happened.
 *  A lesson is between *runs* and nothing routes on it, so losing one costs the
 *  next ticket some tokens and nothing else. Failing a committed run over a note
 *  would be the more expensive mistake.
 *
 *  Only a node that failed is skipped: a turn that errored out did not learn
 *  anything about the repo, it learned something about itself. */
async function harvestLessons(live: LiveRun, nodeId: string, r: NodeResult) {
  if (!r.ok) return;
  try {
    const scope = isReviewSkill(live.ctx.skill) ? "review" : "implement";
    const n = await recordLessons(live.ctx.rootRepo, live.id, scope, r.data);
    if (n) live.logLines.push({ text: `● ${nodeId}: recorded ${n} repo lesson(s)`, kind: "step" });
  } catch {
    /* knowledge is an optimisation for the next run, never this run's business */
  }
}

// ---- the driver ----

/** Walk the graph from `from` until it parks, ends, or fails.
 *
 *  This one loop replaces the two near-identical post-turn dispatchers the old
 *  runner carried (one in startExecution, one in resolvePlan). Adding a node no
 *  longer means copy-pasting a third. */
export async function drive(live: LiveRun, graph: Graph, from: Target) {
  let target: Target = from;
  // The reason recorded on the edge that sent this run to FAIL. Kept here rather
  // than dug back out of the log afterwards: the harness already owns this value
  // at the moment it decides, and re-deriving it with a regex over its own log
  // was the last surviving copy of the "guess the state" anti-pattern the graph
  // runtime exists to remove.
  let failReason = "";

  try {
    while (target !== END && target !== FAIL) {
      // Counted on the run, not on this call: drive() is re-entered every time a
      // gate is resolved and every time a crashed run is recovered, so a local
      // counter would reset on exactly the paths a runaway loop travels.
      if (++live.hops > MAX_HOPS) {
        await finish(live, "failed", `Graph exceeded ${MAX_HOPS} transitions — it is looping.`, "hop-limit");
        return;
      }
      const node = graph.nodes[target];
      if (!node) {
        await finish(live, "failed", `Graph ${graph.id} has no node "${target}"`);
        return;
      }
      if (live.cancelled) {
        await abort(live, node.id);
        return;
      }
      live.currentNodeId = node.id;
      live.ctx.visits[node.id] = (live.ctx.visits[node.id] ?? 0) + 1;

      if (node.kind === "gate") {
        await park(live, node.id, node.artifact);
        return; // resolveGate() re-enters drive() with the human's decision
      }

      live.state = "running";
      await saveRun(live);
      const step = await openStep(live, node);
      const t0 = Date.now();
      const result = await execNode(live, node);
      const logs = live.logLines.slice(step.logStart);
      await closeStep(step.id, result.ok ? "succeeded" : "failed", result, logs, Date.now() - t0);

      if (live.cancelled) {
        await abort(live, node.id);
        return;
      }

      // The reducer: a node writes only its own channel, never another's.
      live.ctx.channels[node.id] = result.data;
      promoteContractFields(live, result.data);
      await harvestLessons(live, node.id, result);

      const edge = graph.edges[node.id];
      if (!edge) {
        await finish(live, "failed", `Graph ${graph.id} has no edge out of "${node.id}"`);
        return;
      }
      const next = edge(live.ctx, result);
      if (next.to === FAIL) failReason = next.reason;
      await saveTransition(live, node.id, next.to, next.reason);
      target = next.to;
      await saveRun(live);
    }

    if (target === END) await finish(live, "succeeded", "");
    else await finish(live, "failed", failReason || "Run failed");
  } catch (e) {
    // A persistence failure lands here. The old engine swallowed those because
    // memory was the source of truth; with a graph, Postgres is, so a lost write
    // must stop the run loudly rather than let it continue on a history that no
    // longer matches reality.
    const detail = e instanceof Error ? e.message : String(e);
    live.logLines.push({ text: `✖ Harness error: ${detail}`, kind: "err" });
    try {
      await finish(live, "failed", `Harness error: ${detail}`);
    } catch {
      // Even finishing failed — drop the live entry so nothing polls a run that
      // can no longer be written to.
      live.state = "failed";
      live.errorMessage = detail;
      live.endedAt = Date.now();
      releaseMcp(live);
    }
  }
}

// ---- gate resolution ----

export type GateAction = "approve" | "revise" | "cancel";

/** Feed a human decision into the parked gate node and resume the walk. The
 *  decision travels as that node's NodeResult, so the gate's own edge routes it
 *  exactly like any other node's output — there is no special-case branch. */
export async function resolveGate(
  live: LiveRun,
  graph: Graph,
  action: GateAction,
  extra: Record<string, unknown> = {}
) {
  const nodeId = live.currentNodeId;
  // The run is leaving the gate either way — bank the time it spent waiting on
  // this reviewer before it starts computing again.
  if (live.parkedAt) {
    live.humanWaitMs += Math.max(0, Date.now() - live.parkedAt);
    live.parkedAt = null;
  }

  const result: NodeResult = {
    ok: action !== "cancel",
    data: { action, ...extra },
    error: "",
    usage: { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, numTurns: 0, durationMs: 0 },
  };

  // A gate is a real node in the history: record the attempt, its outcome and the
  // human wait it accrued, so the dashboard can price the gate itself.
  const step = await openStep(live, graph.nodes[nodeId]);
  await closeStep(step.id, "succeeded", result, [], 0);
  live.ctx.channels[nodeId] = result.data;

  const next = graph.edges[nodeId](live.ctx, result);
  await saveTransition(live, nodeId, next.to, next.reason);

  if (next.to === FAIL) {
    await finish(live, "failed", "Plan rejected — run cancelled by reviewer.", "plan-rejected");
    return;
  }
  live.state = "running";
  await saveRun(live);
  void drive(live, graph, next.to);
}

/** Kill whatever the run is doing right now. */
export function cancel(live: LiveRun): boolean {
  if (live.state !== "running" && live.state !== "waiting") return false;
  live.cancelled = true;
  const pid = live.child?.pid;
  try {
    if (pid && process.platform === "win32") execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    else live.child?.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  // A parked run holds no child process, so nothing above would end it.
  if (live.state === "waiting") void abort(live, live.currentNodeId);
  return true;
}
