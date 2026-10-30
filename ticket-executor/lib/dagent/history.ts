// Run History — every D-Agent run as one table row. Pure: the query is shaped and the rows are folded here,
// the Prisma calls live in `index.ts`, so the rules are tested without a database.

import { flowOf, graphById, graphIdsOf, outline } from "./graph";
import { HISTORY_FLOWS, HISTORY_SIZES, HISTORY_STATES, pageCount, type HistoryFilter, type HistoryPage, type HistoryRow } from "./historyShape";
import type { Flow } from "./types";

export * from "./historyShape";

export type HistoryRunRow = {
  id: string;
  ticketId: string;
  ticketTitle: string;
  ticketUrl: string;
  project: string;
  graphId: string;
  state: string;
  waitReason: string;
  currentNodeId: string;
  errorMessage: string;
  branch: string;
  prUrl: string;
  retryOfId: string;
  startedAt: Date;
  endedAt: Date | null;
};

export type StepTotal = { runId: string; nodeId: string; count: number; costUsd: number; tokens: number };

/** Reads the filter from a URL; unknown values are dropped, never guessed. */
export function parseHistoryFilter(params: URLSearchParams): HistoryFilter {
  const state = params.get("state") ?? "";
  const flow = params.get("flow") ?? "";
  const page = Math.floor(Number(params.get("page")));
  const size = Number(params.get("size"));
  return {
    state: (HISTORY_STATES as readonly string[]).includes(state) ? state : "",
    flow: Object.values(HISTORY_FLOWS).includes(flow) ? flow : "",
    q: (params.get("q") ?? "").trim().slice(0, 200),
    page: page >= 1 ? page : 1,
    size: (HISTORY_SIZES as readonly number[]).includes(size) ? size : HISTORY_SIZES[0],
  };
}

/** The Prisma `where` for a filter; paging is `historySlice()`, newest first. */
export function historyWhere(f: Pick<HistoryFilter, "state" | "flow" | "q">): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  if (f.state) and.push({ state: f.state });
  const flow = (Object.keys(HISTORY_FLOWS) as Flow[]).find((k) => HISTORY_FLOWS[k] === f.flow);
  if (flow) and.push({ graphId: { in: graphIdsOf(flow) } });
  if (f.q) and.push({ OR: [{ ticketId: { contains: f.q, mode: "insensitive" } }, { ticketTitle: { contains: f.q, mode: "insensitive" } }] });
  return and.length ? { AND: and } : {};
}

/** The page actually served (a page past the end shows the last one) and the rows it skips. */
export function historySlice(f: HistoryFilter, total: number): { page: number; skip: number } {
  const page = Math.min(f.page, pageCount(total, f.size));
  return { page, skip: (page - 1) * f.size };
}

const nodeLabelOf = (graphId: string, nodeId: string) => outline(graphById(graphId) ?? undefined).find((n) => n.id === nodeId)?.label ?? nodeId;

/** Folds one page of runs and their per-node step totals into rows. */
export function historyPage(runs: HistoryRunRow[], totals: StepTotal[], total: number, page: number, size: number): HistoryPage {
  const rows = runs.map((r): HistoryRow => {
    const mine = totals.filter((t) => t.runId === r.id);
    return {
      id: r.id,
      ticketId: r.ticketId,
      title: r.ticketTitle,
      ticketUrl: r.ticketUrl,
      project: r.project,
      flow: HISTORY_FLOWS[flowOf(r.graphId)],
      state: r.state === "running" && r.currentNodeId === "setup" ? "preparing" : r.state,
      waitReason: r.waitReason,
      nodeId: r.currentNodeId,
      nodeLabel: r.currentNodeId ? nodeLabelOf(r.graphId, r.currentNodeId) : "",
      error: r.errorMessage,
      branch: r.branch,
      prUrl: r.prUrl,
      retryOf: r.retryOfId,
      startedAt: r.startedAt.getTime(),
      endedAt: r.endedAt ? r.endedAt.getTime() : null,
      costUsd: mine.reduce((a, t) => a + t.costUsd, 0),
      tokens: mine.reduce((a, t) => a + t.tokens, 0),
      fixes: mine.filter((t) => t.nodeId === "fix").reduce((a, t) => a + t.count, 0),
    };
  });
  return { rows, total, page, size };
}
