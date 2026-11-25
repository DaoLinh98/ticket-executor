import test from "node:test";
import assert from "node:assert/strict";

import { planCsv, type CsvRow } from "../lib/sprintCsv";

const row = (over: Partial<CsvRow> = {}): CsvRow => ({
  ticketId: "100", title: "Fix it", project: "P", points: 3, estimateHours: 5, implementOrder: 2, releaseDay: "2026-11-24",
  implementState: "pending", reviewState: "idle", claim: "mine", prUrl: "", ...over,
});

test("a header line, then one line per row, each ending in CRLF", () => {
  const lines = planCsv([row(), row({ ticketId: "101" })], {}).split("\r\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "Ticket,Title,Project,Points,Hours,Queue,Release day,Run,Review,Claim,Pull request,Spent USD");
  assert.equal(lines[1], "100,Fix it,P,3,5,2,2026-11-24,pending,idle,mine,,0.00");
  assert.equal(lines[3], "");
});

test("commas, quotes and newlines are quoted and quotes doubled", () => {
  const line = planCsv([row({ title: 'Say "hi", then\nleave' })], {}).split("\r\n")[1];
  assert.ok(line.includes('"Say ""hi"", then\nleave"'));
});

test("a title that would run as a formula is neutralised", () => {
  const line = planCsv([row({ title: "=HYPERLINK(\"x\")" })], {}).split("\r\n")[1];
  assert.ok(line.includes("'=HYPERLINK"));
});

test("spend comes from the costs by ticket id; an unqueued row has an empty queue cell", () => {
  const line = planCsv([row({ implementOrder: 0 })], { "100": 1.239 }).split("\r\n")[1];
  assert.ok(line.endsWith(",1.24"));
  assert.ok(line.includes(",5,,2026-11-24,"));
});
