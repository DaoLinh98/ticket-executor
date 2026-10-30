// Failure classification and retry node: what Flow Runner retries unattended, and what the Workflow page suggests.
import test from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, retryNodeFor } from "../lib/dagent/retryPolicy";
import { GRAPHS } from "../lib/dagent/graph";

test("a hiccup is transient", () => {
  for (const r of [
    "API Error: 529 overloaded",
    "rate limit reached",
    "Interrupted by a server restart — retry it from a node.",
    "Harness error: read ECONNRESET",
    "Request timed out",
    "claude exited with code 1",
  ]) assert.equal(classifyFailure(r), "transient", r);
});

test("a setup problem is env, even when it looks like a network error", () => {
  for (const r of [
    "No root repo is saved for \"Proj\"",
    "fatal: not a git repository",
    "TF400813: 401 Unauthorized — the PAT expired",
    "spawn claude ENOENT",
    "Author identity unknown — set user.email",
  ]) assert.equal(classifyFailure(r), "env", r);
});

test("the work itself stopping is agent", () => {
  for (const r of ["blocked: the ticket contradicts itself", "Graph exceeded 60 transitions — it is looping.", "nothing was published", ""])
    assert.equal(classifyFailure(r), "agent", r);
});

test("a failed node is retried from the earliest entry that redoes it", () => {
  const entries = GRAPHS.implement.retryEntries;
  assert.equal(retryNodeFor("planCheck", entries), "plan");
  assert.equal(retryNodeFor("implement", entries), "implement");
  assert.equal(retryNodeFor("evaluate", entries), "syncBase");
  assert.equal(retryNodeFor("verifyPublish", entries), "syncBase");
  assert.equal(retryNodeFor("readiness", entries), null);
  assert.equal(retryNodeFor("setup", entries), null);
  assert.equal(retryNodeFor("implement", GRAPHS.qa.retryEntries), null);
});
