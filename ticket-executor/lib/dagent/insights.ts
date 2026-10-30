// Insights — the reads behind the Insights page. The numbers are folded by `lib/runMetrics.ts` (pure, tested);
// this file only picks the window, reads the runs, steps and planned tickets in it, and caches the result.

import { prisma } from "../prisma";
import { cached, DB_CACHE_PREFIX } from "../redis";
import { resolveCredential } from "../providerCredentials";
import { getOrCreateSetting } from "../settings";
import { computeInsights, overBudget, type Insights, type MetricTicket, type TicketCost } from "../runMetrics";
import { flowOf, GRAPHS } from "./graph";

export const INSIGHTS_PERIODS = ["14d", "sprint"] as const;
export type InsightsPeriod = (typeof INSIGHTS_PERIODS)[number];

export type InsightsPayload = Omit<Insights, "nodes"> & {
  /** The window actually served — `sprint` falls back to `14d` when no plan has sprint dates. */
  period: InsightsPeriod;
  sprint: string;
  nodes: (Insights["nodes"][number] & { label: string })[];
  budgetUsd: number;
  overBudget: TicketCost[];
};

const DAY = 86_400_000;
const WINDOW_DAYS = 14;

export const parseInsightsPeriod = (v: string | null): InsightsPeriod => (v === "sprint" ? "sprint" : "14d");

const labelOf = (nodeId: string) => Object.values(GRAPHS).map((g) => g.nodes[nodeId]?.label).find(Boolean) ?? nodeId;

/** The connected identity's newest plan that is not archived — the one Flow Runner is pacing. */
async function activePlan(provider: string, org: string, identityEmail: string) {
  return prisma.sprintPlan.findFirst({
    where: { provider, org, identityEmail, status: { not: "archived" } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, sprint: true, startDate: true, finishDate: true, pointsPerDay: true, items: { select: { ticketId: true } } },
  });
}

/** Run metrics for the last 14 days or the active plan's sprint, scoped to the connected organization. */
export async function loadInsights(period: InsightsPeriod): Promise<InsightsPayload> {
  const setting = await getOrCreateSetting();
  const provider = setting.provider;
  const { org, identity } = await resolveCredential(provider);
  const [runsAgg, ticketsAgg] = await Promise.all([
    prisma.dagentRun.aggregate({ _count: true, _max: { updatedAt: true } }),
    prisma.plannedTicket.aggregate({ _max: { updatedAt: true } }),
  ]);
  const fingerprint = `${runsAgg._count}|${runsAgg._max.updatedAt?.getTime() ?? 0}|${ticketsAgg._max.updatedAt?.getTime() ?? 0}`;
  const key = `${DB_CACHE_PREFIX}insights:${fingerprint}:${period}:${provider}:${org}:${identity.email}:${setting.ticketBudgetUsd}`;
  return cached(key, 60, async () => {
    const plan = await activePlan(provider, org, identity.email);
    const now = Date.now();
    const sprintWindow = period === "sprint" && plan?.startDate && plan.finishDate;
    const from = sprintWindow ? Date.parse(plan.startDate.slice(0, 10) + "T00:00:00Z") : now - WINDOW_DAYS * DAY;
    const to = sprintWindow ? Math.min(now, Date.parse(plan.finishDate.slice(0, 10) + "T23:59:59Z")) : now;

    const rows = await prisma.dagentRun.findMany({
      where: { provider, org, startedAt: { gte: new Date(from), lte: new Date(to) } },
      select: {
        id: true, ticketId: true, ticketTitle: true, graphId: true, state: true, waitReason: true, currentNodeId: true,
        errorMessage: true, prUrl: true, startedAt: true, endedAt: true,
        steps: { select: { nodeId: true, status: true, costUsd: true } },
        transitions: { orderBy: { seq: "desc" }, take: 1, select: { toNode: true, reason: true } },
      },
    });
    const ids = [...new Set([...rows.map((r) => r.ticketId), ...(plan?.items.map((i) => i.ticketId) ?? [])])];
    // A ticket can sit in several plans (one per sprint); the newest row holds its current size and release.
    const planned = ids.length
      ? await prisma.plannedTicket.findMany({
          where: { ticketId: { in: ids }, plan: { provider, org, identityEmail: identity.email } },
          orderBy: { updatedAt: "desc" },
          select: { ticketId: true, points: true, prUrl: true, releasedAt: true },
        })
      : [];
    const tickets = new Map<string, MetricTicket>();
    for (const t of planned) if (!tickets.has(t.ticketId)) tickets.set(t.ticketId, { ...t, releasedAt: t.releasedAt?.getTime() ?? null });

    const insights = computeInsights({
      runs: rows.map((r) => ({
        id: r.id,
        ticketId: r.ticketId,
        ticketTitle: r.ticketTitle,
        flow: flowOf(r.graphId),
        state: r.state,
        waitReason: r.waitReason,
        failedAt: r.currentNodeId,
        errorMessage: r.errorMessage,
        prUrl: r.prUrl,
        startedAt: r.startedAt.getTime(),
        endedAt: r.endedAt?.getTime() ?? null,
        finalTo: r.transitions[0]?.toNode ?? "",
        finalReason: r.transitions[0]?.reason ?? "",
        steps: r.steps,
      })),
      tickets: [...tickets.values()],
      from,
      to,
      plannedPointsPerDay: plan?.pointsPerDay ?? null,
    });
    const over = new Set(overBudget(Object.fromEntries(insights.tickets.map((t) => [t.ticketId, t.costUsd])), setting.ticketBudgetUsd));
    return {
      ...insights,
      period: sprintWindow ? "sprint" : "14d",
      sprint: plan?.sprint ?? "",
      nodes: insights.nodes.map((n) => ({ ...n, label: labelOf(n.nodeId) })),
      budgetUsd: setting.ticketBudgetUsd,
      overBudget: insights.tickets.filter((t) => over.has(t.ticketId)),
    };
  });
}
