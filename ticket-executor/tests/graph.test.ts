// The routing table of every graph, asserted without spawning the Claude CLI.
//
// This is the payoff of edges being pure, synchronous functions of
// (RunContext, NodeResult): the entire decision surface of the engine — what
// ships, what is blocked, what loops back to a human — is checkable in about a
// second, for zero tokens. Before the graph runtime this logic lived inside an
// async IIFE and could not be tested at all.
//
// Two things are asserted here, and they are the two architecture laws that a
// well-meaning change is most likely to break:
//   1. edges route only on the validated structured output;
//   2. an `external` node is a leaf — it never routes back into the graph.
import test from "node:test";
import assert from "node:assert/strict";

import { admissionDenial, type AdmissionFacts } from "../lib/execution/admission";
import { graphById, graphForSkill, resolveSkill } from "../lib/execution/graph/graphs";
import { END, FAIL, type Graph, type NodeResult, type RunContext } from "../lib/execution/graph/types";

// ---- fixtures ----

const CTX: RunContext = {
  runId: "run_test",
  ticketId: "1234",
  ticketUrl: "https://example.invalid/1234",
  provider: "azure-devops",
  project: "Demo",
  prUrl: "",
  skill: "implement-ticket-v3",
  rootRepo: "C:/repo",
  cwd: "C:/repo",
  baseSha: "abc123",
  channels: {},
  visits: {},
};

const CLEAN_VERIFICATION = { tests: "passed", build: "passed", acceptanceCriteria: "met" };
const NOT_BLOCKED = { is: false, reason: "" };

function result(data: Record<string, unknown>, ok = true, error = ""): NodeResult {
  return {
    ok,
    data,
    error,
    usage: {
      costUsd: 0, inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheCreationTokens: 0, numTurns: 0, durationMs: 0,
    },
  };
}

function route(graph: Graph, nodeId: string, r: NodeResult) {
  const edge = graph.edges[nodeId];
  assert.ok(edge, `graph ${graph.id} has no edge out of "${nodeId}"`);
  return edge(CTX, r);
}

const v3 = graphForSkill("implement-ticket-v3");
const reviewV3 = graphForSkill("fix-code-review-v3");
const v2 = graphForSkill("implement-ticket-v2");
const reviewV2 = graphForSkill("fix-code-review-v2");
// The same graphs with the independent reviewer switched on.
const v3e = graphForSkill("implement-ticket-v3", { evaluate: true });
const reviewV3e = graphForSkill("fix-code-review-v3", { evaluate: true });

/** A RunContext with a given number of prior visits to a node — the cycle
 *  accounting a bounded loop's edge reads. */
function ctxWithVisits(visits: Record<string, number>): RunContext {
  return { ...CTX, visits };
}

// ---- the plan phase ----

test("plan: a finished turn goes on to the plan check", () => {
  const r = result({ planWritten: true, summary: "s", assumptions: [], blocked: NOT_BLOCKED });
  assert.equal(route(v3, "plan", r).to, "planCheck");
});

test("plan: a failed turn fails the run", () => {
  const r = result({}, false, "claude exited with code 1");
  const next = route(v3, "plan", r);
  assert.equal(next.to, FAIL);
  assert.match(next.reason, /exited with code 1/);
});

test("plan: a declared blocker fails the run and keeps the agent's reason", () => {
  const r = result({ planWritten: false, summary: "", assumptions: [], blocked: { is: true, reason: "no credentials" } });
  const next = route(v3, "plan", r);
  assert.equal(next.to, FAIL);
  assert.match(next.reason, /no credentials/);
});

test("plan: an agent that reports planWritten=false fails without paying planCheck", () => {
  const r = result({ planWritten: false, summary: "s", assumptions: [], blocked: NOT_BLOCKED });
  for (const graph of [v3, reviewV3]) {
    const next = route(graph, "plan", r);
    assert.equal(next.to, FAIL);
    assert.match(next.reason, /no plan was written/);
  }
});

test("plan: planWritten=true still goes through planCheck — the claim is not the proof", () => {
  const r = result({ planWritten: true, summary: "s", assumptions: [], blocked: NOT_BLOCKED });
  assert.equal(route(v3, "plan", r).to, "planCheck");
});

test("replan routes exactly like plan — one edge serves both", () => {
  const r = result({ planWritten: true, summary: "s", assumptions: [], blocked: NOT_BLOCKED });
  assert.equal(route(v3, "replan", r).to, "planCheck");
});

test("planCheck: a written plan reaches the human gate", () => {
  assert.equal(route(v3, "planCheck", result({ planLength: 120 })).to, "review");
});

test("planCheck: no plan on disk fails rather than parking on an empty gate", () => {
  const next = route(v3, "planCheck", result({ planLength: 0 }, false, "nothing to review"));
  assert.equal(next.to, FAIL);
});

// ---- the human gate ----
// The reviewer's decision arrives as this node's own NodeResult, so it routes
// through the same edge machinery as any agent output.

test("gate: approve → implement", () => {
  assert.equal(route(v3, "review", result({ action: "approve" })).to, "implement");
});

test("gate: revise → replan (the one cycle in this graph)", () => {
  assert.equal(route(v3, "review", result({ action: "revise" })).to, "replan");
});

test("gate: cancel → FAIL", () => {
  assert.equal(route(v3, "review", result({ action: "cancel" }, false)).to, FAIL);
});

test("gate: an unrecognised action is rejected, not treated as approval", () => {
  assert.equal(route(v3, "review", result({ action: "" })).to, FAIL);
});

// ---- the verification gate: the one place unverified code is stopped ----

test("implement: committed and verified → publish", () => {
  const r = result({ committed: true, branch: "feature/1234", summary: "s", verification: CLEAN_VERIFICATION, deviations: [], blocked: NOT_BLOCKED });
  assert.equal(route(v3, "implement", r).to, "publish");
});

test("implement: failing tests stop the run BEFORE anything is pushed", () => {
  const r = result({ committed: true, branch: "b", summary: "s", verification: { ...CLEAN_VERIFICATION, tests: "failed" }, deviations: [], blocked: NOT_BLOCKED });
  const next = route(v3, "implement", r);
  assert.equal(next.to, FAIL);
  assert.equal(next.reason, "verification.tests=failed");
});

test("implement: a failing build stops the run too", () => {
  const r = result({ committed: true, branch: "b", summary: "s", verification: { ...CLEAN_VERIFICATION, build: "failed" }, deviations: [], blocked: NOT_BLOCKED });
  assert.equal(route(v3, "implement", r).reason, "verification.build=failed");
});

test("implement: tests that were never run are NOT a failure — plenty of repos have none", () => {
  const r = result({ committed: true, branch: "b", summary: "s", verification: { tests: "not-run", build: "not-run", acceptanceCriteria: "cannot-verify" }, deviations: [], blocked: NOT_BLOCKED });
  assert.equal(route(v3, "implement", r).to, "publish");
});

// The dashboard's `blockedOnVerification` counts Transition rows whose reason
// starts with "verification.". That makes this prefix a contract between the
// edge and the metric, not cosmetic text — so it is asserted here rather than
// left to be discovered when the tile silently reads zero.
test("implement: a verification FAIL reason carries the prefix the dashboard counts on", () => {
  for (const field of ["tests", "build"] as const) {
    const r = result({
      committed: true, branch: "b", summary: "s",
      verification: { ...CLEAN_VERIFICATION, [field]: "failed" },
      deviations: [], blocked: NOT_BLOCKED,
    });
    for (const graph of [v3, reviewV3]) {
      const next = route(graph, "implement", r);
      assert.equal(next.to, FAIL);
      assert.ok(
        next.reason.startsWith("verification."),
        `${graph.id}: reason "${next.reason}" no longer matches the prefix dashboardMetrics() counts`
      );
    }
  }
});

test("implement: a non-verification failure must NOT borrow that prefix", () => {
  const r = result({ committed: false, branch: "", summary: "s", verification: CLEAN_VERIFICATION, deviations: [], blocked: NOT_BLOCKED });
  assert.ok(!route(v3, "implement", r).reason.startsWith("verification."));
});

test("implement: nothing committed → FAIL (there is nothing to publish)", () => {
  const r = result({ committed: false, branch: "", summary: "s", verification: CLEAN_VERIFICATION, deviations: [], blocked: NOT_BLOCKED });
  const next = route(v3, "implement", r);
  assert.equal(next.to, FAIL);
  assert.match(next.reason, /nothing was committed/);
});

// ---- publish: the external leaf ----

test("publish: a pushed branch ends the run", () => {
  const r = result({ pushed: true, prUrl: "https://example.invalid/pr/1", linked: true, reusedExisting: false, blocked: NOT_BLOCKED });
  assert.equal(route(v3, "publish", r).to, END);
});

test("publish: reusing an existing PR is success, and the transition says so", () => {
  const r = result({ pushed: true, prUrl: "https://example.invalid/pr/1", linked: true, reusedExisting: true, blocked: NOT_BLOCKED });
  const next = route(v3, "publish", r);
  assert.equal(next.to, END);
  assert.match(next.reason, /reused/);
});

test("publish: not pushed → FAIL", () => {
  const r = result({ pushed: false, prUrl: "", linked: false, reusedExisting: false, blocked: NOT_BLOCKED });
  assert.equal(route(v3, "publish", r).to, FAIL);
});

test("fix-code-review-v3 publish reports threads and ends the run", () => {
  const r = result({ pushed: true, prUrl: "https://example.invalid/pr/9", threadsReplied: 3, threadsResolved: 3, blocked: NOT_BLOCKED });
  assert.equal(route(reviewV3, "publish", r).to, END);
});

// ---- the one-shot graphs ----

test("v2 deliver: pushed → END", () => {
  const r = result({ committed: true, branch: "b", summary: "s", verification: CLEAN_VERIFICATION, pushed: true, prUrl: "u", linked: true, blocked: NOT_BLOCKED });
  assert.equal(route(v2, "deliver", r).to, END);
});

test("v2 deliver: not pushed → FAIL", () => {
  const r = result({ committed: true, branch: "b", summary: "s", verification: CLEAN_VERIFICATION, pushed: false, prUrl: "", linked: false, blocked: NOT_BLOCKED });
  assert.equal(route(v2, "deliver", r).to, FAIL);
});

// The one-shot flow cannot stop a push it already made. What it must not do is
// call the run a success anyway — that is what made `verification` decorative in
// auto mode.
test("v2 deliver: a reported test failure fails the run even though the PR exists", () => {
  const r = result({
    committed: true, branch: "b", summary: "s",
    verification: { ...CLEAN_VERIFICATION, tests: "failed" },
    pushed: true, prUrl: "u", linked: true, blocked: NOT_BLOCKED,
  });
  for (const graph of [v2, reviewV2]) {
    const next = route(graph, "deliver", r);
    assert.equal(next.to, FAIL, `${graph.id} still reported success over a failed test`);
    assert.match(next.reason, /verification\.tests=failed/);
    // Must NOT be counted as "stopped before publishing" — it wasn't.
    assert.ok(
      !next.reason.startsWith("verification."),
      "a shipped-then-failed run must not match the blockedOnVerification prefix"
    );
  }
});

test("v2 deliver: a clean verification still ends the run successfully", () => {
  const r = result({ committed: true, branch: "b", summary: "s", verification: CLEAN_VERIFICATION, pushed: true, prUrl: "u", linked: true, blocked: NOT_BLOCKED });
  assert.equal(route(v2, "deliver", r).to, END);
});

test("v2 deliver: not-run verification is still a success — it is not a failure", () => {
  const r = result({ committed: true, branch: "b", summary: "s", verification: { tests: "not-run", build: "not-run", acceptanceCriteria: "cannot-verify" }, pushed: true, prUrl: "u", linked: true, blocked: NOT_BLOCKED });
  assert.equal(route(v2, "deliver", r).to, END);
});

test("v2 deliver: a declared blocker fails the run", () => {
  const r = result({ committed: false, branch: "", summary: "", verification: CLEAN_VERIFICATION, pushed: false, prUrl: "", linked: false, blocked: { is: true, reason: "repo absent" } });
  assert.match(route(reviewV2, "deliver", r).reason, /repo absent/);
});

// ---- the independent reviewer (opt-in) and its bounded fix loop ----

const IMPLEMENTED = {
  committed: true, branch: "b", summary: "s",
  verification: CLEAN_VERIFICATION, deviations: [], blocked: NOT_BLOCKED,
};

test("evaluator off: the graph keeps its original shape and implement goes straight to publish", () => {
  assert.equal(v3.id, "implement-v3");
  assert.ok(!v3.nodes.evaluate, "evaluate must not exist when the setting is off");
  assert.ok(!v3.nodes.fix);
  assert.equal(route(v3, "implement", result(IMPLEMENTED)).to, "publish");
});

test("evaluator on: the graph gets its own id, so a parked run resumes on the shape it started on", () => {
  assert.equal(v3e.id, "implement-v3-eval");
  assert.equal(reviewV3e.id, "fix-review-v3-eval");
  assert.equal(graphById("implement-v3-eval", "implement-ticket-v3").id, "implement-v3-eval");
  // Flipping the setting must not retarget a run already walking the other shape.
  assert.equal(graphById("implement-v3", "implement-ticket-v3").id, "implement-v3");
});

test("evaluator on: implement routes to the reviewer, not to publish", () => {
  for (const graph of [v3e, reviewV3e]) {
    assert.equal(route(graph, "implement", result(IMPLEMENTED)).to, "evaluate");
  }
});

test("evaluator on: the verification gate still fires before the reviewer is paid for", () => {
  const r = result({ ...IMPLEMENTED, verification: { ...CLEAN_VERIFICATION, tests: "failed" } });
  assert.equal(route(v3e, "implement", r).to, FAIL);
});

test("evaluate: a pass releases the run to publish", () => {
  const r = result({ verdict: "pass", blockers: [], blocked: NOT_BLOCKED });
  assert.equal(route(v3e, "evaluate", r).to, "publish");
});

test("evaluate: blocking findings send the run to fix, not to publish", () => {
  const r = result({ verdict: "changes-required", blockers: [{ file: "a.ts:10", issue: "off-by-one" }], blocked: NOT_BLOCKED });
  const next = v3e.edges.evaluate(ctxWithVisits({}), r);
  assert.equal(next.to, "fix");
  assert.match(next.reason, /1 blocker/);
});

test("evaluate: the fix loop is bounded — after MAX_FIX_ATTEMPTS it fails instead of publishing", () => {
  const r = result({ verdict: "changes-required", blockers: [{ file: "a.ts", issue: "still wrong" }], blocked: NOT_BLOCKED });
  // One fix already attempted: still allowed to try again.
  assert.equal(v3e.edges.evaluate(ctxWithVisits({ fix: 1 }), r).to, "fix");
  // Two attempted: the reviewer is still refusing, so a human is needed. It must
  // NOT fall through to publish — publishing over a standing objection would make
  // the whole review decorative.
  const capped = v3e.edges.evaluate(ctxWithVisits({ fix: 2 }), r);
  assert.equal(capped.to, FAIL);
  assert.match(capped.reason, /still blocking after 2 fix attempt/);
});

test("fix: a committed fix goes back to the reviewer, never straight to publish", () => {
  assert.equal(route(v3e, "fix", result(IMPLEMENTED)).to, "evaluate");
});

test("fix: a fix that breaks the tests fails the run", () => {
  const r = result({ ...IMPLEMENTED, verification: { ...CLEAN_VERIFICATION, tests: "failed" } });
  assert.equal(route(v3e, "fix", r).to, FAIL);
});

test("fix: a fix that commits nothing fails rather than looping", () => {
  const r = result({ ...IMPLEMENTED, committed: false });
  const next = route(v3e, "fix", r);
  assert.equal(next.to, FAIL);
  assert.match(next.reason, /committed nothing/);
});

test("the reviewer judges with a FRESH context — anything else is marking its own homework", () => {
  for (const graph of [v3e, reviewV3e]) {
    const evaluate = graph.nodes.evaluate;
    assert.equal(evaluate.kind, "agent");
    assert.equal(evaluate.effects, "pure", "a reviewer must not write anything");
    assert.equal(
      evaluate.kind === "agent" ? evaluate.context : "",
      "fresh",
      `${graph.id}: the evaluate node resumed the implementer's session — it would inherit the very conclusions it is meant to check`
    );
    // The node it reviews is the one that produced the work, and that one resumes.
    const impl = graph.nodes.implement;
    assert.equal(impl.kind === "agent" ? impl.context : "", "resume");
  }
});

// ---- the invariant everything else rests on ----

// Probes spanning every field any contract in the engine declares, so an edge
// cannot dodge the check by reading something the probes omit.
const PROBES: NodeResult[] = [
  result({ pushed: true, prUrl: "u", linked: true, reusedExisting: false, committed: true, branch: "b", summary: "s", verification: CLEAN_VERIFICATION, deviations: [], threadsReplied: 1, threadsResolved: 1, blocked: NOT_BLOCKED }),
  result({ pushed: true, prUrl: "u", linked: true, reusedExisting: true, committed: true, branch: "b", summary: "s", verification: CLEAN_VERIFICATION, deviations: [], threadsReplied: 0, threadsResolved: 0, blocked: NOT_BLOCKED }),
  result({ pushed: false, prUrl: "", linked: false, reusedExisting: false, committed: false, branch: "", summary: "", verification: { tests: "failed", build: "failed", acceptanceCriteria: "cannot-verify" }, deviations: [], threadsReplied: 0, threadsResolved: 0, blocked: NOT_BLOCKED }),
  result({ blocked: { is: true, reason: "hard blocker" } }),
  result({}, false, "turn failed"),
];

for (const graph of [v3, reviewV3, v2, reviewV2, v3e, reviewV3e]) {
  test(`invariant: every "external" node in ${graph.id} is a leaf`, () => {
    const external = Object.values(graph.nodes).filter((n) => n.effects === "external");
    assert.ok(external.length > 0, `${graph.id} declares no external node — did the effect classes drift?`);
    for (const node of external) {
      for (const probe of PROBES) {
        const next = route(graph, node.id, probe);
        assert.ok(
          next.to === END || next.to === FAIL,
          `${graph.id}: external node "${node.id}" routed back into the graph (→ ${next.to}). ` +
            `Anything that has left this machine must never be re-entered: a retry becomes a duplicate push or a second PR.`
        );
      }
    }
  });

  test(`invariant: every node in ${graph.id} has an edge, and every agent node a contract`, () => {
    for (const node of Object.values(graph.nodes)) {
      if (node.kind === "gate") continue; // drive() parks here; the edge is exercised by resolveGate
      assert.ok(graph.edges[node.id], `${graph.id}: node "${node.id}" has no outgoing edge`);
    }
    for (const node of Object.values(graph.nodes)) {
      if (node.kind !== "agent") continue;
      assert.ok(
        node.output && Object.keys(node.output).length > 0,
        `${graph.id}: agent node "${node.id}" declares no JSON Schema — its edges would have nothing to branch on but the exit code`
      );
    }
  });
}

test("graphById resolves a persisted run back onto the shape it started on", () => {
  assert.equal(graphById("implement-v3", "anything").id, "implement-v3");
  assert.equal(graphById("fix-review-v2", "anything").id, "fix-review-v2");
  // Unknown id falls back to the skill, which is what a pre-graphId row has.
  assert.equal(graphById("", "fix-code-review-v3").id, "fix-review-v3");
});

// ---- admission: the server, not the client, decides the run's shape ----

const AUTO = { autoImplement: true, autoResolveCodeReview: true };
const PLAN = { autoImplement: false, autoResolveCodeReview: false };

test("resolveSkill: an unknown skill is rejected instead of silently one-shotting", () => {
  assert.equal(resolveSkill("implement-ticket-v9", false, AUTO), null);
  assert.equal(resolveSkill("", false, AUTO), null);
});

test("resolveSkill: auto mode collapses either implement skill to the one-shot flow", () => {
  assert.equal(resolveSkill("implement-ticket-v3", false, AUTO), "implement-ticket-v2");
  assert.equal(resolveSkill("implement-ticket-v2", false, AUTO), "implement-ticket-v2");
});

test("resolveSkill: plan mode forces the gated flow even when the client asked for v2", () => {
  assert.equal(resolveSkill("implement-ticket-v2", false, PLAN), "implement-ticket-v3");
  assert.equal(resolveSkill("fix-code-review-v2", false, PLAN), "fix-code-review-v3");
});

test("resolveSkill: the two families are independent", () => {
  const mixed = { autoImplement: true, autoResolveCodeReview: false };
  assert.equal(resolveSkill("implement-ticket-v3", false, mixed), "implement-ticket-v2");
  assert.equal(resolveSkill("fix-code-review-v2", false, mixed), "fix-code-review-v3");
});

test("resolveSkill: the family the caller asked for is never changed", () => {
  for (const modes of [AUTO, PLAN]) {
    for (const skill of ["implement-ticket-v2", "implement-ticket-v3"]) {
      assert.match(resolveSkill(skill, false, modes)!, /^implement-ticket-/);
    }
    for (const skill of ["fix-code-review-v2", "fix-code-review-v3"]) {
      assert.match(resolveSkill(skill, false, modes)!, /^fix-code-review-/);
    }
  }
});

test("resolveSkill: a hand-picked skill on the ticket is honoured verbatim", () => {
  assert.equal(resolveSkill("implement-ticket-v3", true, AUTO), "implement-ticket-v3");
  assert.equal(resolveSkill("fix-code-review-v2", true, PLAN), "fix-code-review-v2");
});

// ---- admission: how many runs may be in flight ----
// The SQL that gathers these facts runs inside the advisory-locked transaction;
// the rule is pure, so it is asserted here without a database.

const FREE: AdmissionFacts = {
  ticketId: "1234",
  duplicate: false,
  otherTicketId: "",
  runningOthers: 0,
  isolate: true,
  cap: 2,
};

test("admission: nothing in flight → the run starts", () => {
  assert.equal(admissionDenial(FREE), null);
});

test("admission: one active run per ticket, in BOTH modes", () => {
  for (const isolate of [true, false]) {
    const d = admissionDenial({ ...FREE, isolate, duplicate: true });
    assert.equal(d?.status, 409);
    assert.equal(d?.blocked, "duplicate-ticket");
  }
});

test("admission: single-ticket mode refuses while another ticket holds the slot", () => {
  const d = admissionDenial({ ...FREE, isolate: false, otherTicketId: "9999", runningOthers: 1 });
  assert.equal(d?.blocked, "single-ticket-mode");
  assert.match(d!.message, /#9999/);
});

test("admission: multi-ticket mode allows another ticket to run alongside", () => {
  assert.equal(admissionDenial({ ...FREE, otherTicketId: "9999", runningOthers: 1 }), null);
});

test("admission: the concurrency cap is enforced server-side, not only by the client", () => {
  // At the cap: refused. This is the guard that used to exist only in the Ticket
  // Execution screen's state, where two tabs could bypass it entirely.
  const d = admissionDenial({ ...FREE, runningOthers: 2, cap: 2 });
  assert.equal(d?.status, 409);
  assert.equal(d?.blocked, "concurrency-cap");
  assert.match(d!.message, /limit is 2/);
  // Below the cap: allowed.
  assert.equal(admissionDenial({ ...FREE, runningOthers: 1, cap: 2 }), null);
  // Over the cap (the limit was lowered while runs were in flight): still refused.
  assert.equal(admissionDenial({ ...FREE, runningOthers: 5, cap: 2 })?.blocked, "concurrency-cap");
});

test("admission: a run parked at a gate does NOT consume a concurrency slot", () => {
  // The cap bounds machine load, and a parked run holds no child process and
  // spends nothing. Counting it would let two unanswered plan reviews block every
  // other ticket — and it would disagree with the client, which releases its batch
  // slot the moment a run parks. `runningOthers` is therefore counted from
  // state="running" only, while duplicate-ticket and single-ticket still count
  // parked runs because those own a worktree and a branch.
  assert.equal(admissionDenial({ ...FREE, runningOthers: 0, otherTicketId: "9999", cap: 2 }), null);
  // Same facts in single-ticket mode: the parked run DOES still block there.
  assert.equal(
    admissionDenial({ ...FREE, runningOthers: 0, otherTicketId: "9999", isolate: false, cap: 2 })?.blocked,
    "single-ticket-mode"
  );
});

test("admission: a cap of 0 or less is treated as 1 — never as 'no limit'", () => {
  for (const cap of [0, -1]) {
    assert.equal(admissionDenial({ ...FREE, runningOthers: 1, cap })?.blocked, "concurrency-cap");
    assert.equal(admissionDenial({ ...FREE, runningOthers: 0, cap }), null);
  }
});

test("admission: the duplicate check reports before the cap — the specific reason wins", () => {
  const d = admissionDenial({ ...FREE, duplicate: true, runningOthers: 9 });
  assert.equal(d?.blocked, "duplicate-ticket");
});
