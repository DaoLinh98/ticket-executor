import type { PlannedTicket } from "@prisma/client";
import { prisma } from "../prisma";
import { resolveCredential } from "../providerCredentials";
import { cached, DB_CACHE_PREFIX } from "../redis";

/** One ticket's row in the developer's active Flow Runner plan, for the Workflow page's link back. */
export type PlanRowResult = {
  planId: string;
  sprint: string;
  /** 1-based place among the rows still waiting to be implemented; null once the ticket has left the queue. */
  queuePosition: number | null;
  queueLength: number;
  row: PlannedTicket | null;
};

const EMPTY: PlanRowResult = { planId: "", sprint: "", queuePosition: null, queueLength: 0, row: null };

// The queue the scheduler works down: the developer's own tracked rows still pending, in implement order.
const queued = (planId: string) => ({ planId, untracked: false, claim: "mine", implementState: "pending", implementOrder: { gt: 0 } });

/**
 * The ticket's row in the newest active plan of the connected org and identity — the plan Flow Runner acts on.
 * Cached on the plans' own change stamps, so a row the scheduler just moved is never served stale.
 */
export async function planRowFor(provider: string, ticketId: string): Promise<PlanRowResult> {
  if (!ticketId) return EMPTY;
  const { org, identity } = await resolveCredential(provider);
  if (!org) return EMPTY;
  const plans = { status: "active", provider, org, identityEmail: identity.email };
  const [items, heads] = await Promise.all([
    prisma.plannedTicket.aggregate({ where: { plan: plans }, _count: true, _max: { updatedAt: true } }),
    prisma.sprintPlan.aggregate({ where: plans, _count: true, _max: { updatedAt: true } }),
  ]);
  const stamp = [items._count, items._max.updatedAt?.getTime() ?? 0, heads._count, heads._max.updatedAt?.getTime() ?? 0].join("|");
  return cached(`${DB_CACHE_PREFIX}planRow:${provider}:${org}:${identity.email}:${ticketId}:${stamp}`, 30, async () => {
    const row = await prisma.plannedTicket.findFirst({
      where: { ticketId, untracked: false, plan: plans },
      orderBy: { plan: { updatedAt: "desc" } },
      include: { plan: { select: { id: true, sprint: true } } },
    });
    if (!row) return EMPTY;
    const { plan, ...rest } = row;
    const queue = await prisma.plannedTicket.findMany({ where: queued(plan.id), orderBy: { implementOrder: "asc" }, select: { ticketId: true } });
    const at = queue.findIndex((q) => q.ticketId === ticketId);
    return { planId: plan.id, sprint: plan.sprint, queuePosition: at < 0 ? null : at + 1, queueLength: queue.length, row: rest };
  });
}
