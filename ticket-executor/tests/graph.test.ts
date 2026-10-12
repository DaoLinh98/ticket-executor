// The routing table of every graph, asserted without spawning the Claude CLI.
//
// This is the payoff of edges being pure, synchronous functions of
// (RunContext, NodeResult): the entire decision surface of the engine — what
// ships, what is blocked, what loops back for a fix — is checkable in about a
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
import { graphById, graphForSkill, isTestPath, KNOWN_SKILLS, resolveSkill, skillOfGraph, testGap } from "../lib/execution/graph/graphs";
import { DRAFT_RULE, evaluatePrompt, fixPrompt, publishPrompt, REVIEW_BRANCH_RULE } from "../lib/execution/graph/prompts";
import { END, FAIL, type Graph, type NodeResult, type RunContext } from "../lib/execution/graph/types";

// ---- fixtures ----

const CTX: RunContext = {
  runId: "run_test",
  ticketId: "1234",
  ticketUrl: "https://example.invalid/1234",
  provider: "azure-devops",
  project: "Demo",
  prUrl: "",
  skill: "implement-ticket-v4",
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

function graphOf(skill: string): Graph {
  const g = graphForSkill(skill);
  assert.ok(g, `no graph for ${skill}`);
  return g;
}

function route(graph: Graph, nodeId: string, r: NodeResult, c: RunContext = CTX) {
  const edge = graph.edges[nodeId];
  assert.ok(edge, `graph ${graph.id} has no edge out of "${nodeId}"`);
  return edge(c, r);
}

const impl = graphOf("implement-ticket-v4");
const review = graphOf("fix-code-review-v4");
const qa = graphOf("fix-qa-v4");
const ALL = [impl, review, qa];

/** A RunContext with a given number of prior visits to a node — the cycle
 *  accounting a bounded loop's edge reads. */
function ctxWithVisits(visits: Record<string, number>): RunContext {
  return { ...CTX, visits };
}

const STEP = {
  committed: true, branch: "feature/1234-x", summary: "s", verification: CLEAN_VERIFICATION,
  deviations: [], testExemption: "", blocked: NOT_BLOCKED,
};
const PASS = result({ verdict: "pass", blockers: [], blocked: NOT_BLOCKED });
const REFUSE = result({ verdict: "changes-required", blockers: [{ file: "a.ts:1", issue: "x" }], blocked: NOT_BLOCKED });
const GAP = result({ passed: false, blockers: [{ file: "", issue: "no test" }] });

// ---- one shape for every flow ----

test("every flow walks the same loop, with no gate anywhere", () => {
  for (const g of ALL) {
    assert.deepEqual(Object.keys(g.nodes), ["implement", "check", "evaluate", "fix", "publish"], g.id);
    assert.equal(g.entry, "implement");
    for (const n of Object.values(g.nodes)) assert.ok(n.kind === "agent" || n.kind === "check", `${g.id}: ${n.id} is a ${n.kind}`);
  }
  assert.deepEqual(ALL.map((g) => g.id), ["implement-v4", "fix-review-v4", "fix-qa-v4"]);
});

test("nothing leaves the machine before the review — only publish is external", () => {
  for (const g of ALL) {
    const external = Object.values(g.nodes).filter((n) => n.effects === "external").map((n) => n.id);
    assert.deepEqual(external, ["publish"], g.id);
    assert.equal(g.nodes.implement.effects, "local");
    assert.equal(g.nodes.fix.effects, "local");
    assert.equal(g.nodes.check.kind, "check");
  }
});

test("the reviewer judges with a FRESH context — anything else is marking its own homework", () => {
  for (const g of ALL) {
    assert.equal((g.nodes.evaluate as { context?: string }).context, "fresh", g.id);
    assert.equal(g.nodes.evaluate.effects, "pure", g.id);
    // The fix continues the implementer's session: it is the same author
    // answering the refusal, and re-reading the ticket would be paid twice.
    assert.equal((g.nodes.fix as { context?: string }).context, "resume", g.id);
  }
});

test("publish resumes only where it must: fresh to open a PR, resume to answer review threads", () => {
  assert.equal((impl.nodes.publish as { context?: string }).context, "fresh");
  assert.equal((qa.nodes.publish as { context?: string }).context, "fresh");
  assert.equal((review.nodes.publish as { context?: string }).context, "resume");
});

test("every flow leaves its plan record at implement, where nothing waits on it", () => {
  for (const g of ALL) assert.equal((g.nodes.implement as { artifact?: string }).artifact, "plan", g.id);
});

// ---- implement ----

test("implement: a committed, verified change goes to the test gate, never straight to publish", () => {
  for (const g of ALL) assert.equal(route(g, "implement", result(STEP)).to, "check", g.id);
});

test("implement: failing tests or build stop the run BEFORE anything is pushed", () => {
  for (const g of ALL) {
    assert.equal(route(g, "implement", result({ ...STEP, verification: { ...CLEAN_VERIFICATION, tests: "failed" } })).to, FAIL);
    assert.equal(route(g, "implement", result({ ...STEP, verification: { ...CLEAN_VERIFICATION, build: "failed" } })).to, FAIL);
  }
});

test("implement: tests that were never run are NOT a failure — plenty of repos have none", () => {
  const r = result({ ...STEP, verification: { tests: "not-run", build: "not-run", acceptanceCriteria: "cannot-verify" } });
  assert.equal(route(impl, "implement", r).to, "check");
});

test("implement: a verification FAIL reason carries the prefix the dashboard counts on", () => {
  const next = route(impl, "implement", result({ ...STEP, verification: { ...CLEAN_VERIFICATION, tests: "failed" } }));
  assert.match(next.reason, /^verification\./);
});

test("implement: nothing committed fails the implement and QA flows", () => {
  assert.equal(route(impl, "implement", result({ ...STEP, committed: false })).to, FAIL);
  assert.equal(route(qa, "implement", result({ ...STEP, outcome: "fixed", qaReply: "", committed: false })).to, FAIL);
});

test("implement: a review where every thread is reply-only skips the gate and goes to publish", () => {
  assert.equal(route(review, "implement", result({ ...STEP, committed: false })).to, "publish");
  // …but a declared blocker or a failed turn still fails it.
  assert.equal(route(review, "implement", result({ ...STEP, committed: false, blocked: { is: true, reason: "no PR" } })).to, FAIL);
  assert.equal(route(review, "implement", result({}, false, "turn failed")).to, FAIL);
});

test("implement: a declared blocker fails the run and keeps the agent's reason", () => {
  const next = route(impl, "implement", result({ ...STEP, blocked: { is: true, reason: "no credentials" } }));
  assert.equal(next.to, FAIL);
  assert.match(next.reason, /no credentials/);
});

// ---- the bounded check / review / fix loop ----

test("check: a passing test gate goes to the reviewer; a gap goes back to fix, bounded", () => {
  for (const g of ALL) {
    assert.equal(route(g, "check", result({ passed: true, blockers: [] })).to, "evaluate");
    assert.equal(route(g, "check", GAP).to, "fix");
    assert.equal(route(g, "check", GAP, ctxWithVisits({ fix: 2 })).to, FAIL);
    assert.equal(route(g, "check", result({}, false, "could not diff the branch")).to, FAIL);
  }
});

test("evaluate: a pass releases the run to publish; blockers go to fix, bounded", () => {
  for (const g of ALL) {
    assert.equal(route(g, "evaluate", PASS).to, "publish");
    assert.equal(route(g, "evaluate", REFUSE).to, "fix");
    const next = route(g, "evaluate", REFUSE, ctxWithVisits({ fix: 2 }));
    assert.equal(next.to, FAIL);
    assert.match(next.reason, /after 2 fix attempt/);
  }
});

test("fix: a committed fix goes back through the test gate, never straight to publish", () => {
  for (const g of ALL) {
    assert.equal(route(g, "fix", result(STEP)).to, "check");
    assert.equal(route(g, "fix", result({ ...STEP, committed: false })).to, FAIL);
    assert.equal(route(g, "fix", result({ ...STEP, verification: { ...CLEAN_VERIFICATION, tests: "failed" } })).to, FAIL);
  }
});

// ---- publish ----

test("publish: a pushed branch ends the run; reusing an existing PR says so", () => {
  const committed = { ...CTX, channels: { implement: { committed: true } } };
  assert.equal(route(impl, "publish", result({ pushed: true, prUrl: "u", linked: true, reusedExisting: false, isDraft: true, blocked: NOT_BLOCKED }), committed).to, END);
  const reused = route(impl, "publish", result({ pushed: true, prUrl: "u", linked: true, reusedExisting: true, isDraft: true, blocked: NOT_BLOCKED }), committed);
  assert.equal(reused.to, END);
  assert.match(reused.reason, /reused/);
  assert.equal(route(impl, "publish", result({ pushed: false, prUrl: "", linked: false, reusedExisting: false, isDraft: false, blocked: NOT_BLOCKED }), committed).to, FAIL);
});

test("publish: a reply-only review needs no push to succeed", () => {
  const replyOnly = { ...CTX, channels: { implement: { committed: false } } };
  assert.equal(route(review, "publish", result({ pushed: false, prUrl: "u", threadsReplied: 3, threadsResolved: 0, blocked: NOT_BLOCKED }), replyOnly).to, END);
});

// ---- architecture laws, for every graph ----

// Probes spanning every field any contract in the engine declares, so an edge
// cannot dodge the check by reading something the probes omit.
const PROBES: NodeResult[] = [
  result({ pushed: true, prUrl: "u", linked: true, reusedExisting: false, committed: true, branch: "b", summary: "s", verification: CLEAN_VERIFICATION, deviations: [], threadsReplied: 1, threadsResolved: 1, blocked: NOT_BLOCKED }),
  result({ pushed: true, prUrl: "u", linked: true, reusedExisting: true, committed: true, branch: "b", summary: "s", verification: CLEAN_VERIFICATION, deviations: [], threadsReplied: 0, threadsResolved: 0, blocked: NOT_BLOCKED }),
  result({ pushed: false, prUrl: "", linked: false, reusedExisting: false, committed: false, branch: "", summary: "", verification: { tests: "failed", build: "failed", acceptanceCriteria: "cannot-verify" }, deviations: [], threadsReplied: 0, threadsResolved: 0, blocked: NOT_BLOCKED }),
  result({ blocked: { is: true, reason: "hard blocker" } }),
  result({}, false, "turn failed"),
];

for (const graph of ALL) {
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

// ---- resolution ----

test("graphById resolves a persisted run onto its flow, retired shapes included", () => {
  assert.equal(graphById("implement-v4").id, "implement-v4");
  assert.equal(graphById("fix-review-v4").id, "fix-review-v4");
  assert.equal(graphById("fix-qa-v4").id, "fix-qa-v4");
  // A finished run from a retired graph is shown on its own flow's loop.
  assert.equal(graphById("implement-v3-eval").id, "implement-v4");
  assert.equal(graphById("fix-review-v2").id, "fix-review-v4");
  assert.equal(graphById("fix-qa-v2").id, "fix-qa-v4");
  assert.equal(skillOfGraph("fix-review-v3"), "fix-code-review-v4");
  assert.equal(skillOfGraph(""), "implement-ticket-v4");
});

test("resolveSkill: only the three v4 skills run; anything else is refused, not defaulted", () => {
  for (const s of KNOWN_SKILLS) assert.equal(resolveSkill(s), s);
  for (const s of ["implement-ticket-v2", "implement-ticket-v3", "fix-code-review-v2", "fix-qa-v3", "", "fix-issue"]) {
    assert.equal(resolveSkill(s), null, s);
    assert.equal(graphForSkill(s), null, s);
  }
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

test("admission: a parked run does NOT consume a concurrency slot", () => {
  // The cap bounds machine load, and a parked run holds no child process and
  // spends nothing. Counting it would let two stalled runs block every
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

// ---- prompts ----
//
// An isolated worktree is created detached at the root repo's HEAD, so a review
// run does not start on the branch holding the code it was sent to fix. That is
// carried by the prompt rather than by a second worktree recipe in the engine,
// which makes it exactly the kind of guard invariant 4 says must be observable:
// these assertions are the wiring being visible.

function promptOf(graph: Graph, nodeId: string, c: RunContext = CTX): string {
  const node = graph.nodes[nodeId];
  assert.ok(node, `graph ${graph.id} has no node "${nodeId}"`);
  assert.equal(node.kind, "agent", `node "${nodeId}" is not an agent node`);
  return (node as { prompt: (c: RunContext) => string }).prompt(c);
}

test("review flow: its first turn is told to check out the pull request's branch", () => {
  assert.ok(promptOf(review, "implement").includes(REVIEW_BRANCH_RULE));
  assert.ok(!promptOf(impl, "implement").includes(REVIEW_BRANCH_RULE));
  assert.ok(!promptOf(qa, "implement").includes(REVIEW_BRANCH_RULE));
});

test("only the node that opens a pull request carries the draft rule", () => {
  assert.ok(publishPrompt(CTX).includes(DRAFT_RULE));
  for (const g of ALL) assert.ok(!promptOf(g, "implement").includes(DRAFT_RULE), g.id);
  assert.ok(!promptOf(review, "publish").includes(DRAFT_RULE));
});

test("memory: the first turn and the reviewer are pointed at the Root repo's KNOWLEDGE.md", () => {
  // The worktree is deleted when the run ends, so a lesson written there would
  // die with it — the path must be the Root repo's, never the worktree's.
  const worktree = { ...CTX, cwd: "C:/repo/.te-worktrees/Demo-run_test" };
  for (const g of ALL) {
    const opening = promptOf(g, "implement", worktree);
    assert.match(opening, /Knowledge: C:[\\/]repo[\\/]KNOWLEDGE\.md/, g.id);
    assert.doesNotMatch(opening, /te-worktrees/, g.id);
    assert.match(promptOf(g, "evaluate", worktree), /Knowledge: C:[\\/]repo[\\/]KNOWLEDGE\.md/, g.id);
  }
  // Publishing writes no lesson, so it is not told where the file is.
  assert.doesNotMatch(publishPrompt(CTX), /Knowledge:/);
});

test("the reviewer runs in the mode of its flow, and sees the PR only when reviewing one", () => {
  const withPr = { ...CTX, prUrl: "https://example.invalid/pr/7" };
  assert.match(promptOf(impl, "evaluate"), /^\/review-changes-v4 /);
  assert.doesNotMatch(promptOf(impl, "evaluate"), /Mode:/);
  assert.match(promptOf(qa, "evaluate", withPr), / - Mode: qa-fix$/);
  assert.doesNotMatch(promptOf(qa, "evaluate", withPr), /PR:/);
  assert.match(promptOf(review, "evaluate", withPr), /PR: https:\/\/example\.invalid\/pr\/7 .* - Mode: review-fix$/);
  assert.equal(evaluatePrompt(CTX), promptOf(impl, "evaluate"));
});

test("the fix brief follows whoever refused, and asks for the lesson", () => {
  const byCheck = fixPrompt({ ...CTX, channels: { check: { passed: false, blockers: [{ issue: "no test" }] }, evaluate: { blockers: [{ file: "old.ts", issue: "stale" }] } } });
  assert.match(byCheck, /no test/);
  assert.doesNotMatch(byCheck, /stale/);
  const byReview = fixPrompt({ ...CTX, channels: { check: { passed: true, blockers: [] }, evaluate: { blockers: [{ file: "a.ts:3", issue: "two rules" }] } } });
  assert.match(byReview, /a\.ts:3 — two rules/);
  for (const p of [byCheck, byReview]) {
    assert.match(p, /KNOWLEDGE\.md/);
    assert.match(p, /^Mode: implement\./);
  }
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

// ---- fix-qa: the one flow that may end with no change at all ----

const QA_LOCAL = { ...STEP, outcome: "fixed", qaReply: "" };
const QA_LOCAL_NO_FIX = { ...QA_LOCAL, outcome: "no-fix-needed", qaReply: "Works as the AC describes.", committed: false, branch: "" };

test("fix-qa: a real defect goes to the test gate like any other change", () => {
  assert.equal(route(qa, "implement", result(QA_LOCAL)).to, "check");
});

test("fix-qa: no defect ends the run at implement with a reply and no commit", () => {
  assert.deepEqual(route(qa, "implement", result(QA_LOCAL_NO_FIX)), { to: END, reason: "no-fix-needed" });
  assert.equal(route(qa, "implement", result({ ...QA_LOCAL_NO_FIX, committed: true })).to, FAIL);
  assert.equal(route(qa, "implement", result({ ...QA_LOCAL_NO_FIX, qaReply: " " })).to, FAIL);
});

test("fix-qa: 'no fix needed' is a QA outcome only — other flows ignore the field", () => {
  assert.equal(route(impl, "implement", result({ ...QA_LOCAL_NO_FIX, committed: true, branch: "b" })).to, "check");
});

// ---- the test gate ----

test("test gate: test files are recognised across the stacks the app runs on", () => {
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

test("test gate: testGap — a test file or a stated reason passes, neither refuses", () => {
  assert.equal(testGap(["a.ts", "a.spec.ts"], ""), "");
  assert.equal(testGap(["a.html"], "markup only"), "");
  assert.notEqual(testGap(["a.ts"], ""), "");
  assert.notEqual(testGap([".te/plan.md"], ""), "");
});
