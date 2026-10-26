// QA follow-up: one case per delivered ticket, from QC's signal to the developer's decision.
//
//   signal (watchLifecycle)  →  case `pending`  →  analysis run (D-Agent flow "qa", no decision: ends after
//   qaTriage)  →  `ready`: the developer approves a fix, posts the reply, or dismisses  →  fix run (flow "qa"
//   seeded with the decision)  →  `fixed`: the reply waits to be posted  →  `posted`.
//
// Nothing here posts on its own: a reply reaches the work item only through `postCaseReply`, a person's click.
// The rules — which signal opens, widens or waits for a case, when analysis is due, what the verdicts mean —
// live in `lib/qaFollowUp.ts`.

import type { Prisma } from "@prisma/client";
import { hasIdentity, type DevIdentity } from "../identity";
import { prisma } from "../prisma";
import { resolveCredential } from "../providerCredentials";
import { normalizeProvider, postTicketComment } from "../tickets";
import { MAX_QA_ROUNDS } from "../ticketLifecycle";
import {
  dueForAnalysis,
  followUpAfter,
  isOpenCase,
  normalizeFindings,
  OPEN_CASE,
  onSignal,
  recommend,
  type CaseStatus,
  type LastClosed,
  type Trigger,
} from "../qaFollowUp";
import { runOutcomes, startRun } from "../dagent";
import { logAutomation } from "./planStore";

type Result = { ok: boolean; error: string };

export async function openCase(plannedTicketId: string) {
  return prisma.qaCase.findFirst({
    where: { plannedTicketId, status: { in: [...OPEN_CASE] } },
    orderBy: { createdAt: "desc" },
  });
}

/** Open cases of a plan, newest first — what My Sprint shows. */
export async function listCases(planId: string) {
  return prisma.qaCase.findMany({
    where: { planId, status: { in: [...OPEN_CASE] } },
    orderBy: { createdAt: "desc" },
  });
}

/** Each ticket's last closed case — where its answers stop (`awaitsAnalysis()`). */
export async function lastClosedCases(planId: string): Promise<Record<string, LastClosed>> {
  const rows = await prisma.qaCase.findMany({
    where: { planId, status: { in: ["posted", "dismissed"] } },
    orderBy: { createdAt: "asc" },
    select: { plannedTicketId: true, answersUpTo: true, decidedAt: true, postedAt: true, endedAt: true, createdAt: true },
  });
  const out: Record<string, LastClosed> = {};
  for (const r of rows) {
    out[r.plannedTicketId] = { answersUpTo: r.answersUpTo, closedAt: (r.decidedAt ?? r.postedAt ?? r.endedAt ?? r.createdAt).toISOString() };
  }
  return out;
}

/** Where the last closed case stopped reading, so the next one starts after it. */
async function lastAnswered(plannedTicketId: string): Promise<string> {
  const last = await prisma.qaCase.findFirst({
    where: { plannedTicketId, status: { in: ["posted", "dismissed"] } },
    orderBy: { createdAt: "desc" },
    select: { answersUpTo: true },
  });
  return last?.answersUpTo ?? "";
}

/**
 * Record what one sweep saw on a ticket. `since` is the comment watermark before the sweep, `upTo` after it.
 */
export async function noteSignals(
  row: { id: string; planId: string; ticketId: string },
  triggers: Trigger[],
  window: { since: string; upTo: string },
  now = new Date()
): Promise<void> {
  if (!triggers.length) return;
  const open = await openCase(row.id);
  const action = onSignal((open?.status as CaseStatus | undefined) ?? null);
  const merged = [...new Set([...(open?.triggers ?? []), ...triggers])];

  if (action === "open") {
    await prisma.qaCase.create({
      data: {
        planId: row.planId, plannedTicketId: row.id, ticketId: row.ticketId,
        status: "pending", triggers, signalAt: now,
        since: window.since || (await lastAnswered(row.id)), answersUpTo: window.upTo,
      },
    });
  } else if (open && (action === "extend" || action === "reopen")) {
    await prisma.qaCase.update({
      where: { id: open.id },
      data: {
        status: "pending", triggers: merged, signalAt: now,
        answersUpTo: window.upTo > open.answersUpTo ? window.upTo : open.answersUpTo,
        ...(action === "reopen" ? { errorMessage: "", runId: "" } : {}),
      },
    });
  }
  await logAutomation({
    planId: row.planId, ticketId: row.ticketId, action: "watch", outcome: action === "hold" ? "skipped" : "done",
    reason: "qa-signal",
    detail:
      `${triggers.join(", ")} — ` +
      (action === "open"
        ? "a QA follow-up case was opened."
        : action === "extend"
          ? "added to the case waiting for analysis."
          : action === "reopen"
            ? "the earlier analysis is out of date; the case will be analysed again."
            : "a run is in flight for this case; the new feedback is picked up when it closes."),
  });
}

/** The developer the plan belongs to, read from the stored connection (`ProviderCredential`) — the triager tells
 *  their own comments apart from QC's by it. Null when the connection carries no identity or another developer's. */
async function developerOf(plan: { provider: string; identityEmail: string }): Promise<DevIdentity | null> {
  const { identity } = await resolveCredential(plan.provider);
  return hasIdentity(identity) && identity.email === plan.identityEmail ? identity : null;
}

const NO_DEVELOPER = "The active connection's identity is missing or is not this plan's developer — check Settings → connection.";

async function rootRepoOf(item: { project: string; plan: { provider: string; org: string; project: string } }): Promise<string> {
  const project = item.project || item.plan.project;
  if (!project) return "";
  const mapped = await prisma.rootRepoProjectMap.findUnique({
    where: { provider_org_project: { provider: item.plan.provider, org: item.plan.org, project } },
  });
  return mapped?.rootRepo ?? "";
}

/**
 * Start the analysis of a ticket's open case. By hand (`manual`) it opens a case when none is open, and
 * skips the debounce.
 */
export async function analyzeCase(plannedId: string, manual = false): Promise<Result> {
  const item = await prisma.plannedTicket.findUnique({ where: { id: plannedId }, include: { plan: true } });
  if (!item) return { ok: false, error: "No such planned ticket." };
  let open = await openCase(item.id);
  if (open && !["pending", "ready", "failed"].includes(open.status)) {
    return { ok: false, error: "This ticket's QA case already has a run in flight." };
  }
  if (!open) {
    if (!manual) return { ok: false, error: "This ticket has no QA feedback waiting." };
    open = await prisma.qaCase.create({
      data: {
        planId: item.planId, plannedTicketId: item.id, ticketId: item.ticketId,
        status: "pending", triggers: ["manual"], signalAt: new Date(),
        since: await lastAnswered(item.id), answersUpTo: item.qaCommentAt,
      },
    });
  }

  const rootRepo = await rootRepoOf(item);
  const developer = await developerOf(item.plan);
  const refusal = !rootRepo
    ? `No root repo is saved for "${item.project || item.plan.project || "this ticket's project"}" — set it on the ticket's Overview tab.`
    : !developer
      ? NO_DEVELOPER
      : "";
  const started = refusal
    ? ({ ok: false, error: refusal } as const)
    : await startRun({
        flow: "qa",
        ticketId: item.ticketId,
        provider: item.plan.provider,
        project: item.project || item.plan.project,
        rootRepo,
        seed: { followUp: { since: open.since, upTo: open.answersUpTo, triggers: open.triggers, developer } },
      });
  if (!started.ok) {
    await logAutomation({
      planId: item.planId, ticketId: item.ticketId, action: "watch", outcome: "skipped",
      reason: "qa-analysis-refused", detail: started.error,
    });
    return { ok: false, error: started.error };
  }
  await prisma.qaCase.update({
    where: { id: open.id },
    data: { status: "running", runId: started.runId, errorMessage: "", endedAt: null },
  });
  await logAutomation({
    planId: item.planId, ticketId: item.ticketId, action: "watch", outcome: "started",
    reason: "qa-analysis", detail: "Analysing QC's feedback against the code. Nothing is posted or changed until you decide.",
  });
  return { ok: true, error: "" };
}

/** The scheduler's part: analyse every pending case whose debounce has run out. One refusal (no slot) stops
 *  the pass — the next tick tries again. */
export async function startDueAnalyses(plan: { id: string; autoDraftQaReply: boolean }, now = new Date()): Promise<number> {
  if (!plan.autoDraftQaReply) return 0;
  const pending = await prisma.qaCase.findMany({ where: { planId: plan.id, status: "pending" }, orderBy: { signalAt: "asc" } });
  let started = 0;
  for (const c of pending) {
    if (!dueForAnalysis(c, true, now)) continue;
    const r = await analyzeCase(c.plannedTicketId);
    if (!r.ok) break;
    started += 1;
  }
  return started;
}

/**
 * The developer's decision: fix the findings at `fix` (indexes into the case's findings). Starts the fix run
 * seeded with that decision, so the triager plans exactly those.
 */
export async function approveFix(caseId: string, fix: number[], note: string): Promise<Result> {
  const c = await prisma.qaCase.findUnique({ where: { id: caseId } });
  if (!c) return { ok: false, error: "No such QA case." };
  if (c.status !== "ready") return { ok: false, error: "This case is not waiting for a decision." };
  const findings = normalizeFindings(c.findings);
  const chosen = [...new Set(fix)].filter((i) => findings[i]).map((i) => findings[i].finding);
  if (!chosen.length) return { ok: false, error: "Pick at least one finding to fix." };

  const item = await prisma.plannedTicket.findUnique({ where: { id: c.plannedTicketId }, include: { plan: true } });
  if (!item) return { ok: false, error: "This case's ticket is no longer on the plan." };
  const refusal =
    item.qaRounds >= MAX_QA_ROUNDS
      ? `${MAX_QA_ROUNDS} QA fixes did not close this ticket — it needs a person.`
      : item.implementState === "running" || item.reviewState === "running"
        ? "A run is already in progress for this ticket."
        : "";
  const rootRepo = refusal ? "" : await rootRepoOf(item);
  const developer = refusal ? null : await developerOf(item.plan);
  const started = refusal
    ? ({ ok: false, error: refusal } as const)
    : !rootRepo
      ? ({ ok: false, error: "No root repo is saved for this ticket's project." } as const)
      : !developer
        ? ({ ok: false, error: NO_DEVELOPER } as const)
      : await startRun({
          flow: "qa",
          ticketId: item.ticketId,
          provider: item.plan.provider,
          project: item.project || item.plan.project,
          rootRepo,
          seed: { followUp: { since: c.since, upTo: c.answersUpTo, triggers: c.triggers, developer, decision: { fix: chosen, note: note.trim() } } },
        });
  if (!started.ok) {
    await logAutomation({
      planId: item.planId, ticketId: item.ticketId, action: "implement", outcome: "skipped",
      reason: "qa-fix-refused", detail: started.error,
    });
    return { ok: false, error: started.error };
  }

  await prisma.plannedTicket.update({
    where: { id: item.id },
    data: { implementState: "running", runId: started.runId, qaRounds: item.qaRounds + 1 },
  });
  await prisma.qaCase.update({
    where: { id: c.id },
    data: { status: "fixing", fixRunId: started.runId, decidedAt: new Date(), errorMessage: "" },
  });
  await logAutomation({
    planId: item.planId, ticketId: item.ticketId, action: "implement", outcome: "started",
    reason: "qa-fix", detail: `QA fix round ${item.qaRounds + 1} of ${MAX_QA_ROUNDS}: ${chosen.length} finding(s), approved by you.`,
  });
  return { ok: true, error: "" };
}

/** A closed case whose window QC wrote past opens the next one, so no comment goes unanswered. */
async function carryOver(c: { plannedTicketId: string; planId: string; ticketId: string; answersUpTo: string }) {
  const row = await prisma.plannedTicket.findUnique({ where: { id: c.plannedTicketId }, select: { qaCommentAt: true } });
  if (!row || !followUpAfter(c.answersUpTo, row.qaCommentAt)) return;
  await noteSignals({ id: c.plannedTicketId, planId: c.planId, ticketId: c.ticketId }, ["comment"], { since: c.answersUpTo, upTo: row.qaCommentAt });
}

export async function postCaseReply(caseId: string, body: string): Promise<Result> {
  const c = await prisma.qaCase.findUnique({ where: { id: caseId } });
  if (!c) return { ok: false, error: "No such QA case." };
  if (c.status !== "ready" && c.status !== "fixed") return { ok: false, error: "This case has no reply waiting to be posted." };
  const text = body.trim();
  if (!text) return { ok: false, error: "The reply is empty." };

  const plan = await prisma.sprintPlan.findUnique({ where: { id: c.planId } });
  if (!plan) return { ok: false, error: "This case's plan no longer exists." };
  const { org } = await resolveCredential(plan.provider);
  if (org !== plan.org) return { ok: false, error: "Switch to this plan's organization before posting." };

  try {
    await postTicketComment(normalizeProvider(plan.provider), c.ticketId, text);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await logAutomation({ planId: plan.id, ticketId: c.ticketId, action: "watch", outcome: "failed", reason: "qa-reply-post-failed", detail: error });
    return { ok: false, error };
  }
  await prisma.qaCase.update({
    where: { id: c.id },
    data: { status: "posted", body: text, postedAt: new Date(), decidedAt: c.decidedAt ?? new Date() },
  });
  await logAutomation({
    planId: plan.id, ticketId: c.ticketId, action: "watch", outcome: "done",
    reason: "qa-reply-posted", detail: "Your reply to QC was posted on the work item.",
  });
  await carryOver(c);
  return { ok: true, error: "" };
}

export async function dismissCase(caseId: string): Promise<Result> {
  const c = await prisma.qaCase.findUnique({ where: { id: caseId } });
  if (!c) return { ok: false, error: "No such QA case." };
  if (!isOpenCase(c.status)) return { ok: false, error: "This case is already closed." };
  if (c.status === "running" || c.status === "fixing") return { ok: false, error: "A run is in flight for this case — cancel it first." };
  await prisma.qaCase.update({ where: { id: c.id }, data: { status: "dismissed", decidedAt: new Date() } });
  await carryOver(c);
  return { ok: true, error: "" };
}

/** Bring cases in step with their runs — part of the scheduler's reconcile. */
export async function reconcileQaCases(): Promise<void> {
  const inFlight = await prisma.qaCase.findMany({ where: { status: { in: ["running", "fixing"] } } });
  if (!inFlight.length) return;
  const ids = inFlight.map((c) => (c.status === "running" ? c.runId : c.fixRunId)).filter(Boolean);
  const byId = new Map((await runOutcomes(ids)).map((r) => [r.id, r] as const));

  for (const c of inFlight) {
    const runId = c.status === "running" ? c.runId : c.fixRunId;
    const run = byId.get(runId);
    if (run && (run.state === "running" || run.state === "waiting")) continue;
    const failed = !run || run.state !== "succeeded";
    const why = !run ? "the run no longer exists" : run.endReason || run.state;

    if (c.status === "running") {
      if (failed) {
        await prisma.qaCase.update({ where: { id: c.id }, data: { status: "failed", errorMessage: why, endedAt: new Date() } });
        await logAutomation({ planId: c.planId, ticketId: c.ticketId, action: "watch", outcome: "failed", reason: "qa-analysis-failed", detail: why });
        continue;
      }
      const findings = normalizeFindings(run.output.findings);
      const recommendation = recommend(findings);
      const row = await prisma.plannedTicket.findUnique({ where: { id: c.plannedTicketId }, select: { qaCommentAt: true } });
      // QC wrote while the analysis ran: it answers a window that is already out of date.
      const stale = !!row && followUpAfter(c.answersUpTo, row.qaCommentAt);
      await prisma.qaCase.update({
        where: { id: c.id },
        data: {
          status: stale ? "pending" : "ready",
          findings: findings as unknown as Prisma.InputJsonValue,
          recommendation,
          body: String(run.output.qaReply ?? "").trim(),
          summary: typeof run.output.summary === "string" ? run.output.summary : "",
          fixNeeded: recommendation === "fix",
          needsHuman: recommendation === "decide",
          endedAt: new Date(),
          ...(stale && row ? { answersUpTo: row.qaCommentAt, signalAt: new Date() } : {}),
        },
      });
      await logAutomation({
        planId: c.planId, ticketId: c.ticketId, action: "watch", outcome: "done", reason: `qa-analysis-${recommendation}`,
        detail: stale
          ? "QC wrote again while the analysis ran — it will be analysed again with the new comments."
          : recommendation === "fix"
            ? `${findings.filter((f) => f.defect).length} real defect(s) found — approve the fix to start it.`
            : recommendation === "decide"
              ? "Some feedback needs your decision (missing information or a new requirement)."
              : "No defect — a reply to QC is drafted for you to review and post.",
      });
      continue;
    }

    // A fix run: its plan row is settled by the implement reconcile; the case only needs the result.
    const published = !failed && !!run.prUrl && run.output.outcome !== "no-fix-needed" && run.output.noChange !== true;
    const pr = published ? run.prUrl : "";
    await prisma.qaCase.update({
      where: { id: c.id },
      data: published
        ? { status: "fixed", endedAt: new Date(), body: c.body ? `${c.body}\n\n${pr}` : pr }
        : {
            status: "ready",
            endedAt: new Date(),
            errorMessage: failed ? `The fix run did not finish: ${why}` : "The fix run found nothing to change — decide again or reply.",
          },
    });
  }
}
