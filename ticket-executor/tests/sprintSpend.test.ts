import test from "node:test";
import assert from "node:assert/strict";

import { sprintSpend, type SpendRow } from "../lib/sprintSpend";

const row = (ticketId: string, over: Partial<SpendRow> = {}): SpendRow => ({
  ticketId, claim: "mine", points: 2, implementState: "pending", implementOrder: 1, prUrl: "", ...over,
});
const done = (id: string) => row(id, { implementState: "implemented", implementOrder: 0, prUrl: "https://pr/" + id });

test("the average comes from delivered tickets and prices the ones still to run", () => {
  const rows = [done("1"), done("2"), row("3"), row("4"), row("5")];
  const s = sprintSpend(rows, { "1": 2, "2": 4 }, 0, 5, 4);
  assert.equal(s.finished, 2);
  assert.equal(s.avgPerFinished, 3);
  assert.equal(s.remaining, 3);
  assert.equal(s.projectedRemaining, 9);
  assert.equal(s.projectedTotal, 15);
});

test("with nothing delivered yet there is no estimate, only what has been spent", () => {
  const s = sprintSpend([row("1"), row("2")], { "1": 1.5 }, 0, 5, 4);
  assert.equal(s.avgPerFinished, 0);
  assert.equal(s.projectedRemaining, 0);
  assert.equal(s.projectedTotal, 1.5);
});

test("handed-off tickets are neither averaged nor counted as work left, but their spend still counts", () => {
  const s = sprintSpend([row("1", { claim: "handed-off" }), row("2")], { "1": 3 }, 0, 5, 4);
  assert.equal(s.spent, 3);
  assert.equal(s.remaining, 1);
});

test("points left include a running ticket and are compared with the days left", () => {
  const rows = [row("1", { points: 5 }), row("2", { points: 3, implementState: "running", implementOrder: 0 })];
  assert.equal(sprintSpend(rows, {}, 0, 2, 4).fits, true);
  const tight = sprintSpend(rows, {}, 0, 1, 4);
  assert.equal(tight.pointsLeft, 8);
  assert.equal(tight.capacityLeft, 4);
  assert.equal(tight.fits, false);
});

test("over budget counts only the developer's tickets, and only when a budget is set", () => {
  const rows = [row("1"), row("2", { claim: "handed-off" })];
  assert.equal(sprintSpend(rows, { "1": 9, "2": 9 }, 5, 1, 1).overBudget, 1);
  assert.equal(sprintSpend(rows, { "1": 9 }, 0, 1, 1).overBudget, 0);
});
