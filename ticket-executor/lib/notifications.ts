// What the bell is allowed to say, and the one rule that decides whether you
// have already seen it.
//
// Pure and Prisma-free, the same reason `identity.ts` is: the bell now speaks
// for several sources at once, and the part worth asserting is the merge — which
// events become notifications, which are noise, what counts as unread — not the
// fetching. Every source hands this module its own rows and gets back one shape.
//
// One thing this module deliberately does not carry: the text a human wrote. A
// notification names the ticket and what happened to it; the comment itself
// lives in the provider, one click away. That keeps review-comment bodies,
// mention markup and work-item HTML out of the header entirely.

/** Every distinct thing the bell can report. The prefix is the source, so a new
 *  source adds names rather than overloading an existing one. */
export type NotificationKind =
  | "pr.review-comment"
  | "pr.awaiting-my-vote"
  | "pr.changes-requested"
  | "pr.approved"
  | "pr.conflict"
  | "ticket.mention"
  | "ticket.comment"
  | "run.waiting"
  | "run.failed"
  | "run.succeeded"
  | "scheduler.started"
  | "scheduler.released"
  | "scheduler.review-fixed"
  | "scheduler.failed"
  | "plan.drift"
  | "plan.needs-root-repo"
  | "ticket.ready-for-qa"
  | "ticket.qa-failed"
  | "ticket.qa-reply-ready"
  | "report.unsent";

/** `action` means the developer has to do something; `info` is a record of
 *  something the app did on their behalf. It splits the panel into its two
 *  views — not their order, which is time alone; the badge counts both,
 *  because a badge that goes quiet while the panel still has unread rows in it
 *  is one nobody trusts. */
export type NotificationSeverity = "action" | "info";

/** Where clicking the notification should land. A subset of the detail pane's
 *  tabs, declared here so this module owns each kind's destination rather than
 *  the component inferring one from `kind`. */
export type NotificationTab = "overview" | "plan" | "execution" | "result" | "resolve-review";

export type AppNotification = {
  kind: NotificationKind;
  /** The ticket this is about, or "" when there is no local ticket for it — a
   *  pull request waiting on the developer's review belongs to somebody else's
   *  work item, and there is nothing of theirs to open. Such a notification
   *  carries an `href` instead. */
  ticketId: string;
  /** Which occurrence this is within its kind — a PR id, a run id, an event id.
   *  Part of the read key, so two notifications of the same kind on one ticket
   *  cannot mark each other read. */
  refId: string;
  severity: NotificationSeverity;
  /** One short line naming what happened. Never a human's own words. */
  summary: string;
  /** ISO timestamp, or "" for a standing condition with no moment attached. */
  at: string;
  tab: NotificationTab;
  /** An external page to open instead of selecting a ticket. Set only when
   *  `ticketId` is empty — the two destinations are alternatives, not a
   *  preference order. */
  href?: string;
  /** Changes when the notification's content changes, which is what makes an
   *  already-read notification unread again. */
  fingerprint: string;
};

export type ReadEntry = { seen: string; readAt: string };
export type ReadMap = Record<string, ReadEntry>;

/**
 * The read-state key.
 *
 * All three parts are load-bearing. Keyed by ticket alone — which is what the
 * review-only bell did — a mention and a review comment on the same ticket
 * would mark each other read. Keyed without `refId`, two scheduler events on
 * one ticket would collapse into one.
 */
export function notificationKey(n: AppNotification): string {
  return `${n.kind}::${n.ticketId}::${n.refId}`;
}

/** Has this exact notification, in this exact state, been seen? A fingerprint
 *  that no longer matches is a *changed* notification, and a changed one is
 *  unread again even though its key was read. */
export function isUnread(n: AppNotification, read: ReadMap): boolean {
  return read[notificationKey(n)]?.seen !== n.fingerprint;
}

export function markRead(read: ReadMap, n: AppNotification, at: string): ReadMap {
  return { ...read, [notificationKey(n)]: { seen: n.fingerprint, readAt: at } };
}

export function markAllRead(read: ReadMap, list: AppNotification[], at: string): ReadMap {
  const next = { ...read };
  for (const n of list) next[notificationKey(n)] = { seen: n.fingerprint, readAt: at };
  return next;
}

/** Unread things that need doing — what the "Needs you" view holds. Not the
 *  badge, which counts everything unread. */
export function actionCount(list: AppNotification[], read: ReadMap): number {
  return list.filter((n) => n.severity === "action" && isUnread(n, read)).length;
}

/** The badge number: everything unread, actionable or not. */
export function unreadCount(list: AppNotification[], read: ReadMap): number {
  return list.filter((n) => isUnread(n, read)).length;
}

/**
 * Newest first, and nothing else.
 *
 * Severity used to outrank time, which made the panel a list nobody could scan:
 * the newest thing that happened was somewhere in the middle, under an
 * actionable row from three days ago. "Needs you" is the view for the
 * actionable half — the ordering does not need to say it a second time.
 */
export function sortNotifications(list: AppNotification[]): AppNotification[] {
  return [...list].sort((a, b) => b.at.localeCompare(a.at));
}

// ---- sources ----

/** The shape the review-summary poll already returns, declared structurally so
 *  this module does not depend on the provider-facing types. */
export type ReviewSource = {
  ticketId: string;
  prId: string;
  unresolvedCount: number;
  reviewer: string;
  latestAt: string;
  latestComment: string;
};

/**
 * Unresolved review comments on a ticket's pull request.
 *
 * `latestComment` goes into the fingerprint but never into `summary`: a thread
 * resolved while a fresh one lands leaves `unresolvedCount` unchanged, and
 * without the text in the fingerprint that new comment would arrive already
 * read.
 */
export function fromReviews(rows: ReviewSource[]): AppNotification[] {
  return rows.map((r) => ({
    kind: "pr.review-comment" as const,
    ticketId: r.ticketId,
    refId: r.prId,
    severity: "action" as const,
    summary: `${r.unresolvedCount} unresolved review comment${r.unresolvedCount === 1 ? "" : "s"}${r.reviewer ? ` from ${r.reviewer}` : ""} on PR #${r.prId}`,
    at: r.latestAt,
    tab: "resolve-review" as const,
    fingerprint: `${r.unresolvedCount}::${r.latestAt}::${r.latestComment}`,
  }));
}

/**
 * Azure DevOps' reviewer vote scale, named where it is acted on.
 *
 * It is not a range to compare against loosely: `-5` ("waiting for the author")
 * and `-10` ("rejected") are both a reviewer handing the pull request back, and
 * `5` ("approved with suggestions") is an approval. Treating the sign alone as
 * the answer would report an approval-with-suggestions as a rejection.
 */
const VOTE = { rejected: -10, waiting: -5, none: 0, approvedWithSuggestions: 5, approved: 10 } as const;

export type PullRequestSource = {
  prId: string;
  title: string;
  url: string;
  repo: string;
  mergeStatus: string;
  authorName: string;
  /** Did the developer open it? */
  mine: boolean;
  /** The developer's own vote, or `null` when they are not a reviewer. */
  myVote: number | null;
  /** The worst standing vote from anyone, for a pull request that is the
   *  developer's own. `0` when nobody has voted. */
  worstVote: number;
  bestVote: number;
  /** The work item this pull request belongs to, if this app knows of one.
   *  Empty for somebody else's pull request, which is the reviewer-inbox case. */
  ticketId: string;
};

/**
 * Pull requests that need the developer, out of a whole-organization listing.
 *
 * Four questions, in priority order, and **at most one notification per pull
 * request**: a rejected pull request that also conflicts is one thing to go and
 * fix, and reporting it twice would double the badge for one piece of work.
 *
 * There is deliberately no "this draft has been sitting for a while". Every
 * pull request this app opens is a draft on purpose, and the release calendar —
 * not a timer, and not the bell — decides when it is handed over.
 */
export function fromPullRequests(rows: PullRequestSource[]): AppNotification[] {
  const out: AppNotification[] = [];
  for (const pr of rows) {
    // Somebody else's pull request, with the developer down as a reviewer who
    // has not voted. The one notification here that is about being *blocking*
    // rather than blocked.
    if (!pr.mine) {
      if (pr.myVote === VOTE.none) {
        out.push({
          kind: "pr.awaiting-my-vote",
          ticketId: pr.ticketId,
          refId: pr.prId,
          severity: "action",
          summary: `${pr.authorName || "Someone"} is waiting on your review of PR #${pr.prId} in ${pr.repo}`,
          at: "",
          tab: "resolve-review",
          ...(pr.ticketId ? {} : { href: pr.url }),
          fingerprint: `await-vote::${pr.prId}`,
        });
      }
      continue;
    }

    const base = { ticketId: pr.ticketId, refId: pr.prId, at: "", tab: "resolve-review" as const, ...(pr.ticketId ? {} : { href: pr.url }) };

    if (pr.worstVote === VOTE.rejected || pr.worstVote === VOTE.waiting) {
      out.push({
        ...base,
        kind: "pr.changes-requested",
        severity: "action",
        summary: `A reviewer handed PR #${pr.prId} back to you`,
        fingerprint: `vote::${pr.prId}::${pr.worstVote}`,
      });
      continue;
    }
    if (pr.mergeStatus === "conflicts") {
      out.push({
        ...base,
        kind: "pr.conflict",
        severity: "action",
        summary: `PR #${pr.prId} cannot merge — it conflicts with its target branch`,
        fingerprint: `conflict::${pr.prId}`,
      });
      continue;
    }
    if (pr.bestVote === VOTE.approved || pr.bestVote === VOTE.approvedWithSuggestions) {
      out.push({
        ...base,
        kind: "pr.approved",
        severity: "info",
        summary: `PR #${pr.prId} is approved`,
        fingerprint: `vote::${pr.prId}::${pr.bestVote}`,
      });
    }
  }
  return out;
}

/** A run held for a person: the server restarted while it was publishing, and
 *  nobody can tell whether the push landed. Read off current state rather than
 *  off an observed transition, because it is a standing condition: the run stays
 *  held until somebody looks, however long ago it stopped. */
export type WaitingRunSource = { ticketId: string; runId: string };

export function fromWaitingRuns(rows: WaitingRunSource[]): AppNotification[] {
  return rows.map((r) => ({
    kind: "run.waiting" as const,
    ticketId: r.ticketId,
    refId: r.runId,
    severity: "action" as const,
    summary: "Run held mid-publish — check whether the push landed",
    at: "",
    tab: "execution" as const,
    fingerprint: `waiting::${r.runId}`,
  }));
}

/**
 * A run this session watched reach a terminal state.
 *
 * Recorded as an observed event rather than derived from the latest run per
 * ticket, because "succeeded" is a fact about a moment and not a standing
 * condition — deriving it would put a notification on every ticket with any
 * past run the first time the panel opens.
 */
export type RunEventSource = {
  ticketId: string;
  runId: string;
  state: "succeeded" | "failed";
  at: string;
};

export function fromRunEvents(rows: RunEventSource[]): AppNotification[] {
  return rows.map((r) => ({
    kind: (r.state === "failed" ? "run.failed" : "run.succeeded") as NotificationKind,
    ticketId: r.ticketId,
    refId: r.runId,
    severity: (r.state === "failed" ? "action" : "info") as NotificationSeverity,
    summary: r.state === "failed" ? "Run failed" : "Run finished — draft pull request ready to release",
    at: r.at,
    tab: (r.state === "failed" ? "execution" : "result") as NotificationTab,
    fingerprint: `${r.state}::${r.runId}`,
  }));
}

/** One `AutomationEvent` row — what the scheduler wrote down about a decision. */
export type AutomationSource = {
  id: string;
  ticketId: string;
  action: string;
  outcome: string;
  reason: string;
  createdAt: string;
  project?: string;
};

/**
 * What the scheduler did while nobody was watching.
 *
 * `skipped` is dropped. The scheduler writes down its refusals on purpose —
 * "not due", "blocked by triage", "already running" — and that record is worth
 * having, but it belongs in the Flow Runner log, where somebody is reading
 * deliberately. Every tick produces some, so putting them here would bury the
 * two or three events a day that actually mean something.
 *
 * An `abort` is reported as drift rather than as a scheduler failure: the run
 * was stopped because the ticket stopped being the developer's, which is a fact
 * about the plan needing a human, not a fault in the automation.
 */
export function fromAutomation(rows: AutomationSource[]): AppNotification[] {
  // When each ticket's automatic implement was last reported as over. A
  // "started" older than that is a run that has since finished or failed, and
  // announcing it as under way sends the developer to a dead execution log.
  const concludedAt = new Map<string, number>();
  for (const e of rows) {
    const terminal = e.action === "abort" || (e.action === "implement" && (e.outcome === "done" || e.outcome === "failed"));
    if (!terminal) continue;
    const at = Date.parse(e.createdAt);
    if (Number.isNaN(at)) continue;
    concludedAt.set(e.ticketId, Math.max(at, concludedAt.get(e.ticketId) ?? 0));
  }
  const out: AppNotification[] = [];
  const missingRepo = new Set<string>();
  for (const e of rows) {
    if (e.reason === "no-root-repo" && e.project) {
      if (missingRepo.has(e.project)) continue;
      missingRepo.add(e.project);
      out.push({
        kind: "plan.needs-root-repo",
        ticketId: e.ticketId,
        refId: e.project,
        severity: "action",
        summary: `No root repo known for ${e.project} — run this ticket once by hand to set it`,
        at: e.createdAt,
        tab: "overview",
        fingerprint: `root-repo::${e.project}`,
      });
      continue;
    }
    if (e.outcome === "skipped") continue;
    const base = { ticketId: e.ticketId, refId: e.id, at: e.createdAt, fingerprint: e.id };
    if (e.action === "abort") {
      out.push({
        ...base,
        kind: "plan.drift",
        severity: "action",
        summary: `Automation stopped — ${e.reason || "the ticket is no longer assigned to you"}`,
        tab: "overview",
      });
      continue;
    }
    if (e.outcome === "failed") {
      out.push({
        ...base,
        kind: "scheduler.failed",
        severity: "action",
        // "Automatic review failed" would read as the review having failed
        // rather than the attempt to answer it, so that one lane is named.
        summary:
          e.action === "review"
            ? `Could not resolve the review comments${e.reason ? ` — ${e.reason}` : ""}`
            : `Automatic ${e.action} failed${e.reason ? ` — ${e.reason}` : ""}`,
        tab: e.action === "release" ? "result" : e.action === "review" ? "resolve-review" : "execution",
      });
      continue;
    }
    if (e.action === "review") {
      // The one automation whose *success* can still be the developer's problem.
      // The fix-code-review skill answers every thread but only resolves the ones
      // it actually fixed: a finding it judged invalid, out of scope, or needing a
      // decision is replied to and left open on purpose. Reporting that as "done"
      // and nothing more would quietly hand back work nobody is looking at, so the
      // classified reason decides which of the two this is.
      const needsMe = e.reason === "left-open" || e.reason === "max-rounds";
      out.push({
        ...base,
        kind: "scheduler.review-fixed",
        severity: needsMe ? "action" : "info",
        summary:
          e.reason === "max-rounds"
            ? "Review fixes pushed — the rest needs your decision, and automation has stopped on this one"
            : needsMe
              ? "Review fixes pushed — some threads were answered but left open for you"
              : "Review fixes pushed — every thread resolved",
        tab: "resolve-review",
      });
      continue;
    }
    if (e.action === "release" && e.outcome === "done") {
      out.push({ ...base, kind: "scheduler.released", severity: "info", summary: "Released — pull request published and status advanced", tab: "result" });
      continue;
    }
    if (e.action === "implement" && e.outcome === "started") {
      const startedAt = Date.parse(e.createdAt);
      if (!Number.isNaN(startedAt) && startedAt <= (concludedAt.get(e.ticketId) ?? -1)) continue;
      out.push({ ...base, kind: "scheduler.started", severity: "info", summary: "Automation started implementing this ticket", tab: "execution" });
    }
  }
  return out;
}

/** One comment that landed on a work item — no text, by design. */
export type TicketActivitySource = {
  ticketId: string;
  commentId: string;
  at: string;
  authorName: string;
  mentionsMe: boolean;
};

/**
 * Somebody said something about the developer's work.
 *
 * Two kinds from one source, and the split is the whole value of it. Being
 * *named* is a question addressed to you and ranks with the things that need
 * doing; a comment landing on a ticket of yours is worth knowing about and
 * nothing more. Counting the second as actionable would put a number on the
 * bell for every conversation on the board.
 *
 * The summary names the person and the fact, never the comment. The row exists
 * to get the developer to the ticket, where the words already live.
 */
export function fromTicketActivity(rows: TicketActivitySource[]): AppNotification[] {
  return rows.map((c) => ({
    kind: (c.mentionsMe ? "ticket.mention" : "ticket.comment") as NotificationKind,
    ticketId: c.ticketId,
    refId: c.commentId,
    severity: (c.mentionsMe ? "action" : "info") as NotificationSeverity,
    summary: c.mentionsMe
      ? `${c.authorName || "Someone"} mentioned you in a comment`
      : `${c.authorName || "Someone"} commented on this ticket`,
    at: c.at,
    tab: "overview" as const,
    // The comment id is immutable, so a comment is reported once and stays read
    // once read — unlike a review summary, whose content genuinely changes.
    fingerprint: `comment::${c.commentId}`,
  }));
}

export const REPORT_REMINDER_START_MINUTE = 17 * 60 + 15;
export const REPORT_REMINDER_EVERY_MINUTES = 5;

export type ReportReminderSource = {
  day: string;
  minuteOfDay: number;
  at: string;
  sent: boolean;
};

export function fromReportReminder(r: ReportReminderSource | null): AppNotification[] {
  if (!r || r.sent || r.minuteOfDay < REPORT_REMINDER_START_MINUTE) return [];
  const elapsed = r.minuteOfDay - REPORT_REMINDER_START_MINUTE;
  const slot = Math.floor(elapsed / REPORT_REMINDER_EVERY_MINUTES);
  const slotAt = new Date(Date.parse(r.at) - (elapsed % REPORT_REMINDER_EVERY_MINUTES) * 60_000);
  slotAt.setSeconds(0, 0);
  return [{
    kind: "report.unsent",
    ticketId: "",
    refId: r.day,
    severity: "action",
    summary: "Today's report has not been sent to Slack yet",
    at: slotAt.toISOString(),
    tab: "overview",
    href: "/report",
    fingerprint: `report::${r.day}::${slot}`,
  }];
}

export type LifecycleSource = {
  ticketId: string;
  pendingAction: string;
  pendingSince: string;
};

export function fromLifecycle(rows: LifecycleSource[]): AppNotification[] {
  return rows.flatMap((r): AppNotification[] => {
    const fingerprint = `${r.pendingAction}::${r.pendingSince}`;
    if (r.pendingAction === "move-to-qa") {
      return [{
        kind: "ticket.ready-for-qa",
        ticketId: "",
        refId: r.ticketId,
        severity: "action",
        summary: `#${r.ticketId}'s pull request is merged — confirm moving it to In QA on Flow Runner`,
        at: r.pendingSince,
        tab: "overview",
        href: "/my-sprint",
        fingerprint,
      }];
    }
    if (r.pendingAction === "qa-reply-ready") {
      return [{
        kind: "ticket.qa-reply-ready",
        ticketId: "",
        refId: r.ticketId,
        severity: "action",
        summary: `A reply to QC on #${r.ticketId} is drafted — review it and post it on Flow Runner`,
        at: r.pendingSince,
        tab: "overview",
        href: "/my-sprint",
        fingerprint,
      }];
    }
    if (r.pendingAction === "fix-qa") {
      return [{
        kind: "ticket.qa-failed",
        ticketId: r.ticketId,
        refId: r.ticketId,
        severity: "action",
        summary: `#${r.ticketId} came back from QA — it needs a fix`,
        at: r.pendingSince,
        tab: "overview",
        fingerprint,
      }];
    }
    return [];
  });
}

/** Every source merged into the one list the bell renders. */
export function buildNotifications(sources: {
  reviews?: ReviewSource[];
  pullRequests?: PullRequestSource[];
  ticketActivity?: TicketActivitySource[];
  waitingRuns?: WaitingRunSource[];
  runEvents?: RunEventSource[];
  automation?: AutomationSource[];
  reportReminder?: ReportReminderSource | null;
  lifecycle?: LifecycleSource[];
}): AppNotification[] {
  return sortNotifications([
    ...fromReviews(sources.reviews ?? []),
    ...fromPullRequests(sources.pullRequests ?? []),
    ...fromTicketActivity(sources.ticketActivity ?? []),
    ...fromWaitingRuns(sources.waitingRuns ?? []),
    ...fromRunEvents(sources.runEvents ?? []),
    ...fromAutomation(sources.automation ?? []),
    ...fromReportReminder(sources.reportReminder ?? null),
    ...fromLifecycle(sources.lifecycle ?? []),
  ]);
}

/** Kinds that are a moment rather than a standing condition — the ones kept in
 *  the bell's history once reported. */
const HISTORY_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
  "ticket.mention",
  "ticket.comment",
  "scheduler.started",
  "scheduler.released",
  "scheduler.review-fixed",
  "scheduler.failed",
  "plan.drift",
]);

export function historyWorthy(list: AppNotification[]): AppNotification[] {
  return list.filter((n) => HISTORY_KINDS.has(n.kind) && n.at !== "");
}

/** Live notifications laid over the stored history: one row per key, the live
 *  one winning, newest first. */
export function mergeWithHistory(live: AppNotification[], history: AppNotification[]): AppNotification[] {
  const byKey = new Map<string, AppNotification>();
  for (const n of history) byKey.set(notificationKey(n), n);
  for (const n of live) byKey.set(notificationKey(n), n);
  return sortNotifications([...byKey.values()]);
}
