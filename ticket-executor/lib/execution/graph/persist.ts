import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import type { LogLine } from "../../types";
import type { LiveRun, Node, NodeResult } from "./types";

// Every write here is allowed to throw. That is a deliberate change from the old
// engine, where persist() swallowed failures because the in-memory entry was the
// source of truth. With a graph, Postgres *is* the source of truth between nodes:
// a lost write means a lost node, and continuing blind would produce a run whose
// recorded history no longer matches what actually happened. drive() catches and
// fails the run loudly instead.

/** Snapshot the run's own row. Called after every transition, so a crash leaves
 *  the row pointing at the node that was actually reached. */
export async function saveRun(live: LiveRun) {
  await prisma.run.update({
    where: { id: live.id },
    data: {
      state: live.state,
      currentNodeId: live.currentNodeId,
      endReason: live.endReason,
      errorMessage: live.errorMessage,
      sessionId: live.sessionId,
      worktreePath: live.ctx.cwd,
      baseSha: live.ctx.baseSha,
      prUrl: live.prUrl,
      branch: live.branch,
      resultText: live.resultText,
      channels: live.ctx.channels as unknown as Prisma.InputJsonValue,
      // The loop guards travel with the run, not with the process driving it.
      hops: live.hops,
      visits: live.ctx.visits as unknown as Prisma.InputJsonValue,
      parkedAt: live.parkedAt ? new Date(live.parkedAt) : null,
      humanWaitMs: live.humanWaitMs,
      resumedAfterRestart: live.resumedAfterRestart,
      endedAt: live.endedAt ? new Date(live.endedAt) : null,
    },
  });
}

/** Start an attempt at a node. A node re-entered by a cycle gets attempt + 1
 *  rather than overwriting the earlier row — the history of what was tried is
 *  the point of having Step rows at all. */
export async function openStep(live: LiveRun, node: Node): Promise<{ id: string; logStart: number }> {
  const [prior, priorAnyNode] = await Promise.all([
    prisma.step.count({ where: { runId: live.id, nodeId: node.id } }),
    prisma.step.count({ where: { runId: live.id } }),
  ]);
  const row = await prisma.step.create({
    data: {
      runId: live.id,
      nodeId: node.id,
      label: node.label,
      attempt: prior + 1,
      effects: node.effects,
      status: "running",
      claimedAt: new Date(),
    },
    select: { id: true },
  });
  // The run's *first* step adopts the log from index 0, so everything the run
  // printed before any node opened — which account EmeHub resolved, the isolated
  // worktree it created — is persisted with it. `Step.logLines` is the only
  // durable home a log line has (drive() stores `live.logLines.slice(logStart)`),
  // so those lines used to exist purely in memory and vanish on restart: the run
  // that spent the shared account could not afterwards be shown to have done so.
  // Every later step still starts at the current tail, so no line is stored twice.
  return { id: row.id, logStart: priorAnyNode === 0 ? 0 : live.logLines.length };
}

export async function closeStep(
  stepId: string,
  status: "succeeded" | "failed",
  r: NodeResult,
  logs: LogLine[],
  durationMs: number
) {
  await prisma.step.update({
    where: { id: stepId },
    data: {
      status,
      output: r.data as unknown as Prisma.InputJsonValue,
      errorMessage: r.error,
      logLines: logs as unknown as Prisma.InputJsonValue,
      claimedAt: null,
      costUsd: r.usage.costUsd,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      cacheReadTokens: r.usage.cacheReadTokens,
      cacheCreationTokens: r.usage.cacheCreationTokens,
      numTurns: r.usage.numTurns,
      durationMs,
      endedAt: new Date(),
    },
  });
}

/** Record why the harness moved. Four of these explain a run better than the
 *  whole tool log next to them. */
export async function saveTransition(live: LiveRun, fromNode: string, toNode: string, reason: string) {
  live.seq += 1;
  await prisma.transition.create({
    data: { runId: live.id, seq: live.seq, fromNode, toNode, reason },
  });
  live.logLines.push({ text: `→ ${fromNode} → ${toNode}  (${reason})`, kind: "step" });
}

/** Store a human-readable deliverable. A reviewer's edit becomes a new version
 *  rather than overwriting the agent's, so "what was proposed" and "what was
 *  approved" stay comparable afterwards. */
export async function saveArtifact(
  runId: string,
  kind: string,
  body: string,
  editedBy: "agent" | "human"
): Promise<number> {
  const last = await prisma.artifact.findFirst({
    where: { runId, kind },
    orderBy: { version: "desc" },
    select: { version: true, body: true },
  });
  if (last && last.body === body) return last.version; // nothing changed — don't churn versions
  const version = (last?.version ?? 0) + 1;
  await prisma.artifact.create({ data: { runId, kind, version, body, editedBy } });
  return version;
}

export async function latestArtifact(runId: string, kind: string) {
  return prisma.artifact.findFirst({
    where: { runId, kind },
    orderBy: { version: "desc" },
  });
}
