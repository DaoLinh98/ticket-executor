import { prisma } from "../prisma";
import { isDriving, liveLogs, reconcileOrphans } from "./engine";
import { flowOf } from "./graph";
import type { Flow } from "./types";
import { buildView, listItem, type RunListItem, type RunView } from "./view";

export { cancelRun, onRunEnded, resumeRun, startRun, type ResumeAction, type StartInput } from "./engine";
export type { RunListItem, RunView } from "./view";

export async function listRuns(): Promise<{ runs: RunListItem[] }> {
  await reconcileOrphans();
  const rows = await prisma.dagentRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 30,
    select: { id: true, ticketId: true, ticketTitle: true, state: true, startedAt: true },
  });
  return { runs: rows.map(listItem) };
}

export async function getRunView(id: string): Promise<RunView | null> {
  const row = await prisma.dagentRun.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { startedAt: "asc" } },
      transitions: { orderBy: { seq: "asc" } },
      artifacts: { orderBy: { createdAt: "asc" }, select: { kind: true, body: true, createdAt: true } },
    },
  });
  if (!row) return null;
  if (row.state === "running" && !isDriving(id)) await reconcileOrphans();
  return buildView(row, row.steps, row.transitions, row.artifacts, liveLogs(id));
}

export type RunOutcome = {
  id: string;
  flow: Flow;
  state: string;
  prUrl: string;
  companionPrUrls: string[];
  endReason: string;
  /** The contract output Flow Runner settles on: `qaTriage` (outcome, qaReply, summary), `respond` (threadsReplied,
   *  threadsResolved), and `noChange` — the run succeeded with nothing to publish (already delivered, or a person
   *  accepted that implement needed no change). */
  output: Record<string, unknown>;
};

/** How D-Agent runs stand, for Flow Runner's reconcile — read from the runs and their validated step outputs. */
export async function runOutcomes(ids: string[]): Promise<RunOutcome[]> {
  if (!ids.length) return [];
  const [rows, steps] = await Promise.all([
    prisma.dagentRun.findMany({ where: { id: { in: ids } }, select: { id: true, state: true, prUrl: true, errorMessage: true, graphId: true, currentNodeId: true } }),
    prisma.dagentStep.findMany({
      where: { runId: { in: ids }, nodeId: { in: ["qaTriage", "publish", "respond"] }, status: "succeeded" },
      orderBy: { startedAt: "asc" },
      select: { runId: true, nodeId: true, output: true },
    }),
  ]);
  return rows.map((r) => {
    const out = (nodeId: string) => (steps.filter((s) => s.runId === r.id && s.nodeId === nodeId).pop()?.output ?? {}) as Record<string, unknown>;
    const prs = Array.isArray(out("publish").prs) ? (out("publish").prs as { prUrl?: string }[]) : [];
    return {
      id: r.id,
      flow: flowOf(r.graphId),
      state: r.state,
      prUrl: r.prUrl,
      companionPrUrls: prs.map((p) => p.prUrl ?? "").filter((u) => u && u !== r.prUrl),
      endReason: r.errorMessage,
      output: { ...out("qaTriage"), ...out("respond"), noChange: r.state === "succeeded" && (r.currentNodeId === "readiness" || r.currentNodeId === "implement") },
    };
  });
}

export async function runFingerprint(id: string): Promise<string> {
  const row = await prisma.dagentRun.findUnique({ where: { id }, select: { updatedAt: true, state: true } });
  const live = liveLogs(id);
  return `${row?.updatedAt.getTime() ?? 0}|${row?.state ?? ""}|${live?.stepId ?? ""}|${live?.logs.length ?? 0}`;
}

export async function listFingerprint(): Promise<string> {
  const agg = await prisma.dagentRun.aggregate({ _count: true, _max: { updatedAt: true } });
  return `${agg._count}|${agg._max.updatedAt?.getTime() ?? 0}`;
}
