import { execSync } from "child_process";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { prisma } from "../../prisma";
import type { EndReason } from "../../types";
import { fmtDuration } from "../format";
import { collectFileChanges, summarizeChanges } from "../git";
import { execNode, releaseMcp } from "./exec";
import { closeStep, openStep, saveArtifact, saveRun, saveTransition } from "./persist";
import { clearRunArtifacts, readPlanFile } from "./graphs";
import { knowledgeFile } from "./prompts";
import { END, FAIL, type Graph, type LiveRun, type Node, type NodeResult, type Target } from "./types";

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

// How many times one run may be parked by an account limit before it is failed
// for a person to look at. A ceiling rather than an endless wait, for the same
// reason MAX_HOPS exists: a quota that keeps running out on the same node is not
// a run that is about to finish, and a run parked forever holds a worktree, a
// branch and its ticket's slot while looking like work in progress. Three is one
// park per reset window in a working day.
const MAX_LIMIT_PARKS = 3;

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
  // rather than losing it — into whichever bucket it actually belongs to. Waiting
  // for a reviewer and waiting for a quota are two different facts about a run,
  // and the dashboard's "human wait" would say the machine was waiting on a
  // person for hours nobody was ever asked about.
  bankParkedTime(live);
  reportKnowledge(live);
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

/** A fingerprint of the project's KNOWLEDGE.md, or "" when there is none. */
export function knowledgeStamp(rootRepo: string): string {
  try {
    return createHash("sha1").update(readFileSync(knowledgeFile(rootRepo))).digest("hex");
  } catch {
    return "";
  }
}

/** Say in the run's own log whether the project's memory changed while it ran.
 *  Writing lessons is the agent's job and costs this harness nothing to check,
 *  so the one piece of the outer loop nobody routes on is still observable:
 *  a project whose runs never add a line is a loop that is not learning. */
function reportKnowledge(live: LiveRun) {
  if (live.knowledgeAtStart === null) return;
  const now = knowledgeStamp(live.ctx.rootRepo);
  if (now === live.knowledgeAtStart) return;
  live.logLines.push({
    text: `● KNOWLEDGE.md ${live.knowledgeAtStart ? "changed" : "created"} during this run — ${knowledgeFile(live.ctx.rootRepo)}`,
    kind: "step",
  });
}

/** Close whatever park the run is sitting in, into the bucket that park belongs
 *  to. `resumeAt` is what tells them apart — only a limit park has one. */
export function bankParkedTime(live: LiveRun) {
  if (!live.parkedAt) return;
  const waited = Math.max(0, Date.now() - live.parkedAt);
  if (live.resumeAt) live.limitWaitMs += waited;
  else live.humanWaitMs += waited;
  live.parkedAt = null;
  live.resumeAt = null;
}

/**
 * Park because the account this machine is logged in as ran out of quota
 * mid-node, until it comes back.
 *
 * The run is deliberately **not** failed. Every other failure in the harness is
 * a statement about the work — the tests did not pass, the branch was not
 * pushed, the contract was not honoured — and this one is a statement about the
 * bill: the same node, on the same tree, would have succeeded ten minutes
 * earlier. Failing it would throw away a worktree with uncommitted work in it,
 * mark the ticket failed, and take it out of the scheduler's queue for good.
 *
 * Nothing here removes the worktree and nothing clears `.te/`: the node is going
 * to be re-entered in the session it was cut off in, and both are what it
 * continues from.
 */
async function parkForLimit(live: LiveRun, node: Node, resetAt: Date) {
  // Give back what entering the node cost. Both counters were spent on an
  // attempt that produced nothing, and the node is going to be entered again —
  // leaving them spent would let a spent quota burn a bounded cycle's budget
  // (`visits.fix` against MAX_FIX_ATTEMPTS) without a single fix being tried,
  // and walk a long run towards MAX_HOPS one outage at a time.
  live.ctx.visits[node.id] = Math.max(0, (live.ctx.visits[node.id] ?? 1) - 1);
  live.hops = Math.max(0, live.hops - 1);

  live.state = "waiting";
  live.currentNodeId = node.id;
  live.parkedAt = Date.now();
  live.resumeAt = resetAt.getTime();
  live.limitParks += 1;
  live.endReason = "rate-limited";
  live.errorMessage =
    `The Claude account hit its usage limit during "${node.label}". ` +
    `The run holds here and continues by itself at ${resetAt.toLocaleString()}.`;
  live.logLines.push({ text: `⏸ ${live.errorMessage}`, kind: "step" });
  await saveRun(live);
  // The limit belongs to the account, not to this run: every other ticket would
  // hit it too, and the scheduler's next tick is two minutes away. Starting more
  // work before the reset buys nothing but another dead run — which is exactly
  // how one spent quota produced two failed tickets before this existed.
  await pauseUntil(resetAt);
}

/** Hold every *new* run until the account's quota is back. Read by
 *  admissionDenial(), so a scheduled run and a button press are refused by the
 *  same rule, before the spawn. Never moved backwards: a later reset wins. */
async function pauseUntil(at: Date) {
  try {
    const row = await prisma.setting.findUnique({ where: { id: "default" }, select: { agentPausedUntil: true } });
    if (row?.agentPausedUntil && row.agentPausedUntil >= at) return;
    await prisma.setting.upsert({
      where: { id: "default" },
      create: { id: "default", agentPausedUntil: at },
      update: { agentPausedUntil: at },
    });
  } catch {
    /* the park itself is what protects this run; the pause only protects the next */
  }
}

/** Lift whatever `.te/plan.md` currently holds into a durable Artifact row.
 *
 *  `.te/` is one run's drafting surface — excluded from git, cleared by
 *  clearRunArtifacts(), and deleted outright with an isolated run's worktree — so
 *  the Artifact row is the only copy that outlives the run. Called when a node
 *  that declares `artifact: "plan"` ends.
 *
 *  saveArtifact() skips a body identical to the latest version, so calling this
 *  on a node that did not touch the file costs one read and writes nothing. */
async function capturePlan(live: LiveRun) {
  const plan = readPlanFile(live.ctx.cwd);
  if (plan) await saveArtifact(live.id, "plan", plan, "agent");
}

/** Lift the handful of contract fields that have consumers outside the run's own
 *  routing onto the Run row. Only ever *set* by a node that reported one — a
 *  later node that says nothing about the branch must not blank it. */
function promoteContractFields(live: LiveRun, data: Record<string, unknown>) {
  if (typeof data.branch === "string" && data.branch) live.branch = data.branch;
  if (typeof data.prUrl === "string" && data.prUrl) live.prUrl = data.prUrl;
  // `resultText` is what the Result tab shows as "what this run did", so it must
  // come from the node that produced the deliverable — not from whichever node
  // happened to report a `summary` last. Keyed off `committed` rather than a
  // hard-coded list of node ids: that field is exactly what distinguishes the
  // delivering contract (STEP_OUTPUT) from the reviewing and publishing ones.
  const delivers = typeof data.committed === "boolean";
  if (delivers && typeof data.summary === "string" && data.summary) live.resultText = data.summary;
}

// ---- the driver ----

/** Walk the graph from `from` until it parks, ends, or fails.
 *
 *  This one loop replaces the two near-identical post-turn dispatchers the old
 *  runner carried (one in startExecution, one in the old plan-gate resolver). Adding a node no
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
      // limit-parked run wakes and every time a crashed run is recovered, so a local
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

      live.state = "running";
      await saveRun(live);
      const step = await openStep(live, node);
      const t0 = Date.now();
      const result = await execNode(live, node);
      const logs = live.logLines.slice(step.logStart);
      // An account limit is not a verdict on the attempt, so the attempt is not
      // recorded as one: `abandoned` is the same status a step interrupted by a
      // server restart gets, and for the same reason — it was stopped, not judged.
      const limited = !live.cancelled && !result.ok && !!result.limitResetAt;
      await closeStep(
        step.id,
        result.ok ? "succeeded" : limited ? "abandoned" : "failed",
        result,
        logs,
        Date.now() - t0
      );

      if (live.cancelled) {
        await abort(live, node.id);
        return;
      }

      // Before the reducer and before the edge: a limited turn produced no
      // output, so there is nothing to write into a channel and nothing for an
      // edge to route on. The node is not left behind — the run comes back to
      // this same node when the quota does.
      if (limited) {
        if (live.limitParks >= MAX_LIMIT_PARKS) {
          await finish(
            live,
            "failed",
            `The account's usage limit interrupted this run ${live.limitParks} times at "${node.label}". ` +
              `It is not retried again automatically — check the account's quota, then start it once more.`,
            "rate-limited"
          );
        } else {
          await parkForLimit(live, node, result.limitResetAt!);
        }
        return;
      }

      // Before the reducer, and deliberately not conditional on `result.ok`: a
      // node that failed its verification still planned something, and that plan
      // is the most useful thing a person can read about why it failed.
      if (node.kind === "agent" && node.artifact === "plan") await capturePlan(live);

      // The reducer: a node writes only its own channel, never another's.
      live.ctx.channels[node.id] = result.data;
      promoteContractFields(live, result.data);

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
