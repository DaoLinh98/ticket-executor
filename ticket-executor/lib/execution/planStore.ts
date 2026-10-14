// Reads and writes for the sprint plan — the durable half of `lib/sprintPlan.ts`.
//
// The arithmetic is a pure module with a test suite, this file is the part that
// touches Postgres. The scheduler reads what is written here; nothing recomputes
// a release day at read time, because a plan that silently re-dates itself when
// the sprint's data shifts is a plan nobody can be held to.

import { prisma } from "../prisma";
import { CLAUDE_EFFORTS } from "../claudeOptions";
import type { DevIdentity } from "../identity";
import { claimSprint, type ClaimedTicket, type Remembered } from "../sprintClaim";
import {
  buildPlan,
  planDiff,
  releaseDays,
  reorderQueue,
  retryDenial,
  type PlanConfig,
  type PlanDiff,
  type PlanInput,
  type QueueMove,
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
    manual: i.addedByUser,
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

async function computePlan(
  key: PlanKey,
  live: Ticket[],
  identity: DevIdentity,
  triage: TriageResult | null,
  window: { startDate: string; finishDate: string },
  today: string,
  cfg: PlanConfig
) {
  const claimed = await claimedSprint(key, live, identity);
  const existing = await findPlan(key);
  const kept = new Map((existing?.items ?? []).filter((i) => i.implementOrder > 0).map((i) => [i.ticketId, i.implementOrder]));
  const inputs = planInputs(claimed, triage).map((input) =>
    input.order === undefined && kept.has(input.ticket.id) ? { ...input, order: kept.get(input.ticket.id) } : input
  );
  return { computed: buildPlan(inputs, window, today, cfg), existing };
}

export async function previewRebuild(
  key: PlanKey,
  live: Ticket[],
  identity: DevIdentity,
  triage: TriageResult | null,
  window: { startDate: string; finishDate: string },
  today: string,
  cfg: PlanConfig
): Promise<PlanDiff & { overflowPoints: number; titles: Record<string, string> }> {
  const { computed, existing } = await computePlan(key, live, identity, triage, window, today, cfg);
  const diff = planDiff(existing?.items ?? [], computed.tickets);
  return {
    ...diff,
    overflowPoints: computed.overflowPoints,
    titles: Object.fromEntries(computed.tickets.map((t) => [t.ticketId, t.title])),
  };
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
  const { computed } = await computePlan(key, live, identity, triage, window, today, cfg);
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

export async function recentAutomation(planId: string, take = 50, ticketId = "") {
  return prisma.automationEvent.findMany({
    where: { ...(planId ? { planId } : {}), ...(ticketId ? { ticketId } : {}) },
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

/** Take an unstarted ticket out of the plan. A row the queue has touched, or that
 *  has a run, a pull request or a release, is history and stays. */
export async function removeTicketFromPlan(plannedId: string): Promise<{ ok: boolean; error?: string }> {
  const item = await prisma.plannedTicket.findUnique({ where: { id: plannedId } });
  if (!item) return { ok: false, error: "No such planned ticket." };
  if (item.implementState !== "pending" || item.runId || item.prUrl || item.releasedAt) {
    return { ok: false, error: "This ticket has already been worked, so it stays in the plan as a record." };
  }
  await prisma.plannedTicket.delete({ where: { id: plannedId } });
  await logAutomation({
    planId: item.planId,
    ticketId: item.ticketId,
    action: "implement",
    outcome: "skipped",
    reason: "removed-by-user",
    detail: "Removed from the plan by hand.",
  });
  return { ok: true };
}

/** Append a ticket to the plan, last in the implement queue.
 *
 *  Nothing has been built yet: the row is `pending`, so the queue works it after
 *  everything already planned, and it is released on the last release day the
 *  plan already uses (or the first one left, when the plan is empty). A rebuild
 *  re-dates it like any other unstarted row. */
export async function addTicketToPlan(
  plan: { id: string; startDate: string; finishDate: string },
  ticket: { ticketId: string; title: string; project: string; points: number; estimateHours: number },
  today: string
): Promise<{ ok: boolean; error?: string }> {
  const existing = await prisma.plannedTicket.findUnique({
    where: { planId_ticketId: { planId: plan.id, ticketId: ticket.ticketId } },
  });
  if (existing) return { ok: false, error: "This ticket is already in the plan." };

  const rows = await prisma.plannedTicket.findMany({ where: { planId: plan.id }, select: { implementOrder: true, releaseDay: true } });
  const days = releaseDays({ startDate: plan.startDate, finishDate: plan.finishDate }, today);
  const lastDay = rows.map((r) => r.releaseDay).filter(Boolean).sort().pop() ?? days[0] ?? today;
  await prisma.plannedTicket.create({
    data: {
      planId: plan.id,
      ticketId: ticket.ticketId,
      title: ticket.title,
      project: ticket.project,
      points: ticket.points,
      estimateHours: ticket.estimateHours,
      implementOrder: Math.max(0, ...rows.map((r) => r.implementOrder)) + 1,
      releaseDay: lastDay,
      addedByUser: true,
    },
  });
  await logAutomation({
    planId: plan.id,
    ticketId: ticket.ticketId,
    action: "implement",
    outcome: "skipped",
    reason: "added-by-user",
    detail: `Added to the plan by hand, last in the implement queue, release day ${lastDay}.`,
  });
  return { ok: true };
}

export async function moveInQueue(plannedId: string, move: QueueMove): Promise<{ ok: boolean; error?: string }> {
  const item = await prisma.plannedTicket.findUnique({ where: { id: plannedId } });
  if (!item) return { ok: false, error: "No such planned ticket." };
  const movable = (i: { implementState: string; implementOrder: number; claim: string; runId: string; prUrl: string; releasedAt: Date | null }) =>
    i.implementState === "pending" && i.implementOrder > 0 && i.claim === "mine" && !i.runId && !i.prUrl && !i.releasedAt;
  if (!movable(item)) return { ok: false, error: "Only a ticket still waiting in the queue can be moved." };
  const siblings = (await prisma.plannedTicket.findMany({ where: { planId: item.planId } })).filter(movable);
  const next = reorderQueue(siblings, plannedId, move);
  if (!next) return { ok: false, error: "It is already there." };
  await prisma.$transaction(
    [...next].map(([id, implementOrder]) => prisma.plannedTicket.update({ where: { id }, data: { implementOrder } }))
  );
  await logAutomation({
    planId: item.planId,
    ticketId: item.ticketId,
    action: "implement",
    outcome: "skipped",
    reason: "reordered-by-user",
    detail: move === "top" ? "Moved to the front of the implement queue." : `Moved ${move} in the implement queue.`,
  });
  return { ok: true };
}

export async function setReleaseDay(plannedId: string, day: string, today: string): Promise<{ ok: boolean; error?: string }> {
  const item = await prisma.plannedTicket.findUnique({ where: { id: plannedId }, include: { plan: true } });
  if (!item) return { ok: false, error: "No such planned ticket." };
  if (item.releasedAt) return { ok: false, error: "This ticket has already been released." };
  if (item.claim !== "mine") return { ok: false, error: "This ticket is no longer assigned to you." };
  const days = releaseDays({ startDate: item.plan.startDate, finishDate: item.plan.finishDate }, today);
  if (!days.includes(day)) return { ok: false, error: "Pick a working day inside the sprint that has not passed." };
  await prisma.plannedTicket.update({ where: { id: plannedId }, data: { releaseDay: day } });
  await logAutomation({
    planId: item.planId,
    ticketId: item.ticketId,
    action: "release",
    outcome: "skipped",
    reason: "redated-by-user",
    detail: `Release day moved from ${item.releaseDay || "none"} to ${day}.`,
  });
  return { ok: true };
}

export async function setRunOptions(plannedId: string, model: string, effort: string): Promise<{ ok: boolean; error?: string }> {
  const item = await prisma.plannedTicket.findUnique({ where: { id: plannedId } });
  if (!item) return { ok: false, error: "No such planned ticket." };
  if (item.implementState !== "pending" || item.runId || item.prUrl || item.releasedAt) {
    return { ok: false, error: "Model and effort can only be changed before the ticket starts." };
  }
  if (!/^[\w.\-[\]]{1,80}$/.test(model)) return { ok: false, error: "Unknown model." };
  if (!(CLAUDE_EFFORTS as readonly string[]).includes(effort)) return { ok: false, error: "Unknown effort." };
  await prisma.plannedTicket.update({ where: { id: plannedId }, data: { model, effort } });
  await logAutomation({
    planId: item.planId,
    ticketId: item.ticketId,
    action: "implement",
    outcome: "skipped",
    reason: "run-options-by-user",
    detail: `Implement run set to ${model} at ${effort} effort (was ${item.model} at ${item.effort}).`,
  });
  return { ok: true };
}

export async function holdPlannedTicket(plannedId: string): Promise<{ ok: boolean; error?: string }> {
  const item = await prisma.plannedTicket.findUnique({ where: { id: plannedId } });
  if (!item) return { ok: false, error: "No such planned ticket." };
  if (item.implementState !== "pending" || item.runId || item.prUrl || item.releasedAt || item.claim !== "mine") {
    return { ok: false, error: "Only a ticket still waiting in the queue can be put on hold." };
  }
  await prisma.plannedTicket.update({ where: { id: plannedId }, data: { implementState: "skipped" } });
  await logAutomation({
    planId: item.planId,
    ticketId: item.ticketId,
    action: "implement",
    outcome: "skipped",
    reason: "held-by-user",
    detail: "Put on hold by hand. The scheduler leaves it alone until you resume it.",
  });
  return { ok: true };
}
