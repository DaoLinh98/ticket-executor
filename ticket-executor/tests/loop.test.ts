import test from "node:test";
import assert from "node:assert/strict";

import { knowledgeChange } from "../lib/execution/graph/knowledge";
import { reviewEscapes, type LoopRun } from "../lib/execution/loopMetrics";

// ---- knowledgeChange ----

test("knowledgeChange: an untouched file is no change", () => {
  assert.equal(knowledgeChange("K.md", "## a\n- x\n", "## a\n- x\n"), null);
});

test("knowledgeChange: a created file reports every non-blank line as added", () => {
  assert.deepEqual(knowledgeChange("K.md", "", "## Build\n\n- run npm ci first\n"), {
    file: "K.md", added: ["## Build", "- run npm ci first"], removed: [], lines: 2,
  });
});

test("knowledgeChange: a refined entry shows as one removed and one added line, the rest untouched", () => {
  const before = "## Tests\n- use vitest\n- mock the clock\n";
  const after = "## Tests\n- use vitest\n- mock the clock with fake timers\n";
  assert.deepEqual(knowledgeChange("K.md", before, after), {
    file: "K.md", added: ["- mock the clock with fake timers"], removed: ["- mock the clock"], lines: 3,
  });
});

test("knowledgeChange: line endings and trailing spaces are not a change in content", () => {
  const c = knowledgeChange("K.md", "## a\n- x\n", "## a  \r\n- x\r\n");
  assert.deepEqual(c && { added: c.added, removed: c.removed }, { added: [], removed: [] });
});

test("knowledgeChange: a duplicated line counts once per copy", () => {
  const c = knowledgeChange("K.md", "## a\n- x\n", "## a\n- x\n- x\n");
  assert.deepEqual(c?.added, ["- x"]);
  assert.deepEqual(c?.removed, []);
});

// ---- reviewEscapes ----

const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
const run = (o: Partial<LoopRun>): LoopRun => ({
  id: "r", ticketId: "1", skill: "implement-ticket-v4", state: "succeeded", startedAt: at(0), endedAt: at(1), ...o,
});

test("reviewEscapes: a reviewed, shipped run with no later rework is a pass that held", () => {
  assert.deepEqual(reviewEscapes([run({ id: "a" })], new Set(["a"])), { passed: 1, escaped: 0 });
});

test("reviewEscapes: a later review-fix or QA-fix on the same ticket is an escape", () => {
  for (const skill of ["fix-code-review-v4", "fix-qa-v4"]) {
    const runs = [run({ id: "a" }), run({ id: "b", skill, startedAt: at(5), endedAt: at(6) })];
    assert.deepEqual(reviewEscapes(runs, new Set(["a"])), { passed: 1, escaped: 1 }, skill);
  }
});

test("reviewEscapes: rework on another ticket, or before the run ended, does not count", () => {
  const runs = [
    run({ id: "a" }),
    run({ id: "b", ticketId: "2", skill: "fix-qa-v4", startedAt: at(5) }),
    run({ id: "c", skill: "fix-code-review-v4", startedAt: at(0) }),
  ];
  assert.deepEqual(reviewEscapes(runs, new Set(["a"])), { passed: 1, escaped: 0 });
});

test("reviewEscapes: only implement runs the reviewer saw and that succeeded are measured", () => {
  const runs = [
    run({ id: "a" }),
    run({ id: "b", state: "failed" }),
    run({ id: "c", skill: "fix-qa-v4" }),
  ];
  assert.deepEqual(reviewEscapes(runs, new Set(["b", "c"])), { passed: 0, escaped: 0 });
});
