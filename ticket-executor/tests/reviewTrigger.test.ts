// The guard that keeps the review lane from talking to itself.
//
// This is the one piece of the auto-resolve flow whose failure mode is not a
// wasted run but a visible mess on somebody's pull request: a scheduler that
// re-triggers on its own replies posts them again, and again, under the
// developer's name, where nothing can be withdrawn. Every branch below is a
// door that has to stay shut.
import test from "node:test";
import assert from "node:assert/strict";

import { reviewVerdict, type ReviewRowState, type ReviewScan } from "../lib/execution/reviewTrigger";

const MAX = 3;
const fresh: ReviewRowState = { lastCommentAt: "", reviewRounds: 0 };
const scan = (over: Partial<ReviewScan> = {}): ReviewScan => ({
  unresolvedCount: 2,
  latestAt: "2026-09-10T09:00:00Z",
  mine: false,
  ...over,
});

test("a reviewer comment on a ticket nothing has been done to yet starts a run", () => {
  const v = reviewVerdict(fresh, scan(), MAX);
  assert.equal(v.act, "run");
  assert.equal(v.advanceTo, "2026-09-10T09:00:00Z");
});

test("no open threads is never work, whatever else is true", () => {
  const v = reviewVerdict(fresh, scan({ unresolvedCount: 0 }), MAX);
  assert.equal(v.act, "wait");
  assert.equal(v.reason, "nothing-open");
});

test("the threads a finished run left open on purpose do not start another one", () => {
  // The exact end state of a successful run: it replied to three findings,
  // resolved one, and left two open because they were invalid or architectural.
  // Those two are still `unresolvedCount`, and the newest comment on them is the
  // run's own reply.
  const after: ReviewRowState = { lastCommentAt: "2026-09-10T09:00:00Z", reviewRounds: 1 };
  const v = reviewVerdict(after, scan({ latestAt: "2026-09-10T09:00:00Z" }), MAX);
  assert.equal(v.act, "wait");
  assert.equal(v.reason, "no-new-comments");
});

test("our own reply is not a request, and the watermark moves past it", () => {
  const after: ReviewRowState = { lastCommentAt: "2026-09-10T09:00:00Z", reviewRounds: 1 };
  const v = reviewVerdict(after, scan({ latestAt: "2026-09-10T09:30:00Z", mine: true }), MAX);
  assert.equal(v.act, "wait");
  assert.equal(v.reason, "own-reply");
  // Without this the same reply is re-read on every scan for the rest of the
  // sprint, and only the authorship check stands between it and a second run.
  assert.equal(v.advanceTo, "2026-09-10T09:30:00Z");
});

test("a reviewer answering our reply is new work again", () => {
  const after: ReviewRowState = { lastCommentAt: "2026-09-10T09:30:00Z", reviewRounds: 1 };
  const v = reviewVerdict(after, scan({ latestAt: "2026-09-10T11:00:00Z" }), MAX);
  assert.equal(v.act, "run");
  assert.equal(v.advanceTo, "2026-09-10T11:00:00Z");
});

test("the ceiling outranks a genuinely new comment", () => {
  const spent: ReviewRowState = { lastCommentAt: "2026-09-10T09:00:00Z", reviewRounds: MAX };
  const v = reviewVerdict(spent, scan({ latestAt: "2026-09-10T12:00:00Z" }), MAX);
  assert.equal(v.act, "wait");
  assert.equal(v.reason, "max-rounds");
  // And it does not move the watermark: the comment was never answered, so a
  // person looking at this row later must still see it as unanswered.
  assert.equal(v.advanceTo, "");
});

test("a provider that reports open threads with no timestamp never triggers", () => {
  // Defensive only in the sense that the field is optional in the summary shape;
  // treating an unknown date as "newer than everything" would fire on every scan.
  const v = reviewVerdict(fresh, scan({ latestAt: "" }), MAX);
  assert.equal(v.act, "wait");
  assert.equal(v.reason, "no-new-comments");
});

test("the loop terminates: run, our reply, rescan — and it stops", () => {
  let row: ReviewRowState = { lastCommentAt: "", reviewRounds: 0 };
  const reviewerComment = scan({ latestAt: "2026-09-10T09:00:00Z" });

  const first = reviewVerdict(row, reviewerComment, MAX);
  assert.equal(first.act, "run");
  row = { lastCommentAt: first.advanceTo, reviewRounds: 1 };

  // The run replies to both threads and resolves neither. Two scans follow.
  const ourReply = scan({ latestAt: "2026-09-10T09:20:00Z", mine: true });
  const second = reviewVerdict(row, ourReply, MAX);
  assert.equal(second.act, "wait");
  row = { lastCommentAt: second.advanceTo, reviewRounds: 1 };

  const third = reviewVerdict(row, ourReply, MAX);
  assert.equal(third.act, "wait");
  assert.equal(third.reason, "no-new-comments");
});
