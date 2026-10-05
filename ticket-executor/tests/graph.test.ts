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
import { parseLimitReset } from "../lib/execution/claudeCli";
import { graphById, graphForSkill, isTestPath, resolveSkill, testGap } from "../lib/execution/graph/graphs";
import { DRAFT_RULE, qaEvaluatePrompt, qaFixPrompt, REVIEW_BRANCH_RULE } from "../lib/execution/graph/prompts";
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
  knowledge: "",
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
const qaV3 = graphForSkill("fix-qa-v3");

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

test("publish resumes only where it must: fresh to open a PR, resume to answer review threads", () => {
  // Opening a PR needs the branch, the ticket, .te/plan.md and git log — all of
  // which the harness hands over — so it must NOT replay the plan+implement
  // transcript. That replay was measured at roughly a fifth of a run's cost.
  for (const graph of [v3, v3e]) {
    const publish = graph.nodes.publish;
    assert.equal(
      publish.kind === "agent" ? publish.context : "",
      "fresh",
      `${graph.id}: publish resumed the implement session to run a push and a PR create — the transcript it replays is never read`
    );
  }
  // The review flow is the exception, and deliberately so: which threads this run
  // addressed exists only in the session that addressed them. A fresh session
  // would have to guess, on someone else's pull request.
  for (const graph of [reviewV3, reviewV3e]) {
    const publish = graph.nodes.publish;
    assert.equal(
      publish.kind === "agent" ? publish.context : "",
      "resume",
      `${graph.id}: publish went fresh, so it cannot know which review threads to reply to`
    );
  }
});

test("publish stays the external leaf whichever context it runs in", () => {
  for (const graph of [v3, v3e, reviewV3, reviewV3e]) {
    assert.equal(graph.nodes.publish.effects, "external");
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

for (const graph of [v3, reviewV3, v2, reviewV2, v3e, reviewV3e, qaV3]) {
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

// The one-shot flow has no gate to park at, so the only place its plan can be
// captured is the node itself declaring that it leaves one. Asserted on the
// graph rather than in drive(): if this declaration is dropped, an auto run
// still opens its PR and nothing fails — the Plan tab just quietly goes empty.
test("both one-shot flows declare the plan record they leave behind", () => {
  for (const graph of [v2, reviewV2]) {
    const deliver = graph.nodes.deliver;
    assert.equal(deliver.kind, "agent");
    assert.equal(
      (deliver as { artifact?: string }).artifact,
      "plan",
      `${graph.id}: the only node in this graph must declare the plan it writes, or nothing captures it`
    );
  }
});

test("the gated flow still shows its plan at the gate, not at a node", () => {
  for (const graph of [v3, v3e]) {
    const gate = Object.values(graph.nodes).find((n) => n.kind === "gate");
    assert.equal(gate?.artifact, "plan", `${graph.id}: the review gate must name the plan it shows`);
    // The plan node writes the file; the gate is what captures it. Declaring it
    // on both would be a second place to keep in sync.
    assert.equal((graph.nodes.plan as { artifact?: string }).artifact, undefined);
  }
});

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
  pausedUntil: null,
  now: new Date("2026-09-10T10:00:00Z"),
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

// ---- the review flow's opening prompt ----
//
// An isolated worktree is created detached at the root repo's HEAD, so a review
// run does not start on the branch holding the code it was sent to fix. That is
// carried by the prompt rather than by a second worktree recipe in the engine,
// which makes it exactly the kind of guard invariant 4 says must be observable:
// these assertions are the wiring being visible.

function promptOf(graph: Graph, nodeId: string): string {
  const node = graph.nodes[nodeId];
  assert.ok(node, `graph ${graph.id} has no node "${nodeId}"`);
  assert.equal(node.kind, "agent", `node "${nodeId}" is not an agent node`);
  return (node as { prompt: (c: RunContext) => string }).prompt(CTX);
}

test("review flow: both fresh nodes are told to check out the pull request's branch", () => {
  assert.ok(promptOf(reviewV2, "deliver").includes(REVIEW_BRANCH_RULE));
  assert.ok(promptOf(reviewV3, "plan").includes(REVIEW_BRANCH_RULE));
});

test("implement flow: nothing tells it to check out a branch that does not exist yet", () => {
  assert.ok(!promptOf(v2, "deliver").includes(REVIEW_BRANCH_RULE));
  assert.ok(!promptOf(v3, "plan").includes(REVIEW_BRANCH_RULE));
});

test("the two rules do not cross: only the flow that opens a pull request carries the draft rule", () => {
  assert.ok(promptOf(v2, "deliver").includes(DRAFT_RULE));
  assert.ok(!promptOf(reviewV2, "deliver").includes(DRAFT_RULE));
});

// ---- account limits: park, don't fail ----
// A spent quota is the one failure that is not a statement about the work, and
// the harness reacts to it by holding the run rather than ending it. Both halves
// of that decision are pure and asserted here: reading the CLI's message, and
// refusing to start anything else until it resets.

const AT_NOON = new Date("2026-09-10T12:00:00+07:00");

test("limit: the CLI's reset time is read, and a time already past is tomorrow's", () => {
  const later = parseLimitReset(
    "You've hit your session limit · resets 7:50pm (Asia/Ho_Chi_Minh)",
    AT_NOON
  );
  assert.equal(later?.toISOString(), "2026-09-10T12:50:00.000Z"); // 19:50 +07

  const past = parseLimitReset(
    "You've hit your session limit · resets 9:30am (Asia/Ho_Chi_Minh)",
    AT_NOON
  );
  assert.equal(past?.toISOString(), "2026-09-11T02:30:00.000Z"); // tomorrow 09:30 +07
});

test("limit: only a limit message parks a run", () => {
  // Every other failure keeps failing the node — parking on one would hold a
  // worktree open forever waiting for a quota nobody is out of.
  assert.equal(parseLimitReset("implement finished without returning its structured output", AT_NOON), null);
  assert.equal(parseLimitReset("Graph exceeded 40 transitions — it is looping.", AT_NOON), null);
  assert.equal(parseLimitReset("", AT_NOON), null);
  // A limit with no reset time in it cannot say when to wake up, so it is not
  // one this can act on.
  assert.equal(parseLimitReset("You've hit your session limit", AT_NOON), null);
});

test("limit: no zone in the message falls back to this machine's clock", () => {
  const at = parseLimitReset("5-hour limit reached ∙ resets 11pm", AT_NOON);
  assert.ok(at instanceof Date);
  assert.ok(at!.getTime() > AT_NOON.getTime());
});

test("admission: a spent account refuses every new run until it resets", () => {
  const paused = { ...FREE, pausedUntil: new Date("2026-09-10T12:50:00Z"), now: AT_NOON };
  const d = admissionDenial(paused);
  assert.equal(d?.status, 429);
  assert.equal(d?.blocked, "rate-limited");

  // The pause expires by itself: nothing has to clear the column.
  assert.equal(admissionDenial({ ...paused, now: new Date("2026-09-10T13:00:00Z") }), null);
});

test("admission: a ticket-specific refusal still outranks the pause", () => {
  // Waiting three hours for a quota does not help somebody whose ticket already
  // has a run in flight — that one is theirs to finish or cancel now.
  const d = admissionDenial({ ...FREE, duplicate: true, pausedUntil: new Date("2026-09-10T12:50:00Z"), now: AT_NOON });
  assert.equal(d?.blocked, "duplicate-ticket");
});

test("a persisted v1/v2 QA fix run still resumes on its one-shot graph", () => {
  const g = graphById("fix-qa-v2", "fix-qa-v2");
  assert.equal(g.id, "fix-qa-v2");
  assert.deepEqual(Object.keys(g.nodes), ["deliver"]);
  assert.equal(g.nodes.deliver.effects, "external");
  assert.equal(graphById("fix-qa-v1", "fix-qa-v1").id, "fix-qa-v1");
});

const qaFix = graphById("fix-qa-v2", "fix-qa-v2");
const QA_FIXED = {
  outcome: "fixed", qaReply: "", committed: true, branch: "bug/1-qa-fix", summary: "", verification: CLEAN_VERIFICATION,
  pushed: true, prUrl: "https://example/pr/1", linked: true, isDraft: true, lessons: [], blocked: NOT_BLOCKED,
};
const QA_NO_FIX = {
  ...QA_FIXED, outcome: "no-fix-needed", qaReply: "Works as the AC describes.", committed: false, branch: "",
  pushed: false, prUrl: "", linked: false, isDraft: false,
};

test("QA fix: a real defect is delivered like any one-shot run", () => {
  assert.deepEqual(route(qaFix, "deliver", result(QA_FIXED)), { to: END, reason: "delivered" });
  assert.equal(route(qaFix, "deliver", result({ ...QA_FIXED, pushed: false })).to, FAIL);
});

test("QA fix: no defect ends the run with a reply and no repository change", () => {
  assert.deepEqual(route(qaFix, "deliver", result(QA_NO_FIX)), { to: END, reason: "no-fix-needed" });
});

test("QA fix: 'no fix needed' is refused when the run changed the repository or wrote no reply", () => {
  assert.equal(route(qaFix, "deliver", result({ ...QA_NO_FIX, pushed: true })).to, FAIL);
  assert.equal(route(qaFix, "deliver", result({ ...QA_NO_FIX, committed: true })).to, FAIL);
  assert.equal(route(qaFix, "deliver", result({ ...QA_NO_FIX, prUrl: "https://example/pr/2" })).to, FAIL);
  assert.equal(route(qaFix, "deliver", result({ ...QA_NO_FIX, qaReply: "  " })).to, FAIL);
});

// ---- fix-qa-v3: QA fix with a local commit, a test gate and an independent review ----

const QA_LOCAL = {
  outcome: "fixed", qaReply: "", committed: true, branch: "bug/1-qa-fix", summary: "s", verification: CLEAN_VERIFICATION,
  deviations: [], testExemption: "", lessons: [], blocked: NOT_BLOCKED,
};
const QA_LOCAL_NO_FIX = { ...QA_LOCAL, outcome: "no-fix-needed", qaReply: "Works as the AC describes.", committed: false, branch: "" };

test("fix-qa-v3: the QA skill resolves to the gated graph whatever the settings say", () => {
  const modes = { autoImplement: true, autoResolveCodeReview: true };
  assert.equal(resolveSkill("fix-qa-v3", false, modes), "fix-qa-v3");
  assert.equal(qaV3.id, "fix-qa-v3");
  assert.deepEqual(Object.keys(qaV3.nodes), ["implement", "check", "evaluate", "fix", "publish"]);
  assert.equal(graphById("fix-qa-v3", "fix-qa-v3").id, "fix-qa-v3");
});

test("fix-qa-v3: nothing leaves the machine before the review — only publish is external", () => {
  const external = Object.values(qaV3.nodes).filter((n) => n.effects === "external").map((n) => n.id);
  assert.deepEqual(external, ["publish"]);
  assert.equal(qaV3.nodes.implement.effects, "local");
  assert.equal((qaV3.nodes.evaluate as { context?: string }).context, "fresh");
  assert.equal(qaV3.nodes.check.kind, "check");
});

test("fix-qa-v3: a committed fix goes to the test gate, not to publish", () => {
  assert.equal(route(qaV3, "implement", result(QA_LOCAL)).to, "check");
  assert.equal(route(qaV3, "implement", result({ ...QA_LOCAL, committed: false })).to, FAIL);
  assert.equal(route(qaV3, "implement", result({ ...QA_LOCAL, verification: { ...CLEAN_VERIFICATION, tests: "failed" } })).to, FAIL);
});

test("fix-qa-v3: no defect ends the run at implement with a reply and no commit", () => {
  assert.deepEqual(route(qaV3, "implement", result(QA_LOCAL_NO_FIX)), { to: END, reason: "no-fix-needed" });
  assert.equal(route(qaV3, "implement", result({ ...QA_LOCAL_NO_FIX, committed: true })).to, FAIL);
  assert.equal(route(qaV3, "implement", result({ ...QA_LOCAL_NO_FIX, qaReply: " " })).to, FAIL);
});

test("fix-qa-v3: the test gate sends a change with no test back to fix, bounded", () => {
  assert.equal(route(qaV3, "check", result({ passed: true, blockers: [] })).to, "evaluate");
  const gap = result({ passed: false, blockers: [{ file: "", issue: "no test" }] });
  assert.equal(route(qaV3, "check", gap).to, "fix");
  assert.equal(qaV3.edges.check(ctxWithVisits({ fix: 2 }), gap).to, FAIL);
  assert.equal(route(qaV3, "check", result({}, false, "could not diff the branch")).to, FAIL);
});

test("fix-qa-v3: review blockers loop through fix and back through the test gate", () => {
  assert.equal(route(qaV3, "evaluate", result({ verdict: "pass", blockers: [], lessons: [], blocked: NOT_BLOCKED })).to, "publish");
  const refuse = result({ verdict: "changes-required", blockers: [{ file: "a.ts:1", issue: "x" }], lessons: [], blocked: NOT_BLOCKED });
  assert.equal(route(qaV3, "evaluate", refuse).to, "fix");
  assert.equal(qaV3.edges.evaluate(ctxWithVisits({ fix: 2 }), refuse).to, FAIL);
  assert.equal(route(qaV3, "fix", result(QA_LOCAL)).to, "check");
  assert.equal(route(qaV3, "fix", result({ ...QA_LOCAL, committed: false })).to, FAIL);
});

test("fix-qa-v3: the reviewer runs in qa-fix mode and the fix brief follows whoever refused", () => {
  assert.match(qaEvaluatePrompt(CTX), /^\/review-changes-v1 .* - Mode: qa-fix$/);
  const byCheck = qaFixPrompt({ ...CTX, channels: { check: { passed: false, blockers: [{ issue: "no test" }] }, evaluate: { blockers: [{ file: "old.ts", issue: "stale" }] } } });
  assert.match(byCheck, /no test/);
  assert.doesNotMatch(byCheck, /stale/);
  const byReview = qaFixPrompt({ ...CTX, channels: { check: { passed: true, blockers: [] }, evaluate: { blockers: [{ file: "a.ts:3", issue: "two rules" }] } } });
  assert.match(byReview, /two rules/);
});

test("fix-qa-v3: test files are recognised across the stacks the app runs on", () => {
  for (const p of [
    "angular/src/app/pages/fund/edit/edit.component.spec.ts",
    "tests/graph.test.ts",
    "aspnet-core/test/CRMS.Application.Tests/Services/InvestmentUniverseServiceTest.cs",
    "src/__tests__/a.tsx",
    "pkg/x_test.go",
    "app/test_views.py",
  ]) assert.ok(isTestPath(p), p);
  for (const p of ["angular/src/app/pages/fund/edit/edit.component.ts", "lib/latest.ts", "src/Contest.tsx"]) {
    assert.ok(!isTestPath(p), p);
  }
});

test("fix-qa-v3: testGap — a test file or a stated reason passes, neither refuses", () => {
  assert.equal(testGap(["a.ts", "a.spec.ts"], ""), "");
  assert.equal(testGap(["a.html"], "markup only"), "");
  assert.notEqual(testGap(["a.ts"], ""), "");
  assert.notEqual(testGap([".te/plan.md"], ""), "");
});
