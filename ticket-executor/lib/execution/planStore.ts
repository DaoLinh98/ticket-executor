// Reads and writes for the sprint plan — the durable half of `lib/sprintPlan.ts`.
//
// The split is the same one `knowledge.ts` / `knowledgeStore.ts` already make:
// the arithmetic is a pure module with a test suite, this file is the part that
// touches Postgres. The scheduler reads what is written here; nothing recomputes
// a release day at read time, because a plan that silently re-dates itself when
// the sprint's data shifts is a plan nobody can be held to.

import { prisma } from "../prisma";
import type { DevIdentity } from "../identity";
import { claimSprint, type ClaimedTicket, type Remembered } from "../sprintClaim";
import {
  buildPlan,
  retryDenial,
  type PlanConfig,
  type PlanInput,
  type SprintPlanResult,
} from "../sprintPlan";
import { pendingActionFor, stageOf, type PendingAction, type Stage } from "../ticketLifecycle";
import type { TriageResult, TriagedTicket } from "./triage";
import type { Ticket } from "../types";

export type PlanKey = {
  provider: string;
  org: string;
  project: string;
  sprint: string;
  identityEmail: string;
};

/** Fold a triage result into planner inputs.
 *
 *  Three things cross over, and only three: the re-estimate becomes the points
 *  the calendar is laid out with, the work order becomes the queue, and
 *  `needsClarification` becomes the flag that keeps a ticket out of the
 *  scheduler. The reasons and the comment drafts stay in the triage row — they
 *  are for the developer to read, not for the planner to act on. */
export function planInputs(claimed: ClaimedTicket[], triage: TriageResult | null): PlanInput[] {
  const byId = new Map<string, TriagedTicket>(
    (triage?.tickets ?? []).map((t) => [String(t.id), t])
  );
  return claimed.map((c) => {
    const statusBlocked = stageOf(c.ticket.status) === "blocked";
    const base = { ticket: c.ticket, claim: c.claim, assigneeNow: c.assigneeNow, blocked: statusBlocked };
    const t = byId.get(String(c.ticket.id));
    if (!t) return base;
    return {
      ...base,
      points: t.suggestedPoints > 0 ? t.suggestedPoints : undefined,
      order: t.workOrder > 0 ? t.workOrder : undefined,
      blocked: statusBlocked || t.needsClarification || t.readiness === "blocked",
    };
  });
}

/**
 * What the app already knows about this sprint, and whether it has evidence of
 * having worked each ticket.
 *
 * Evidence is read from two places because the plan is only half the record: a
 * ticket the developer ran by hand from the Ticket Execution screen has a `Run`
 * row and a pull request but no plan progress at all, and calling that untouched
 * would drop it out of the sprint the moment QA takes it over.
 */
export async function rememberSprint(key: PlanKey): Promise<Remembered[]> {
  const plan = await findPlan(key);
  if (!plan) return [];
  const ids = plan.items.map((i) => i.ticketId);
  const runs = ids.length
    ? await prisma.run.findMany({
        where: {
          ticketId: { in: ids },
          provider: key.provider,
          org: key.org,
          ...(key.project ? { project: key.project } : {}),
        },
        select: { ticketId: true },
      })
    : [];
  const ran = new Set(runs.map((r) => r.ticketId));
  return plan.items.map((i) => ({
    ticketId: i.ticketId,
    title: i.title,
    points: i.points,
    estimateHours: i.estimateHours,
    worked:
      i.implementState !== "pending" ||
      !!i.releasedAt ||
      !!i.prUrl ||
      i.claim === "handed-off" ||
      ran.has(i.ticketId),
  }));
}

/** The developer's sprint as claims: live assignment merged with what the plan
 *  remembers. The one place both halves of the question meet. */
export async function claimedSprint(
  key: PlanKey,
  live: Ticket[],
  identity: DevIdentity
): Promise<ClaimedTicket[]> {
  return claimSprint(live, await rememberSprint(key), identity);
}

export async function findPlan(key: PlanKey) {
  return prisma.sprintPlan.findUnique({
    where: {
      provider_org_project_sprint_identityEmail: key,
    },
    include: { items: { orderBy: { implementOrder: "asc" } } },
  });
}

export async function planById(id: string) {
  return prisma.sprintPlan.findUnique({ where: { id }, include: { items: { orderBy: { implementOrder: "asc" } } } });
}

/**
 * Write a freshly computed plan.
 *
 * Upsert on the sprint key, then replace the items — but **only the ones nothing
 * has happened to yet**. A ticket the agent has already implemented, or one
 * already released, keeps its row: re-planning a sprint mid-flight is normal
 * (work lands, scope moves), and it must never rewrite the record of what was
 * actually done. That is why this is a per-item merge rather than a delete-all.
 */
export async function savePlan(
  key: PlanKey,
  window: { startDate: string; finishDate: string },
  cfg: PlanConfig,
  computed: SprintPlanResult,
  opts: { reviewers?: string[]; includeWider?: boolean } = {}
) {
  const plan = await prisma.sprintPlan.upsert({
    where: { provider_org_project_sprint_identityEmail: key },
    create: {
      ...key,
      startDate: window.startDate,
      finishDate: window.finishDate,
      pointsPerDay: cfg.pointsPerDay,
      hoursPerDay: cfg.hoursPerDay,
      hoursPerPoint: cfg.hoursPerPoint,
      maxTicketsPerDay: cfg.maxTicketsPerDay,
      reviewers: opts.reviewers ?? [],
      ...(opts.includeWider === undefined ? {} : { includeWider: opts.includeWider }),
    },
    update: {
      startDate: window.startDate,
      finishDate: window.finishDate,
      pointsPerDay: cfg.pointsPerDay,
      hoursPerDay: cfg.hoursPerDay,
      hoursPerPoint: cfg.hoursPerPoint,
      maxTicketsPerDay: cfg.maxTicketsPerDay,
      ...(opts.reviewers ? { reviewers: opts.reviewers } : {}),
      ...(opts.includeWider === undefined ? {} : { includeWider: opts.includeWider }),
    },
  });

  const existing = await prisma.plannedTicket.findMany({ where: { planId: plan.id } });
  const byTicket = new Map(existing.map((e) => [e.ticketId, e]));

  for (const t of computed.tickets) {
    const prev = byTicket.get(t.ticketId);
    // Once a ticket has been worked or released, the plan describes history and
    // must not be re-dated underneath it. Its *claim* still moves, though — a
    // ticket is handed to QA precisely because it was finished, so the settled
    // rows are the ones that change hands most — and that is the one field a
    // rebuild must keep current on them.
    const settled = prev && (prev.implementState !== "pending" || !!prev.releasedAt);
    if (settled) {
      await prisma.plannedTicket.update({
        where: { id: prev.id },
        data: { claim: t.claim, assigneeNow: t.assigneeNow, title: t.title, ...(t.project ? { project: t.project } : {}) },
      });
      continue;
    }
    await prisma.plannedTicket.upsert({
      where: { planId_ticketId: { planId: plan.id, ticketId: t.ticketId } },
      create: {
        planId: plan.id,
        ticketId: t.ticketId,
        title: t.title,
        project: t.project,
        implementOrder: t.implementOrder,
        points: t.points,
        estimateHours: t.estimateHours,
        releaseDay: t.releaseDay,
        blocked: t.blocked,
        claim: t.claim,
        assigneeNow: t.assigneeNow,
      },
      // `unblockedByUser` is deliberately absent from both create and update.
      // Every other field here is recomputed from the newest triage, which is
      // the point of a rebuild; the override is not triage's to recompute. It
      // stays on the row until the developer clears it, and the default on
      // create is already false.
      update: {
        title: t.title,
        ...(t.project ? { project: t.project } : {}),
        implementOrder: t.implementOrder,
        points: t.points,
        estimateHours: t.estimateHours,
        releaseDay: t.releaseDay,
        blocked: t.blocked,
        claim: t.claim,
        assigneeNow: t.assigneeNow,
      },
    });
  }

  // Nothing is deleted here, and that is the point. A ticket that left the
  // developer's hands comes back through `claimSprint()` as `handed-off` or
  // `dropped` and is in `computed` above, so the row is updated rather than
  // removed: the sprint is what they carried this fortnight, not what still
  // bears their name on the last day of it. Junk from a plan built against the
  // wrong sprint is dealt with by archiving the plan, not by quietly eroding it.
  return planById(plan.id);
}

/** Recompute and store in one step — what the page's "Build plan" does. */
export async function rebuildPlan(
  key: PlanKey,
  live: Ticket[],
  identity: DevIdentity,
  triage: TriageResult | null,
  window: { startDate: string; finishDate: string },
  today: string,
  cfg: PlanConfig,
  opts: { reviewers?: string[]; includeWider?: boolean } = {}
) {
  const claimed = await claimedSprint(key, live, identity);
  const computed = buildPlan(planInputs(claimed, triage), window, today, cfg);
  const saved = await savePlan(key, window, cfg, computed, opts);
  if (!saved) return saved;

  const statusById = new Map(live.map((t) => [String(t.id), t.status]));
  let changed = false;
  for (const row of saved.items) {
    const status = statusById.get(row.ticketId);
    if (status === undefined) continue;
    const stage = stageOf(status);
    const current = row.pendingAction as PendingAction;
    const next = pendingActionFor({ stage, prevStage: (row.stage || "") as Stage | "", prMerged: row.prMerged, current });
    if (stage === row.stage && next === current) continue;
    await prisma.plannedTicket.update({
      where: { id: row.id },
      data: { stage, ...(next !== current ? { pendingAction: next, pendingSince: next ? new Date() : null } : {}) },
    });
    changed = true;
  }
  return changed ? planById(saved.id) : saved;
}

export async function setPlanStatus(id: string, status: "draft" | "active" | "archived") {
  return prisma.sprintPlan.update({ where: { id }, data: { status } });
}

export async function setPlanAutomation(
  id: string,
  patch: { autoImplement?: boolean; autoRelease?: boolean; autoResolveReview?: boolean; autoDraftQaReply?: boolean; reviewers?: string[] }
) {
  return prisma.sprintPlan.update({ where: { id }, data: patch });
}

/**
 * Override — or withdraw the override on — triage's "needs clarification".
 *
 * Written through a function rather than from the route so the audit row is not
 * optional: letting a ticket triage refused run unattended is exactly the kind
 * of decision that has to be answerable a fortnight later, and a flag with no
 * event behind it answers nothing.
 *
 * Returns null when the row is gone, which the caller reports as a 404 rather
 * than pretending the write happened.
 */
export async function setTicketUnblocked(plannedId: string, unblocked: boolean) {
  const item = await prisma.plannedTicket.findUnique({ where: { id: plannedId } });
  if (!item) return null;

  const updated = await prisma.plannedTicket.update({
    where: { id: plannedId },
    data: { unblockedByUser: unblocked },
  });
  await logAutomation({
    planId: item.planId,
    ticketId: item.ticketId,
    action: "implement",
    outcome: "skipped",
    reason: unblocked ? "unblocked-by-user" : "reblocked-by-user",
    detail: unblocked
      ? "Triage said this ticket needs clarification. You marked it ready to run anyway."
      : "The override was withdrawn — this ticket waits for clarification again.",
  });
  return updated;
}

// ---- the audit log ----

/** Record what the scheduler decided. Never throws: an automation that cannot
 *  write its own audit row must still not take the action twice, and losing the
 *  row is strictly less bad than crashing the tick. */
export async function logAutomation(e: {
  planId?: string;
  ticketId?: string;
  action: "implement" | "release" | "review" | "abort" | "watch";
  outcome: "started" | "done" | "skipped" | "failed";
  reason?: string;
  detail?: string;
}) {
  try {
    await prisma.automationEvent.create({
      data: {
        planId: e.planId ?? "",
        ticketId: e.ticketId ?? "",
        action: e.action,
        outcome: e.outcome,
        reason: e.reason ?? "",
        detail: (e.detail ?? "").slice(0, 2000),
      },
    });
  } catch {
    /* the log is evidence, not a dependency */
  }
}

export async function recentAutomation(planId: string, take = 50) {
  return prisma.automationEvent.findMany({
    where: planId ? { planId } : {},
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * Put one stopped ticket back in the implement queue.
 *
 * The manual half of the queue, and the counterpart to `releasePlannedTicket()`
 * and `startReviewRun()`: it does not spawn anything. It clears the row back to
 * `pending` and lets the scheduler pick it up on its own terms, so a retried
 * ticket goes through exactly the same admission, claim and concurrency checks
 * as one that was never tried — a second starter here would be the second
 * admission path invariant 3 forbids.
 *
 * `runId` is cleared with it. Left pointing at the failed run, `reconcileImplement()`
 * would read that run's finished state on the next tick and mark the row failed
 * again before the new one had started.
 */
export async function retryPlannedTicket(
  plannedId: string
): Promise<{ ok: boolean; error?: string }> {
  const item = await prisma.plannedTicket.findUnique({ where: { id: plannedId } });
  if (!item) return { ok: false, error: "No such planned ticket." };

  const denial = retryDenial({
    implementState: item.implementState,
    prUrl: item.prUrl,
    claim: item.claim,
    implementOrder: item.implementOrder,
  });
  if (denial) return { ok: false, error: denial };

  await prisma.plannedTicket.update({
    where: { id: plannedId },
    data: { implementState: "pending", runId: "" },
  });
  // Logged like every other decision, including this one's refusals above: a row
  // that silently changed state between two ticks is one nobody can explain the
  // morning after.
  await logAutomation({
    planId: item.planId,
    ticketId: item.ticketId,
    action: "implement",
    outcome: "skipped",
    reason: "retry-by-user",
    detail: `Requeued by hand after "${item.implementState}". The scheduler picks it up on its next pass.`,
  });
  return { ok: true };
}
