// What on My Sprint is waiting for the developer, in the order it should be read.
//
// Pure: no React, no Prisma, no fetch. The page turns each entry's `actions` into buttons and
// supplies the clock (`today`), so the same plan always lists the same items.

import { isFixingQa, MAX_QA_ROUNDS } from "./ticketLifecycle";
import { overBudget } from "./runMetrics";

export type AttentionTone = "danger" | "warning" | "accent";
export type AttentionActionKind = "result" | "fixReview" | "release" | "retry" | "moveToQa" | "markReviewed" | "readDraft";

export type AttentionEntry = {
  key: string;
  ticketId: string;
  /** The stored plan row this concerns; the page resolves the row to act on it. */
  plannedId: string;
  title: string;
  tone: AttentionTone;
  text: string;
  actions: AttentionActionKind[];
};

export type AttentionRow = {
  id: string;
  ticketId: string;
  title: string;
  claim: string;
  reviewState: string;
  reviewRounds: number;
  prPublished: boolean;
  prMerged: boolean;
  prUrl: string;
  releaseError: string;
  releaseDay: string;
  releasedAt: string | null;
  implementState: string;
  implementOrder: number;
  pendingAction: string;
  qaRounds: number;
};

export type AttentionCase = {
  id: string;
  plannedTicketId: string;
  ticketId: string;
  status: string;
  recommendation: string;
};

export type AttentionReview = { plannedTicketId: string; ticketId: string; runId: string; reason: string };

export type AttentionInput = {
  rows: AttentionRow[];
  reviews: AttentionReview[];
  cases: AttentionCase[];
  /** Spend per ticket id, and the soft per-ticket budget (0 = none). */
  costs: Record<string, number>;
  budgetUsd: number;
  /** Today as an ISO day; empty when the sprint has no calendar. */
  today: string;
  autoRelease: boolean;
  autoDraftQaReply: boolean;
};

const TONE_RANK: Record<AttentionTone, number> = { danger: 0, warning: 1, accent: 2 };

const usd = (n: number) => "$" + n.toFixed(2);

function qaCaseText(c: AttentionCase): string {
  if (c.status === "pending") return "QC gave feedback — analyse it (auto-analysis is off).";
  if (c.status === "failed") return "The analysis of QC's feedback failed.";
  if (c.status === "fixed") return "The QA fix has a pull request — post the reply to QC.";
  if (c.recommendation === "fix") return "QC found a real defect — approve the fix.";
  if (c.recommendation === "decide") return "QC's feedback needs your call.";
  if (c.recommendation === "none") return "QC only confirmed — nothing to reply, close it.";
  return "A reply to QC is ready — review and post it.";
}

export function attentionOf(input: AttentionInput): AttentionEntry[] {
  const { rows, reviews, cases, costs, budgetUsd, today, autoRelease, autoDraftQaReply } = input;
  const out: AttentionEntry[] = [];
  const titleOf = (plannedId: string) => rows.find((r) => r.id === plannedId)?.title ?? "";

  for (const t of rows) {
    if (!t.id || t.claim !== "mine") continue;
    const base = { ticketId: t.ticketId, plannedId: t.id, title: t.title };
    const due = !!t.prUrl && t.implementState === "implemented" && !t.releasedAt;
    if (t.reviewState === "needs-human") {
      out.push({ ...base, key: "nh-" + t.id, tone: "warning", text: `${t.reviewRounds} rounds of automatic review fixes did not close it — the rest needs a decision.`, actions: ["result"] });
    }
    if (t.reviewState === "failed") {
      out.push({ ...base, key: "rf-" + t.id, tone: "danger", text: "The review fix run failed.", actions: [t.prPublished && !t.prMerged ? "fixReview" : "result"] });
    }
    if (t.releaseError) {
      out.push({ ...base, key: "re-" + t.id, tone: "danger", text: t.releaseError, actions: due ? ["release"] : [] });
    }
    if (t.implementState === "failed") {
      out.push({
        ...base, key: "if-" + t.id, tone: "danger",
        text: t.prUrl ? "The run failed after opening a pull request — look at the result." : "The implement run failed.",
        actions: [!t.prUrl && t.implementOrder > 0 ? "retry" : "result"],
      });
    }
    if (t.pendingAction === "move-to-qa") {
      out.push({ ...base, key: "mq-" + t.id, tone: "accent", text: "Pull request merged — confirm to move it to In QA.", actions: ["moveToQa"] });
    }
    if (t.pendingAction === "fix-qa" && !isFixingQa(t) && t.qaRounds >= MAX_QA_ROUNDS) {
      out.push({ ...base, key: "qx-" + t.id, tone: "danger", text: `${t.qaRounds} QA fixes did not close this ticket — it needs you.`, actions: ["result"] });
    }
    if (due && !autoRelease && today && t.releaseDay && t.releaseDay <= today && !t.releaseError) {
      out.push({ ...base, key: "rd-" + t.id, tone: "accent", text: "Its release day has come and auto-release is off.", actions: ["release"] });
    }
  }

  // A run the harness ended on NEEDS_REVIEW: decided already, flagged until the developer has looked.
  for (const r of reviews) {
    const row = rows.find((t) => t.id === r.plannedTicketId);
    out.push({
      key: "nr-" + r.runId, ticketId: r.ticketId, plannedId: r.plannedTicketId, title: row?.title ?? "", tone: "warning",
      text: row?.implementState === "no-fix-needed"
        ? "Needs review — the run found nothing to change and ended. Check its summary."
        : `Needs review — ${r.reason}.`,
      actions: ["result", "markReviewed"],
    });
  }

  // Over the soft budget: automation stops retrying and fixing review on its own; anything by hand still works.
  for (const ticketId of overBudget(costs, budgetUsd)) {
    const row = rows.find((t) => t.ticketId === ticketId && t.claim === "mine");
    if (!row) continue;
    out.push({
      key: "ob-" + ticketId, ticketId, plannedId: row.id, title: row.title, tone: "warning",
      text: `Spent ${usd(costs[ticketId])} of its ${usd(budgetUsd)} budget — automation no longer retries or fixes review on it by itself.`,
      actions: ["result"],
    });
  }

  // Every QA follow-up case waiting on the developer — whoever holds the ticket now.
  for (const c of cases) {
    if (c.status !== "ready" && c.status !== "failed" && c.status !== "fixed" && !(c.status === "pending" && !autoDraftQaReply)) continue;
    out.push({
      key: "qa-" + c.id, ticketId: c.ticketId, plannedId: c.plannedTicketId, title: titleOf(c.plannedTicketId),
      tone: c.status === "failed" || c.recommendation === "fix" ? "danger" : c.status === "fixed" ? "accent" : "warning",
      text: qaCaseText(c),
      actions: ["readDraft"],
    });
  }

  return out.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
}
