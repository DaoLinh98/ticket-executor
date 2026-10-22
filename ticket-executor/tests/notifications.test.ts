// The bell's merge rule, asserted without a provider, a database or a browser.
//
// This suite exists because the bell is now the only place several independent
// sources meet, and the mistakes that matter there are all silent ones: a
// notification that arrives already read, a badge that counts the wrong things,
// two events on one ticket marking each other seen. None of those throw.
import test from "node:test";
import assert from "node:assert/strict";

import {
  actionCount,
  attentionNotifications,
  buildNotifications,
  fromAutomation,
  fromLifecycle,
  fromPullRequests,
  fromReviews,
  fromTicketActivity,
  fromRunEvents,
  fromReportReminder,
  fromWaitingRuns,
  historyWorthy,
  isUnread,
  markAllRead,
  markRead,
  mergeWithHistory,
  notificationKey,
  sortNotifications,
  unreadCount,
  type AppNotification,
  type ReadMap,
} from "../lib/notifications";

const review = (over: Partial<Parameters<typeof fromReviews>[0][number]> = {}) => ({
  ticketId: "101",
  prId: "55",
  unresolvedCount: 2,
  reviewer: "Alice",
  latestAt: "2026-09-06T10:00:00Z",
  latestComment: "please rename this",
  ...over,
});

const automation = (over: Partial<Parameters<typeof fromAutomation>[0][number]> = {}) => ({
  id: "ev1",
  ticketId: "101",
  action: "implement",
  outcome: "started",
  reason: "",
  createdAt: "2026-09-06T09:00:00Z",
  ...over,
});

// ---- read state ----

test("the read key separates kinds and occurrences on one ticket", () => {
  const [rv] = fromReviews([review()]);
  const [run] = fromWaitingRuns([{ ticketId: "101", runId: "r1" }]);
  assert.notEqual(notificationKey(rv), notificationKey(run));

  // Reading the review comment must not mark the held run read — this is the
  // exact collision the ticket-only key used to have.
  const read = markRead({}, rv, "2026-09-06T11:00:00Z");
  assert.equal(isUnread(rv, read), false);
  assert.equal(isUnread(run, read), true);
});

test("two scheduler events on one ticket stay distinct", () => {
  const list = fromAutomation([
    automation({ id: "ev1" }),
    automation({ id: "ev2", action: "release", outcome: "done" }),
  ]);
  assert.equal(list.length, 2);
  const read = markRead({}, list[0], "2026-09-06T11:00:00Z");
  assert.equal(isUnread(list[1], read), true);
});

test("a new comment that nets out the same count is unread again", () => {
  const before = fromReviews([review()])[0];
  const read = markRead({}, before, "2026-09-06T11:00:00Z");
  assert.equal(isUnread(before, read), false);

  // One thread resolved, one fresh thread landed: same count, different comment.
  const after = fromReviews([review({ latestComment: "and this one too", latestAt: "2026-09-06T12:00:00Z" })])[0];
  assert.equal(after.summary.includes("and this one too"), false, "the comment text must never reach the summary");
  assert.equal(isUnread(after, read), true);
});

test("markAllRead clears every notification it is given", () => {
  const list = buildNotifications({
    reviews: [review()],
    waitingRuns: [{ ticketId: "202", runId: "r9" }],
    automation: [automation()],
  });
  const read = markAllRead({}, list, "2026-09-06T11:00:00Z");
  assert.equal(unreadCount(list, read), 0);
});

// ---- counting ----

test("the badge counts unread actions only", () => {
  const list = buildNotifications({
    reviews: [review()],
    runEvents: [
      { ticketId: "1", runId: "r1", state: "succeeded", at: "2026-09-06T08:00:00Z" },
      { ticketId: "2", runId: "r2", state: "failed", at: "2026-09-06T08:30:00Z" },
    ],
    automation: [automation({ action: "release", outcome: "done", id: "ev3" })],
  });
  // Four notifications, two of them informational.
  assert.equal(list.length, 4);
  assert.equal(unreadCount(list, {}), 4);
  assert.equal(actionCount(list, {}), 2);
});

test("reading an action drops the badge but not the list", () => {
  const list = buildNotifications({ reviews: [review()] });
  const read: ReadMap = markRead({}, list[0], "2026-09-06T11:00:00Z");
  assert.equal(actionCount(list, read), 0);
  assert.equal(list.length, 1);
});

// ---- sources ----

test("a held run is a standing condition with no timestamp", () => {
  const [n] = fromWaitingRuns([{ ticketId: "101", runId: "r1" }]);
  assert.equal(n.severity, "action");
  assert.equal(n.tab, "execution");
  assert.equal(n.at, "");
});

test("run outcomes split by severity and destination", () => {
  const [ok, bad] = fromRunEvents([
    { ticketId: "1", runId: "r1", state: "succeeded", at: "2026-09-06T08:00:00Z" },
    { ticketId: "2", runId: "r2", state: "failed", at: "2026-09-06T09:00:00Z" },
  ]);
  assert.equal(ok.severity, "info");
  assert.equal(ok.tab, "result");
  assert.equal(bad.severity, "action");
  assert.equal(bad.tab, "execution");
});

test("skipped scheduler decisions never reach the bell", () => {
  const list = fromAutomation([
    automation({ id: "a", outcome: "skipped", reason: "not-due" }),
    automation({ id: "b", outcome: "skipped", reason: "blocked-by-triage" }),
    automation({ id: "c", outcome: "started" }),
  ]);
  assert.deepEqual(list.map((n) => n.refId), ["c"]);
});

test("a missing root repo is one actionable notification per project, opening its ticket", () => {
  const list = fromAutomation([
    automation({ id: "a", ticketId: "101", outcome: "skipped", reason: "no-root-repo", project: "Audit Center" }),
    automation({ id: "b", ticketId: "102", outcome: "skipped", reason: "no-root-repo", project: "Audit Center" }),
    automation({ id: "c", ticketId: "103", outcome: "skipped", reason: "no-root-repo", project: "Fee Center" }),
  ]);
  assert.deepEqual(list.map((n) => [n.kind, n.refId]), [
    ["plan.needs-root-repo", "Audit Center"],
    ["plan.needs-root-repo", "Fee Center"],
  ]);
  assert.deepEqual(list.map((n) => n.ticketId), ["101", "103"]);
  assert.ok(list.every((n) => n.severity === "action" && n.tab === "overview" && !n.href));
});

test("a missing root repo with no known project stays out of the bell", () => {
  assert.deepEqual(fromAutomation([automation({ outcome: "skipped", reason: "no-root-repo" })]), []);
});

test("an abort is reported as plan drift, needing a human", () => {
  const [n] = fromAutomation([
    automation({ id: "x", action: "abort", outcome: "done", reason: "reassigned" }),
  ]);
  assert.equal(n.kind, "plan.drift");
  assert.equal(n.severity, "action");
  assert.equal(n.tab, "overview");
  assert.equal(n.summary.includes("reassigned"), true);
});

test("an abort with no recorded reason still says something useful", () => {
  const [n] = fromAutomation([automation({ id: "x", action: "abort", outcome: "done", reason: "" })]);
  assert.equal(n.summary.includes("no longer assigned"), true);
});

test("a failed scheduler action is actionable and names the action", () => {
  const [n] = fromAutomation([
    automation({ id: "y", action: "release", outcome: "failed", reason: "provider-error" }),
  ]);
  assert.equal(n.kind, "scheduler.failed");
  assert.equal(n.severity, "action");
  assert.equal(n.summary.includes("release"), true);
  assert.equal(n.summary.includes("provider-error"), true);
});

test("a start the run has already finished under is not reported as under way", () => {
  const list = fromAutomation([
    automation({ id: "b", outcome: "failed", reason: "run-failed", createdAt: "2026-09-06T09:30:00Z" }),
    automation({ id: "a", outcome: "started", createdAt: "2026-09-06T09:00:00Z" }),
  ]);
  assert.deepEqual(list.map((n) => n.kind), ["scheduler.failed"]);
});

test("a restart after a failed run is reported again", () => {
  const list = fromAutomation([
    automation({ id: "c", outcome: "started", createdAt: "2026-09-06T10:00:00Z" }),
    automation({ id: "b", outcome: "failed", reason: "run-failed", createdAt: "2026-09-06T09:30:00Z" }),
  ]);
  assert.deepEqual(list.map((n) => n.kind), ["scheduler.started", "scheduler.failed"]);
});

test("another ticket's conclusion does not silence a running one", () => {
  const list = fromAutomation([
    automation({ id: "b", ticketId: "202", outcome: "failed", createdAt: "2026-09-06T09:30:00Z" }),
    automation({ id: "a", outcome: "started", createdAt: "2026-09-06T09:00:00Z" }),
  ]);
  assert.equal(list.filter((n) => n.kind === "scheduler.started").length, 1);
});

test("an unrecognised scheduler outcome is dropped rather than guessed at", () => {
  assert.deepEqual(fromAutomation([automation({ outcome: "done", action: "implement" })]), []);
});

// ---- ordering ----

test("newest first, whatever the severity", () => {
  const list = sortNotifications([
    ...fromRunEvents([
      { ticketId: "1", runId: "r1", state: "succeeded", at: "2026-09-06T12:00:00Z" },
      { ticketId: "2", runId: "r2", state: "failed", at: "2026-09-06T08:00:00Z" },
    ]),
    ...fromAutomation([automation({ id: "ev9", action: "release", outcome: "done", createdAt: "2026-09-06T13:00:00Z" })]),
  ]);
  assert.deepEqual(
    list.map((n) => n.kind),
    ["scheduler.released", "run.succeeded", "run.failed"]
  );
});

test("sortNotifications does not mutate its input", () => {
  const input: AppNotification[] = fromRunEvents([
    { ticketId: "1", runId: "r1", state: "succeeded", at: "2026-09-06T08:00:00Z" },
    { ticketId: "2", runId: "r2", state: "failed", at: "2026-09-06T09:00:00Z" },
  ]);
  const before = input.map((n) => n.kind);
  sortNotifications(input);
  assert.deepEqual(input.map((n) => n.kind), before);
});

test("an empty build is an empty list, not a throw", () => {
  assert.deepEqual(buildNotifications({}), []);
});


// ---- pull requests ----

const prSource = (over: Partial<Parameters<typeof fromPullRequests>[0][number]> = {}) => ({
  prId: "10517",
  title: "Fix the thing",
  url: "https://dev.azure.com/org/Proj/_git/Repo/pullrequest/10517",
  repo: "Repo",
  mergeStatus: "succeeded",
  authorName: "Other Person",
  mine: true,
  myVote: null as number | null,
  worstVote: 0,
  bestVote: 0,
  ticketId: "101",
  ...over,
});

test("a pull request awaiting my vote is actionable", () => {
  const [n] = fromPullRequests([prSource({ mine: false, myVote: 0 })]);
  assert.equal(n.kind, "pr.awaiting-my-vote");
  assert.equal(n.severity, "action");
  assert.equal(n.summary.includes("Other Person"), true);
});

test("a pull request I am not a reviewer on says nothing", () => {
  assert.deepEqual(fromPullRequests([prSource({ mine: false, myVote: null })]), []);
});

test("a pull request I have already voted on says nothing", () => {
  assert.deepEqual(fromPullRequests([prSource({ mine: false, myVote: 10 })]), []);
  assert.deepEqual(fromPullRequests([prSource({ mine: false, myVote: -10 })]), []);
});

test("somebody else's pull request with no local ticket opens the provider instead", () => {
  const [n] = fromPullRequests([prSource({ mine: false, myVote: 0, ticketId: "" })]);
  assert.equal(n.ticketId, "");
  assert.equal(n.href, "https://dev.azure.com/org/Proj/_git/Repo/pullrequest/10517");
});

test("a pull request with a local ticket deep-links to it rather than out", () => {
  const [n] = fromPullRequests([prSource({ mine: false, myVote: 0, ticketId: "404" })]);
  assert.equal(n.ticketId, "404");
  assert.equal(n.href, undefined);
});

test("both kinds of hand-back are reported as changes requested", () => {
  for (const vote of [-10, -5]) {
    const [n] = fromPullRequests([prSource({ worstVote: vote })]);
    assert.equal(n.kind, "pr.changes-requested", `vote ${vote}`);
    assert.equal(n.severity, "action");
  }
});

test("approved with suggestions is an approval, not a rejection", () => {
  // +5 is the vote a naive sign check gets wrong in the other direction; -5 is
  // the one it gets wrong in this one.
  const [n] = fromPullRequests([prSource({ bestVote: 5 })]);
  assert.equal(n.kind, "pr.approved");
  assert.equal(n.severity, "info");
});

test("a conflict on my pull request is actionable", () => {
  const [n] = fromPullRequests([prSource({ mergeStatus: "conflicts" })]);
  assert.equal(n.kind, "pr.conflict");
  assert.equal(n.severity, "action");
});

test("one pull request produces at most one notification", () => {
  // Rejected *and* conflicting is one thing to go and fix; two rows would count
  // one piece of work twice on the badge.
  const list = fromPullRequests([prSource({ worstVote: -10, mergeStatus: "conflicts", bestVote: 10 })]);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, "pr.changes-requested");
});

test("a healthy unreviewed pull request of mine says nothing", () => {
  assert.deepEqual(fromPullRequests([prSource()]), []);
});

test("a draft of mine is not a notification — the release calendar owns it", () => {
  assert.deepEqual(fromPullRequests([prSource({ mergeStatus: "succeeded" })]), []);
});

test("a re-vote makes an already-read approval unread again", () => {
  const [before] = fromPullRequests([prSource({ bestVote: 5 })]);
  const read = markRead({}, before, "2026-09-06T11:00:00Z");
  const [after] = fromPullRequests([prSource({ bestVote: 10 })]);
  assert.equal(isUnread(after, read), true);
});


// ---- ticket comments ----

const activity = (over: Partial<Parameters<typeof fromTicketActivity>[0][number]> = {}) => ({
  ticketId: "101",
  commentId: "24693145",
  at: "2026-09-06T10:00:00Z",
  authorName: "Marc Kleinschmidt",
  mentionsMe: false,
  ...over,
});

test("being mentioned is actionable; an ordinary comment is not", () => {
  const [plain] = fromTicketActivity([activity()]);
  const [named] = fromTicketActivity([activity({ mentionsMe: true })]);
  assert.equal(plain.kind, "ticket.comment");
  assert.equal(plain.severity, "info");
  assert.equal(named.kind, "ticket.mention");
  assert.equal(named.severity, "action");
});

test("a comment notification names the person and the fact, never the words", () => {
  const [n] = fromTicketActivity([activity({ mentionsMe: true })]);
  assert.equal(n.summary, "Marc Kleinschmidt mentioned you in a comment");
  assert.equal(n.tab, "overview");
  assert.equal(n.ticketId, "101");
});

test("an author the provider did not name still reads as a sentence", () => {
  const [n] = fromTicketActivity([activity({ authorName: "" })]);
  assert.equal(n.summary, "Someone commented on this ticket");
});

test("a comment is reported once and stays read", () => {
  // The fingerprint is the immutable comment id, so re-polling the same window
  // — which the watermark does after a failed read — cannot resurrect it.
  const [first] = fromTicketActivity([activity()]);
  const read = markRead({}, first, "2026-09-06T11:00:00Z");
  const [again] = fromTicketActivity([activity()]);
  assert.equal(isUnread(again, read), false);
});

test("two comments on one ticket do not mark each other read", () => {
  const list = fromTicketActivity([activity({ commentId: "1" }), activity({ commentId: "2" })]);
  const read = markRead({}, list[0], "2026-09-06T11:00:00Z");
  assert.equal(isUnread(list[1], read), true);
});

test("a mention and a comment on one ticket are separate notifications", () => {
  const list = fromTicketActivity([
    activity({ commentId: "1", mentionsMe: true }),
    activity({ commentId: "2" }),
  ]);
  assert.notEqual(notificationKey(list[0]), notificationKey(list[1]));
  assert.equal(actionCount(list, {}), 1);
});

// ---- the review lane ----
//
// The one automation whose success can still be the developer problem: the
// skill answers every thread but resolves only the ones it fixed, so a finished
// run routinely leaves work behind. These assertions are what stop that landing
// as a quiet "done".

test("a review fix that resolved everything is a record, not a task", () => {
  const [n] = fromAutomation([automation({ action: "review", outcome: "done", reason: "all-resolved" })]);
  assert.equal(n.kind, "scheduler.review-fixed");
  assert.equal(n.severity, "info");
  assert.equal(n.tab, "resolve-review");
});

test("a review fix that left threads open reaches the badge", () => {
  const [n] = fromAutomation([automation({ action: "review", outcome: "done", reason: "left-open" })]);
  assert.equal(n.severity, "action");
  assert.match(n.summary, /left open for you/);
});

test("hitting the round ceiling says so, and says automation has stopped", () => {
  const [n] = fromAutomation([automation({ action: "review", outcome: "done", reason: "max-rounds" })]);
  assert.equal(n.severity, "action");
  assert.match(n.summary, /automation has stopped/);
});

test("a failed review fix is named as the fix failing, not the review", () => {
  const [n] = fromAutomation([automation({ action: "review", outcome: "failed", reason: "verification" })]);
  assert.equal(n.kind, "scheduler.failed");
  assert.equal(n.severity, "action");
  assert.match(n.summary, /Could not resolve the review comments/);
  assert.equal(n.tab, "resolve-review");
});

test("a skipped review decision stays in the sprint log and off the bell", () => {
  assert.equal(fromAutomation([automation({ action: "review", outcome: "skipped", reason: "no-new-comments" })]).length, 0);
});

test("history keeps moments, not standing conditions", () => {
  const list = buildNotifications({
    reviews: [review()],
    waitingRuns: [{ ticketId: "101", runId: "r1" }],
    ticketActivity: [activity()],
    automation: [automation({ outcome: "failed" })],
  });
  const kinds = historyWorthy(list).map((n) => n.kind).sort();
  assert.deepEqual(kinds, ["scheduler.failed", "ticket.comment"]);
});

test("merging history dedupes by key, live wins, newest first", () => {
  const [live] = fromTicketActivity([activity({ commentId: "c1", at: "2026-09-06T10:00:00Z" })]);
  const stale = { ...live, summary: "old" };
  const [older] = fromTicketActivity([activity({ commentId: "c0", at: "2026-09-01T10:00:00Z" })]);
  const merged = mergeWithHistory([live], [older, stale]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].summary, live.summary);
  assert.equal(notificationKey(merged[1]), notificationKey(older));
});

test("the report reminder starts at 17:15 and stops once sent", () => {
  const base = { day: "2026-09-28", at: "2026-09-28T10:14:00.000Z", sent: false };
  assert.equal(fromReportReminder({ ...base, minuteOfDay: 17 * 60 + 14 }).length, 0);
  assert.equal(fromReportReminder({ ...base, minuteOfDay: 17 * 60 + 15 }).length, 1);
  assert.equal(fromReportReminder({ ...base, minuteOfDay: 18 * 60, sent: true }).length, 0);
  assert.equal(fromReportReminder(null).length, 0);
});

test("the report reminder is unread again every five minutes", () => {
  const at = (m: number) => `2026-09-28T10:${String(m).padStart(2, "0")}:30.000Z`;
  const r = (m: number) => fromReportReminder({ day: "2026-09-28", minuteOfDay: 17 * 60 + m, at: at(m), sent: false })[0];
  const first = r(15);
  assert.equal(r(19).fingerprint, first.fingerprint);
  assert.notEqual(r(20).fingerprint, first.fingerprint);
  assert.equal(notificationKey(r(20)), notificationKey(first));
  assert.equal(isUnread(r(20), markRead({}, first, "x")), true);
  assert.equal(r(23).at, "2026-09-28T10:20:00.000Z");
  assert.equal(first.severity, "action");
  assert.equal(first.href, "/report");
});

test("a merged pull request waiting for the QA move is one actionable notification pointing at Flow Runner", () => {
  const [n, ...rest] = fromLifecycle([{ ticketId: "201", pendingAction: "move-to-qa", pendingSince: "2026-09-30T02:00:00Z" }]);
  assert.equal(rest.length, 0);
  assert.equal(n.kind, "ticket.ready-for-qa");
  assert.equal(n.severity, "action");
  assert.equal(n.ticketId, "");
  assert.equal(n.refId, "201");
  assert.equal(n.href, "/my-sprint");
});

test("a ticket back from QA is an actionable notification that opens the ticket", () => {
  const [n] = fromLifecycle([{ ticketId: "202", pendingAction: "fix-qa", pendingSince: "2026-09-30T02:00:00Z" }]);
  assert.equal(n.kind, "ticket.qa-failed");
  assert.equal(n.ticketId, "202");
  assert.equal(n.tab, "overview");
  assert.ok(!n.href);
});

test("a new pending moment on the same ticket is unread again", () => {
  const [a] = fromLifecycle([{ ticketId: "203", pendingAction: "fix-qa", pendingSince: "2026-09-30T02:00:00Z" }]);
  const [b] = fromLifecycle([{ ticketId: "203", pendingAction: "fix-qa", pendingSince: "2026-10-01T02:00:00Z" }]);
  assert.equal(notificationKey(a), notificationKey(b));
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test("an unknown pending action produces nothing", () => {
  assert.deepEqual(fromLifecycle([{ ticketId: "204", pendingAction: "", pendingSince: "" }]), []);
});

test("the popup holds only unread QC replies and QA failures", () => {
  const list = [
    ...fromLifecycle([
      { ticketId: "301", pendingAction: "fix-qa", pendingSince: "2026-09-30T02:00:00Z" },
      { ticketId: "302", pendingAction: "qa-reply-ready", pendingSince: "2026-09-30T03:00:00Z" },
      { ticketId: "303", pendingAction: "move-to-qa", pendingSince: "2026-09-30T04:00:00Z" },
    ]),
  ];
  assert.deepEqual(attentionNotifications(list, {}).map((n) => n.refId), ["302", "301"]);
  const seen = markRead({}, list[0], "2026-09-30T05:00:00Z");
  assert.deepEqual(attentionNotifications(list, seen).map((n) => n.refId), ["302"]);
});

test("a drafted reply to QC is one actionable notification pointing at Flow Runner", () => {
  const [n] = fromLifecycle([{ ticketId: "205", pendingAction: "qa-reply-ready", pendingSince: "2026-09-30T02:00:00Z" }]);
  assert.equal(n.kind, "ticket.qa-reply-ready");
  assert.equal(n.severity, "action");
  assert.equal(n.href, "/my-sprint");
});
