import test from "node:test";
import assert from "node:assert/strict";
import { computeInsights, normaliseReason, outcomeOf, overBudget, paceOf, type MetricRun, type MetricTicket } from "../lib/runMetrics";

const DAY = 86_400_000;
// Monday 2026-10-12 → Friday 2026-10-23: ten working days.
const FROM = Date.parse("2026-10-12T00:00:00Z");
const TO = Date.parse("2026-10-23T18:00:00Z");

const run = (id: string, extra: Partial<MetricRun> = {}): MetricRun => ({
  id,
  ticketId: "4182",
  ticketTitle: "Export invoices",
  flow: "implement",
  state: "succeeded",
  waitReason: "",
  failedAt: "verifyPublish",
  errorMessage: "",
  prUrl: "",
  startedAt: FROM + DAY,
  endedAt: FROM + DAY + 600_000,
  finalTo: "END",
  finalReason: "",
  steps: [],
  ...extra,
});

const ticket = (ticketId: string, points: number, extra: Partial<MetricTicket> = {}): MetricTicket => ({ ticketId, points, prUrl: "", releasedAt: null, ...extra });

test("outcomeOf keeps NEEDS_REVIEW ends and PO waits apart from plain outcomes", () => {
  assert.equal(outcomeOf({ state: "succeeded", waitReason: "", finalTo: "END" }), "succeeded");
  assert.equal(outcomeOf({ state: "succeeded", waitReason: "", finalTo: "NEEDS_REVIEW" }), "endedForReview");
  assert.equal(outcomeOf({ state: "waiting", waitReason: "needs-input", finalTo: "NEEDS_INPUT" }), "waitingForPo");
  assert.equal(outcomeOf({ state: "cancelled", waitReason: "", finalTo: "" }), "cancelled");
  assert.equal(outcomeOf({ state: "running", waitReason: "", finalTo: "plan" }), "running");
});

test("normaliseReason groups the same failure told with different ids", () => {
  const a = normaliseReason("Push failed for https://dev.azure.com/x/_git/y at 1234567\nstack...");
  const b = normaliseReason("Push failed for https://dev.azure.com/z/_git/q at 9876543");
  assert.equal(a, b);
  assert.equal(a, "Push failed for <url> at #");
  assert.equal(normaliseReason(""), "(no reason recorded)");
  assert.equal(normaliseReason("x".repeat(300)).length, 118);
  assert.equal(normaliseReason("Could not open C:\\repos\\app\\src or /home/u/app"), "Could not open <path> or <path>");
});

test("computeInsights folds nodes, flows, failures and ticket cost", () => {
  const runs = [
    run("a", { steps: [{ nodeId: "implement", status: "succeeded", costUsd: 1 }, { nodeId: "fix", status: "succeeded", costUsd: 0.5 }, { nodeId: "fix", status: "succeeded", costUsd: 0.5 }] }),
    run("b", { state: "failed", failedAt: "fix", finalTo: "FAIL", errorMessage: "Review blockers left after every fix", endedAt: FROM + DAY + 1_200_000, steps: [{ nodeId: "implement", status: "succeeded", costUsd: 1 }, { nodeId: "fix", status: "failed", costUsd: 1 }] }),
    run("c", { ticketId: "77", ticketTitle: "Fix login", state: "failed", failedAt: "setup", errorMessage: "rate limit exceeded (429)", steps: [] }),
    run("d", { ticketId: "77", flow: "review", finalTo: "NEEDS_REVIEW", steps: [{ nodeId: "respond", status: "refused", costUsd: 0.25 }] }),
    run("e", { ticketId: "90", flow: "qa", state: "waiting", waitReason: "needs-input", endedAt: null, finalTo: "NEEDS_INPUT" }),
  ];
  const ins = computeInsights({ runs, tickets: [ticket("4182", 3), ticket("77", 0)], from: FROM, to: TO, plannedPointsPerDay: 2 });

  assert.deepEqual(ins.totals, { runs: 5, finished: 4, successRate: 0.5, costUsd: 4.25, costPerPoint: 1.3333 });

  const fix = ins.nodes.find((n) => n.nodeId === "fix")!;
  assert.deepEqual([fix.visits, fix.failures, fix.runsEndedHere, fix.totalCostUsd, fix.avgCostUsd], [3, 1, 1, 2, 0.6667]);
  assert.equal(fix.successRate, 2 / 3);
  const respond = ins.nodes.find((n) => n.nodeId === "respond")!;
  assert.deepEqual([respond.refusals, respond.successRate], [1, 0]);
  assert.equal(ins.nodes.find((n) => n.nodeId === "setup")!.successRate, null);

  const impl = ins.flows.find((f) => f.flow === "implement")!;
  assert.deepEqual([impl.runs, impl.succeeded, impl.failed, impl.avgFixRounds, impl.avgDurationSec], [3, 1, 2, 1, 800]);
  const review = ins.flows.find((f) => f.flow === "review")!;
  assert.deepEqual([review.endedForReview, review.succeeded, review.avgFixRounds], [1, 0, null]);
  const qa = ins.flows.find((f) => f.flow === "qa")!;
  assert.deepEqual([qa.waitingForPo, qa.avgDurationSec], [1, null]);

  assert.deepEqual(ins.failures.classes, { transient: 1, env: 0, agent: 1 });
  assert.equal(ins.failures.top.length, 2);

  assert.deepEqual(ins.tickets.map((t) => [t.ticketId, t.costUsd, t.runs, t.points]), [["4182", 4, 2, 3], ["77", 0.25, 2, null], ["90", 0, 1, null]]);
});

test("paceOf counts released or PR'd sized tickets per working day and judges them against the plan", () => {
  const tickets = new Map(
    [
      ticket("1", 3, { releasedAt: FROM + 2 * DAY }),
      ticket("2", 5),
      ticket("3", 4, { releasedAt: FROM + 3 * DAY }),
      ticket("4", 8, { releasedAt: FROM - DAY }), // before the window
      ticket("5", 0, { releasedAt: FROM + DAY }), // unsized
    ].map((t) => [t.ticketId, t]),
  );
  const runs = [run("r2", { ticketId: "2", prUrl: "https://pr/2", endedAt: FROM + 4 * DAY })];
  const pace = paceOf(runs, tickets, FROM, TO, 2);
  assert.deepEqual(pace, { sample: 3, deliveredPoints: 12, workingDays: 10, suggestedPointsPerDay: 1, plannedPointsPerDay: 2, verdict: "slower" });

  assert.equal(paceOf(runs, tickets, FROM, TO, 1).verdict, "on-pace");
  assert.equal(paceOf(runs, tickets, FROM, TO, 0.5).verdict, "faster");
  assert.equal(paceOf(runs, tickets, FROM, TO, null).verdict, "no-plan");
  assert.equal(paceOf([], tickets, FROM, TO, 2).verdict, "too-few");
});

test("overBudget lists tickets at or over the budget, and nothing when it is off", () => {
  const costs = { a: 4.9, b: 5, c: 12, d: 0 };
  assert.deepEqual(overBudget(costs, 5), ["c", "b"]);
  assert.deepEqual(overBudget(costs, 0), []);
  assert.deepEqual(overBudget({}, 5), []);
});
