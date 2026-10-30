// The PO loop's one decision that is pure: which post the parked run's current questions came from.
import test from "node:test";
import assert from "node:assert/strict";
import { postedAtOf, PO_ANSWERED, QUESTIONS_POSTED } from "../lib/clarification";

const at = (m: number) => new Date(Date.UTC(2026, 9, 29, 9, m));
const ev = (reason: string, m: number, outcome = "done", detail = "run1") => ({ reason, outcome, detail, createdAt: at(m) });

test("questions not posted yet", () => {
  assert.equal(postedAtOf([], "run1"), null);
});

test("posted questions wait for the PO", () => {
  assert.equal(postedAtOf([ev(QUESTIONS_POSTED, 1)], "run1"), at(1).toISOString());
});

test("an answer that resumed the run clears the post; the next park asks again", () => {
  assert.equal(postedAtOf([ev(QUESTIONS_POSTED, 1), ev(PO_ANSWERED, 5, "started", "run1 — 1 new comment")], "run1"), null);
  assert.equal(
    postedAtOf([ev(QUESTIONS_POSTED, 1), ev(PO_ANSWERED, 5, "started", "run1 — x"), ev(QUESTIONS_POSTED, 9)], "run1"),
    at(9).toISOString()
  );
});

test("a resume that failed keeps the post; other runs' events are ignored", () => {
  assert.equal(postedAtOf([ev(QUESTIONS_POSTED, 1), ev(PO_ANSWERED, 5, "failed", "run1 — x")], "run1"), at(1).toISOString());
  assert.equal(postedAtOf([ev(QUESTIONS_POSTED, 1, "done", "run2")], "run1"), null);
});
