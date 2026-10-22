import test from "node:test";
import assert from "node:assert/strict";

import { graphById, outlineOf } from "../lib/execution/graph/graphs";
import {
  activityStats,
  cumulativeStarts,
  defaultStepId,
  edgeStats,
  filterActivity,
  FLOW_NODE_W,
  flowLayout,
  groupActivity,
  logRanges,
  mainPath,
  nodeRunState,
  nodeSummaries,
  outputKind,
  transitionInto,
  transitionOutOf,
  type StepTrace,
  type TransitionView,
} from "../lib/runTrace";

function step(id: string, nodeId: string, startedAt: string, status: StepTrace["status"] = "succeeded"): StepTrace {
  return {
    id, nodeId, label: nodeId, attempt: 1, status, effects: "pure", startedAt, endedAt: status === "running" ? null : startedAt,
    durationMs: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, numTurns: 0,
    errorMessage: "", output: {}, logFrom: 0, logTo: 0,
  };
}

const T = (seq: number, fromNode: string, toNode: string, at: string, reason = ""): TransitionView => ({ seq, fromNode, toNode, reason, at });

test("logRanges: each step owns the lines up to the next step's start, the last one up to the tail", () => {
  assert.deepEqual(logRanges([0, 4, 9], 12), [
    { from: 0, to: 4 },
    { from: 4, to: 9 },
    { from: 9, to: 12 },
  ]);
});

test("logRanges: an unknown start inherits the previous one and never runs backwards", () => {
  assert.deepEqual(logRanges([0, undefined, 2, 1], 5), [
    { from: 0, to: 0 },
    { from: 0, to: 2 },
    { from: 2, to: 2 },
    { from: 2, to: 5 },
  ]);
});

test("cumulativeStarts: persisted step logs laid end to end", () => {
  assert.deepEqual(cumulativeStarts([3, 0, 5]), [0, 3, 3]);
});

test("groupActivity: a tool call is paired with its result by tool_use id", () => {
  const items = groupActivity([
    { text: "▸ Implement — /implement-ticket-v4", kind: "cmd", detail: "full prompt" },
    { text: "● Session started", kind: "step" },
    { text: "Looking at the code.", kind: "muted" },
    { text: "Then the tests.", kind: "muted" },
    { text: "$ npm test", kind: "cmd", tool: "Bash", ref: "a", detail: "npm test" },
    { text: "✎ Read src/x.ts", kind: "file", tool: "Read", ref: "b" },
    { text: "↳ ok", kind: "result", ref: "b", detail: "file body" },
    { text: "↳ 3 failing", kind: "result", ref: "a", detail: "3 failing", isError: true },
    { text: "↳ orphan", kind: "result", ref: "zzz" },
  ]);
  assert.deepEqual(items.map((i) => i.type), ["prompt", "event", "message", "tool", "tool", "event"]);
  const bash = items[3];
  assert.ok(bash.type === "tool" && bash.result?.isError);
  const read = items[4];
  assert.ok(read.type === "tool" && read.result?.detail === "file body");
  const msg = items[2];
  assert.ok(msg.type === "message" && msg.lines.length === 2);
});

test("groupActivity: legacy lines with no tool metadata still read as tool calls", () => {
  const items = groupActivity([
    { text: "$ git status", kind: "cmd" },
    { text: "✎ mcp__ado__get", kind: "file" },
  ]);
  assert.deepEqual(items.map((i) => i.type), ["tool", "tool"]);
});

test("filterActivity + activityStats: errors, tools and a text query", () => {
  const items = groupActivity([
    { text: "$ npm test", kind: "cmd", tool: "Bash", ref: "a" },
    { text: "↳ boom", kind: "result", ref: "a", detail: "boom", isError: true },
    { text: "✎ Edit src/a.ts", kind: "file", tool: "Edit", ref: "b" },
    { text: "All good now.", kind: "muted" },
    { text: "✖ failed", kind: "fail" },
  ]);
  assert.equal(filterActivity(items, "errors", "").length, 2);
  assert.equal(filterActivity(items, "tools", "").length, 2);
  assert.equal(filterActivity(items, "messages", "").length, 1);
  assert.equal(filterActivity(items, "all", "BOOM").length, 1);
  assert.deepEqual(activityStats(items), { tools: 2, commands: 1, edits: 1, messages: 1, errors: 2 });
});

test("outputKind: the contract's shape names the renderer, never the node id", () => {
  assert.equal(outputKind({ verdict: "pass", blockers: [] }), "review");
  assert.equal(outputKind({ passed: false, blockers: [] }), "gate");
  assert.equal(outputKind({ committed: true }), "delivery");
  assert.equal(outputKind({ outcome: "no-fix-needed" }), "delivery");
  assert.equal(outputKind({ pushed: true, prUrl: "u" }), "publish");
  assert.equal(outputKind({ recorded: false, lesson: "" }), "lesson");
  assert.equal(outputKind({}), "unknown");
});

test("transitions map onto the step that took them, by time — an abandoned attempt took none", () => {
  const steps = [
    step("s1", "implement", "2026-01-01T00:00:00Z"),
    step("s2", "check", "2026-01-01T00:01:00Z"),
    step("s3", "evaluate", "2026-01-01T00:02:00Z", "abandoned"),
    step("s4", "evaluate", "2026-01-01T00:05:00Z"),
    step("s5", "fix", "2026-01-01T00:06:00Z", "running"),
  ];
  const ts = [
    T(1, "implement", "check", "2026-01-01T00:00:59Z", "committed"),
    T(2, "check", "evaluate", "2026-01-01T00:01:01Z", "test gate passed"),
    T(3, "evaluate", "fix", "2026-01-01T00:05:59Z", "review found 1 blocker(s)"),
  ];
  assert.equal(transitionOutOf(steps[0], steps, ts)?.seq, 1);
  assert.equal(transitionOutOf(steps[2], steps, ts), null);
  assert.equal(transitionOutOf(steps[3], steps, ts)?.seq, 3);
  assert.equal(transitionInto(steps[3], steps, ts)?.seq, 2, "a re-entry after a park still came in through the gate");
  assert.equal(transitionInto(steps[4], steps, ts)?.reason, "review found 1 blocker(s)");
  assert.equal(defaultStepId(steps), "s5");
  assert.equal(nodeRunState("evaluate", steps), "done");
  assert.equal(nodeRunState("publish", steps), "pending");
  assert.equal(edgeStats(ts).get("evaluate->fix")?.count, 1);
});

test("nodeSummaries: attempts, time and cost add up per node; the latest attempt sets the tone", () => {
  const a = { ...step("a", "check", "2026-01-01T00:00:00Z", "failed"), durationMs: 1000, costUsd: 0 };
  const b = { ...step("b", "evaluate", "2026-01-01T00:00:01Z"), durationMs: 5000, costUsd: 0.5 };
  const c = { ...step("c", "check", "2026-01-01T00:00:06Z", "running") };
  const m = nodeSummaries([a, b, c], Date.parse("2026-01-01T00:00:16Z"));
  assert.deepEqual(m.get("check"), { attempts: 2, durationMs: 11000, costUsd: 0, tone: "running", latestStepId: "c", label: "check", runningSince: "2026-01-01T00:00:06Z" });
  assert.equal(m.get("evaluate")?.tone, "done");
  assert.equal(m.get("evaluate")?.costUsd, 0.5);
});

test("mainPath: each flow's happy path is the first declared node target, followed to the end", () => {
  assert.deepEqual(mainPath(outlineOf(graphById("implement-v5"))), ["implement", "check", "evaluate", "publish"]);
  assert.deepEqual(mainPath(outlineOf(graphById("fix-review-v5"))), ["implement", "check", "evaluate", "publish"]);
  assert.deepEqual(mainPath(outlineOf(graphById("fix-qa-v4"))), ["implement", "check", "evaluate", "publish"]);
});

test("flowLayout: the happy path is one row, recovery nodes sit under it and are wired in before a run", () => {
  const defs = outlineOf(graphById("implement-v5"));
  const clean = flowLayout(defs, []);
  const at = (id: string) => clean.nodes.find((n) => n.id === id)!;
  for (const d of defs) assert.ok(at(d.id), `${d.id} not laid out`);
  assert.ok(at("END") && !clean.nodes.some((n) => n.id === "FAIL"));
  for (const id of ["implement", "check", "evaluate", "publish"]) assert.equal(at(id).lane, "main");
  assert.ok(at("implement").x < at("check").x && at("check").x < at("evaluate").x && at("evaluate").x < at("publish").x);
  assert.equal(at("fix").lane, "side");
  assert.equal(at("reflect").lane, "side");
  assert.ok(at("fix").x >= at("check").x && at("fix").x <= at("evaluate").x, "fix sits under the nodes it loops between");
  assert.ok(Math.abs(at("reflect").x - at("fix").x) >= FLOW_NODE_W, "side nodes never overlap");
  assert.deepEqual(clean.edges.map((e) => e.id), [
    "implement->check", "check->evaluate", "evaluate->publish", "publish->END",
    "evaluate->fix", "fix->check", "evaluate->reflect",
  ]);
  assert.ok(clean.edges.every((e) => !e.taken));
  assert.equal(clean.edges.find((e) => e.id === "evaluate->fix")?.route, "down");
  assert.equal(clean.edges.find((e) => e.id === "fix->check")?.route, "up");
});

test("flowLayout: a taken loop is drawn down into the side row and back up; FAIL appears once reached", () => {
  const defs = outlineOf(graphById("implement-v5"));
  const laid = flowLayout(defs, [
    T(1, "implement", "check", "2026-01-01T00:00:00Z"),
    T(2, "check", "evaluate", "2026-01-01T00:00:01Z"),
    T(3, "evaluate", "fix", "2026-01-01T00:00:02Z", "review found 1 blocker(s)"),
    T(4, "fix", "check", "2026-01-01T00:00:03Z"),
    T(5, "check", "FAIL", "2026-01-01T00:00:04Z", "check failed"),
  ]);
  const edge = (id: string) => laid.edges.find((e) => e.id === id);
  assert.equal(edge("evaluate->fix")?.route, "down");
  assert.equal(edge("evaluate->fix")?.taken?.lastReason, "review found 1 blocker(s)");
  assert.equal(edge("fix->check")?.route, "up");
  assert.equal(edge("check->FAIL")?.route, "down");
  assert.equal(edge("check->evaluate")?.taken?.count, 1);
  assert.ok(laid.nodes.some((n) => n.id === "FAIL" && n.lane === "side"));
});
