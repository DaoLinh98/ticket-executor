import test from "node:test";
import assert from "node:assert/strict";

import { commentsSince, isFixingQa, isQueueable, pendingActionFor, stageFrom, stageOf } from "../lib/ticketLifecycle";

test("every Azure DevOps state in the team's process maps to a stage", () => {
  const expected: Record<string, string> = {
    New: "ready",
    Refined: "ready",
    "Ready for Development": "ready",
    "In Progress": "doing",
    Blocked: "blocked",
    "Code Review": "code-review",
    "Ready for QA": "qa",
    "In QA": "qa",
    "QA Passed": "qa-passed",
    "QA Failed": "qa-failed",
    Resolved: "done",
    Closed: "done",
    Removed: "done",
  };
  for (const [status, stage] of Object.entries(expected)) {
    assert.equal(stageOf(status), stage, status);
  }
});

test("stage lookup ignores case and surrounding space, and defaults to ready", () => {
  assert.equal(stageOf("  in qa "), "qa");
  assert.equal(stageOf("Something A Process Template Invented"), "ready");
  assert.equal(stageOf(""), "ready");
});

test("only work not yet handed over is queueable", () => {
  assert.ok(isQueueable("ready"));
  assert.ok(isQueueable("doing"));
  assert.ok(isQueueable("blocked"));
  for (const s of ["code-review", "qa", "qa-failed", "qa-passed", "done"] as const) {
    assert.ok(!isQueueable(s), s);
  }
});

const act = (over: Partial<Parameters<typeof pendingActionFor>[0]>) =>
  pendingActionFor({ stage: "ready", prevStage: "", prMerged: false, current: "", ...over });

test("a merged pull request on a ticket still in Code Review asks to move it to QA", () => {
  assert.equal(act({ stage: "code-review", prevStage: "code-review", prMerged: true }), "move-to-qa");
  assert.equal(act({ stage: "code-review", prevStage: "code-review", prMerged: false }), "");
});

test("the suggestion to move to QA goes away once the ticket is in QA", () => {
  assert.equal(act({ stage: "qa", prevStage: "code-review", prMerged: true, current: "move-to-qa" }), "");
});

test("QA Failed needs a fix", () => {
  assert.equal(act({ stage: "qa-failed", prevStage: "qa" }), "fix-qa");
});

test("a ticket pulled back from QA to In Progress needs a fix, and keeps needing it while in progress", () => {
  assert.equal(act({ stage: "doing", prevStage: "qa" }), "fix-qa");
  assert.equal(act({ stage: "doing", prevStage: "qa-failed", current: "fix-qa" }), "fix-qa");
  assert.equal(act({ stage: "doing", prevStage: "doing", current: "fix-qa" }), "fix-qa");
});

test("the fix is delivered once the ticket goes back to review or QA", () => {
  assert.equal(act({ stage: "code-review", prevStage: "doing", current: "fix-qa" }), "");
  assert.equal(act({ stage: "qa", prevStage: "doing", current: "fix-qa" }), "");
});

test("ordinary progress, and a first sighting with no history, ask for nothing", () => {
  assert.equal(act({ stage: "doing", prevStage: "ready" }), "");
  assert.equal(act({ stage: "doing", prevStage: "" }), "");
  assert.equal(act({ stage: "qa-passed", prevStage: "qa" }), "");
  assert.equal(act({ stage: "done", prevStage: "qa-passed" }), "");
});

test("a QA fix is in flight from its start until its pull request is released", () => {
  assert.ok(isFixingQa({ qaRounds: 1, implementState: "running", releasedAt: null }));
  assert.ok(isFixingQa({ qaRounds: 1, implementState: "implemented", releasedAt: null }));
  assert.ok(!isFixingQa({ qaRounds: 1, implementState: "implemented", releasedAt: "2026-09-30T00:00:00Z" }));
  assert.ok(!isFixingQa({ qaRounds: 1, implementState: "failed", releasedAt: null }));
  assert.ok(!isFixingQa({ qaRounds: 0, implementState: "running", releasedAt: null }));
});

test("only comments newer than the watermark and written by someone else are new QC comments", () => {
  const marks = [
    { at: "2026-09-29T10:00:00Z", authorName: "QC Person" },
    { at: "2026-09-30T09:00:00Z", authorName: "QC Person" },
    { at: "2026-09-30T10:00:00Z", authorName: "Ken Nguyen" },
  ];
  const r = commentsSince(marks, "2026-09-29T12:00:00Z", (n) => n === "Ken Nguyen");
  assert.equal(r.count, 1);
  assert.equal(r.latestAt, "2026-09-30T10:00:00Z");
});

test("with nothing new the watermark stays where it was", () => {
  const r = commentsSince([{ at: "2026-09-29T10:00:00Z", authorName: "QC" }], "2026-09-30T00:00:00Z", () => false);
  assert.deepEqual(r, { count: 0, latestAt: "2026-09-30T00:00:00Z" });
});

test("a stored stage id is read as is, not as a tracker status", () => {
  assert.equal(stageFrom("qa-failed", "In QA"), "qa-failed");
  assert.equal(stageFrom("code-review", ""), "code-review");
  assert.equal(stageFrom("", "QA Failed"), "qa-failed");
  assert.equal(stageFrom("bogus", "In Progress"), "doing");
});
