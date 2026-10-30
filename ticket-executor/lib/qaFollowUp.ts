// What happens to a ticket after it is handed to QA.
//
// A delivered ticket is not finished: QC asks a question, reports an issue, fails
// it, or sends it back to In Progress. Each of those is a **signal**, and every
// signal must end in a decision the developer approved — explain, confirm, or fix
// the code — rather than sit on the developer's side. One open **case** per ticket
// collects the signals, an agent analyses them against the code, the developer
// decides, and the case closes when the reply is posted or the case is dismissed.
//
// Pure and Prisma-free, like `ticketLifecycle.ts`: the caller gathers the facts,
// this module decides what they mean.

import type { Stage } from "./ticketLifecycle";

/**
 * - `pending`  — signals seen, not analysed yet (debouncing, waiting for a slot, or auto-analysis is off)
 * - `running`  — the analysis run is in flight
 * - `ready`    — analysed; waiting for the developer's decision
 * - `failed`   — the analysis did not finish
 * - `fixing`   — the developer approved a fix; the fix run is in flight
 * - `fixed`    — the fix published a draft PR; the reply to QC waits to be posted
 * - `posted` / `dismissed` — closed
 */
export type CaseStatus = "pending" | "running" | "ready" | "failed" | "fixing" | "fixed" | "posted" | "dismissed";

export const OPEN_CASE: readonly CaseStatus[] = ["pending", "running", "ready", "failed", "fixing", "fixed"];

export const isOpenCase = (status: string): boolean => (OPEN_CASE as readonly string[]).includes(status);

export type Trigger = "comment" | "qa-failed" | "returned" | "manual";

export const TRIGGER_LABEL: Record<Trigger, string> = {
  comment: "QC commented",
  "qa-failed": "QA failed",
  returned: "Back to In Progress",
  manual: "Asked by you",
};

const WITH_QA: ReadonlySet<Stage> = new Set<Stage>(["qa", "qa-failed", "qa-passed"]);

/** Comments are read while the ticket is with QA, and while it is back in progress after QA. */
export function watchesComments(stage: Stage, returnedFromQa: boolean): boolean {
  return WITH_QA.has(stage) || (stage === "doing" && returnedFromQa);
}

/** The signals one sweep of a ticket produced. */
export function signalsOf(f: { stage: Stage; prevStage: Stage | ""; newComments: number }): Trigger[] {
  const out: Trigger[] = [];
  if (f.newComments > 0) out.push("comment");
  if (f.stage === "qa-failed" && f.prevStage !== "qa-failed" && f.prevStage !== "") out.push("qa-failed");
  if (f.stage === "doing" && f.prevStage !== "" && WITH_QA.has(f.prevStage)) out.push("returned");
  return out;
}

/**
 * What a new signal does to the ticket's open case.
 * - `open`   — no open case: open one.
 * - `extend` — still pending: widen it, and restart the debounce.
 * - `reopen` — analysed but not acted on: the analysis is out of date, analyse again.
 * - `hold`   — a run is in flight or a fix is out: the new comments are picked up when the case closes
 *              (`followUpAfter`), so nothing is lost and nothing interrupts the run.
 */
export function onSignal(open: CaseStatus | null): "open" | "extend" | "reopen" | "hold" {
  if (!open) return "open";
  if (open === "pending") return "extend";
  if (open === "ready" || open === "failed") return "reopen";
  return "hold";
}

/** A closing (or just-analysed) case left comments unanswered when QC wrote after its window. */
export function followUpAfter(caseUpTo: string, ticketCommentAt: string): boolean {
  return !!ticketCommentAt && ticketCommentAt > caseUpTo;
}

/** Where the ticket's last closed case left off: the last comment it answered, and when it was closed. */
export type LastClosed = { answersUpTo: string; closedAt: string };

/**
 * Whether QC's feedback on a ticket with no open case is still unanswered — what the Analyse action is offered
 * for. A comment after the last closed case's window, or a return from QA (QA failed / back to In Progress)
 * no case has dealt with since. A ticket whose feedback is all answered offers nothing.
 */
export function awaitsAnalysis(f: {
  stage: Stage;
  pendingAction: string;
  pendingSince: string | null;
  qaCommentAt: string;
  lastClosed: LastClosed | null;
}): boolean {
  if (!WITH_QA.has(f.stage) && f.pendingAction !== "fix-qa") return false;
  if (followUpAfter(f.lastClosed?.answersUpTo ?? "", f.qaCommentAt)) return true;
  if (f.pendingAction !== "fix-qa" || !f.pendingSince) return false;
  return !f.lastClosed || new Date(f.lastClosed.closedAt).getTime() < new Date(f.pendingSince).getTime();
}

/** QC often writes several comments in a row; analysing after the first would answer half of them. */
export const DEBOUNCE_MS = 10 * 60_000;

export function dueForAnalysis(c: { status: string; signalAt: Date | null }, auto: boolean, now: Date): boolean {
  if (!auto || c.status !== "pending") return false;
  return !c.signalAt || now.getTime() - c.signalAt.getTime() >= DEBOUNCE_MS;
}

// ---- the analysis ----

export type FindingKind = "question" | "defect" | "not-defect" | "needs-info" | "new-scope" | "acknowledgement";

export const FINDING_KINDS: readonly FindingKind[] = ["question", "defect", "not-defect", "needs-info", "new-scope", "acknowledgement"];

export type Finding = {
  finding: string;
  kind: FindingKind;
  defect: boolean;
  reason: string;
  files: string[];
  /** Set by `normalizeFindings` when a verdict was downgraded for lack of evidence. */
  weak?: boolean;
};

// `path/to/file.ext:42`, or an acceptance criterion named as such.
const CITES_CODE = /[\w./\\-]+\.[A-Za-z0-9]+:\d+/;
const CITES_AC = /\bAC\s*#?\d+|acceptance criteri/i;

/** A "not a defect" verdict must point at the code or the criterion that proves the behaviour is right. */
export function hasEvidence(reason: string): boolean {
  return CITES_CODE.test(reason) || CITES_AC.test(reason);
}

/**
 * The harness's reading of the agent's verdicts — never the agent's own summary.
 * `defect` follows `kind`, and a `not-defect` with no evidence becomes `needs-info`: an unproven
 * "works as designed" is exactly the reply that leaves a real bug in place.
 */
export function normalizeFindings(raw: unknown): Finding[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const f = (r ?? {}) as Partial<Finding>;
    const reason = String(f.reason ?? "");
    let kind: FindingKind = FINDING_KINDS.includes(f.kind as FindingKind) ? (f.kind as FindingKind) : f.defect ? "defect" : "needs-info";
    const weak = kind === "not-defect" && !hasEvidence(reason);
    if (weak) kind = "needs-info";
    return {
      finding: String(f.finding ?? ""),
      kind,
      defect: kind === "defect",
      reason,
      files: Array.isArray(f.files) ? f.files.map(String) : [],
      ...(weak ? { weak: true } : {}),
    };
  });
}

/**
 * - `fix`    — at least one real defect: the code changes.
 * - `decide` — something only the developer can settle (missing information, a new requirement).
 * - `reply`  — questions and proven non-defects: an answer is enough.
 * - `none`   — QC only confirmed or informed (a pass, a thanks): nothing to fix and nothing to answer.
 */
export type Recommendation = "fix" | "decide" | "reply" | "none";

export function recommend(findings: Finding[]): Recommendation {
  if (findings.some((f) => f.kind === "defect")) return "fix";
  if (!findings.length || findings.some((f) => f.kind === "needs-info" || f.kind === "new-scope")) return "decide";
  if (findings.every((f) => f.kind === "acknowledgement")) return "none";
  return "reply";
}

// ---- keeping it moving ----

/** How long a case may wait on the developer before the bell asks again. */
export const SLA_MS = 4 * 60 * 60_000;

/** Waiting on the developer — the states the bell reports. */
export function awaitsDeveloper(c: { status: string }, auto: boolean): boolean {
  return c.status === "ready" || c.status === "failed" || c.status === "fixed" || (c.status === "pending" && !auto);
}

/** Whole SLA periods the case has waited — 0 while inside the first one. Part of the bell's fingerprint, so
 *  every further period re-raises the notification once. */
export function overduePeriods(since: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / SLA_MS));
}
