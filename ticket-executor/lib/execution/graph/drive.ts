import { execSync } from "child_process";
import { prisma } from "../../prisma";
import type { EndReason } from "../../types";
import { fmtDuration } from "../format";
import { collectFileChanges, summarizeChanges } from "../git";
import { execNode, releaseMcp } from "./exec";
import { closeStep, openStep, saveArtifact, saveRun, saveTransition } from "./persist";
import { readPlanFile } from "./graphs";
import { END, FAIL, type Graph, type LiveRun, type NodeResult, type Target } from "./types";

// A backstop, not a policy. Cycles are legitimate (revise the plan, fix what an
// evaluator found), but a graph that has moved 40 times is looping, and a runaway
// loop spends real money. Per-node budgets and Run.budgetUsd are the real limits;
// this catches the case where something is wrong with the graph itself.
const MAX_HOPS = 40;

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
  if (typeof data.summary === "string" && data.summary) live.resultText = data.summary;
}

// ---- the driver ----

/** Walk the graph from `from` until it parks, ends, or fails.
 *
 *  This one loop replaces the two near-identical post-turn dispatchers the old
 *  runner carried (one in startExecution, one in resolvePlan). Adding a node no
 *  longer means copy-pasting a third. */
export async function drive(live: LiveRun, graph: Graph, from: Target) {
  let target: Target = from;
  let hops = 0;

  try {
    while (target !== END && target !== FAIL) {
      if (++hops > MAX_HOPS) {
        await finish(live, "failed", `Graph exceeded ${MAX_HOPS} transitions — it is looping.`, "hop-limit");
        return;
      }
      const node = graph.nodes[target];
      if (!node) {
        await finish(live, "failed", `Graph ${graph.id} has no node "${target}"`);
        return;
      }
      if (live.cancelled) {
        await finish(live, "cancelled", "Cancelled by user", "cancelled");
        return;
      }
      // Checked between nodes rather than inside one: a node already running is
      // bounded by its own --max-budget-usd, and killing it mid-write would leave
      // the worktree in a state nothing downstream expects.
      if (live.budgetUsd > 0 && live.spentUsd >= live.budgetUsd) {
        await finish(live, "failed", `Run budget of $${live.budgetUsd.toFixed(2)} reached.`, "budget");
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

      live.spentUsd += result.usage.costUsd;

      if (live.cancelled) {
        await finish(live, "cancelled", "Cancelled by user", "cancelled");
        return;
      }

      // The reducer: a node writes only its own channel, never another's.
      live.ctx.channels[node.id] = result.data;
      promoteContractFields(live, result.data);

      const edge = graph.edges[node.id];
      if (!edge) {
        await finish(live, "failed", `Graph ${graph.id} has no edge out of "${node.id}"`);
        return;
      }
      const next = edge(live.ctx, result);
      await saveTransition(live, node.id, next.to, next.reason);
      target = next.to;
      await saveRun(live);
    }

    if (target === END) await finish(live, "succeeded", "");
    else await finish(live, "failed", lastReason(live) || "Run failed");
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

/** The reason recorded on the transition that sent the run to FAIL — the useful
 *  half of "the run failed". */
function lastReason(live: LiveRun): string {
  for (let i = live.logLines.length - 1; i >= 0; i--) {
    const l = live.logLines[i];
    if (l.kind === "step" && l.text.includes("→ FAIL")) {
      const m = l.text.match(/\(([^)]*)\)\s*$/);
      if (m) return m[1];
    }
  }
  return "";
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
  if (live.state === "waiting") void finish(live, "cancelled", "Cancelled by user", "cancelled");
  return true;
}
