// Runs that ended on NEEDS_REVIEW: the harness decided (implement changed nothing, or the PR read-back did not
// match) and ended the run — nothing waits on a person to resume it. The row is flagged on Flow Runner until
// the developer marks it reviewed. The mark is an append to the automation log keyed by the run id, so it is
// as auditable as the decision it answers and needs no column of its own.
import { prisma } from "../prisma";
import { runOutcomes } from "../dagent";

export const REVIEW_ACK = "review-acknowledged";

export type RunNeedingReview = { plannedTicketId: string; ticketId: string; runId: string; reason: string };

/** Each tracked row whose current run ended on NEEDS_REVIEW and has not been marked reviewed. */
export async function reviewsWaiting(planId: string): Promise<RunNeedingReview[]> {
  const rows = await prisma.plannedTicket.findMany({
    where: { planId, untracked: false, runId: { not: "" } },
    select: { id: true, ticketId: true, runId: true },
  });
  if (!rows.length) return [];
  const outcomes = await runOutcomes(rows.map((r) => r.runId));
  const flagged = outcomes.filter((o) => typeof o.output.needsReview === "string" && o.output.needsReview);
  if (!flagged.length) return [];
  const acked = new Set(
    (
      await prisma.automationEvent.findMany({
        where: { planId, reason: REVIEW_ACK, detail: { in: flagged.map((o) => o.id) } },
        select: { detail: true },
      })
    ).map((e) => e.detail)
  );
  return flagged
    .filter((o) => !acked.has(o.id))
    .flatMap((o) => {
      const row = rows.find((r) => r.runId === o.id);
      return row ? [{ plannedTicketId: row.id, ticketId: row.ticketId, runId: o.id, reason: String(o.output.needsReview) }] : [];
    });
}

/** The developer has looked at a run that ended on NEEDS_REVIEW. */
export async function acknowledgeReview(plannedId: string): Promise<{ ok: boolean; error?: string }> {
  const item = await prisma.plannedTicket.findUnique({ where: { id: plannedId }, select: { planId: true, ticketId: true, runId: true } });
  if (!item?.runId) return { ok: false, error: "This ticket has no run to mark reviewed." };
  // Written directly rather than through `logAutomation()`, which swallows a failed write — this row is state.
  await prisma.automationEvent.create({
    data: { planId: item.planId, ticketId: item.ticketId, action: "implement", outcome: "done", reason: REVIEW_ACK, detail: item.runId },
  });
  return { ok: true };
}
