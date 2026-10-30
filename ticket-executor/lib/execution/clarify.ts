// A run parked on NEEDS_INPUT, carried to the PO and back.
//
// Readiness drafts the questions; the developer edits and approves them and `postClarification()` posts them on
// the work item — the only write here, and only on a person's say-so. From then on `recheckAnswered()` (each tick)
// watches the work item: the first comment by someone other than the developer after the questions resumes the run
// at readiness, which reads the ticket again. Every step is an automation event keyed by the run id, so the loop
// needs no column of its own and the log says when it was asked and when it was answered.
import { prisma } from "../prisma";
import { resumeRun } from "../dagent";
import { hasIdentity, isSamePerson } from "../identity";
import { resolveCredential } from "../providerCredentials";
import { commentsSince } from "../ticketLifecycle";
import { loadCommentMarks, normalizeProvider, postTicketComment } from "../tickets";
import { PO_ANSWERED, postedAtOf, QUESTIONS_POSTED } from "../clarification";
import { logAutomation } from "./planStore";


const ANSWER_SCAN_MS = 6 * 60_000;
const lastAnswerScan = new Map<string, number>();

export type Clarification = {
  plannedTicketId: string;
  ticketId: string;
  runId: string;
  questions: string[];
  /** When the current questions were posted on the work item; null until the developer approves them. */
  postedAt: string | null;
};

/** Each tracked row whose run is parked on needs-input, with readiness's latest questions. */
export async function clarificationsWaiting(planId: string): Promise<Clarification[]> {
  const rows = await prisma.plannedTicket.findMany({
    where: { planId, untracked: false, implementState: "running", runId: { not: "" } },
    select: { id: true, ticketId: true, runId: true },
  });
  if (!rows.length) return [];
  const runs = await prisma.dagentRun.findMany({
    where: { id: { in: rows.map((r) => r.runId) }, state: "waiting", waitReason: "needs-input" },
    select: { id: true },
  });
  if (!runs.length) return [];
  const ids = runs.map((r) => r.id);
  const [steps, events] = await Promise.all([
    prisma.dagentStep.findMany({
      where: { runId: { in: ids }, nodeId: "readiness", status: "succeeded" },
      orderBy: { startedAt: "asc" },
      select: { runId: true, output: true },
    }),
    prisma.automationEvent.findMany({
      where: { planId, reason: { in: [QUESTIONS_POSTED, PO_ANSWERED] }, OR: ids.map((id) => ({ detail: { startsWith: id } })) },
      orderBy: { createdAt: "asc" },
      select: { reason: true, outcome: true, detail: true, createdAt: true },
    }),
  ]);
  return ids.flatMap((runId) => {
    const row = rows.find((r) => r.runId === runId);
    if (!row) return [];
    const out = (steps.filter((s) => s.runId === runId).pop()?.output ?? {}) as { questions?: unknown };
    const questions = Array.isArray(out.questions) ? out.questions.map(String).filter(Boolean) : [];
    return [{ plannedTicketId: row.id, ticketId: row.ticketId, runId, questions, postedAt: postedAtOf(events, runId) }];
  });
}

/** Post the developer-approved questions on the work item. */
export async function postClarification(plannedId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const text = body.trim();
  if (!text) return { ok: false, error: "The questions are empty." };
  const item = await prisma.plannedTicket.findUnique({ where: { id: plannedId }, include: { plan: true } });
  if (!item) return { ok: false, error: "No such planned ticket." };
  const waiting = (await clarificationsWaiting(item.planId)).find((c) => c.plannedTicketId === plannedId);
  if (!waiting) return { ok: false, error: "This ticket's run is not waiting on the PO." };
  const { org } = await resolveCredential(item.plan.provider);
  if (org !== item.plan.org) return { ok: false, error: "Switch to this plan's organization before posting." };

  try {
    await postTicketComment(normalizeProvider(item.plan.provider), item.ticketId, text);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await logAutomation({ planId: item.planId, ticketId: item.ticketId, action: "watch", outcome: "failed", reason: "questions-post-failed", detail: error });
    return { ok: false, error };
  }
  // Written directly rather than through `logAutomation()`, which swallows a failed write — this row is state.
  await prisma.automationEvent.create({
    data: { planId: item.planId, ticketId: item.ticketId, action: "watch", outcome: "done", reason: QUESTIONS_POSTED, detail: waiting.runId },
  });
  return { ok: true };
}

/** Resume each parked run whose posted questions got a reply from someone else. Returns how many resumed. */
export async function recheckAnswered(
  plan: { id: string; provider: string; org: string; identityEmail: string },
  now = new Date()
): Promise<number> {
  if (now.getTime() - (lastAnswerScan.get(plan.id) ?? 0) < ANSWER_SCAN_MS) return 0;
  const asked = (await clarificationsWaiting(plan.id)).filter((c) => c.postedAt);
  if (!asked.length) return 0;
  lastAnswerScan.set(plan.id, now.getTime());

  const { org, identity } = await resolveCredential(plan.provider);
  if (!org || org !== plan.org || !hasIdentity(identity) || identity.email !== plan.identityEmail) return 0;
  const provider = normalizeProvider(plan.provider);

  let resumed = 0;
  for (const c of asked) {
    const marks = await loadCommentMarks(provider, c.ticketId).catch(() => null);
    if (!marks) continue;
    const seen = commentsSince(marks, c.postedAt!, (name) => isSamePerson("", name, identity));
    if (!seen.count) continue;
    const r = await resumeRun(c.runId, "recheck-readiness");
    await logAutomation({
      planId: plan.id, ticketId: c.ticketId, action: "implement", outcome: r.ok ? "started" : "failed", reason: PO_ANSWERED,
      detail: `${c.runId} — ${seen.count} new comment(s) since the questions were posted. ` +
        (r.ok ? "Readiness reads the ticket again." : `The run could not resume: ${r.error ?? "unknown"}.`),
    });
    if (r.ok) resumed += 1;
  }
  return resumed;
}
