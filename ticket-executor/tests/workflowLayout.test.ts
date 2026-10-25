import test from "node:test";
import assert from "node:assert/strict";

import { layoutRun } from "../lib/workflow/layout";
import type { Effects, FlowNodeDef, NodeKind } from "../lib/workflow/types";
import { GRAPHS } from "../lib/dagent/graph";
import { flowDefs } from "../lib/dagent/view";

const D = (id: string, label: string, phase: string, kind: NodeKind, effects: Effects, context: "" | "fresh" | "resume", next: string[], maxVisits?: number): FlowNodeDef => ({
  id,
  label,
  phase,
  kind,
  effects,
  context,
  next,
  maxVisits,
});

// A fixed shape for the layout rules, independent of how the live graphs evolve.
const DEFAULT_DEFS: FlowNodeDef[] = [
  D("preflight", "Preflight", "pre-run", "gate", "pure", "", ["admission"]),
  D("admission", "Admission", "pre-run", "gate", "pure", "", ["setup"]),
  D("setup", "Prepare workspace", "prepare", "harness", "local", "", ["readiness"]),
  D("readiness", "Ticket readiness", "understand", "agent", "pure", "fresh", ["plan", "NEEDS_INPUT"]),
  D("plan", "Plan the change", "understand", "agent", "local", "fresh", ["planCheck"], 2),
  D("planCheck", "Plan check", "understand", "check", "pure", "", ["implement", "plan"]),
  D("implement", "Implement", "build", "agent", "local", "fresh", ["syncBase"]),
  D("syncBase", "Sync with base", "build", "check", "local", "", ["testGate", "fix"]),
  D("testGate", "Test gate", "verify", "check", "pure", "", ["diffGuard", "fix"]),
  D("diffGuard", "Diff guard", "verify", "check", "pure", "", ["evaluate", "fix"]),
  D("evaluate", "Independent review", "verify", "agent", "pure", "fresh", ["prePublish", "fix"]),
  D("fix", "Fix refusals", "verify", "agent", "local", "resume", ["syncBase", "reflect"], 5),
  D("reflect", "Record lesson", "verify", "agent", "local", "fresh", ["FAIL"]),
  D("prePublish", "Pre-publish check", "publish", "check", "pure", "", ["publish", "syncBase"]),
  D("publish", "Push & open draft PR", "publish", "harness", "external", "", ["verifyPublish"], 1),
  D("verifyPublish", "Verify PR", "publish", "check", "pure", "", ["END", "NEEDS_REVIEW"]),
];

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

test("exits to the same terminal share one rail", () => {
  const defs = DEFAULT_DEFS.map((d) => (d.id === "implement" ? { ...d, next: [...d.next, "NEEDS_INPUT"] } : d));
  const lay = layoutRun(defs, "LR");
  // The rail is the path's third point: M stub, L…Q… into the rail, then along it.
  const railY = (key: string) => lay.edges.find((e) => e.key === key)!.d.match(/Q\S+ (-?[\d.]+) /)![1];
  assert.equal(railY("readiness>NEEDS_INPUT"), railY("implement>NEEDS_INPUT"));
  assert.notEqual(railY("readiness>NEEDS_INPUT"), railY("verifyPublish>NEEDS_REVIEW"));
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

test("every D-Agent graph lays out with every node and its entry on the canvas", () => {
  for (const g of Object.values(GRAPHS)) {
    const lay = layoutRun(flowDefs(g), "LR");
    const ids = new Set(lay.nodes.map((n) => n.id));
    for (const id of Object.keys(g.nodes)) assert.ok(ids.has(id), `${g.id}:${id}`);
    assert.ok(lay.edges.some((e) => e.key === `admission>${g.entry}`), `${g.id}:entry`);
  }
});
