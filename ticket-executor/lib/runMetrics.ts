// Insights — what D-Agent runs cost and where they stop, folded from runs the loader already read. Pure and
// Prisma-free (the reads live in `lib/dagent/insights.ts`), so every number the Insights page shows is asserted
// in a test that needs no database.

import { classifyFailure, type FailureClass } from "@/lib/dagent/retryPolicy";
import { workingDays } from "@/lib/sprintPlan";
import type { Flow } from "@/lib/dagent/types";

export type MetricStep = { nodeId: string; status: string; costUsd: number };

export type MetricRun = {
  id: string;
  ticketId: string;
  ticketTitle: string;
  flow: Flow;
  state: string;
  waitReason: string;
  /** The node the run stood on last — where a failed run failed. */
  failedAt: string;
  errorMessage: string;
  prUrl: string;
  startedAt: number;
  endedAt: number | null;
  /** The last transition's target (END, FAIL, NEEDS_INPUT, NEEDS_REVIEW, or a node) and its reason. */
  finalTo: string;
  finalReason: string;
  steps: MetricStep[];
};

/** A planned ticket's size and delivery facts; one per ticket id (the loader keeps the newest plan's row). */
export type MetricTicket = { ticketId: string; points: number; prUrl: string; releasedAt: number | null };

export type NodeMetric = {
  nodeId: string;
  visits: number;
  /** Steps that errored (status `failed`). */
  failures: number;
  /** Steps whose agent ran but whose verdict sent the run back (status `refused`). */
  refusals: number;
  /** Failed runs that stopped on this node. */
  runsEndedHere: number;
  /** Succeeded steps over finished steps (succeeded + refused + failed); null before any finished. */
  successRate: number | null;
  totalCostUsd: number;
  avgCostUsd: number;
};

export type FlowMetric = {
  flow: Flow;
  runs: number;
  succeeded: number;
  endedForReview: number;
  failed: number;
  cancelled: number;
  waitingForPo: number;
  running: number;
  avgCostUsd: number;
  /** Over runs that have ended; null when none has. */
  avgDurationSec: number | null;
  /** `fix` steps per implement run; null for the other flows. */
  avgFixRounds: number | null;
};

export type FailureReason = { reason: string; cls: FailureClass; count: number };

export type TicketCost = { ticketId: string; title: string; runs: number; costUsd: number; points: number | null };

export type PaceVerdict = "too-few" | "faster" | "slower" | "on-pace" | "no-plan";

export type Pace = {
  /** Tickets with points that reached a PR (or were released) inside the window. */
  sample: number;
  deliveredPoints: number;
  workingDays: number;
  suggestedPointsPerDay: number | null;
  plannedPointsPerDay: number | null;
  verdict: PaceVerdict;
};

export type Insights = {
  from: number;
  to: number;
  totals: { runs: number; finished: number; successRate: number | null; costUsd: number; costPerPoint: number | null };
  flows: FlowMetric[];
  nodes: NodeMetric[];
  failures: { classes: Record<FailureClass, number>; top: FailureReason[] };
  tickets: TicketCost[];
  pace: Pace;
};

/** Below this many delivered tickets the pace suggestion is shown but not trusted. */
export const PACE_MIN_SAMPLE = 3;
/** How far actual pace may sit from the plan's before it is called faster or slower. */
const PACE_TOLERANCE = 0.15;
const TOP_REASONS = 8;
const FLOWS: Flow[] = ["implement", "review", "qa"];

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const runCost = (r: MetricRun) => sum(r.steps.map((s) => s.costUsd));
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/** The disjoint outcome a run counts under. A NEEDS_REVIEW end is `succeeded` in the table but reported apart. */
export function outcomeOf(r: Pick<MetricRun, "state" | "waitReason" | "finalTo">): "succeeded" | "endedForReview" | "failed" | "cancelled" | "waitingForPo" | "running" {
  if (r.state === "succeeded") return r.finalTo === "NEEDS_REVIEW" ? "endedForReview" : "succeeded";
  if (r.state === "failed" || r.state === "cancelled") return r.state;
  if (r.state === "waiting" && r.waitReason === "needs-input") return "waitingForPo";
  return "running";
}

/** A failure reason folded to a short groupable line: first line, ids and numbers masked, at most 120 chars. */
export function normaliseReason(reason: string): string {
  const line = (reason || "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  const s = line
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.\-]+){2,}/g, "<path>")
    .replace(/\b[0-9a-f]{7,40}\b/gi, "#")
    .replace(/\d{4,}/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "(no reason recorded)";
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

function nodeMetrics(runs: MetricRun[]): NodeMetric[] {
  const by = new Map<string, NodeMetric>();
  const at = (nodeId: string) => {
    let m = by.get(nodeId);
    if (!m) by.set(nodeId, (m = { nodeId, visits: 0, failures: 0, refusals: 0, runsEndedHere: 0, successRate: null, totalCostUsd: 0, avgCostUsd: 0 }));
    return m;
  };
  const ok = new Map<string, number>();
  for (const r of runs) {
    for (const s of r.steps) {
      const m = at(s.nodeId);
      m.visits++;
      m.totalCostUsd += s.costUsd;
      if (s.status === "failed") m.failures++;
      if (s.status === "refused") m.refusals++;
      if (s.status === "succeeded") ok.set(s.nodeId, (ok.get(s.nodeId) ?? 0) + 1);
    }
    if (r.state === "failed" && r.failedAt) at(r.failedAt).runsEndedHere++;
  }
  return [...by.values()]
    .map((m) => {
      const good = ok.get(m.nodeId) ?? 0;
      const finished = good + m.failures + m.refusals;
      return { ...m, totalCostUsd: round(m.totalCostUsd, 4), avgCostUsd: m.visits ? round(m.totalCostUsd / m.visits, 4) : 0, successRate: finished ? good / finished : null };
    })
    .sort((a, b) => b.runsEndedHere - a.runsEndedHere || b.failures - a.failures || b.totalCostUsd - a.totalCostUsd);
}

function flowMetrics(runs: MetricRun[]): FlowMetric[] {
  return FLOWS.map((flow) => {
    const mine = runs.filter((r) => r.flow === flow);
    const count = (o: ReturnType<typeof outcomeOf>) => mine.filter((r) => outcomeOf(r) === o).length;
    const ended = mine.filter((r) => r.endedAt != null);
    return {
      flow,
      runs: mine.length,
      succeeded: count("succeeded"),
      endedForReview: count("endedForReview"),
      failed: count("failed"),
      cancelled: count("cancelled"),
      waitingForPo: count("waitingForPo"),
      running: count("running"),
      avgCostUsd: mine.length ? round(sum(mine.map(runCost)) / mine.length, 4) : 0,
      avgDurationSec: ended.length ? Math.round(sum(ended.map((r) => ((r.endedAt as number) - r.startedAt) / 1000)) / ended.length) : null,
      avgFixRounds: flow === "implement" && mine.length ? round(sum(mine.map((r) => r.steps.filter((s) => s.nodeId === "fix").length)) / mine.length) : flow === "implement" ? 0 : null,
    };
  });
}

function failureMetrics(runs: MetricRun[]): Insights["failures"] {
  const classes: Record<FailureClass, number> = { transient: 0, env: 0, agent: 0 };
  const reasons = new Map<string, FailureReason>();
  for (const r of runs) {
    if (r.state !== "failed") continue;
    const raw = r.errorMessage || r.finalReason;
    const cls = classifyFailure(raw);
    classes[cls]++;
    const reason = normaliseReason(raw);
    const hit = reasons.get(reason);
    if (hit) hit.count++;
    else reasons.set(reason, { reason, cls, count: 1 });
  }
  return { classes, top: [...reasons.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)).slice(0, TOP_REASONS) };
}

function ticketCosts(runs: MetricRun[], tickets: Map<string, MetricTicket>): TicketCost[] {
  const by = new Map<string, TicketCost>();
  for (const r of runs) {
    const t = by.get(r.ticketId) ?? { ticketId: r.ticketId, title: r.ticketTitle, runs: 0, costUsd: 0, points: tickets.get(r.ticketId)?.points || null };
    t.runs++;
    t.costUsd += runCost(r);
    if (!t.title) t.title = r.ticketTitle;
    by.set(r.ticketId, t);
  }
  return [...by.values()].map((t) => ({ ...t, costUsd: round(t.costUsd, 4) })).sort((a, b) => b.costUsd - a.costUsd);
}

/**
 * Actual pace: points of tickets that reached a PR or were released inside the window, per working day of the
 * window (up to `now`). A ticket's delivery moment is its release, else the end of its first run in the window that
 * left a PR. Rounded to the nearest 0.5 point, the step a plan is built in.
 */
export function paceOf(runs: MetricRun[], tickets: Map<string, MetricTicket>, from: number, to: number, plannedPointsPerDay: number | null): Pace {
  const delivered = new Map<string, number>();
  for (const t of tickets.values()) {
    if (!(t.points > 0)) continue;
    let at = t.releasedAt;
    if (at == null) {
      const withPr = runs.filter((r) => r.ticketId === t.ticketId && r.prUrl && r.endedAt != null && r.state === "succeeded").map((r) => r.endedAt as number);
      at = withPr.length ? Math.min(...withPr) : null;
    }
    if (at != null && at >= from && at <= to) delivered.set(t.ticketId, t.points);
  }
  const sample = delivered.size;
  const deliveredPoints = sum([...delivered.values()]);
  const days = workingDays(new Date(from).toISOString(), new Date(to).toISOString()).length;
  const suggested = sample && days ? Math.max(0.5, Math.round((deliveredPoints / days) * 2) / 2) : null;
  const planned = plannedPointsPerDay && plannedPointsPerDay > 0 ? plannedPointsPerDay : null;
  let verdict: PaceVerdict;
  if (sample < PACE_MIN_SAMPLE || suggested == null) verdict = "too-few";
  else if (planned == null) verdict = "no-plan";
  else if (suggested > planned * (1 + PACE_TOLERANCE)) verdict = "faster";
  else if (suggested < planned * (1 - PACE_TOLERANCE)) verdict = "slower";
  else verdict = "on-pace";
  return { sample, deliveredPoints, workingDays: days, suggestedPointsPerDay: suggested, plannedPointsPerDay: planned, verdict };
}

/** Every number on the Insights page for one window. `runs` are those started inside `[from, to]`. */
export function computeInsights(input: { runs: MetricRun[]; tickets: MetricTicket[]; from: number; to: number; plannedPointsPerDay: number | null }): Insights {
  const { runs, from, to } = input;
  const tickets = new Map(input.tickets.map((t) => [t.ticketId, t]));
  const ticketRows = ticketCosts(runs, tickets);
  const sized = ticketRows.filter((t) => t.points);
  const sizedPoints = sum(sized.map((t) => t.points as number));
  const outcomes = runs.map(outcomeOf);
  const good = outcomes.filter((o) => o === "succeeded" || o === "endedForReview").length;
  const finished = good + outcomes.filter((o) => o === "failed").length;
  return {
    from,
    to,
    totals: {
      runs: runs.length,
      finished,
      successRate: finished ? good / finished : null,
      costUsd: round(sum(runs.map(runCost)), 4),
      costPerPoint: sizedPoints ? round(sum(sized.map((t) => t.costUsd)) / sizedPoints, 4) : null,
    },
    flows: flowMetrics(runs),
    nodes: nodeMetrics(runs),
    failures: failureMetrics(runs),
    tickets: ticketRows,
    pace: paceOf(runs, tickets, from, to, input.plannedPointsPerDay),
  };
}

/** Ticket ids whose spend is at or over the soft budget, most expensive first. A budget of 0 (or less) is off. */
export function overBudget(costByTicket: Record<string, number>, budgetUsd: number): string[] {
  if (!(budgetUsd > 0)) return [];
  return Object.entries(costByTicket)
    .filter(([, cost]) => cost >= budgetUsd)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}
