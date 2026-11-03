import { test } from "node:test";
import assert from "node:assert/strict";
import { turnFor } from "../lib/dagent/stepModels";

const run = { model: "sonnet", effort: "medium" };

test("each step gets its own model, ignoring the run's", () => {
  assert.deepEqual(turnFor("readiness", {}, run), { model: "opus", effort: "medium" });
  assert.deepEqual(turnFor("plan", {}, run), { model: "opus", effort: "high" });
  assert.deepEqual(turnFor("implement", {}, run), { model: "sonnet", effort: "medium" });
  assert.deepEqual(turnFor("evaluate", {}, run), { model: "opus", effort: "high" });
  assert.deepEqual(turnFor("reflect", {}, run), { model: "sonnet", effort: "medium" });
  assert.deepEqual(turnFor("publish", {}, run), { model: "haiku", effort: "low" });
});

test("fix runs on Sonnet for two attempts, then escalates to Opus", () => {
  assert.equal(turnFor("fix", { fix: 1 }, run).model, "sonnet");
  assert.equal(turnFor("fix", { fix: 2 }, run).model, "sonnet");
  assert.equal(turnFor("fix", { fix: 3 }, run).model, "opus");
  assert.equal(turnFor("fix", { fix: 5 }, run).model, "opus");
});

test("a step without an entry keeps the run's model and effort", () => {
  assert.deepEqual(turnFor("unknown", {}, { model: "opus", effort: "high" }), { model: "opus", effort: "high" });
});
