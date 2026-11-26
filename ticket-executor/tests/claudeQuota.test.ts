import test from "node:test";
import assert from "node:assert/strict";
import { estimateQuota, parseQuota, pctText, quotaOf, quotaRate, quotaSpent, type Quota } from "../lib/claudeQuota";

const q = (session: number | null, week: number | null): Quota => ({
  session: session === null ? null : { pct: session, resetsAt: null },
  week: week === null ? null : { pct: week, resetsAt: null },
  weekSonnet: null,
  weekOpus: null,
  at: "2026-11-26T00:00:00.000Z",
});

test("parseQuota reads the session and weekly windows and clamps to 0-100", () => {
  const r = parseQuota({
    five_hour: { utilization: 37.5, resets_at: "2026-11-26T05:00:00+00:00" },
    seven_day: { utilization: 140, resets_at: null },
    seven_day_opus: null,
  });
  assert.equal(r?.session?.pct, 37.5);
  assert.equal(r?.session?.resetsAt, "2026-11-26T05:00:00.000Z");
  assert.equal(r?.week?.pct, 100);
  assert.equal(r?.weekOpus, null);
});

test("parseQuota refuses a body without either window", () => {
  assert.equal(parseQuota(null), null);
  assert.equal(parseQuota({ error: "x" }), null);
  assert.equal(parseQuota({ five_hour: { utilization: "n/a" } }), null);
});

test("quotaOf round-trips a stored reading and refuses junk", () => {
  assert.deepEqual(quotaOf(JSON.parse(JSON.stringify(q(10, 2)))), q(10, 2));
  assert.equal(quotaOf({ at: "x" }), null);
  assert.equal(quotaOf("nope"), null);
});

test("quotaSpent is the move between two readings; a reset window counts what accrued since", () => {
  assert.deepEqual(quotaSpent(q(10, 2), q(17.4, 2.5)), { session: 7.4, week: 0.5 });
  assert.deepEqual(quotaSpent(q(95, 40), q(3, 41)), { session: 3, week: 1 });
  assert.equal(quotaSpent(null, q(1, 1)), null);
  assert.deepEqual(quotaSpent(q(10, null), q(12, null)), { session: 2, week: null });
});

test("quotaRate is the median points-per-dollar of measured steps, ignoring cheap or unread ones", () => {
  const step = (cost: number, from: Quota | null, to: Quota | null) => ({ costUsd: cost, quotaStart: from, quotaEnd: to });
  const steps = [
    step(1, q(0, 0), q(4, 1)), // 4 / $
    step(2, q(4, 1), q(10, 2)), // 3 / $
    step(1, q(10, 2), q(30, 3)), // 20 / $ — someone else was using the account
    step(0.05, q(30, 3), q(31, 3)), // too cheap to count
    step(1, null, q(40, 4)), // unread
  ];
  assert.deepEqual(quotaRate(steps), { session: 4, week: 1, samples: 3 });
  assert.equal(quotaRate(steps.slice(0, 2)), null);
});

test("estimateQuota scales a cost by the rate and says nothing without one", () => {
  const rate = { session: 4, week: 0.5, samples: 3 };
  assert.deepEqual(estimateQuota(2.2, rate), { session: 8.8, week: 1.1 });
  assert.equal(estimateQuota(2.2, null), null);
  assert.equal(estimateQuota(0, rate), null);
});

test("pctText keeps a decimal for small numbers and marks a sliver", () => {
  assert.equal(pctText(7.44), "7.4%");
  assert.equal(pctText(42.4), "42%");
  assert.equal(pctText(0.01), "<0.1%");
  assert.equal(pctText(0), "0%");
});
