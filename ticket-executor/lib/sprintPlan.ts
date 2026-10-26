// The sprint arithmetic: how much work the developer is carrying, how much time
// is left to carry it in, and which day each finished ticket should be handed to
// a reviewer.
//
// Pure and Prisma-free, the same reason `admission.ts` and `identity.ts` are —
// this is the rule the scheduler will act on, and a rule worth acting on
// automatically is a rule worth asserting in a test that needs no database.
//
// **Two schedules, not one.** The whole point of this module is that "when the
// agent works on a ticket" and "when a human is asked to look at it" are
// different questions:
//
//   - `implementOrder` is a *queue*. The agent works straight down it, as fast
//     as the machine allows, because there is no reason to leave the machine
//     idle overnight.
//   - `releaseDay` is a *calendar*. Finished work is revealed at a steady pace,
//     because a reviewer who receives five pull requests on the last Friday of
//     the sprint reviews none of them properly.
//
// Everything here is deliberately deterministic. An LLM could order a backlog,
// but a division can be re-run to explain itself and an LLM's answer cannot;
// the agent's judgement belongs upstream, in the triage that produces the
// `order` and `points` this module is handed.

import type { Claim } from "@/lib/sprintClaim";
import { isQueueable, stageOf, type Stage } from "@/lib/ticketLifecycle";
import type { Ticket } from "@/lib/types";

// ---- lanes ----

/**
 * Which lane a ticket sits in for capacity purposes.
 *
 * Deliberately *not* reusing `canImplement()` / `isReviewable()` from lib/ui.ts:
 * those answer "may a run start on this now" and "might this have an open PR",
 * which are questions about one ticket. This answers "does this work still cost
 * me sprint capacity", which is a question about the whole board — and `done`,
 * the lane that matters most for that, has no counterpart there at all.
 */
export type Lane = "todo" | "doing" | "review" | "done";

const LANE_BY_STAGE: Record<Stage, Lane> = {
  ready: "todo",
  doing: "doing",
  blocked: "doing",
  "qa-failed": "doing",
  "code-review": "review",
  qa: "review",
  "qa-passed": "review",
  done: "done",
};

export function laneOf(status: string): Lane {
  return LANE_BY_STAGE[stageOf(status)];
}

// ---- what counts as a ticket ----

/**
 * The work item types that are *containers*, not units of work — per provider.
 *
 * A sprint read from Azure DevOps is not the list the Backlog tab shows. The
 * team-iteration endpoint returns everything in the iteration, so an eight-point
 * User Story split into four Tasks arrives as five rows: the story and its four
 * children, all assigned to the same person, describing the same eight points of
 * work. Counted as five tickets that is a sprint three times larger than it is,
 * and planned as five tickets it is four scheduled runs against one story.
 *
 * Only Azure DevOps has the hierarchy, so only Azure DevOps has an entry. A
 * provider absent from this map has every type deliverable, which is the honest
 * answer for GitHub: an issue labelled `enhancement` maps to the type "Feature"
 * there and is a perfectly ordinary unit of work, not a container for anything.
 */
const CONTAINER_TYPES: Record<string, Set<string>> = {
  "azure-devops": new Set(["epic", "feature", "task", "test case", "test plan", "test suite"]),
};

/** Is this a ticket the developer delivers, rather than a bucket other tickets
 *  hang from or a step inside one? */
export function isDeliverable(ticket: Ticket, provider: string): boolean {
  const containers = CONTAINER_TYPES[provider];
  return !containers || !containers.has((ticket.type ?? "").trim().toLowerCase());
}

export function deliverablesOnly(tickets: Ticket[], provider: string): Ticket[] {
  return tickets.filter((t) => isDeliverable(t, provider));
}

// ---- working days ----

/** ISO date (YYYY-MM-DD) in UTC — the key every day in this module is addressed
 *  by. Sprint boundaries arrive from the provider as UTC instants, so mixing a
 *  local-time day in would shift the whole calendar by a day for anyone east of
 *  Greenwich, which is where this app is used. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDay(iso: string): Date {
  return new Date(iso.slice(0, 10) + "T00:00:00.000Z");
}

const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/**
 * Every working day in `[from, to]`, inclusive of both ends.
 *
 * Monday–Friday. There is no holiday calendar yet and its absence is visible
 * rather than hidden: a sprint containing a public holiday simply reports one
 * more day of capacity than it has, and the developer sees the plan is tight.
 * A silently-guessed holiday list would be worse.
 */
export function workingDays(from: string, to: string): string[] {
  const out: string[] = [];
  const end = utcDay(to);
  for (const d = utcDay(from); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    if (!isWeekend(d)) out.push(isoDay(d));
  }
  return out;
}

/** The first `count` working days on or after `from`. */
function workingDaysFrom(from: string, count: number): string[] {
  const out: string[] = [];
  for (const d = utcDay(from); out.length < count; d.setUTCDate(d.getUTCDate() + 1)) {
    if (!isWeekend(d)) out.push(isoDay(d));
  }
  return out;
}

// ---- inputs ----

export type SprintWindow = {
  /** ISO instant or date the iteration starts / finishes. Either may be empty:
   *  a provider with no iteration dates yields a plan with no calendar, which
   *  the UI reports rather than faking. */
  startDate: string;
  finishDate: string;
};

export type PlanConfig = {
  /** `Setting.hoursPerStoryPoint`. The one conversion in the app — the dashboard
   *  computes ROI with the same number, and two of them would disagree. */
  hoursPerPoint: number;
  /** Effective hours the developer gives a working day. */
  hoursPerDay: number;
  /** The release pace: how many points may be handed to reviewers per working
   *  day. Steady delivery is the objective, so this is measured in points and
   *  not in tickets — one eight-point ticket is four days of review appetite,
   *  however few rows it occupies. */
  pointsPerDay: number;
  /** Upper bound on tickets released in one day, whatever the points say. Zero
   *  means no ceiling. Exists because a day of five one-point tickets is five
   *  context switches for the reviewer even though it is on pace. */
  maxTicketsPerDay: number;
};

export const DEFAULT_PLAN_CONFIG: PlanConfig = {
  hoursPerPoint: 4,
  hoursPerDay: 8,
  pointsPerDay: 2,
  maxTicketsPerDay: 0,
};

/** A ticket as the planner sees it: the provider's row plus whatever triage
 *  decided about it. Both overrides are optional and both come from a human or
 *  an agent the human accepted — never inferred here. */
export type PlanInput = {
  ticket: Ticket;
  /** Points to plan with, when triage re-estimated it. Falls back to the
   *  provider's own sizing. */
  points?: number;
  /** Position in the implement queue, when triage proposed one. Ties and
   *  absences keep the order the caller supplied, which is the provider's. */
  order?: number;
  /** Triage found something a BA has to answer. Such a ticket is planned like
   *  any other — it still occupies sprint capacity — but is never eligible for
   *  an automatic run. */
  blocked?: boolean;
  /** Where the developer's claim on this ticket stands (`lib/sprintClaim.ts`).
   *  Absent means `mine`, which is what every caller meant before claims existed
   *  and what a freshly assigned ticket is. */
  claim?: Claim;
  /** Who holds it now. Carried through untouched — the planner never reads it,
   *  the page and the plan row do. */
  assigneeNow?: string;
};

/** `mine` when the caller said nothing. */
const claimOf = (input: PlanInput): Claim => input.claim ?? "mine";

// ---- sizing ----

export function pointsOf(input: PlanInput): number {
  if (typeof input.points === "number" && input.points > 0) return input.points;
  return input.ticket.storyPoints ?? 0;
}

/**
 * How many hours one ticket is expected to take.
 *
 * Points win over a provider-supplied hour estimate, because points are what the
 * team actually sizes with and what the release pace is measured in; the hour
 * estimate is the fallback for a work item type nobody points. A ticket with
 * neither is `0` — unsized, not free — and `summarize()` counts those separately
 * so an unsized backlog cannot masquerade as a light one.
 */
export function ticketHours(input: PlanInput, cfg: PlanConfig): number {
  const points = pointsOf(input);
  if (points > 0) return points * cfg.hoursPerPoint;
  return input.ticket.estimateHours ?? 0;
}

// ---- summary ----

export type SprintSummary = {
  ticketCount: number;
  totalPoints: number;
  donePoints: number;
  remainingPoints: number;
  /** The sprint split by claim (`lib/sprintClaim.ts`). `ticketCount` and
   *  `totalPoints` above are the two together — the scope the developer carried
   *  this sprint, which is the number that must not shrink when a finished
   *  ticket is reassigned to QA. `dropped` tickets are in neither, and in no
   *  total on this object: they were never worked and are not the developer's
   *  sprint, only a change worth showing. */
  mine: { tickets: number; points: number };
  handedOff: { tickets: number; points: number };
  droppedCount: number;
  /** Tickets carrying neither points nor an hour estimate. Reported rather than
   *  assumed, because every hour figure below silently excludes them. */
  unsizedCount: number;
  byLane: Record<Lane, { tickets: number; points: number }>;
  /** Working days in the whole iteration, and the ones from `today` onward. */
  workingDaysTotal: number;
  workingDaysLeft: number;
  /** Hours the remaining working days can absorb, and hours the remaining work
   *  is expected to need. */
  capacityHours: number;
  requiredHours: number;
  /** capacity − required. Negative means the sprint does not fit. */
  slackHours: number;
  verdict: "no-calendar" | "on-track" | "tight" | "over-committed";
};

const emptyLanes = (): Record<Lane, { tickets: number; points: number }> => ({
  todo: { tickets: 0, points: 0 },
  doing: { tickets: 0, points: 0 },
  review: { tickets: 0, points: 0 },
  done: { tickets: 0, points: 0 },
});

/**
 * The working days a plan may still release on.
 *
 * Normally the remainder of the iteration. But a board or backlog can hand back
 * a window that has already closed — a fixed backlog window, a sprint picked
 * long after it ended — and clamping `today` into a finished window leaves no
 * days at all, so every ticket silently loses its release date. In that case the
 * window is moved forward to begin on the day the plan is built, keeping the
 * length it was given: the pace the developer approved, on dates that exist.
 */
export function releaseDays(window: SprintWindow, today: string): string[] {
  if (!window.startDate || !window.finishDate) return [];
  if (today <= window.finishDate) {
    return workingDays(today > window.startDate ? today : window.startDate, window.finishDate);
  }
  return workingDaysFrom(today, workingDays(window.startDate, window.finishDate).length);
}

export function summarize(
  inputs: PlanInput[],
  window: SprintWindow,
  today: string,
  cfg: PlanConfig
): SprintSummary {
  const byLane = emptyLanes();
  let totalPoints = 0;
  let donePoints = 0;
  let requiredHours = 0;
  let unsizedCount = 0;
  let ticketCount = 0;
  const mine = { tickets: 0, points: 0 };
  const handedOff = { tickets: 0, points: 0 };
  let droppedCount = 0;

  for (const input of inputs) {
    const claim = claimOf(input);
    const points = pointsOf(input);
    // A dropped ticket was never worked and is not the developer's any more. It
    // is reported as a count and nothing else — folding it into points or lanes
    // would put somebody else's work on this report.
    if (claim === "dropped") {
      droppedCount += 1;
      continue;
    }
    ticketCount += 1;
    totalPoints += points;

    if (claim === "handed-off") {
      handedOff.tickets += 1;
      handedOff.points += points;
      // Delivered, and out of the developer's hands: no lane, no hours. Its
      // status belongs to whoever holds it now, and for a ticket that left the
      // sprint there is no status to read at all.
      donePoints += points;
      continue;
    }

    mine.tickets += 1;
    mine.points += points;
    const lane = laneOf(input.ticket.status);
    const hours = ticketHours(input, cfg);
    byLane[lane].tickets += 1;
    byLane[lane].points += points;
    if (points === 0 && hours === 0) unsizedCount += 1;
    if (lane === "done") donePoints += points;
    // Work in the review lane is finished as far as the developer's remaining
    // hours are concerned — it is waiting on somebody else.
    else if (lane !== "review") requiredHours += hours;
  }

  const hasCalendar = !!window.startDate && !!window.finishDate;
  const all = hasCalendar ? workingDays(window.startDate, window.finishDate) : [];
  const left = releaseDays(window, today);
  const capacityHours = left.length * cfg.hoursPerDay;
  const slackHours = capacityHours - requiredHours;

  return {
    ticketCount,
    totalPoints,
    donePoints,
    remainingPoints: totalPoints - donePoints,
    mine,
    handedOff,
    droppedCount,
    unsizedCount,
    byLane,
    workingDaysTotal: all.length,
    workingDaysLeft: left.length,
    capacityHours,
    requiredHours,
    slackHours,
    verdict: !hasCalendar
      ? "no-calendar"
      : slackHours < 0
        ? "over-committed"
        : slackHours < cfg.hoursPerDay
          ? "tight"
          : "on-track",
  };
}

// ---- allocation ----

export type PlannedTicket = {
  ticketId: string;
  title: string;
  project: string;
  /** Position in the implement queue, 1-based and dense. Zero for a ticket that
   *  is already in review or done — those are not queued for anything. */
  implementOrder: number;
  points: number;
  estimateHours: number;
  /** The working day this ticket should be handed to a reviewer, ISO. Empty when
   *  the sprint has no calendar, or when the pace does not reach this ticket
   *  before the sprint ends — which is a finding, not a rounding error, and is
   *  why it is empty rather than clamped to the last day. */
  releaseDay: string;
  lane: Lane;
  /** Blocked by triage: planned, counted, but never auto-run. */
  blocked: boolean;
  claim: Claim;
  /** Who holds it now, when the claim is no longer `mine`. */
  assigneeNow: string;
};

export type SprintPlanResult = {
  summary: SprintSummary;
  tickets: PlannedTicket[];
  /** Points the pace could not fit before the sprint ends. Zero on a plan that
   *  lands. */
  overflowPoints: number;
};

/** The queue order: triage's `order` when it gave one, otherwise the order the
 *  caller supplied. A stable sort, so tickets triage said nothing about keep
 *  their relative positions instead of being shuffled by the sort. */
function queueOrder(inputs: PlanInput[]): PlanInput[] {
  return inputs
    .map((input, i) => ({ input, i }))
    .sort((a, b) => {
      const ao = a.input.order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.input.order ?? Number.MAX_SAFE_INTEGER;
      return ao - bo || a.i - b.i;
    })
    .map((x) => x.input);
}

/**
 * The plan.
 *
 * Tickets already in review or done stay in the result (the page shows the whole
 * sprint) but consume no release capacity — they have already been handed over.
 * Everything else is laid onto the remaining working days at `pointsPerDay`, in
 * queue order, and a ticket is released on the day its own points are fully
 * covered: an eight-point ticket at two points a day lands on the fourth day,
 * not the first.
 */
export function buildPlan(
  inputs: PlanInput[],
  window: SprintWindow,
  today: string,
  cfg: PlanConfig
): SprintPlanResult {
  const summary = summarize(inputs, window, today, cfg);
  const days = releaseDays(window, today);

  const pace = Math.max(0.01, cfg.pointsPerDay);
  const ceiling = cfg.maxTicketsPerDay;
  // The day being filled, how much of its pace is spent, and how many tickets it
  // already carries. Carried across the whole queue, which is what makes the
  // release calendar cumulative rather than per-ticket.
  let dayIndex = 0;
  let spentToday = 0;
  let ticketsToday = 0;
  let overflowPoints = 0;
  let position = 0;

  const tickets: PlannedTicket[] = queueOrder(inputs).map((input) => {
    const claim = claimOf(input);
    // A ticket that is no longer the developer's has no status of theirs to
    // read: it may be sitting in somebody else's column, or have left the sprint
    // with no live row at all. `done` is the honest lane for one they finished
    // and `todo` for one they never started.
    const lane = claim === "mine" ? laneOf(input.ticket.status) : claim === "handed-off" ? "done" : "todo";
    const points = pointsOf(input);
    const planned: PlannedTicket = {
      ticketId: input.ticket.id,
      title: input.ticket.title,
      project: input.ticket.project ?? "",
      implementOrder: 0,
      points,
      estimateHours: ticketHours(input, cfg),
      releaseDay: "",
      lane,
      blocked: !!input.blocked,
      claim,
      assigneeNow: input.assigneeNow ?? "",
    };
    // Only work that is still the developer's gets a queue position and a
    // release day. Scheduling a run on a ticket somebody else now owns is the
    // one mistake this whole module exists to prevent.
    if (claim !== "mine" || !isQueueable(stageOf(input.ticket.status))) return planned;

    position += 1;
    planned.implementOrder = position;
    if (!days.length) return planned;

    // An unsized ticket still occupies a slot — it just cannot claim points, so
    // it is charged one day's pace rather than nothing.
    const cost = points > 0 ? points : pace;

    // Move to the next day when this one is full: either its pace is spent, or
    // it has as many tickets as a reviewer should get.
    if ((spentToday > 0 && spentToday + cost > pace) || (ceiling > 0 && ticketsToday >= ceiling)) {
      dayIndex += 1;
      spentToday = 0;
      ticketsToday = 0;
    }
    if (dayIndex >= days.length) {
      overflowPoints += points;
      return planned;
    }

    // A ticket larger than one day's pace spans several days and lands on the
    // last of them; those days are consumed, not shared.
    const spans = Math.max(1, Math.ceil((spentToday + cost) / pace));
    const landing = dayIndex + spans - 1;
    if (landing >= days.length) {
      overflowPoints += points;
      dayIndex = days.length;
      return planned;
    }
    planned.releaseDay = days[landing];
    dayIndex = landing;
    spentToday = (spentToday + cost) - (spans - 1) * pace;
    ticketsToday += 1;
    if (spentToday >= pace) {
      dayIndex += 1;
      spentToday = 0;
      ticketsToday = 0;
    }
    return planned;
  });

  return { summary, tickets, overflowPoints };
}

/** What is due to be released on one day — the question the scheduler asks every
 *  morning. */
export function releasesOn(plan: SprintPlanResult, day: string): PlannedTicket[] {
  return plan.tickets.filter((t) => t.releaseDay === day);
}

// ---- putting a stopped ticket back in the queue ----

/** The state of one plan row, as far as retrying it is concerned. */
export type RetryFacts = {
  implementState: string;
  /** A pull request this row already produced. */
  prUrl: string;
  /** Where the developer's claim on the ticket stands (lib/sprintClaim.ts). */
  claim: string;
  /** Position in the implement queue; zero for a ticket that was never queued. */
  implementOrder?: number;
};

/**
 * Whether a planned ticket may be queued again, and why not when it may not.
 *
 * It exists because a rebuild deliberately will not do this. `savePlan()` treats
 * any row that is not `pending` as settled and refuses to re-date it, which is
 * right for work that finished and wrong for work that stopped — so before this,
 * one failed run took a ticket out of the sprint's queue permanently and the only
 * way back was an UPDATE by hand.
 *
 * The refusals are the point, not the permission:
 *
 *   - **A row that already produced a pull request** is never retried, whatever
 *     its state says. `implementState` can be `failed` with a `prUrl` set — the
 *     one-shot flow opens the PR inside the same turn it verifies in, so a run
 *     that published and then failed its tests lands exactly there. Queueing that
 *     again is a second pull request for one ticket, which is the thing invariant
 *     2 exists to prevent. The way forward for that row is the review lane.
 *   - **A running row** would be a second agent on one branch — the failure
 *     worktrees exist to prevent. Cancel it first; the cancel marks it failed and
 *     then this allows it.
 *   - **An implemented or released row** is finished work. Re-running it is not a
 *     retry, it is a duplicate.
 *   - **A ticket that is no longer the developer's** is somebody else's to run,
 *     and `startNextTicket()` would refuse it anyway. Refusing here too is the
 *     same two-locks-on-one-door rule the queue already follows.
 */
export function retryDenial(f: RetryFacts): string {
  if (f.claim !== "mine") {
    return "This ticket is no longer assigned to you, so the queue will not run it.";
  }
  if (f.prUrl) {
    return "This ticket already has a pull request. Running it again would open a second one — use the review lane instead.";
  }
  if (f.implementState === "running") {
    return "This ticket is running right now. Cancel that run first.";
  }
  if (f.implementState === "implemented") {
    return "This ticket is already implemented and waiting for its release day.";
  }
  if (f.implementState === "pending") {
    return "This ticket is already in the queue.";
  }
  if (f.implementOrder === 0) {
    return "This ticket is not in the implement queue — it was already past implementation when the plan was built.";
  }
  return "";
}

/** `{ to }` drops the row onto another queued row's position (drag and drop). */
export type QueueMove = "up" | "down" | "top" | { to: string };

export function reorderQueue(
  rows: { id: string; implementOrder: number }[],
  id: string,
  move: QueueMove
): Map<string, number> | null {
  const sorted = [...rows].sort((a, b) => a.implementOrder - b.implementOrder);
  const from = sorted.findIndex((r) => r.id === id);
  if (from < 0) return null;
  const to = typeof move === "object" ? sorted.findIndex((r) => r.id === move.to) : move === "top" ? 0 : move === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= sorted.length || to === from) return null;
  const orders = sorted.map((r) => r.implementOrder);
  const sequence = sorted.map((r) => r.id);
  const [moved] = sequence.splice(from, 1);
  sequence.splice(to, 0, moved);
  return new Map(sequence.map((rowId, i) => [rowId, orders[i]]));
}

export type PlanDiff = {
  added: string[];
  moved: { ticketId: string; from: number; to: number }[];
  redated: { ticketId: string; from: string; to: string }[];
  claimChanged: { ticketId: string; from: string; to: string }[];
};

export function planDiff(
  stored: {
    ticketId: string;
    implementState: string;
    releasedAt: Date | string | null;
    implementOrder: number;
    releaseDay: string;
    claim: string;
  }[],
  computed: PlannedTicket[]
): PlanDiff {
  const byTicket = new Map(stored.map((s) => [s.ticketId, s]));
  const diff: PlanDiff = { added: [], moved: [], redated: [], claimChanged: [] };
  for (const t of computed) {
    const prev = byTicket.get(t.ticketId);
    if (!prev) {
      diff.added.push(t.ticketId);
      continue;
    }
    if (prev.claim !== t.claim) diff.claimChanged.push({ ticketId: t.ticketId, from: prev.claim, to: t.claim });
    if (prev.implementState !== "pending" || prev.releasedAt) continue;
    if (prev.implementOrder !== t.implementOrder) {
      diff.moved.push({ ticketId: t.ticketId, from: prev.implementOrder, to: t.implementOrder });
    }
    if (prev.releaseDay !== t.releaseDay) {
      diff.redated.push({ ticketId: t.ticketId, from: prev.releaseDay, to: t.releaseDay });
    }
  }
  return diff;
}

export type Forecast = {
  velocity: number;
  projectedDay: string;
  slipDays: number;
};

export function forecastFinish(f: {
  donePoints: number;
  remainingPoints: number;
  window: SprintWindow;
  today: string;
}): Forecast | null {
  const { donePoints, remainingPoints, window, today } = f;
  if (!window.startDate || !window.finishDate || today < window.startDate) return null;
  const elapsed = workingDays(window.startDate, today > window.finishDate ? window.finishDate : today).length;
  if (elapsed === 0 || donePoints <= 0) return null;
  const velocity = donePoints / elapsed;
  if (remainingPoints <= 0) return { velocity, projectedDay: today, slipDays: 0 };
  const daysNeeded = Math.ceil(remainingPoints / velocity);
  const days = workingDaysFrom(today, daysNeeded);
  const projectedDay = days[days.length - 1];
  const slipDays = projectedDay > window.finishDate ? Math.max(0, workingDays(window.finishDate, projectedDay).length - 1) : 0;
  return { velocity, projectedDay, slipDays };
}
