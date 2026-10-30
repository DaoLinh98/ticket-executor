// The soft per-ticket budget (`Setting.ticketBudgetUsd`, 0 = off). Nothing is cancelled: a run in flight finishes,
// and a person can still start anything by hand. What stops is automation spending more on its own — an
// unattended retry or review fix on a ticket that has already cost what the developer said it is worth.
import { prisma } from "../prisma";
import { getOrCreateSetting } from "../settings";
import { overBudget } from "../runMetrics";

/** Lifetime D-Agent spend per ticket. */
export async function ticketSpend(ticketIds: string[]): Promise<Record<string, number>> {
  if (!ticketIds.length) return {};
  const runs = await prisma.dagentRun.findMany({
    where: { ticketId: { in: ticketIds } },
    select: { ticketId: true, steps: { select: { costUsd: true } } },
  });
  const spend: Record<string, number> = {};
  for (const r of runs) spend[r.ticketId] = (spend[r.ticketId] ?? 0) + r.steps.reduce((sum, s) => sum + s.costUsd, 0);
  return spend;
}

/** The tickets, of these, that automation should no longer spend on by itself. */
export async function overBudgetTickets(ticketIds: string[]): Promise<Set<string>> {
  const { ticketBudgetUsd } = await getOrCreateSetting();
  if (!(ticketBudgetUsd > 0)) return new Set();
  return new Set(overBudget(await ticketSpend(ticketIds), ticketBudgetUsd));
}
