import test from "node:test";
import assert from "node:assert/strict";

import { layoutRun } from "../lib/workflow/layout";
import { DEFAULT_DEFS, buildScenarios } from "../lib/workflow/mock";

const NOW = Date.parse("2026-10-23T02:42:00Z");

test("layout is deterministic", () => {
  assert.deepEqual(layoutRun(DEFAULT_DEFS, "LR"), layoutRun(DEFAULT_DEFS, "LR"));
});

test("happy path sits on row 0 and fix drops to row 1", () => {
  const lay = layoutRun(DEFAULT_DEFS, "LR");
  const row = (id: string) => lay.nodes.find((n) => n.id === id)!.row;
  assert.equal(row("implement"), 0);
  assert.equal(row("evaluate"), 0);
  assert.equal(row("fix"), 1);
  assert.equal(row("reflect"), 1);
});

test("terminals are laid out and routed around the lanes", () => {
  const lay = layoutRun(DEFAULT_DEFS, "LR");
  const ids = lay.nodes.filter((n) => n.kind === "terminal").map((n) => n.id);
  assert.deepEqual(ids, ["END", "NEEDS_REVIEW", "NEEDS_INPUT", "FAIL"]);
  assert.equal(lay.edges.find((e) => e.key === "readiness>NEEDS_INPUT")!.cls, "park");
  assert.equal(lay.edges.find((e) => e.key === "syncBase>fix")!.cls, "down");
});

test("a retry edge back to an earlier node is a loop", () => {
  const lay = layoutRun(DEFAULT_DEFS, "LR");
  assert.equal(lay.edges.find((e) => e.key === "fix>syncBase")!.cls, "loop");
});

test("vertical layout keeps every node inside its bounds", () => {
  const lay = layoutRun(DEFAULT_DEFS, "TB");
  const { x, y, w, h } = lay.bounds;
  for (const n of lay.nodes) {
    assert.ok(n.x >= x && n.x + n.w <= x + w, n.id);
    assert.ok(n.y >= y && n.y + n.h <= y + h, n.id);
  }
});

test("an implicit traversed edge is drawn once", () => {
  const lay = layoutRun(DEFAULT_DEFS, "LR", [["evaluate", "reflect"]]);
  const e = lay.edges.filter((x) => x.key === "evaluate>reflect");
  assert.equal(e.length, 1);
  assert.equal(e[0].implicit, true);
});

test("every scenario run lays out and its steps stay on known nodes", () => {
  const scenarios = buildScenarios(NOW);
  for (const sc of Object.values(scenarios)) {
    for (const make of Object.values(sc.runs)) {
      const run = make();
      const lay = layoutRun(run.defs, "LR", run.transitions.map((t): [string, string] => [t.fromNode, t.toNode]));
      const ids = new Set(lay.nodes.map((n) => n.id));
      for (const s of run.steps) assert.ok(ids.has(s.nodeId), `${sc.key}:${s.nodeId}`);
      assert.ok(ids.has(run.currentNodeId), `${sc.key}:current`);
    }
  }
});
