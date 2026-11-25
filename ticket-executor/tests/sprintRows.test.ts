import test from "node:test";
import assert from "node:assert/strict";

import { isPlanFilter, isPlanSort, previewRow, sortRows } from "../app/(app)/my-sprint/model";

const row = (ticketId: string, over: Record<string, unknown> = {}) => ({
  ...previewRow({ ticketId, title: ticketId, project: "P", implementOrder: 1, points: 1, estimateHours: 1, releaseDay: "", blocked: false, claim: "mine", assigneeNow: "", lane: "todo" } as never),
  ...over,
});
const ids = (rs: { ticketId: string }[]) => rs.map((r) => r.ticketId);

test("queue keeps the stored order", () => {
  const rs = [row("b"), row("a")];
  assert.deepEqual(ids(sortRows(rs, "queue", {})), ["b", "a"]);
});

test("release day sorts ascending with undated rows last", () => {
  const rs = [row("a", { releaseDay: "" }), row("b", { releaseDay: "2026-11-24" }), row("c", { releaseDay: "2026-11-21" })];
  assert.deepEqual(ids(sortRows(rs, "release", {})), ["c", "b", "a"]);
});

test("cost and points sort descending and ties keep the queue order", () => {
  const rs = [row("a", { points: 2 }), row("b", { points: 5 }), row("c", { points: 2 })];
  assert.deepEqual(ids(sortRows(rs, "points", {})), ["b", "a", "c"]);
  assert.deepEqual(ids(sortRows(rs, "cost", { a: 1, c: 3 })), ["c", "a", "b"]);
});

test("state puts failed first, then running, pending and finished", () => {
  const rs = [row("a", { implementState: "implemented" }), row("b", { implementState: "pending" }), row("c", { implementState: "failed" }), row("d", { implementState: "running" })];
  assert.deepEqual(ids(sortRows(rs, "state", {})), ["c", "d", "b", "a"]);
});

test("sorting never mutates the input", () => {
  const rs = [row("a", { points: 1 }), row("b", { points: 9 })];
  sortRows(rs, "points", {});
  assert.deepEqual(ids(rs), ["a", "b"]);
});

test("URL values are accepted only when they name a real filter or sort", () => {
  assert.ok(isPlanFilter("attention"));
  assert.ok(isPlanSort("cost"));
  for (const bad of ["nope", "", "toString", "constructor", null]) {
    assert.equal(isPlanFilter(bad), false, String(bad));
    assert.equal(isPlanSort(bad), false, String(bad));
  }
});
