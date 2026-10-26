import test from "node:test";
import assert from "node:assert/strict";

import {
  awaitsAnalysis,
  awaitsDeveloper,
  DEBOUNCE_MS,
  dueForAnalysis,
  followUpAfter,
  hasEvidence,
  normalizeFindings,
  onSignal,
  overduePeriods,
  recommend,
  signalsOf,
  SLA_MS,
  watchesComments,
} from "../lib/qaFollowUp";

test("comments are watched with QA, and after QA sent the ticket back — not before delivery", () => {
  for (const s of ["qa", "qa-failed", "qa-passed"] as const) assert.ok(watchesComments(s, false), s);
  assert.ok(watchesComments("doing", true));
  assert.ok(!watchesComments("doing", false));
  assert.ok(!watchesComments("code-review", false));
});

test("a comment, QA failed and back-to-In-Progress are each a signal", () => {
  assert.deepEqual(signalsOf({ stage: "qa", prevStage: "qa", newComments: 2 }), ["comment"]);
  assert.deepEqual(signalsOf({ stage: "qa-failed", prevStage: "qa", newComments: 0 }), ["qa-failed"]);
  assert.deepEqual(signalsOf({ stage: "doing", prevStage: "qa", newComments: 1 }), ["comment", "returned"]);
  assert.deepEqual(signalsOf({ stage: "qa-failed", prevStage: "qa-failed", newComments: 0 }), []);
  // The first sweep of a ticket has no previous stage to compare with.
  assert.deepEqual(signalsOf({ stage: "qa-failed", prevStage: "", newComments: 0 }), []);
  assert.deepEqual(signalsOf({ stage: "doing", prevStage: "code-review", newComments: 0 }), []);
});

test("a signal opens a case, widens a pending one, re-analyses a stale one, and never interrupts a run", () => {
  assert.equal(onSignal(null), "open");
  assert.equal(onSignal("pending"), "extend");
  assert.equal(onSignal("ready"), "reopen");
  assert.equal(onSignal("failed"), "reopen");
  for (const s of ["running", "fixing", "fixed"] as const) assert.equal(onSignal(s), "hold", s);
});

test("comments QC wrote after a case's window open the next case", () => {
  assert.ok(followUpAfter("2026-10-20T01:00:00Z", "2026-10-20T02:00:00Z"));
  assert.ok(!followUpAfter("2026-10-20T02:00:00Z", "2026-10-20T02:00:00Z"));
  assert.ok(!followUpAfter("2026-10-20T02:00:00Z", ""));
});

test("analysis waits out the debounce, and only when auto-analysis is on", () => {
  const at = new Date("2026-10-20T10:00:00Z");
  const later = (ms: number) => new Date(at.getTime() + ms);
  const c = { status: "pending", signalAt: at };
  assert.ok(!dueForAnalysis(c, true, later(DEBOUNCE_MS - 1)));
  assert.ok(dueForAnalysis(c, true, later(DEBOUNCE_MS)));
  assert.ok(!dueForAnalysis(c, false, later(DEBOUNCE_MS)));
  assert.ok(!dueForAnalysis({ ...c, status: "ready" }, true, later(DEBOUNCE_MS)));
});

test("evidence is a file:line or a named acceptance criterion", () => {
  assert.ok(hasEvidence("src/billing/total.ts:42 rounds half-up as AC asks"));
  assert.ok(hasEvidence("Satisfies AC 3: totals exclude VAT"));
  assert.ok(hasEvidence("Covered by the acceptance criteria"));
  assert.ok(!hasEvidence("Works as designed"));
});

test("an unproven 'not a defect' is downgraded, and defect always follows kind", () => {
  const [weak, proven, legacy, bogus] = normalizeFindings([
    { finding: "Button grey", kind: "not-defect", defect: false, reason: "Works as designed", files: [] },
    { finding: "Rounding", kind: "not-defect", defect: true, reason: "src/total.ts:42 rounds as AC 2 says", files: [] },
    { finding: "Crash", defect: true, reason: "src/a.ts:1", files: ["src/a.ts"] },
    { finding: "Odd", kind: "whatever", reason: "", files: [] },
  ]);
  assert.equal(weak.kind, "needs-info");
  assert.equal(weak.weak, true);
  assert.equal(proven.kind, "not-defect");
  assert.equal(proven.defect, false);
  assert.equal(legacy.kind, "defect");
  assert.equal(bogus.kind, "needs-info");
  assert.deepEqual(normalizeFindings("nope"), []);
});

test("the recommendation is the harness's, from the verdicts", () => {
  const f = (kind: string) => normalizeFindings([{ finding: "x", kind, reason: "src/a.ts:1", files: [] }]);
  assert.equal(recommend([...f("question"), ...f("defect")]), "fix");
  assert.equal(recommend([...f("question"), ...f("new-scope")]), "decide");
  assert.equal(recommend(f("needs-info")), "decide");
  assert.equal(recommend([...f("question"), ...f("not-defect")]), "reply");
  assert.equal(recommend([]), "decide");
});

test("the bell reports what waits on the developer, and asks again every SLA period", () => {
  assert.ok(awaitsDeveloper({ status: "ready" }, true));
  assert.ok(awaitsDeveloper({ status: "fixed" }, true));
  assert.ok(awaitsDeveloper({ status: "pending" }, false));
  assert.ok(!awaitsDeveloper({ status: "pending" }, true));
  assert.ok(!awaitsDeveloper({ status: "running" }, false));
  const at = new Date("2026-10-20T10:00:00Z");
  assert.equal(overduePeriods(at, new Date(at.getTime() + SLA_MS - 1)), 0);
  assert.equal(overduePeriods(at, new Date(at.getTime() + 2 * SLA_MS)), 2);
});

test("Analyse is offered only while QC's feedback is unanswered", () => {
  const base = { stage: "qa" as const, pendingAction: "", pendingSince: null, qaCommentAt: "2026-10-26T04:00:00Z", lastClosed: null };
  // A comment no case has answered yet.
  assert.ok(awaitsAnalysis(base));
  // Every comment answered by the last closed case: nothing to offer.
  const answered = { answersUpTo: "2026-10-26T04:00:00Z", closedAt: "2026-10-26T05:00:00Z" };
  assert.ok(!awaitsAnalysis({ ...base, lastClosed: answered }));
  // QC wrote again after it.
  assert.ok(awaitsAnalysis({ ...base, qaCommentAt: "2026-10-26T06:00:00Z", lastClosed: answered }));
  // A QA ticket nobody commented on.
  assert.ok(!awaitsAnalysis({ ...base, qaCommentAt: "" }));
  // Sent back from QA after the last case closed — and not, once a case dealt with it.
  const back = { ...base, stage: "qa-failed" as const, pendingAction: "fix-qa", qaCommentAt: "", pendingSince: "2026-10-26T07:00:00Z" };
  assert.ok(awaitsAnalysis(back));
  assert.ok(awaitsAnalysis({ ...back, lastClosed: answered }));
  assert.ok(!awaitsAnalysis({ ...back, lastClosed: { ...answered, closedAt: "2026-10-26T08:00:00Z" } }));
  // Before QA: never.
  assert.ok(!awaitsAnalysis({ ...base, stage: "code-review" }));
});
