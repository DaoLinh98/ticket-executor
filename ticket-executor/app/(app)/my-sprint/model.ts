import { COLORS } from "@/lib/ui";
import type { Claim } from "@/lib/sprintClaim";
import type { Lane, PlanConfig, SprintPlanResult } from "@/lib/sprintPlan";
import type { CaseStatus, Finding, LastClosed, Recommendation, Trigger } from "@/lib/qaFollowUp";
import { isQueueable, STAGE_LABEL, stageFrom } from "@/lib/ticketLifecycle";
import type { Ticket } from "@/lib/types";
import type { TriagedTicket } from "@/lib/execution/triage";

export type MySprint = {
  configured: boolean;
  notice?: string;
  error?: string;
  identity?: { email: string; name: string };
  anchorProject?: string;
  sprint?: string;
  window?: { startDate: string; finishDate: string };
  today?: string;
  truncated?: boolean;
  tickets?: Ticket[];
  claimed?: { ticket: Ticket; claim: Claim; assigneeNow: string; fromPlan: boolean }[];
  plan: SprintPlanResult | null;
  config: PlanConfig;
};

export type TriageRow = {
  id: string;
  status: "running" | "succeeded" | "failed";
  result: { summary?: string; finalNotes?: string[]; tickets?: TriagedTicket[] };
  errorMessage: string;
  costUsd: number;
};

export type PlannedRow = {
  id: string;
  ticketId: string;
  title: string;
  project: string;
  implementOrder: number;
  points: number;
  estimateHours: number;
  releaseDay: string;
  blocked: boolean;
  unblockedByUser: boolean;
  implementState: string;
  runId: string;
  prUrl: string;
  prPublished: boolean;
  reviewersSet: boolean;
  statusMoved: boolean;
  releasedAt: string | null;
  releaseError: string;
  reviewState: string;
  reviewRunId: string;
  openComments: number;
  threadsReplied: number;
  threadsResolved: number;
  reviewRounds: number;
  reviewError: string;
  claim: Claim;
  assigneeNow: string;
  model: string;
  effort: string;
  stage: string;
  prMerged: boolean;
  pendingAction: string;
  pendingSince?: string | null;
  qaCommentAt?: string;
  qaRounds: number;
  /** Stopped tracking by the developer — kept as a record, never shown. */
  untracked?: boolean;
};

export type StoredPlan = {
  id: string;
  status: "draft" | "active" | "archived";
  autoImplement: boolean;
  autoRelease: boolean;
  autoResolveReview: boolean;
  autoDraftQaReply: boolean;
  includeWider: boolean;
  reviewers: string[];
  pointsPerDay: number;
  hoursPerDay: number;
  maxTicketsPerDay: number;
  items: PlannedRow[];
};

/** An open QA follow-up case — `lib/qaFollowUp.ts` holds what each field means. */
export type QaCase = {
  id: string;
  plannedTicketId: string;
  ticketId: string;
  status: Exclude<CaseStatus, "posted" | "dismissed">;
  triggers: Trigger[];
  findings: Finding[] | null;
  recommendation: Recommendation | "";
  body: string;
  summary: string;
  errorMessage: string;
  runId: string;
  fixRunId: string;
  signalAt: string | null;
  endedAt: string | null;
  createdAt: string;
};

export type AutomationRow = {
  id: string;
  ticketId: string;
  action: string;
  outcome: string;
  reason: string;
  detail: string;
  createdAt: string;
};

export const LANE_LABEL: Record<Lane, string> = {
  todo: "To do",
  doing: "In progress",
  review: "In review",
  done: "Done",
};

export const LANE_COLOR: Record<Lane, string> = {
  todo: COLORS.textDim,
  doing: COLORS.accent,
  review: COLORS.indigo,
  done: COLORS.success,
};

export const VERDICT: Record<string, { color: string; label: string }> = {
  "on-track": { color: COLORS.success, label: "On track" },
  tight: { color: COLORS.warning, label: "Tight" },
  "over-committed": { color: COLORS.danger, label: "Over-committed" },
  "no-calendar": { color: COLORS.accent, label: "No sprint dates" },
};

// `means` is the answer to "what does this ticket still need?", which the label
// alone never gives — "Ready · notes" in particular reads like a half-verdict
// until you know it is startable today. It is the pill's tooltip here and a
// legend in the full report.
export const READINESS: Record<string, { color: string; label: string; means: string }> = {
  ready: { color: COLORS.success, label: "Ready", means: "Nothing is missing — start it as it stands." },
  "ready-with-notes": {
    color: COLORS.info,
    label: "Ready · notes",
    means: "Startable today, nobody has to answer anything. The notes are context to carry into the work — open the full report.",
  },
  "needs-clarification": {
    color: COLORS.warning,
    label: "Needs clarification",
    means: "A person has to answer something first. The scheduler will not run it until it is cleared.",
  },
  blocked: {
    color: COLORS.danger,
    label: "Blocked",
    means: "Work cannot start at all — a missing dependency, or a contradiction only the client can resolve.",
  },
};

// Where the developer's claim on a ticket stands. `mine` has no pill: the row's
// own status and state columns say everything, and a badge on every ordinary
// ticket would only make the two exceptions harder to spot.
export const CLAIM: Record<Claim, { color: string; label: string }> = {
  mine: { color: COLORS.textDim, label: "Mine" },
  "handed-off": { color: COLORS.info, label: "Handed off" },
  dropped: { color: COLORS.textDim, label: "Left sprint" },
};

export const IMPLEMENT_STATE: Record<string, { color: string; label: string }> = {
  pending: { color: COLORS.textDim, label: "Queued" },
  running: { color: COLORS.accent, label: "Running" },
  implemented: { color: COLORS.indigo, label: "Draft PR" },
  failed: { color: COLORS.danger, label: "Failed" },
  skipped: { color: COLORS.faint, label: "Skipped" },
  "no-fix-needed": { color: COLORS.info, label: "No fix needed" },
};

/**
 * What the State column says about one row.
 *
 * Release is not a value of `implementState` — the engine stops at
 * "implemented" and `releasePlannedTicket()` records what it did in its own
 * three columns — so reading `implementState` alone leaves a released ticket
 * labelled "Draft PR" forever, next to a pull request that is no longer a draft.
 *
 * The release columns therefore come first, and the partial case gets its own
 * label rather than being rounded to one of the two ends: a pull request that
 * was published but whose work item never moved is a real state somebody has to
 * finish by hand, and calling it either "Draft PR" or "Released" hides that.
 */
export function stateOf(t: PlannedRow, status: string): { color: string; label: string } {
  if (t.releasedAt) return { color: COLORS.success, label: "Released" };
  if (t.implementState === "pending" && !t.implementOrder) {
    const stage = stageFrom(t.stage, status);
    if (!isQueueable(stage)) return { color: stage === "qa-failed" ? COLORS.danger : COLORS.indigo, label: STAGE_LABEL[stage] };
  }
  if (t.implementState === "skipped" && t.claim === "mine" && !t.prUrl) return { color: COLORS.textDim, label: "On hold" };
  if (t.prPublished) return { color: COLORS.warning, label: "In review" };
  return IMPLEMENT_STATE[t.implementState] ?? IMPLEMENT_STATE.pending;
}

/**
 * What the Review column says about one row.
 *
 * A column of its own rather than another branch inside `stateOf()`. The two
 * answer questions about different moments and both stay true at once: a
 * released ticket whose review is being resolved is still released, and folding
 * the second fact into the first is exactly the mistake that left a released
 * ticket reading "Draft PR" until State was split from the release columns.
 *
 * `spin` is the live half. A pill alone cannot say whether "Fixing" is this
 * second or a stale row, which is the same reason the State column carries one.
 */
export function reviewOf(t: PlannedRow): { color: string; label: string; spin: boolean } | null {
  // Nothing is under review until a reviewer has been told there is something to
  // review. Before release the pull request is a draft nobody has been sent.
  if (!t.prPublished) return null;
  switch (t.reviewState) {
    case "running":
      return { color: COLORS.accent, label: "Fixing", spin: true };
    case "failed":
      return { color: COLORS.danger, label: "Fix failed", spin: false };
    case "needs-human":
      return { color: COLORS.warning, label: "Needs you", spin: false };
    case "resolved":
      return {
        color: t.openComments > 0 ? COLORS.warning : COLORS.success,
        label: `Replied ${t.threadsReplied}`,
        spin: false,
      };
    default:
      return t.openComments > 0
        ? { color: COLORS.warning, label: `${t.openComments} open`, spin: false }
        : { color: COLORS.textDim, label: "Clean", spin: false };
  }
}

export const hours = (h: number) => (Math.round(h * 10) / 10).toString() + "h";

/** "Mon 07 Sep" — the weekday is the part a release calendar is read for. */
export function dayLabel(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00.000Z");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}

// The triage column carries the override control next to its verdict, so it is
// the one that has to fit two things rather than one.
const GRID = "44px 1fr 60px 68px 132px 106px 104px 104px 176px";

/**
 * Where a ticket actually lives, when that is not the iteration on screen.
 *
 * Read off the provider's iteration path rather than off which query returned
 * the row: the path is what the developer sees in the tracker, and it is the
 * only thing that separates "not scheduled at all" (the path is still the
 * project root) from "parked in another sprint".
 *
 * Empty for a ticket that is in this iteration — the common case earns no badge.
 */
export function originLabel(iterationPath: string | undefined, sprint: string): string {
  const segments = (iterationPath ?? "").split("\\").filter(Boolean);
  if (segments.length === 0) return "";
  if (segments.length === 1) return "Backlog";
  const leaf = segments[segments.length - 1];
  return leaf === sprint ? "" : leaf;
}

export type PlanResponse = {
  plan: StoredPlan | null;
  events: AutomationRow[];
  cases: QaCase[];
  /** Each ticket's last closed QA case, by planned-ticket id. */
  closed: Record<string, LastClosed>;
  costs: Record<string, number>;
};

export type RebuildPreview = {
  added: string[];
  moved: { ticketId: string; from: number; to: number }[];
  redated: { ticketId: string; from: string; to: string }[];
  claimChanged: { ticketId: string; from: string; to: string }[];
  overflowPoints: number;
  titles: Record<string, string>;
};

export const usd = (n: number) => "$" + n.toFixed(2);

export type PlanFilter = "all" | "attention" | "queued" | "running" | "review" | "done";
export type PlanSort = "queue" | "release";

export const FILTER_LABEL: Record<PlanFilter, string> = {
  all: "All",
  attention: "Needs you",
  queued: "Queued",
  running: "Running",
  review: "In review",
  done: "Done",
};

export function matchesFilter(t: PlannedRow, filter: PlanFilter, attentionIds: Set<string>): boolean {
  switch (filter) {
    case "attention":
      return attentionIds.has(t.ticketId);
    case "queued":
      return t.claim === "mine" && (t.implementState === "pending" || t.implementState === "skipped") && t.implementOrder > 0 && !t.prUrl;
    case "running":
      return t.implementState === "running" || t.reviewState === "running";
    case "review":
      return t.claim === "mine" && t.prPublished;
    case "done":
      return !!t.releasedAt || t.claim !== "mine";
    default:
      return true;
  }
}

export const PLAN_KEY = ["my-sprint", "plan"] as const;

export const fetchPlan = async (): Promise<PlanResponse> => {
  const d = await fetch("/api/my-sprint/plan").then((r) => r.json());
  return {
    plan: d.plan ?? null,
    events: Array.isArray(d.events) ? d.events : [],
    cases: Array.isArray(d.cases) ? d.cases : [],
    closed: d.closed && typeof d.closed === "object" ? d.closed : {},
    costs: d.costs && typeof d.costs === "object" ? d.costs : {},
  };
};
