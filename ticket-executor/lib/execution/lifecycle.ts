import { hasIdentity, isMine, isSamePerson } from "../identity";
import { prisma } from "../prisma";
import { resolveCredential } from "../providerCredentials";
import { getOrCreateSetting } from "../settings";
import { commentsSince, pendingActionFor, QA_STAGES, stageOf, type PendingAction, type Stage } from "../ticketLifecycle";
import { deliverablesOnly, isoDay } from "../sprintPlan";
import {
  cycleSince,
  loadCommentMarks,
  loadLinkedPullRequest,
  loadMyOpenTickets,
  loadSprintCycle,
  loadTicketsByIds,
  normalizeProvider,
  resolveStatusForUpdate,
  updateTicketStatus,
} from "../tickets";
import { logAutomation, rebuildPlan } from "./planStore";
import { startQaReply } from "./qaReply";

export const QA_STATUS = "In QA";

const PR_SCAN_MS = 6 * 60_000;
const lastPrScan = new Map<string, number>();
const SYNC_MS = 10 * 60_000;
const lastSync = new Map<string, number>();

export type WatchPlan = {
  id: string;
  provider: string;
  org: string;
  project: string;
  sprint: string;
  identityEmail: string;
  includeWider: boolean;
  startDate: string;
  finishDate: string;
  autoDraftQaReply: boolean;
};

export type SyncPlan = WatchPlan & {
  pointsPerDay: number;
  hoursPerDay: number;
  hoursPerPoint: number;
  maxTicketsPerDay: number;
};

export async function syncNewTickets(plan: SyncPlan, now = new Date(), force = false): Promise<number> {
  if (plan.project) return 0;
  if (!force && now.getTime() - (lastSync.get(plan.id) ?? 0) < SYNC_MS) return 0;
  lastSync.set(plan.id, now.getTime());

  const { org, identity } = await resolveCredential(plan.provider);
  if (!org || org !== plan.org || !hasIdentity(identity) || identity.email !== plan.identityEmail) return 0;

  const provider = normalizeProvider(plan.provider);
  const today = isoDay(now);
  const window = { startDate: plan.startDate, finishDate: plan.finishDate };
  const loaded = await loadMyOpenTickets(
    provider,
    identity,
    cycleSince({ anchorProject: "", sprint: plan.sprint, ...window }, today)
  );
  if (!loaded.connected || loaded.tickets.length === 0) return 0;

  const live = deliverablesOnly(loaded.tickets, provider);
  const known = new Set(
    (await prisma.plannedTicket.findMany({ where: { planId: plan.id }, select: { ticketId: true } })).map((r) => r.ticketId)
  );
  const fresh = live.filter((t) => !known.has(String(t.id)) && isMine(t, identity));
  if (!fresh.length && !force) return 0;

  await rebuildPlan(
    { provider: plan.provider, org: plan.org, project: "", sprint: plan.sprint, identityEmail: plan.identityEmail },
    live,
    identity,
    null,
    window,
    today,
    {
      pointsPerDay: plan.pointsPerDay,
      hoursPerDay: plan.hoursPerDay,
      hoursPerPoint: plan.hoursPerPoint,
      maxTicketsPerDay: plan.maxTicketsPerDay,
    }
  );
  if (fresh.length) {
    await logAutomation({
      planId: plan.id, action: "watch", outcome: "done", reason: "new-tickets",
      detail: `Plan rebuilt for newly assigned ticket(s): ${fresh.map((t) => "#" + t.id).join(", ")}.`,
    });
  }
  return fresh.length;
}

export async function rolloverPlans(now = new Date()): Promise<number> {
  const setting = await getOrCreateSetting();
  const anchor = setting.sprintAnchorProject;
  if (!anchor) return 0;
  const plans = await prisma.sprintPlan.findMany({ where: { status: "active", project: "" } });
  let rolled = 0;
  for (const plan of plans) {
    const { org } = await resolveCredential(plan.provider);
    if (!org || org !== plan.org) continue;
    const cycle = await loadSprintCycle(normalizeProvider(plan.provider), anchor).catch(() => null);
    if (!cycle?.sprint || cycle.sprint === plan.sprint) continue;

    const carried = {
      status: "active",
      startDate: cycle.startDate,
      finishDate: cycle.finishDate,
      pointsPerDay: plan.pointsPerDay,
      hoursPerDay: plan.hoursPerDay,
      hoursPerPoint: plan.hoursPerPoint,
      maxTicketsPerDay: plan.maxTicketsPerDay,
      includeWider: plan.includeWider,
      autoImplement: plan.autoImplement,
      autoRelease: plan.autoRelease,
      autoResolveReview: plan.autoResolveReview,
      autoDraftQaReply: plan.autoDraftQaReply,
      reviewers: plan.reviewers,
    };
    const key = { provider: plan.provider, org: plan.org, project: "", sprint: cycle.sprint, identityEmail: plan.identityEmail };
    const next = await prisma.sprintPlan.upsert({
      where: { provider_org_project_sprint_identityEmail: key },
      create: { ...key, ...carried },
      update: carried,
    });

    const taken = new Set(
      (await prisma.plannedTicket.findMany({ where: { planId: next.id }, select: { ticketId: true } })).map((r) => r.ticketId)
    );
    const unfinished = await prisma.plannedTicket.findMany({
      where: { planId: plan.id, claim: "mine", NOT: { stage: "done" } },
      select: { id: true, ticketId: true },
    });
    const moving = unfinished.filter((r) => !taken.has(r.ticketId));
    if (moving.length) {
      await prisma.plannedTicket.updateMany({
        where: { id: { in: moving.map((r) => r.id) } },
        data: { planId: next.id },
      });
    }
    await prisma.sprintPlan.update({ where: { id: plan.id }, data: { status: "archived" } });
    await logAutomation({
      planId: next.id, action: "watch", outcome: "done", reason: "rolled-over",
      detail:
        `${plan.sprint} ended — ${cycle.sprint} started. Carried ${moving.length} unfinished ticket(s): ` +
        (moving.map((r) => "#" + r.ticketId).join(", ") || "none") + ".",
    });
    await syncNewTickets({ ...next, ...carried, project: "" }, now, true);
    rolled += 1;
  }
  return rolled;
}

export async function watchLifecycle(plan: WatchPlan, now = new Date()): Promise<number> {
  const { org, identity } = await resolveCredential(plan.provider);
  if (!org || org !== plan.org || !hasIdentity(identity) || identity.email !== plan.identityEmail) return 0;

  const provider = normalizeProvider(plan.provider);
  const rows = await prisma.plannedTicket.findMany({ where: { planId: plan.id } });
  if (!rows.length) return 0;
  const fetched = await loadTicketsByIds(provider, rows.map((r) => r.ticketId)).catch(() => []);
  if (!fetched.length) return 0;
  const live = new Map(fetched.map((t) => [String(t.id), t]));
  const scanPrs = now.getTime() - (lastPrScan.get(plan.id) ?? 0) >= PR_SCAN_MS;
  if (scanPrs) lastPrScan.set(plan.id, now.getTime());

  let changed = 0;
  for (const row of rows) {
    const ticket = live.get(row.ticketId);
    if (!ticket) continue;

    const stage = stageOf(ticket.status);
    const prevStage = (row.stage || "") as Stage | "";
    const data: {
      stage?: string;
      prUrl?: string;
      prPublished?: boolean;
      prMerged?: boolean;
      pendingAction?: string;
      pendingSince?: Date | null;
      qaCommentAt?: string;
    } = {};

    let prMerged = row.prMerged;
    if (stage === "doing" && prMerged) {
      prMerged = false;
      data.prMerged = false;
    }
    if (stage === "code-review" && !prMerged && scanPrs) {
      const pr = await loadLinkedPullRequest(provider, row.ticketId, row.prUrl || null).catch(() => null);
      if (pr) {
        if (!row.prUrl && pr.prUrl) {
          data.prUrl = pr.prUrl;
          data.prPublished = !pr.isDraft;
        }
        if (pr.status === "completed") {
          prMerged = true;
          data.prMerged = true;
        }
      }
    }

    const current = row.pendingAction as PendingAction;
    let newQcComments = 0;
    if (scanPrs && (QA_STAGES.has(stage) || (stage === "doing" && current === "fix-qa"))) {
      const marks = await loadCommentMarks(provider, row.ticketId).catch(() => null);
      if (marks) {
        const seen = commentsSince(marks, row.qaCommentAt, (name) => isSamePerson("", name, identity));
        if (seen.latestAt !== row.qaCommentAt) data.qaCommentAt = seen.latestAt;
        newQcComments = row.qaCommentAt ? seen.count : 0;
      }
    }

    const next = pendingActionFor({ stage, prevStage, prMerged, current });
    if (stage !== prevStage) data.stage = stage;
    if (next !== current) {
      data.pendingAction = next;
      data.pendingSince = next ? now : null;
    }
    if (!Object.keys(data).length) continue;

    await prisma.plannedTicket.update({ where: { id: row.id }, data });
    changed += 1;

    if (prevStage && stage !== prevStage) {
      await logAutomation({
        planId: plan.id, ticketId: row.ticketId, action: "watch", outcome: "done",
        reason: "stage-changed", detail: `${prevStage} → ${stage} ("${ticket.status}")`,
      });
    }
    if (data.prUrl) {
      await logAutomation({
        planId: plan.id, ticketId: row.ticketId, action: "watch", outcome: "done",
        reason: "pr-adopted", detail: `Linked pull request found: ${data.prUrl}`,
      });
    }
    if (newQcComments > 0) {
      await logAutomation({
        planId: plan.id, ticketId: row.ticketId, action: "watch", outcome: "done",
        reason: "qa-comment", detail: `${newQcComments} new comment(s) from QC.`,
      });
      if (plan.autoDraftQaReply) {
        const drafted = await startQaReply(row.id, { since: row.qaCommentAt, answersUpTo: data.qaCommentAt });
        if (!drafted.ok) {
          await logAutomation({
            planId: plan.id, ticketId: row.ticketId, action: "watch", outcome: "skipped",
            reason: "qa-reply-refused", detail: drafted.error,
          });
        }
      }
    }
    if (next && next !== current) {
      await logAutomation({
        planId: plan.id, ticketId: row.ticketId, action: "watch", outcome: "done",
        reason: next,
        detail:
          next === "move-to-qa"
            ? "The pull request is merged while the ticket is still in Code Review — waiting for you to confirm the move to QA."
            : "The ticket came back from QA — it needs a fix.",
      });
    }
  }
  return changed;
}

export async function moveToQa(plannedId: string): Promise<{ ok: boolean; error: string; status: string }> {
  const item = await prisma.plannedTicket.findUnique({ where: { id: plannedId }, include: { plan: true } });
  if (!item) return { ok: false, error: "No such planned ticket.", status: "" };
  if (item.pendingAction !== "move-to-qa") {
    return { ok: false, error: "This ticket has nothing waiting to be moved to QA.", status: "" };
  }

  const provider = normalizeProvider(item.plan.provider);
  const { org } = await resolveCredential(provider);
  if (org !== item.plan.org) {
    return { ok: false, error: "Switch to this plan's organization before moving its tickets.", status: "" };
  }

  try {
    const resolved = await resolveStatusForUpdate(provider, item.ticketId, QA_STATUS);
    if (!resolved) {
      const error = `This work item's workflow has no state matching "${QA_STATUS}" — move it by hand.`;
      await logAutomation({
        planId: item.planId, ticketId: item.ticketId, action: "watch", outcome: "failed",
        reason: "no-qa-state", detail: error,
      });
      return { ok: false, error, status: "" };
    }
    const status = await updateTicketStatus(provider, item.ticketId, resolved);
    await prisma.plannedTicket.update({
      where: { id: item.id },
      data: { pendingAction: "", pendingSince: null, stage: stageOf(status) },
    });
    await logAutomation({
      planId: item.planId, ticketId: item.ticketId, action: "watch", outcome: "done",
      reason: "moved-to-qa", detail: `Status set to "${status}" after you confirmed.`,
    });
    return { ok: true, error: "", status };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await logAutomation({
      planId: item.planId, ticketId: item.ticketId, action: "watch", outcome: "failed",
      reason: "move-to-qa-failed", detail: error,
    });
    return { ok: false, error, status: "" };
  }
}
