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

import { hasIdentity } from "../identity";
import { claimSprint } from "../sprintClaim";
import { deliverablesOnly, isoDay } from "../sprintPlan";
import { prisma } from "../prisma";
import { resolveCredential } from "../providerCredentials";
import { loadMySprintTickets, normalizeProvider } from "../tickets";
import { logAutomation, rememberSprint } from "./planStore";
import { dueForRelease, releasePlannedTicket } from "./release";
import { cancelRun, startRun } from "./runner";

/** How often the tick runs. Minutes, not seconds: nothing it watches changes
 *  faster than a Claude turn finishes, and a tighter loop would only add
 *  provider round-trips and lock contention for the same answers. */
const TICK_MS = 120_000;

/** Advisory lock key for the tick. A distinct constant rather than a hash of a
 *  string, so it is greppable next to the one `startRun()` uses. */
const TICK_LOCK = 918_273_641;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export type TickReport = {
  plans: number;
  implementStarted: number;
  released: number;
  skipped: number;
  /** Runs stopped because the ticket stopped being the developer's. */
  aborted: number;
};

/**
 * One pass over every active plan.
 *
 * Exported so it can be run by hand — the "Run now" button and a test both want
 * exactly this, and a scheduler whose only trigger is the passage of time is one
 * nobody can check.
 */
export async function tick(now = new Date()): Promise<TickReport> {
  const report: TickReport = { plans: 0, implementStarted: 0, released: 0, skipped: 0, aborted: 0 };
  // A non-blocking lock: if another process holds it, this tick simply does not
  // happen. Waiting would only queue up ticks behind a slow one.
  const [{ locked }] = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${TICK_LOCK}::bigint) AS locked
  `;
  if (!locked) return report;

  try {
    const plans = await prisma.sprintPlan.findMany({ where: { status: "active" } });
    report.plans = plans.length;
    const today = isoDay(now);

    for (const plan of plans) {
      // Before acting on the plan, find out whether it is still describing the
      // developer's work. Ownership is the one input to every decision below
      // that the app does not control, so it is re-read first rather than
      // trusted from whenever the plan was last built by hand.
      report.aborted += await refreshClaims(plan);
      if (plan.autoRelease) {
        for (const item of await dueForRelease(plan.id, today)) {
          const outcome = await releasePlannedTicket(item.id);
          if (outcome.ok) report.released += 1;
          else report.skipped += 1;
        }
      }
      if (plan.autoImplement) {
        const started = await startNextTicket(plan, today);
        if (started) report.implementStarted += 1;
        else report.skipped += 1;
      }
    }
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${TICK_LOCK}::bigint)`;
  }
  return report;
}

type ActivePlan = { id: string; provider: string; org: string; project: string };

type ClaimPlan = ActivePlan & { sprint: string; identityEmail: string; includeWider: boolean };

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
  const loaded = await loadMySprintTickets(
    provider,
    plan.project,
    plan.sprint || undefined,
    identity,
    plan.includeWider
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
  const next = await prisma.plannedTicket.findFirst({
    where: {
      planId: plan.id,
      implementState: "pending",
      claim: "mine",
      // Triage's verdict, unless the developer has overridden it. The override
      // is a deliberate human act recorded on the row (`unblockedByUser`), which
      // is the only thing that may outrank a blocker triage found.
      OR: [{ blocked: false }, { unblockedByUser: true }],
    },
    orderBy: { implementOrder: "asc" },
  });
  if (!next) return false;

  // A blocked ticket is skipped by the query above; say so once a day rather
  // than every two minutes, which is what the `today` marker in the detail is
  // for — a log nobody can read is not evidence.
  const blockedCount = await prisma.plannedTicket.count({
    where: { planId: plan.id, implementState: "pending", blocked: true, unblockedByUser: false },
  });

  // The root repo the project was last run with. The scheduler must not invent
  // one: `startRun()` re-validates it, and a wrong value would be a refusal
  // every two minutes forever.
  const mapped = await prisma.rootRepoProjectMap.findUnique({
    where: { provider_org_project: { provider: plan.provider, org: plan.org, project: plan.project } },
  });
  if (!mapped?.rootRepo) {
    await logAutomation({
      planId: plan.id, ticketId: next.ticketId, action: "implement", outcome: "skipped",
      reason: "no-root-repo",
      detail: `No root repo is remembered for project "${plan.project}" — set it in the Root repo field on My Sprint.`,
    });
    return false;
  }

  const result = await startRun({
    ticketId: next.ticketId,
    ticketUrl: "",
    provider: plan.provider,
    project: plan.project,
    rootRepo: mapped.rootRepo,
    requestedSkill: "implement-ticket-v2",
    // The plan *is* the human approval. A scheduled run must not park at a plan
    // gate at two in the morning waiting for somebody who is asleep — the whole
    // sprint was reviewed and activated before any of this started.
    skillExplicit: true,
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
 * Reconcile what the engine did with what the plan believes.
 *
 * Called at the top of each tick rather than written by the runner, and that is
 * a deliberate choice about ownership: the engine knows nothing about plans, and
 * teaching it would put a second consumer inside the run lifecycle. Reading the
 * Run rows back is a cheap query and keeps the dependency pointing one way.
 */
export async function reconcile(): Promise<void> {
  const inFlight = await prisma.plannedTicket.findMany({
    where: { implementState: "running", runId: { not: "" } },
  });
  if (!inFlight.length) return;
  const runs = await prisma.run.findMany({
    where: { id: { in: inFlight.map((i) => i.runId) } },
    select: { id: true, state: true, prUrl: true, endReason: true },
  });
  const byId = new Map(runs.map((r) => [r.id, r]));

  for (const item of inFlight) {
    const run = byId.get(item.runId);
    if (!run || run.state === "running" || run.state === "waiting") continue;
    const implemented = run.state === "succeeded" && !!run.prUrl;
    await prisma.plannedTicket.update({
      where: { id: item.id },
      data: {
        implementState: implemented ? "implemented" : "failed",
        prUrl: run.prUrl,
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
