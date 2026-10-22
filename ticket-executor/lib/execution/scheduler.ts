// The scheduler: the part of this app that works when nobody is watching.
//
// Everything automatic the app does happens here, and it is deliberately small,
// because it owns no policy of its own. It asks two questions on a timer —
// "is there a ticket the plan says to work on next" and "is there finished work
// the plan says to hand over today" — and answers both by calling code that
// already exists: `startRun()` for the first, `releasePlannedTicket()` for the
// second.
//
// Three rules it does not get to bend:
//
//   1. **It never spawns anything itself.** Every run goes through `startRun()`,
//      so duplicate-ticket, single-ticket-mode, the concurrency cap and the
//      missing-skill refusal all apply to a scheduled run exactly as they do to
//      one a human pressed a button for. A second admission path is the thing
//      the engine invariant exists to forbid.
//   2. **One process ticks at a time.** The tick takes a Postgres advisory lock,
//      because host and container can share a database, and two schedulers on one
//      plan is two agents in one working tree.
//   3. **Every decision is written down**, including the decision to do nothing.
//      An automation whose refusals are invisible cannot be debugged the morning
//      after — see `AutomationEvent`.

import { hasIdentity, isSamePerson } from "../identity";
import { claimSprint } from "../sprintClaim";
import { deliverablesOnly, isoDay } from "../sprintPlan";
import { prisma } from "../prisma";
import { resolveCredential } from "../providerCredentials";
import { cycleSince, loadMyOpenTickets, loadMySprintTickets, loadPrReviews, normalizeProvider } from "../tickets";
import { logAutomation, rememberSprint } from "./planStore";
import { rolloverPlans, syncNewTickets, watchLifecycle } from "./lifecycle";
import { IMPLEMENT_SKILL, QA_FIX_SKILL, REVIEW_FIX_SKILL } from "./graph/graphs";
import { isFixingQa, MAX_QA_ROUNDS } from "../ticketLifecycle";
import { openQaDraft } from "./qaReply";
import { dueForRelease, releasePlannedTicket } from "./release";
import { reviewVerdict } from "./reviewTrigger";
import { localRepoForPr, openCommentsTotal, pickReviewPr, repoNameFromPrUrl, reviewRoundLimit, reviewTargets } from "./reviewTargets";
import { discoverCompanionRepos } from "../preflight";
import { cancelRun, resumeRateLimitedRuns, startRun } from "./runner";

/** How often the tick runs. Minutes, not seconds: nothing it watches changes
 *  faster than a Claude turn finishes, and a tighter loop would only add
 *  provider round-trips and lock contention for the same answers. */
const TICK_MS = 120_000;

/** Advisory lock key for the tick. A distinct constant rather than a hash of a
 *  string, so it is greppable next to the one `startRun()` uses. */
const TICK_LOCK = 918_273_641;

const TICK_TX_TIMEOUT_MS = 600_000;

/** How many times one ticket may go round the fix-review loop.
 *
 *  Three, because the loop's failure mode is not a wrong fix but an unfixable
 *  finding: the skill classifies architectural and policy findings as "needs a
 *  human decision" and leaves those threads open on purpose. A fourth round
 *  would re-read the same threads and reach the same conclusion, at full price.
 *  Hitting the ceiling is a state (`needs-human`), not a failure. */
const MAX_REVIEW_ROUNDS = 3;

const CLOSED_PR_STATUSES = ["Completed", "Abandoned"];

/** How many failed releases one ticket gets before the scheduler stops retrying
 *  it. The Release button still works by hand. */
const MAX_RELEASE_ATTEMPTS = 3;

async function releaseRetriesExhausted(planId: string, ticketId: string): Promise<boolean> {
  const failures = await prisma.automationEvent.count({
    where: { planId, ticketId, action: "release", outcome: "failed" },
  });
  if (failures < MAX_RELEASE_ATTEMPTS) return false;
  const already = await prisma.automationEvent.findFirst({
    where: { planId, ticketId, action: "release", reason: "retries-exhausted" },
    select: { id: true },
  });
  if (!already) {
    await logAutomation({
      planId, ticketId, action: "release", outcome: "skipped", reason: "retries-exhausted",
      detail: `Automatic release failed ${MAX_RELEASE_ATTEMPTS} times — stopped retrying. Release it by hand once the cause is fixed.`,
    });
  }
  return true;
}

/** How long after a review run finishes before its ticket may be looked at
 *  again. The run has just pushed commits and written replies; the provider
 *  needs a moment to settle, and re-reading inside that window mostly returns
 *  the run's own writes. */
const REVIEW_COOLDOWN_MS = 10 * 60_000;

/** How often one plan's released tickets are polled for new review comments.
 *
 *  Longer than the tick, because this is the only part of the scheduler whose
 *  cost scales with the size of the sprint: a released ticket stays a candidate
 *  for the rest of the sprint, so without a floor a five-ticket sprint would pay
 *  five provider reads every two minutes forever. Held in memory rather than on
 *  the row because it is a cost control, not a fact about the ticket — losing it
 *  to a restart costs one extra scan. */
const REVIEW_SCAN_MS = 6 * 60_000;
const lastReviewScan = new Map<string, number>();

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export type TickReport = {
  plans: number;
  implementStarted: number;
  /** Runs started to answer a reviewer on an already-published pull request. */
  reviewStarted: number;
  released: number;
  skipped: number;
  /** Runs stopped because the ticket stopped being the developer's. */
  aborted: number;
  /** Runs continued after the Claude account's usage limit reset. */
  resumed: number;
  watched: number;
};

/**
 * One pass over every active plan.
 *
 * Exported so it can be run by hand — the "Run now" button and a test both want
 * exactly this, and a scheduler whose only trigger is the passage of time is one
 * nobody can check.
 */
export async function tick(now = new Date()): Promise<TickReport> {
  const report: TickReport = { plans: 0, implementStarted: 0, reviewStarted: 0, released: 0, skipped: 0, aborted: 0, resumed: 0, watched: 0 };
  await prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${TICK_LOCK}::bigint) AS locked
      `;
      if (!locked) return;
      await runTick(now, report);
    },
    { timeout: TICK_TX_TIMEOUT_MS, maxWait: 5_000 }
  );
  return report;
}

async function runTick(now: Date, report: TickReport): Promise<void> {
  // Before the plans, and outside the loop: a run parked on a spent quota
  // belongs to whatever plan started it, and the account it is waiting on is
  // the machine's, not the sprint's. It is also the cheapest work in the
  // tick — one indexed read that normally returns nothing.
  report.resumed = await resumeRateLimitedRuns(now);
  await rolloverPlans(now);

  const plans = await prisma.sprintPlan.findMany({ where: { status: "active" } });
  report.plans = plans.length;
  const today = isoDay(now);

  for (const plan of plans) {
    // Before acting on the plan, find out whether it is still describing the
    // developer's work. Ownership is the one input to every decision below
    // that the app does not control, so it is re-read first rather than
    // trusted from whenever the plan was last built by hand.
    report.aborted += await refreshClaims(plan);
    report.watched += await syncNewTickets(plan, now);
    report.watched += await watchLifecycle(plan, now);
    if (plan.autoRelease) {
      for (const item of await dueForRelease(plan.id, today)) {
        if (await releaseRetriesExhausted(plan.id, item.ticketId)) {
          report.skipped += 1;
          continue;
        }
        const outcome = await releasePlannedTicket(item.id);
        if (outcome.ok) report.released += 1;
        else report.skipped += 1;
      }
    }
    // Before the queue, not after it. An open review comment is work somebody
    // is already waiting on, while the next ticket in the queue is work nobody
    // has seen yet — and both compete for the same concurrency slot.
    if (plan.autoResolveReview) {
      if (await resolveNextReview(plan)) report.reviewStarted += 1;
    }
    if (plan.autoImplement) {
      const started = await startNextTicket(plan, today);
      if (started) report.implementStarted += 1;
      else report.skipped += 1;
    }
  }
}

type ActivePlan = { id: string; provider: string; org: string; project: string };

type ClaimPlan = ActivePlan & {
  sprint: string;
  identityEmail: string;
  includeWider: boolean;
  startDate: string;
  finishDate: string;
};

async function rootRepoFor(plan: ActivePlan, project: string): Promise<string> {
  const key = project || plan.project;
  if (!key) return "";
  const mapped = await prisma.rootRepoProjectMap.findUnique({
    where: { provider_org_project: { provider: plan.provider, org: plan.org, project: key } },
  });
  return mapped?.rootRepo ?? "";
}

async function noteMissingRootRepo(
  plan: ActivePlan,
  item: { ticketId: string; project: string },
  action: "implement" | "review",
  today: string
): Promise<string> {
  const project = item.project || plan.project;
  const error = `No root repo is saved for "${project || "this ticket's project"}" — set it on the ticket's Overview tab and save it.`;
  const already = await prisma.automationEvent.findFirst({
    where: {
      planId: plan.id,
      ticketId: item.ticketId,
      reason: "no-root-repo",
      createdAt: { gte: new Date(today + "T00:00:00.000Z") },
    },
    select: { id: true },
  });
  if (!already) {
    await logAutomation({
      planId: plan.id, ticketId: item.ticketId, action, outcome: "skipped",
      reason: "no-root-repo", detail: error,
    });
  }
  return error;
}

/**
 * Re-read who owns this plan's tickets, and stop working on the ones that are no
 * longer the developer's.
 *
 * A ticket can change hands while an agent is mid-run: a colleague picks it up,
 * a lead re-balances the sprint, QA takes it early. Finishing that run would push
 * a branch and open a pull request on somebody else's work item, which is exactly
 * the kind of thing an unattended agent must not do. So the run is cancelled and
 * the row is marked `skipped` — cancelled work is a fact worth recording, not a
 * failure to retry.
 *
 * The claim is refreshed here rather than in `rebuildPlan()` because a rebuild
 * also re-dates the schedule, and the schedule is what the developer approved.
 * This writes two fields and nothing else.
 *
 * Returns how many runs it stopped.
 */
async function refreshClaims(plan: ClaimPlan): Promise<number> {
  // Nothing queued and nothing running means no decision depends on ownership,
  // and this function's whole cost is a provider read. A finished sprint should
  // not keep paying for one every two minutes.
  const actionable = await prisma.plannedTicket.count({
    where: { planId: plan.id, implementState: { in: ["pending", "running"] } },
  });
  if (!actionable) return 0;

  // Only the active connection can be read: `loadTickets()` authenticates as
  // whichever one the header is switched to. Reading the wrong organization
  // would return a sprint with none of these tickets in it, and every row would
  // look reassigned — which would cancel every run in flight. A plan for another
  // organization therefore waits, and says so once.
  const { org, identity } = await resolveCredential(plan.provider);
  if (!org || org !== plan.org) {
    await logAutomation({
      planId: plan.id, action: "abort", outcome: "skipped", reason: "connection-elsewhere",
      detail: `The active connection is ${org || "none"}, not ${plan.org} — ownership was not re-read.`,
    });
    return 0;
  }
  if (!hasIdentity(identity) || identity.email !== plan.identityEmail) {
    await logAutomation({
      planId: plan.id, action: "abort", outcome: "skipped", reason: "identity-changed",
      detail: `This plan belongs to ${plan.identityEmail || "(nobody)"}, and the connection now says ${identity.email || "(nobody)"}.`,
    });
    return 0;
  }

  const provider = normalizeProvider(plan.provider);
  // Widened exactly as the plan was built, or a ticket the plan legitimately
  // holds from the backlog would come back absent from every read and drift out
  // of the developer's hands on paper alone.
  const loaded = plan.project
    ? await loadMySprintTickets(provider, plan.project, plan.sprint || undefined, identity, plan.includeWider)
    : await loadMyOpenTickets(
        provider,
        identity,
        cycleSince({ anchorProject: "", sprint: plan.sprint, startDate: plan.startDate, finishDate: plan.finishDate }, isoDay(new Date()))
      );
  // A provider that answered with nothing is far more likely to be a token or a
  // network problem than a sprint in which the developer lost every ticket at
  // once. Refusing to act on it is the whole reason this check exists.
  if (!loaded.connected || loaded.tickets.length === 0) {
    await logAutomation({
      planId: plan.id, action: "abort", outcome: "skipped", reason: "no-sprint-read",
      detail: "The sprint came back empty or disconnected, so ownership was left as it was.",
    });
    return 0;
  }

  const claimed = claimSprint(
    deliverablesOnly(loaded.tickets, provider),
    await rememberSprint({
      provider: plan.provider, org: plan.org, project: plan.project,
      sprint: plan.sprint, identityEmail: plan.identityEmail,
    }),
    identity
  );
  const claimById = new Map(claimed.map((c) => [String(c.ticket.id), c]));

  const rows = await prisma.plannedTicket.findMany({ where: { planId: plan.id } });
  let aborted = 0;

  for (const row of rows) {
    const now = claimById.get(row.ticketId);
    // A row the live sprint says nothing about keeps the claim it has. Absence is
    // not evidence here: `claimSprint()` only knows the tickets it was handed.
    if (!now || now.claim === row.claim) continue;

    await prisma.plannedTicket.update({
      where: { id: row.id },
      data: { claim: now.claim, assigneeNow: now.assigneeNow },
    });

    if (now.claim === "mine") {
      // Handed back. Nothing to stop, and the queue picks it up again on its own.
      await logAutomation({
        planId: plan.id, ticketId: row.ticketId, action: "abort", outcome: "done",
        reason: "claim-returned",
        detail: "This ticket is yours again.",
      });
      continue;
    }

    const inFlight = row.implementState === "running" && !!row.runId;
    if (!inFlight) {
      await logAutomation({
        planId: plan.id, ticketId: row.ticketId, action: "abort", outcome: "skipped",
        reason: "claim-changed",
        detail: `Now ${now.claim}${now.assigneeNow ? " — with " + now.assigneeNow : ""}. Nothing was running, so nothing was stopped.`,
      });
      continue;
    }

    // `cancelRun` answers false when the run is not live in this process — after
    // a restart, say. The row is marked either way: a run this process cannot
    // reach is not one it should keep waiting for.
    const stopped = await cancelRun(row.runId);
    await prisma.plannedTicket.update({
      where: { id: row.id },
      data: { implementState: "skipped" },
    });
    aborted += 1;
    await logAutomation({
      planId: plan.id, ticketId: row.ticketId, action: "abort",
      outcome: stopped ? "done" : "failed",
      reason: "claim-changed",
      detail: stopped
        ? `Run cancelled: the ticket is now ${now.claim}${now.assigneeNow ? " with " + now.assigneeNow : ""}.`
        : "The ticket changed hands but its run was not reachable in this process; the plan row was marked skipped.",
    });
  }

  return aborted;
}

/**
 * Start the next ticket in one plan's queue, if there is one and it may start.
 *
 * Exactly one per tick, on purpose. The concurrency ceiling lives in
 * `startRun()`, and asking it for one slot at a time means the scheduler never
 * has to hold an opinion about how many are free — it just tries the next
 * ticket, and a refusal is a recorded fact rather than an error.
 */
async function startNextTicket(plan: ActivePlan, today: string): Promise<boolean> {
  // `claim: "mine"` is a safety condition, not a filter for tidiness: a ticket
  // that has changed hands is somebody else's work, and starting a run on it
  // would push a branch and a pull request into a ticket the developer no longer
  // owns. `buildPlan()` already leaves such a row unqueued; this is the second
  // lock on the same door, because the row is written by one process and read by
  // another two minutes at a time.
  const queue = await prisma.plannedTicket.findMany({
    where: {
      planId: plan.id,
      implementState: "pending",
      claim: "mine",
      implementOrder: { gt: 0 },
      // Triage's verdict, unless the developer has overridden it. The override
      // is a deliberate human act recorded on the row (`unblockedByUser`), which
      // is the only thing that may outrank a blocker triage found.
      OR: [{ blocked: false }, { unblockedByUser: true }],
    },
    orderBy: { implementOrder: "asc" },
  });
  if (!queue.length) return false;

  // A blocked ticket is skipped by the query above; say so once a day rather
  // than every two minutes, which is what the `today` marker in the detail is
  // for — a log nobody can read is not evidence.
  const blockedCount = await prisma.plannedTicket.count({
    where: { planId: plan.id, implementState: "pending", blocked: true, unblockedByUser: false },
  });

  // The root repo the project was last run with. The scheduler must not invent
  // one: `startRun()` re-validates it, and a wrong value would be a refusal
  // every two minutes forever.
  let next: (typeof queue)[number] | null = null;
  let rootRepo = "";
  for (const row of queue) {
    rootRepo = await rootRepoFor(plan, row.project);
    if (rootRepo) {
      next = row;
      break;
    }
    await noteMissingRootRepo(plan, row, "implement", today);
  }
  if (!next) return false;

  const result = await startRun({
    ticketId: next.ticketId,
    ticketUrl: "",
    provider: plan.provider,
    project: next.project || plan.project,
    rootRepo,
    requestedSkill: IMPLEMENT_SKILL,
    model: next.model,
    effort: next.effort,
  });

  if (!result.ok) {
    await logAutomation({
      planId: plan.id, ticketId: next.ticketId, action: "implement", outcome: "skipped",
      reason: result.blocked || "admission-refused",
      detail: result.error,
    });
    return false;
  }

  await prisma.plannedTicket.update({
    where: { id: next.id },
    data: { implementState: "running", runId: result.runId },
  });
  await logAutomation({
    planId: plan.id, ticketId: next.ticketId, action: "implement", outcome: "started",
    reason: "queue",
    detail:
      `Queue position ${next.implementOrder}, release day ${next.releaseDay || "unscheduled"}` +
      // A ticket triage said was not ready, started anyway on a human's say-so,
      // is the one line in this log somebody will want to find later.
      (next.blocked && next.unblockedByUser
        ? ". Triage marked this one as needing clarification; you overrode that."
        : "") +
      (blockedCount ? `. ${blockedCount} ticket(s) skipped, waiting on clarification.` : "") +
      ` (${today})`,
  });
  return true;
}

/**
 * Answer one reviewer, if a reviewer has said something new.
 *
 * Shaped like `startNextTicket` on purpose: pick one row, go through
 * `startRun()`, write down what happened. The question it has to answer first is
 * the harder half. Whether there is work here cannot be read off the row at all,
 * and the obvious way to read it off the provider is wrong.
 *
 * **Why `unresolvedCount > 0` is not the trigger.** The fix-code-review skill
 * deliberately leaves threads open: a finding it judged invalid, out of scope, or
 * architectural gets a reply explaining why, and keeps its status. A finished run
 * therefore ends with open threads as a matter of course. A scheduler triggering
 * on the count would start again at once, reply on top of its own replies, and do
 * it on a pull request belonging to somebody else, where nothing can be undone.
 *
 * Four guards, layered rather than alternative:
 *
 *   1. **A watermark.** `lastCommentAt` is the newest open comment this plan has
 *      already acted on. Only something newer than it is new work.
 *   2. **Authorship.** When the newest open comment is ours it is a reply, not a
 *      request. The watermark advances past it so it is never weighed again.
 *   3. **A ceiling.** `MAX_REVIEW_ROUNDS`, after which the row reads `needs-human`
 *      and stops asking.
 *   4. **A cooldown.** Ten minutes after a run, while the provider is still
 *      serving back the writes that run just made.
 *
 * Returns whether a run was started.
 */
async function resolveNextReview(plan: ActivePlan): Promise<boolean> {
  const now = Date.now();
  if (now - (lastReviewScan.get(plan.id) ?? 0) < REVIEW_SCAN_MS) return false;

  // Everything this plan could conceivably have a reviewer waiting on. The
  // `prPublished` condition is what makes this safe to run at all: a draft pull
  // request has no reviewer, so nothing on it is a review comment yet.
  const candidates = await prisma.plannedTicket.findMany({
    where: {
      planId: plan.id,
      claim: "mine",
      implementState: "implemented",
      runId: { not: "" },
      prPublished: true,
      prMerged: false,
      NOT: { prUrl: "" },
      reviewState: { notIn: ["running", "needs-human"] },
    },
    include: { prReviews: true },
    orderBy: { implementOrder: "asc" },
  });
  if (!candidates.length) return false;
  lastReviewScan.set(plan.id, now);

  const ready = candidates.filter(
    (r) => r.reviewRounds < reviewRoundLimit(r, MAX_REVIEW_ROUNDS) && (!r.reviewedAt || now - r.reviewedAt.getTime() >= REVIEW_COOLDOWN_MS)
  );
  if (!ready.length) return false;

  const provider = normalizeProvider(plan.provider);
  const { org, identity } = await resolveCredential(plan.provider);
  if (!org || org !== plan.org) return false;

  const targets = ready.flatMap((row) =>
    reviewTargets(row).map((prUrl) => ({ row, ticketId: row.ticketId, prUrl }))
  );
  const scan = await loadPrReviews(provider, targets);
  if (scan.degraded) {
    await logAutomation({
      planId: plan.id, action: "review", outcome: "skipped", reason: "provider-degraded",
      detail: scan.notice || "The review poll failed for every pull request, so nothing was judged.",
    });
    return false;
  }

  type ReviewTarget = {
    row: (typeof ready)[number]; prUrl: string; latestAt: string; reviewer: string; open: number; total: number;
  };
  let target: ReviewTarget | null = null as ReviewTarget | null;
  for (const row of ready) {
    const tracked = new Map(row.prReviews.map((t) => [t.prUrl, t]));
    const counts: number[] = [];
    let primaryMark: string | null = null;
    let rowTarget = null as ReviewTarget | null;
    for (let i = 0; i < targets.length; i++) {
      if (targets[i].row !== row) continue;
      const prUrl = targets[i].prUrl;
      const primary = prUrl === row.prUrl;
      const outcome = scan.outcomes[i];
      const stored = primary ? null : tracked.get(prUrl);
      if (outcome.failed) {
        counts.push(primary ? row.openComments - row.prReviews.reduce((n, t) => n + t.openComments, 0) : stored?.openComments ?? 0);
        continue;
      }
      const entry = outcome.entry && !CLOSED_PR_STATUSES.includes(outcome.entry.prStatus) ? outcome.entry : null;
      const open = entry?.unresolvedCount ?? 0;
      counts.push(open);
      const verdict = entry
        ? reviewVerdict(
            { lastCommentAt: primary ? row.lastCommentAt : stored?.lastCommentAt ?? "", reviewRounds: row.reviewRounds },
            {
              unresolvedCount: entry.unresolvedCount,
              latestAt: entry.latestIso,
              mine: isSamePerson("", entry.reviewer, identity),
              approved: entry.approved,
            },
            reviewRoundLimit(row, MAX_REVIEW_ROUNDS)
          )
        : null;
      const mark = verdict && verdict.act === "wait" && verdict.advanceTo ? verdict.advanceTo : null;
      if (primary) {
        primaryMark = mark;
      } else if (stored?.openComments !== open || mark) {
        await prisma.plannedTicketPr.upsert({
          where: { plannedTicketId_prUrl: { plannedTicketId: row.id, prUrl } },
          create: { plannedTicketId: row.id, prUrl, openComments: open, lastCommentAt: mark ?? "" },
          update: { openComments: open, ...(mark ? { lastCommentAt: mark } : {}) },
        });
      }
      if (entry && verdict?.act === "run" && !rowTarget) {
        rowTarget = { row, prUrl, latestAt: verdict.advanceTo, reviewer: entry.reviewer, open, total: 0 };
      }
    }
    const total = openCommentsTotal(counts);
    await prisma.plannedTicket.update({
      where: { id: row.id },
      data: { openComments: total, ...(primaryMark ? { lastCommentAt: primaryMark } : {}) },
    });
    if (rowTarget && !target) target = { ...rowTarget, total };
  }
  if (!target) return false;

  const started = await startReviewRun(target.row.id, {
    prUrl: target.prUrl,
    reason: "new-comment",
    detail:
      `${target.open} open thread(s) on ${repoNameFromPrUrl(target.prUrl) || "the pull request"}; ` +
      `newest by ${target.reviewer || "a reviewer"} at ${target.latestAt}. ` +
      `Round ${target.row.reviewRounds + 1} of ${reviewRoundLimit(target.row, MAX_REVIEW_ROUNDS)}.`,
    lastCommentAt: target.latestAt,
    openComments: target.total,
  });
  return started.ok;
}

async function pickLiveReviewPr(item: {
  plan: { provider: string; org: string };
  ticketId: string;
  prUrl: string;
  companionPrUrls: string[];
  openComments: number;
  lastCommentAt: string;
  prReviews: { prUrl: string; openComments: number; lastCommentAt: string }[];
}): Promise<string> {
  const fallback = pickReviewPr(item, item.prReviews);
  const targets = reviewTargets(item);
  if (targets.length < 2) return fallback;
  const { org, identity } = await resolveCredential(item.plan.provider);
  if (!org || org !== item.plan.org) return fallback;
  const scan = await loadPrReviews(normalizeProvider(item.plan.provider), targets.map((prUrl) => ({ ticketId: item.ticketId, prUrl })));
  const tracked = new Map(item.prReviews.map((t) => [t.prUrl, t]));
  for (let i = 0; i < targets.length; i++) {
    const entry = scan.outcomes[i]?.entry;
    if (!entry || CLOSED_PR_STATUSES.includes(entry.prStatus)) continue;
    const seen = targets[i] === item.prUrl ? item.lastCommentAt : tracked.get(targets[i])?.lastCommentAt ?? "";
    const verdict = reviewVerdict(
      { lastCommentAt: seen, reviewRounds: 0 },
      { unresolvedCount: entry.unresolvedCount, latestAt: entry.latestIso, mine: isSamePerson("", entry.reviewer, identity), approved: entry.approved },
      MAX_REVIEW_ROUNDS
    );
    if (verdict.act === "run") return targets[i];
  }
  return fallback;
}

/**
 * Start one review run against one planned ticket, and record what happened.
 *
 * The scheduler and the button on the row both come through here, which is the
 * same rule the release path keeps: an automation nobody can trigger by hand is
 * one nobody can check, and two starters would be two places for the admission
 * contract to drift apart.
 *
 * It deliberately does **not** re-ask whether there is anything to fix. The
 * scheduler has just read the provider and a person pressing the button has just
 * read the same numbers on screen; a second poll here would cost a round trip to
 * confirm what the caller already knows.
 */
export async function startReviewRun(
  plannedId: string,
  opts: { reason: string; detail: string; prUrl?: string; lastCommentAt?: string; openComments?: number }
): Promise<{ ok: boolean; error: string; blocked?: string }> {
  const item = await prisma.plannedTicket.findUnique({ where: { id: plannedId }, include: { plan: true, prReviews: true } });
  if (!item) return { ok: false, error: "No such planned ticket." };

  // The three conditions that make a review run meaningful at all, re-read here
  // rather than trusted from the caller: the button is on a page that may have
  // been open since before any of them changed.
  const refusal =
    item.claim !== "mine"
      ? "This ticket is no longer yours."
      : !item.prPublished || !item.prUrl
        ? "This ticket has no published pull request to review."
        : item.prMerged
          ? "This ticket's pull request is already merged — there is no branch left to fix it on."
        : item.reviewState === "running"
          ? "A review fix is already running for this ticket."
          : "";
  if (refusal) {
    await logAutomation({
      planId: item.planId, ticketId: item.ticketId, action: "review", outcome: "skipped",
      reason: "not-reviewable", detail: refusal,
    });
    return { ok: false, error: refusal };
  }

  const rootRepo = await rootRepoFor(item.plan, item.project);
  if (!rootRepo) {
    const error = await noteMissingRootRepo(item.plan, item, "review", isoDay(new Date()));
    return { ok: false, error, blocked: "no-root-repo" };
  }

  const targetPr =
    opts.prUrl && reviewTargets(item).includes(opts.prUrl) ? opts.prUrl : await pickLiveReviewPr(item);
  const isPrimary = targetPr === item.prUrl;
  const repoPath = isPrimary ? rootRepo : localRepoForPr(targetPr, rootRepo, discoverCompanionRepos(rootRepo).repos);
  if (!repoPath) {
    const error =
      `No local clone of ${repoNameFromPrUrl(targetPr) || "the pull request's repository"} is named in the Root repo's ` +
      `instruction files, so its review comments cannot be fixed here.`;
    await logAutomation({
      planId: item.planId, ticketId: item.ticketId, action: "review", outcome: "skipped",
      reason: "no-local-checkout", detail: error,
    });
    return { ok: false, error };
  }

  const result = await startRun({
    ticketId: item.ticketId,
    ticketUrl: "",
    provider: item.plan.provider,
    project: item.project || item.plan.project,
    rootRepo: repoPath,
    prUrl: targetPr,
    requestedSkill: REVIEW_FIX_SKILL,
    rememberRootRepo: isPrimary,
    model: item.model,
    effort: item.effort,
  });
  if (!result.ok) {
    await logAutomation({
      planId: item.planId, ticketId: item.ticketId, action: "review", outcome: "skipped",
      reason: result.blocked || "admission-refused", detail: result.error,
    });
    return { ok: false, error: result.error };
  }

  await prisma.plannedTicket.update({
    where: { id: item.id },
    data: {
      reviewState: "running",
      reviewRunId: result.runId,
      reviewError: "",
      ...(opts.openComments === undefined ? {} : { openComments: opts.openComments }),
      ...(opts.lastCommentAt && isPrimary ? { lastCommentAt: opts.lastCommentAt } : {}),
    },
  });
  if (opts.lastCommentAt && !isPrimary) {
    await prisma.plannedTicketPr.upsert({
      where: { plannedTicketId_prUrl: { plannedTicketId: item.id, prUrl: targetPr } },
      create: { plannedTicketId: item.id, prUrl: targetPr, lastCommentAt: opts.lastCommentAt },
      update: { lastCommentAt: opts.lastCommentAt },
    });
  }
  await logAutomation({
    planId: item.planId, ticketId: item.ticketId, action: "review", outcome: "started",
    reason: opts.reason, detail: opts.detail,
  });
  return { ok: true, error: "" };
}

export async function startQaFix(plannedId: string): Promise<{ ok: boolean; error: string; blocked?: string }> {
  const item = await prisma.plannedTicket.findUnique({ where: { id: plannedId }, include: { plan: true } });
  if (!item) return { ok: false, error: "No such planned ticket." };

  const refusal =
    item.claim !== "mine"
      ? "This ticket is no longer yours."
      : item.pendingAction !== "fix-qa"
        ? "QA has not sent this ticket back."
        : isFixingQa(item)
          ? "A QA fix is already in progress for this ticket."
          : item.qaRounds >= MAX_QA_ROUNDS
            ? `${MAX_QA_ROUNDS} QA fixes did not close this ticket — it needs a person.`
            : item.implementState === "running" || item.reviewState === "running"
              ? "A run is already in progress for this ticket."
              : "";
  if (refusal) {
    await logAutomation({
      planId: item.planId, ticketId: item.ticketId, action: "implement", outcome: "skipped",
      reason: "qa-fix-refused", detail: refusal,
    });
    return { ok: false, error: refusal };
  }

  const rootRepo = await rootRepoFor(item.plan, item.project);
  if (!rootRepo) {
    const error = await noteMissingRootRepo(item.plan, item, "implement", isoDay(new Date()));
    return { ok: false, error, blocked: "no-root-repo" };
  }

  const result = await startRun({
    ticketId: item.ticketId,
    ticketUrl: "",
    provider: item.plan.provider,
    project: item.project || item.plan.project,
    rootRepo,
    requestedSkill: QA_FIX_SKILL,
  });
  if (!result.ok) {
    await logAutomation({
      planId: item.planId, ticketId: item.ticketId, action: "implement", outcome: "skipped",
      reason: result.blocked || "admission-refused", detail: result.error,
    });
    return { ok: false, error: result.error };
  }

  await prisma.plannedTicket.update({
    where: { id: item.id },
    data: {
      implementState: "running",
      runId: result.runId,
      qaRounds: item.qaRounds + 1,
    },
  });
  await logAutomation({
    planId: item.planId, ticketId: item.ticketId, action: "implement", outcome: "started",
    reason: "qa-fix", detail: `QA fix round ${item.qaRounds + 1} of ${MAX_QA_ROUNDS}, started after you confirmed.`,
  });
  return { ok: true, error: "" };
}

/**
 * Reconcile what the engine did with what the plan believes.
 *
 * Called at the top of each tick rather than written by the runner, and that is
 * a deliberate choice about ownership: the engine knows nothing about plans, and
 * teaching it would put a second consumer inside the run lifecycle. Reading the
 * Run rows back is a cheap query and keeps the dependency pointing one way.
 */
async function reconcileImplement(): Promise<void> {
  const inFlight = await prisma.plannedTicket.findMany({
    where: { implementState: "running", runId: { not: "" } },
  });
  if (!inFlight.length) return;
  const runs = await prisma.run.findMany({
    where: { id: { in: inFlight.map((i) => i.runId) } },
    select: { id: true, state: true, prUrl: true, companionPrUrls: true, endReason: true, skill: true },
  });
  const byId = new Map(runs.map((r) => [r.id, r]));
  const steps = await prisma.step.findMany({
    where: { runId: { in: inFlight.map((i) => i.runId) }, nodeId: { in: ["deliver", "implement"] } },
    select: { runId: true, output: true },
  });
  const outputByRun = new Map(steps.map((st) => [st.runId, (st.output ?? {}) as Record<string, unknown>]));

  for (const item of inFlight) {
    const run = byId.get(item.runId);
    if (!run || run.state === "running" || run.state === "waiting") continue;
    const out = outputByRun.get(item.runId) ?? {};
    if (run.state === "succeeded" && out.outcome === "no-fix-needed") {
      await settleNoFixNeeded(item, out);
      continue;
    }
    const implemented = run.state === "succeeded" && !!run.prUrl;
    await prisma.plannedTicket.update({
      where: { id: item.id },
      data: {
        implementState: implemented ? "implemented" : "failed",
        prUrl: run.prUrl,
        companionPrUrls: run.companionPrUrls.length ? run.companionPrUrls : item.companionPrUrls,
        ...(implemented && run.skill.startsWith("fix-qa-") ? QA_FIX_RESET : {}),
      },
    });
    await logAutomation({
      planId: item.planId, ticketId: item.ticketId, action: "implement",
      outcome: implemented ? "done" : "failed",
      reason: implemented ? "" : run.endReason || run.state,
      detail: implemented
        ? `Draft pull request ready, waiting for release day ${item.releaseDay || "(unscheduled)"}.`
        : "The run did not produce a pull request.",
    });
  }
}

const QA_FIX_RESET = {
  prMerged: false,
  prPublished: false,
  reviewersSet: false,
  statusMoved: false,
  releasedAt: null,
  releaseError: "",
  reviewState: "idle",
  reviewRunId: "",
  openComments: 0,
  threadsReplied: 0,
  threadsResolved: 0,
  reviewRounds: 0,
  lastCommentAt: "",
  reviewError: "",
};

async function settleNoFixNeeded(
  item: { id: string; planId: string; ticketId: string; qaRounds: number; qaCommentAt: string },
  out: Record<string, unknown>
): Promise<void> {
  await prisma.plannedTicket.update({
    where: { id: item.id },
    data: { implementState: "no-fix-needed", qaRounds: Math.max(0, item.qaRounds - 1) },
  });
  const open = await openQaDraft(item.id);
  if (!open) {
    await prisma.qaReplyDraft.create({
      data: {
        planId: item.planId,
        plannedTicketId: item.id,
        ticketId: item.ticketId,
        status: "ready",
        answersUpTo: item.qaCommentAt,
        body: String(out.qaReply ?? "").trim(),
        summary: typeof out.summary === "string" ? out.summary : "",
        endedAt: new Date(),
      },
    });
  }
  await logAutomation({
    planId: item.planId, ticketId: item.ticketId, action: "implement", outcome: "done",
    reason: "no-fix-needed",
    detail: open
      ? "QA's findings were reviewed and none is a defect — nothing was changed. A reply draft was already waiting, so it was kept."
      : "QA's findings were reviewed and none is a defect — nothing was changed. A reply to QA is drafted for you to post.",
  });
}

/**
 * The same sweep for the review lane.
 *
 * Separate from the implement sweep rather than a second branch inside it,
 * because the two read different columns, write different columns, and answer
 * different questions. Sharing a loop would mean a row in flight on one lane
 * being judged by the other lane rules.
 *
 * What counts as success here is not what counts for an implement run. An
 * implement run has to produce a pull request; a review run has to have written
 * to the pull request that already exists. `threadsReplied` is therefore the
 * field that decides it: a run that succeeded without replying to anything
 * either found nothing to do or gave up quietly, and neither is a round worth
 * counting against the ceiling.
 */
async function reconcileReviews(): Promise<void> {
  const inFlight = await prisma.plannedTicket.findMany({
    where: { reviewState: "running", reviewRunId: { not: "" } },
  });
  if (!inFlight.length) return;
  const runs = await prisma.run.findMany({
    where: { id: { in: inFlight.map((i) => i.reviewRunId) } },
    select: { id: true, state: true, endReason: true },
  });
  const byId = new Map(runs.map((r) => [r.id, r]));
  // What the run reported, read from the node contract rather than from its
  // prose. `deliver` is the one-shot review node; a v3 run reports the same two
  // fields from `publish`, so both are accepted and whichever exists wins.
  const steps = await prisma.step.findMany({
    where: { runId: { in: inFlight.map((i) => i.reviewRunId) }, nodeId: { in: ["deliver", "publish"] } },
    select: { runId: true, output: true },
  });
  const outputByRun = new Map(steps.map((st) => [st.runId, st.output as Record<string, unknown>]));

  for (const item of inFlight) {
    const run = byId.get(item.reviewRunId);
    if (!run || run.state === "running" || run.state === "waiting") continue;

    const out = outputByRun.get(item.reviewRunId) ?? {};
    const replied = Number(out.threadsReplied ?? 0) || 0;
    const resolved = Number(out.threadsResolved ?? 0) || 0;
    const answered = run.state === "succeeded" && replied > 0;
    const rounds = item.reviewRounds + (answered ? 1 : 0);
    // The ceiling is applied here rather than at the next scan so the row says
    // why it stopped asking at the moment it stopped, not two minutes later.
    const state = !answered ? "failed" : rounds >= reviewRoundLimit(item, MAX_REVIEW_ROUNDS) ? "needs-human" : "resolved";

    await prisma.plannedTicket.update({
      where: { id: item.id },
      data: {
        reviewState: state,
        reviewRounds: rounds,
        threadsReplied: replied,
        threadsResolved: resolved,
        reviewedAt: new Date(),
        reviewError: answered ? "" : run.endReason || run.state,
      },
    });
    await logAutomation({
      planId: item.planId, ticketId: item.ticketId, action: "review",
      outcome: answered ? "done" : "failed",
      // Classified rather than free text, because the bell reads it: whether a
      // finished fix needs the developer is exactly the difference between a
      // notification that lands on the badge and one that does not.
      reason: !answered
        ? run.endReason || run.state
        : state === "needs-human"
          ? "max-rounds"
          : replied > resolved
            ? "left-open"
            : "all-resolved",
      detail: answered
        ? `Replied to ${replied} thread(s), resolved ${resolved}.` +
          (replied > resolved
            ? ` ${replied - resolved} left open on purpose — invalid or out of scope.`
            : "") +
          (state === "needs-human"
            ? ` Round ${rounds} of ${reviewRoundLimit(item, MAX_REVIEW_ROUNDS)}: this ticket will not be picked up automatically again.`
            : "")
        : "The run did not write to the pull request.",
    });
  }
}

/** Bring both lanes back in step with the engine before anything new starts. */
export async function reconcile(): Promise<void> {
  await reconcileImplement();
  await reconcileReviews();
}

async function safeTick() {
  if (running) return; // a tick that outlasts its interval must not overlap itself
  running = true;
  try {
    await reconcile();
    await tick();
  } catch (e) {
    console.error("[ticket-executor] scheduler tick failed:", e);
  } finally {
    running = false;
  }
}

/** Start the ticker. Idempotent — a second call is a no-op, which matters
 *  because Next may evaluate the instrumentation module more than once. */
export function startScheduler() {
  if (timer) return;
  timer = setInterval(() => void safeTick(), TICK_MS);
  // Do not run one immediately: a server that has just started is also a server
  // whose `recoverInterruptedRuns()` sweep is still deciding what is alive.
  timer.unref?.();
  console.log(`[ticket-executor] scheduler started (every ${TICK_MS / 1000}s)`);
}

/** Run one tick on demand, for the "Run now" button. */
export async function tickNow(): Promise<TickReport> {
  await reconcile();
  return tick();
}
