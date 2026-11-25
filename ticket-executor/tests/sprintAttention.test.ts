import test from "node:test";
import assert from "node:assert/strict";

import { attentionOf, type AttentionInput, type AttentionRow } from "../lib/sprintAttention";

const row = (over: Partial<AttentionRow> = {}): AttentionRow => ({
  id: "p1", ticketId: "100", title: "Ticket", claim: "mine", reviewState: "idle", reviewRounds: 0,
  prPublished: false, prMerged: false, prUrl: "", releaseError: "", releaseDay: "", releasedAt: null,
  implementState: "pending", implementOrder: 1, pendingAction: "", qaRounds: 0, ...over,
});

const input = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  rows: [], reviews: [], cases: [], costs: {}, budgetUsd: 0, today: "2026-11-20", autoRelease: false, autoDraftQaReply: true, ...over,
});

test("a quiet plan needs nothing", () => {
  assert.deepEqual(attentionOf(input({ rows: [row()] })), []);
});

test("rows the developer no longer holds are never listed", () => {
  const out = attentionOf(input({ rows: [row({ claim: "handed-off", implementState: "failed" })] }));
  assert.equal(out.length, 0);
});

test("a failed run with no PR offers retry; with a PR it only offers the result", () => {
  const retry = attentionOf(input({ rows: [row({ implementState: "failed" })] }));
  assert.deepEqual(retry.map((e) => e.actions), [["retry"]]);
  const result = attentionOf(input({ rows: [row({ implementState: "failed", prUrl: "https://pr/1" })] }));
  assert.deepEqual(result.map((e) => e.actions), [["result"]]);
});

test("a failed review fix is retried only while the PR is published and open", () => {
  const open = attentionOf(input({ rows: [row({ reviewState: "failed", prPublished: true })] }));
  assert.deepEqual(open[0].actions, ["fixReview"]);
  const merged = attentionOf(input({ rows: [row({ reviewState: "failed", prPublished: true, prMerged: true })] }));
  assert.deepEqual(merged[0].actions, ["result"]);
});

test("a release error offers release only when the ticket is due for it", () => {
  const due = row({ releaseError: "boom", prUrl: "https://pr/1", implementState: "implemented" });
  assert.deepEqual(attentionOf(input({ rows: [due] }))[0].actions, ["release"]);
  assert.deepEqual(attentionOf(input({ rows: [row({ releaseError: "boom" })] }))[0].actions, []);
});

test("release day reminder appears only with auto-release off, on or after the day, without an error", () => {
  const due = row({ prUrl: "https://pr/1", implementState: "implemented", releaseDay: "2026-11-20" });
  assert.equal(attentionOf(input({ rows: [due] })).filter((e) => e.key === "rd-p1").length, 1);
  assert.equal(attentionOf(input({ rows: [due], autoRelease: true })).length, 0);
  assert.equal(attentionOf(input({ rows: [{ ...due, releaseDay: "2026-11-21" }] })).length, 0);
  assert.equal(attentionOf(input({ rows: [due], today: "" })).length, 0);
});

test("QA fixes past the round limit need the developer, while one still running does not", () => {
  const stuck = row({ pendingAction: "fix-qa", qaRounds: 3, implementState: "failed", prUrl: "https://pr/1" });
  assert.ok(attentionOf(input({ rows: [stuck] })).some((e) => e.key === "qx-p1"));
  const running = row({ pendingAction: "fix-qa", qaRounds: 3, implementState: "running" });
  assert.ok(!attentionOf(input({ rows: [running] })).some((e) => e.key === "qx-p1"));
});

test("needs-review runs name the ticket and carry both actions", () => {
  const out = attentionOf(input({
    rows: [row({ implementState: "no-fix-needed" })],
    reviews: [{ plannedTicketId: "p1", ticketId: "100", runId: "r1", reason: "read-back mismatch" }],
  }));
  assert.equal(out[0].key, "nr-r1");
  assert.match(out[0].text, /nothing to change/);
  assert.deepEqual(out[0].actions, ["result", "markReviewed"]);
});

test("a ticket over budget is listed once per ticket, only when the developer holds it", () => {
  const rows = [row(), row({ id: "p2", ticketId: "200", claim: "handed-off" })];
  const out = attentionOf(input({ rows, costs: { "100": 6, "200": 9, "300": 7 }, budgetUsd: 5 }));
  assert.deepEqual(out.map((e) => e.key), ["ob-100"]);
  assert.match(out[0].text, /\$6\.00 of its \$5\.00/);
});

test("QA cases: pending ones show only when auto-analysis is off; tone follows the recommendation", () => {
  const cases = [
    { id: "c1", plannedTicketId: "p1", ticketId: "100", status: "pending", recommendation: "" },
    { id: "c2", plannedTicketId: "p1", ticketId: "100", status: "ready", recommendation: "fix" },
    { id: "c3", plannedTicketId: "p1", ticketId: "100", status: "running", recommendation: "" },
  ];
  const off = attentionOf(input({ rows: [row()], cases, autoDraftQaReply: false }));
  assert.deepEqual(off.map((e) => e.key).sort(), ["qa-c1", "qa-c2"]);
  const on = attentionOf(input({ rows: [row()], cases, autoDraftQaReply: true }));
  assert.deepEqual(on.map((e) => e.key), ["qa-c2"]);
  assert.equal(on[0].tone, "danger");
});

test("entries sort danger, then warning, then accent, keeping the order within a tone", () => {
  const rows = [
    row({ id: "a", ticketId: "1", pendingAction: "move-to-qa" }),
    row({ id: "b", ticketId: "2", reviewState: "needs-human", reviewRounds: 3 }),
    row({ id: "c", ticketId: "3", implementState: "failed" }),
    row({ id: "d", ticketId: "4", reviewState: "needs-human", reviewRounds: 3 }),
  ];
  assert.deepEqual(attentionOf(input({ rows })).map((e) => e.key), ["if-c", "nh-b", "nh-d", "mq-a"]);
});
