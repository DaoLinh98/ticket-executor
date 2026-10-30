import { prisma } from "../prisma";
import { cached, DB_CACHE_PREFIX } from "../redis";
import { isDriving, liveLogs, reconcileOrphans } from "./engine";
import { flowOf } from "./graph";
import { NEEDS_REVIEW, type Flow } from "./types";
import { historyPage, historySlice, historyWhere, type HistoryFilter, type HistoryPage } from "./history";
import { buildView, listItem, type RunListItem, type RunView } from "./view";

export { cancelRun, onRunEnded, resumeRun, startRun, type ResumeAction, type StartInput } from "./engine";
export type { RunListItem, RunView } from "./view";
export { parseHistoryFilter, type HistoryFilter, type HistoryPage, type HistoryRow } from "./history";

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
  // Only the ticket's newest run may be retried or cancelled; told here so a run linked directly is judged right.
  const newer = await prisma.dagentRun.count({ where: { ticketId: row.ticketId, startedAt: { gt: row.startedAt } } });
  return { ...buildView(row, row.steps, row.transitions, row.artifacts, liveLogs(id)), newest: newer === 0 };
}

/** One numbered page of Run History, newest first, with the filter's total. Keyed by the list fingerprint, so a changed run is never served stale. */
export async function listRunHistory(filter: HistoryFilter): Promise<HistoryPage> {
  await reconcileOrphans();
  const key = `${DB_CACHE_PREFIX}runHistory:${await listFingerprint()}:${JSON.stringify(filter)}`;
  return cached(key, 15, async () => {
    const where = historyWhere(filter);
    const total = await prisma.dagentRun.count({ where });
    const { page, skip } = historySlice(filter, total);
    const runs = await prisma.dagentRun.findMany({
      where,
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      skip,
      take: filter.size,
      select: {
        id: true, ticketId: true, ticketTitle: true, ticketUrl: true, project: true, graphId: true, state: true, waitReason: true,
        currentNodeId: true, errorMessage: true, branch: true, prUrl: true, retryOfId: true, startedAt: true, endedAt: true,
      },
    });
    const totals = await prisma.dagentStep.groupBy({
      by: ["runId", "nodeId"],
      where: { runId: { in: runs.map((r) => r.id) } },
      _count: { _all: true },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
    });
    return historyPage(
      runs,
      totals.map((t) => ({ runId: t.runId, nodeId: t.nodeId, count: t._count._all, costUsd: t._sum.costUsd ?? 0, tokens: (t._sum.inputTokens ?? 0) + (t._sum.outputTokens ?? 0) })),
      total,
      page,
      filter.size,
    );
  });
}

export type RunOutcome = {
  id: string;
  flow: Flow;
  state: string;
  prUrl: string;
  companionPrUrls: string[];
  endReason: string;
  /** The node the run stood on when it ended — where a failed run failed. */
  failedAt: string;
  /** The contract output Flow Runner settles on: `qaTriage` (outcome, qaReply, summary), `respond` (threadsReplied,
   *  threadsResolved), `noChange` — the run succeeded with nothing to publish (already delivered, or implement
   *  changed nothing) — and `needsReview`, the reason a run that ended on NEEDS_REVIEW wants a look ("" otherwise). */
  output: Record<string, unknown>;
};

/** How D-Agent runs stand, for Flow Runner's reconcile — read from the runs and their validated step outputs. */
export async function runOutcomes(ids: string[]): Promise<RunOutcome[]> {
  if (!ids.length) return [];
  const [rows, steps, reviews] = await Promise.all([
    prisma.dagentRun.findMany({ where: { id: { in: ids } }, select: { id: true, state: true, prUrl: true, errorMessage: true, graphId: true, currentNodeId: true } }),
    prisma.dagentStep.findMany({
      where: { runId: { in: ids }, nodeId: { in: ["qaTriage", "publish", "respond"] }, status: "succeeded" },
      orderBy: { startedAt: "asc" },
      select: { runId: true, nodeId: true, output: true },
    }),
    prisma.dagentTransition.findMany({ where: { runId: { in: ids }, toNode: NEEDS_REVIEW }, select: { runId: true, reason: true } }),
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
      failedAt: r.currentNodeId,
      output: {
        ...out("qaTriage"),
        ...out("respond"),
        noChange: r.state === "succeeded" && (r.currentNodeId === "readiness" || r.currentNodeId === "implement"),
        needsReview: r.state === "succeeded" ? reviews.find((t) => t.runId === r.id)?.reason ?? "" : "",
      },
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
export { INSIGHTS_PERIODS, loadInsights, parseInsightsPeriod, type InsightsPayload, type InsightsPeriod } from "./insights";
