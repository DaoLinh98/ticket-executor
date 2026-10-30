// Run History's shape — the filter values and the row a page shows. Type imports only, so a client page can read it
// without pulling the engine into its bundle.

import type { Flow } from "./types";

export const HISTORY_STATES = ["running", "waiting", "succeeded", "failed", "cancelled"] as const;
export const HISTORY_FLOWS: Record<Flow, string> = { implement: "implement", review: "fix-review", qa: "fix-qa" };

/** Rows a page may hold; the first is the default. */
export const HISTORY_SIZES = [25, 50, 100] as const;

/** `flow` is the label a row shows (`fix-review`), the same word the filter offers. `page` counts from 1. */
export type HistoryFilter = { state: string; flow: string; q: string; page: number; size: number };

export type HistoryRow = {
  id: string;
  ticketId: string;
  title: string;
  ticketUrl: string;
  project: string;
  flow: string;
  state: string;
  waitReason: string;
  nodeId: string;
  nodeLabel: string;
  error: string;
  branch: string;
  prUrl: string;
  retryOf: string;
  startedAt: number;
  endedAt: number | null;
  costUsd: number;
  tokens: number;
  fixes: number;
};

/** `page` is the one served — clamped to the last page when the asked one ran past it. */
export type HistoryPage = { rows: HistoryRow[]; total: number; page: number; size: number };

export const pageCount = (total: number, size: number) => Math.max(1, Math.ceil(total / size));
