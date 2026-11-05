import test from "node:test";
import assert from "node:assert/strict";

import { compareRuns, FRESH_START, retryAdviceOf, runSections } from "../lib/workflow/present";
import type { Refusal, Run, Section, Step } from "../lib/workflow/types";
import { flowDefs } from "../lib/dagent/view";
import { GRAPH } from "../lib/dagent/graph";

const ENTRIES = GRAPH.retryEntries;

function step(nodeId: string, blockers?: Refusal[]): Step {
  return {
    id: `${nodeId}-${Math.random()}`,
    nodeId,
    attempt: 1,
    status: "succeeded",
    startedAt: 0,
    endedAt: 1,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    numTurns: 0,
    errorMessage: "",
    output: blockers ? { node: "evaluate", verdict: blockers.length ? "changes-required" : "pass", blockers, reviewedDelta: false, checked: [], assumptions: [], reviewNotes: [] } : null,
    logFrom: 0,
    logTo: 0,
    input: null,
  };
}

function run(p: Partial<Run> & { reason?: string }): Run {
  const { reason, ...rest } = p;
  return {
    id: "r1",
    flow: "implement",
    state: "failed",
    currentNodeId: "evaluate",
    fixAttempts: 0,
    maxFixAttempts: 5,
    costUsd: 1,
    inputTokens: 0,
    outputTokens: 0,
    startedAt: 0,
    endedAt: 1,
    costByPhase: { prepare: 0, understand: 0, build: 0, verify: 0, publish: 0 },
    failure: reason === undefined ? undefined : { reason, refusals: [], lesson: "", retryableFrom: ENTRIES },
    defs: flowDefs(GRAPH),
    steps: [],
    transitions: [],
    bundle: null,
    ...rest,
  };
}

const retryOf = (r: Run) => runSections(r, [], 1).find((s): s is Extract<Section, { kind: "retry" }> => s.kind === "retry")!;

test("retry advice: a failure past plan preselects retryNodeFor() and marks it suggested", () => {
  const r = run({ reason: "rate limit reached (429)", currentNodeId: "evaluate" });
  const a = retryAdviceOf(r)!;
  assert.equal(a.cls, "transient");
  assert.equal(a.suggestedId, "syncBase");
  assert.equal(a.defaultId, "syncBase");
  assert.match(a.text, /likely passes on retry/i);
  const sec = retryOf(r);
  assert.equal(sec.defaultId, "syncBase");
  assert.equal(sec.suggestedId, "syncBase");
});

test("retry advice: an env failure says to fix the setup first", () => {
  const a = retryAdviceOf(run({ reason: "Root repo is not a git repository", currentNodeId: "implement" }))!;
  assert.equal(a.cls, "env");
  assert.equal(a.suggestedId, "implement");
  assert.match(a.text, /fix the setup first/i);
});

test("retry advice: a failure before plan suggests a fresh start, offered as an option on implement runs", () => {
  const r = run({ reason: "The agent was blocked", currentNodeId: "readiness" });
  const a = retryAdviceOf(r)!;
  assert.equal(a.cls, "agent");
  assert.equal(a.suggestedId, null);
  assert.equal(a.defaultId, FRESH_START);
  assert.match(a.text, /fresh start is suggested/);
  assert.ok(retryOf(r).options.some((o) => o.id === FRESH_START && o.enabled));
  assert.equal(retryAdviceOf(run({ state: "succeeded" })), null);
});

test("retry advice: a non-implement run is never offered a fresh start", () => {
  const r = run({ reason: "blocked", currentNodeId: "readiness", flow: "fix-review" });
  assert.notEqual(retryAdviceOf(r)!.defaultId, FRESH_START);
  assert.ok(!retryOf(r).options.some((o) => o.id === FRESH_START));
});

test("compareRuns: end states, plan, blockers by text and the cost delta", () => {
  const b = (issue: string, file?: string): Refusal => ({ source: "evaluate", issue, file });
  const prev = run({ reason: "Review blockers left after every fix", costUsd: 2, steps: [step("evaluate", [b("Missing test"), b("Null check  missing", "a.ts")])] });
  const cur = run({ state: "succeeded", costUsd: 1.5, steps: [step("evaluate", [b("null check missing", "a.ts"), b("Wrong label")])], transitions: [{ seq: 1, fromNode: "verifyPublish", toNode: "END", reason: "verified", at: 1 }] });
  const d = compareRuns({ run: prev, planMd: "# Plan\nA" }, { run: cur, planMd: "# Plan\nB" });
  assert.equal(d.prev.tone, "danger");
  assert.equal(d.prev.reason, "Review blockers left after every fix");
  assert.equal(d.cur.reason, "verified");
  assert.equal(d.plan, "changed");
  assert.deepEqual(d.blockers, { resolved: ["Missing test"], standing: ["a.ts: null check missing"], added: ["Wrong label"], pending: false });
  assert.equal(d.delta, "−$0.50");
});

test("compareRuns: same plan, and a retry not yet reviewed", () => {
  const prev = run({ reason: "x", steps: [step("evaluate", [{ source: "evaluate", issue: "A" }])] });
  const cur = run({ state: "running", costUsd: 1.25 });
  const d = compareRuns({ run: prev, planMd: "plan\n" }, { run: cur, planMd: "plan" });
  assert.equal(d.plan, "same");
  assert.deepEqual(d.blockers, { resolved: [], standing: [], added: [], pending: true });
  assert.equal(d.delta, "+$0.25");
  assert.equal(compareRuns({ run: run({}), planMd: "" }, { run: run({}), planMd: "" }).blockers, null);
});
