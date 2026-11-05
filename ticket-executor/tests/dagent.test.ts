import test from "node:test";
import assert from "node:assert/strict";
import { agentProblem, parseAgent } from "../lib/dagent/agents";
import { DENIED_SKILLS, turnArgs } from "../lib/dagent/cli";
import { agentsOf, allAgents, flowOf, GRAPH, GRAPHS, graphById, MAX_FIX_ATTEMPTS, MAX_PLAN_ATTEMPTS, QA_GRAPH, REVIEW_GRAPH } from "../lib/dagent/graph";
import {
  evaluatePrompt,
  fixPrompt,
  implementPrompt,
  planPrompt,
  prBody,
  publishPrompt,
  qaImplementPrompt,
  qaTriagePrompt,
  readinessPrompt,
  reflectPrompt,
  respondPrompt,
  reviewImplementPrompt,
  reviewTriagePrompt,
  skillSummary,
} from "../lib/dagent/prompts";
import { basesOf, bundleOf, checkReadiness, checkReview, deliveryOf, diffViolations, digestOf, fixBlockersOf, violationRefusals, reviewedHeadsOf, isPlanned, knowledgeDiff, planIssues, plannedFiles, prNumber, renderPlan, richToText, skillFrontMatter, skillsOf, skillUse, warningsOf } from "../lib/dagent/rules";
import { companionNote } from "../lib/repoContext";
import { readFileSync } from "fs";
import path from "path";
import { BUNDLED_AGENTS } from "../lib/agentPack";
import { BUNDLED_SKILLS, readVersion } from "../lib/skillPack";
import { END, FAIL, NEEDS_INPUT, NEEDS_REVIEW, TERMINALS, ZERO_USAGE, type Ctx, type NodeResult } from "../lib/dagent/types";
import { buildView, outputOf } from "../lib/dagent/view";
import { briefOutline, briefTokens, cacheHit, lineDiff, outSections, refusalSections } from "../lib/workflow/present";

const ctx = (channels: Ctx["channels"] = {}, visits: Ctx["visits"] = {}): Ctx => ({
  runId: "r1",
  flow: "implement",
  prUrl: "",
  ticketId: "4182",
  ticketUrl: "",
  provider: "azure-devops",
  project: "billing",
  rootRepo: "/src/billing-api",
  cwd: "/src/billing-api/.te-worktrees/dagent-r1",
  baseSha: "abc",
  companions: [],
  knowledgeFile: "/src/billing-api/KNOWLEDGE.md",
  channels,
  visits,
});

const ok = (data: Record<string, unknown>): NodeResult => ({ ok: true, data, error: "", usage: ZERO_USAGE });
const notOk = (error: string): NodeResult => ({ ok: false, data: {}, error, usage: ZERO_USAGE });
const edge = (id: string, c: Ctx, r: NodeResult) => GRAPH.edges[id](c, r);
const clear = { blocked: { is: false, reason: "" } };

test("skillUse: an assigned skill is read or unread by its SKILL.md reads; an unassigned one opened is reported", () => {
  const brief = [
    "## Skills to follow",
    "- dotnet-upgrade-10: C:\\Users\\me\\.claude\\skills\\dotnet-upgrade-10\\SKILL.md — the ticket bumps net10.0",
    "- resolve-sonar-issues: C:\\Users\\me\\.claude\\skills\\resolve-sonar-issues\\SKILL.md — Sonar findings",
    "## Skills",
    "- tdd — Test-driven development (C:\\Users\\me\\.claude\\skills\\tdd\\SKILL.md)",
  ].join("\n");
  const logs = ["✎ Read C:\\Users\\me\\.claude\\skills\\dotnet-upgrade-10\\SKILL.md", "$ cat ~/.claude/skills/diagnose/SKILL.md", "✎ Skill caveman"];
  assert.deepEqual(skillUse(brief, logs), [
    { name: "dotnet-upgrade-10", state: "read" },
    { name: "resolve-sonar-issues", state: "unread" },
    { name: "diagnose", state: "opened" },
    { name: "caveman", state: "opened" },
  ]);
  // The picking role: its picks lead, a candidate it only opened is "opened", the menu itself assigns nothing.
  assert.deepEqual(skillUse(brief.split("## Skills\n")[1], ["✎ Read C:/x/skills/tdd/SKILL.md", "✎ Read C:/x/skills/dotnet-upgrade-10/SKILL.md"], ["dotnet-upgrade-10"]), [
    { name: "dotnet-upgrade-10", state: "picked" },
    { name: "tdd", state: "opened" },
  ]);
  // A step kept before briefs were saved: the run's picked skills stand in for what it was told.
  assert.deepEqual(skillUse("", ["✎ Read C:/x/skills/dotnet-upgrade-10/SKILL.md"], [], ["dotnet-upgrade-10", "resolve-sonar-issues"]), [
    { name: "dotnet-upgrade-10", state: "read" },
    { name: "resolve-sonar-issues", state: "unread" },
  ]);
});

test("every edge target is declared, and every declared target is a node or a terminal", () => {
  for (const g of Object.values(GRAPHS)) {
    for (const n of Object.values(g.nodes)) {
      assert.ok(g.edges[n.id], `${g.id}: ${n.id} has no edge`);
      for (const t of n.next) assert.ok(g.nodes[t] || TERMINALS.includes(t), `${g.id}: ${n.id} → ${t}`);
    }
  }
});

test("the external node is a leaf: nothing after it can reach it again", () => {
  for (const g of Object.values(GRAPHS)) {
    const external = Object.values(g.nodes).filter((n) => n.effects === "external");
    assert.equal(external.length, 1, g.id);
    const seen = new Set<string>();
    const walk = (id: string) => {
      for (const t of g.nodes[id]?.next ?? []) if (!seen.has(t) && g.nodes[t]) (seen.add(t), walk(t));
    };
    walk(external[0].id);
    assert.ok(!seen.has(external[0].id), g.id);
    assert.equal(external[0].maxVisits, 1, g.id);
  }
});

const reviewCtx = (channels: Ctx["channels"] = {}, visits: Ctx["visits"] = {}): Ctx => ({ ...ctx(channels, visits), flow: "review", prUrl: "https://dev.azure.com/o/p/_git/r/pullrequest/7" });
const thread = (decision: string) => ({ threadId: "1", file: "a.ts:3", comment: "c", decision, reason: "r" });

test("review fix: triage routes to the fix, straight to the replies, or fails with nothing to answer", () => {
  const e = (r: NodeResult) => REVIEW_GRAPH.edges.reviewTriage(reviewCtx(), r);
  assert.equal(e(ok({ threads: [thread("fix"), thread("reject")], planMd: "", ...clear })).to, "implement");
  assert.equal(e(ok({ threads: [thread("reject")], planMd: "", ...clear })).to, "respond");
  assert.equal(e(ok({ threads: [], planMd: "", ...clear })).to, FAIL);
});

test("review fix: the PR branch is never rebased — commits go straight to the diff guard", () => {
  assert.ok(!REVIEW_GRAPH.nodes.syncBase);
  const done = ok({ committed: true, branch: "b", ...clear });
  assert.equal(REVIEW_GRAPH.edges.implement(reviewCtx(), done).to, "diffGuard");
  assert.equal(REVIEW_GRAPH.edges.fix(reviewCtx(), done).to, "diffGuard");
  assert.equal(REVIEW_GRAPH.edges.prePublish(reviewCtx(), ok({ passed: false, baseMoved: true, issues: ["x"] })).to, FAIL);
});

test("review fix: answering is required, and a committed fix must be pushed", () => {
  const changed = reviewCtx({ diffGuard: { changed: [{ repo: "r", branch: "b", files: 1 }] } });
  assert.equal(REVIEW_GRAPH.edges.respond(changed, ok({ pushed: false, threadsReplied: 2, ...clear })).to, FAIL);
  assert.equal(REVIEW_GRAPH.edges.respond(changed, ok({ pushed: true, threadsReplied: 0, ...clear })).to, FAIL);
  assert.equal(REVIEW_GRAPH.edges.respond(changed, ok({ pushed: true, threadsReplied: 2, ...clear })).to, END);
  assert.equal(REVIEW_GRAPH.edges.respond(reviewCtx(), ok({ pushed: false, threadsReplied: 1, ...clear })).to, END);
});

test("QA fix: no defect ends with a reply, a defect enters the implement loop", () => {
  const e = (data: Record<string, unknown>) => QA_GRAPH.edges.qaTriage(ctx(), ok({ ...data, ...clear }));
  assert.equal(e({ outcome: "no-fix-needed", findings: [{ defect: false }] }).to, END);
  assert.equal(e({ outcome: "fix", findings: [{ defect: true }], branch: "bug/1-x" }).to, "implement");
  assert.equal(e({ outcome: "fix", findings: [{ defect: false }], branch: "bug/1-x" }).to, FAIL);
  assert.equal(e({ outcome: "fix", findings: [{ defect: true }], branch: "" }).to, FAIL);
  assert.equal(QA_GRAPH.nodes.publish.effects, "external");
});

test("QA follow-up: an analysis run stops after the triage; the developer's decision enters the implement loop", () => {
  const window = { since: "2026-10-20T01:00:00Z", upTo: "2026-10-21T01:00:00Z", triggers: ["comment"] };
  const fixing = ok({ outcome: "fix", findings: [{ defect: true }], branch: "bug/1-x", ...clear });
  assert.equal(QA_GRAPH.edges.qaTriage(ctx({ followUp: window }), fixing).to, END);
  const decided = ctx({ followUp: { ...window, decision: { fix: ["Total is wrong"], note: "" } } });
  assert.equal(QA_GRAPH.edges.qaTriage(decided, fixing).to, "implement");
  assert.equal(QA_GRAPH.edges.qaTriage(ctx({ followUp: window }), notOk("turn failed")).to, FAIL);
  assert.equal(flowOf("dagent-fix-qa-v2"), "qa");
});

test("QA triage brief carries the comment window, and the developer's decision as binding", () => {
  const window = { since: "2026-10-20T01:00:00Z", upTo: "2026-10-21T01:00:00Z", triggers: ["qa-failed"] };
  const analyse = qaTriagePrompt(ctx({ followUp: window }));
  assert.match(analyse, /after 2026-10-20T01:00:00Z, up to 2026-10-21T01:00:00Z/);
  assert.doesNotMatch(analyse, /binding/);
  assert.doesNotMatch(analyse, /The developer is/);
  const known = qaTriagePrompt(ctx({ followUp: { ...window, developer: { name: "Dev Sample", email: "dev@example.test" } } }));
  assert.match(known, /The developer is Dev Sample <dev@example\.test> — their own comments are context/);
  const fix = qaTriagePrompt(ctx({ followUp: { ...window, decision: { fix: ["Total is wrong"], note: "keep the API" } } }));
  assert.match(fix, /binding/);
  assert.match(fix, /1\. Total is wrong/);
  assert.match(fix, /Developer's note: keep the API/);
});

test("every agent node runs a global agent and declares a schema", () => {
  for (const n of Object.values(GRAPH.nodes)) {
    if (n.kind !== "agent") continue;
    assert.equal(typeof n.output.type, "string");
  }
  assert.deepEqual(agentsOf().sort(), ["analyst", "fixer", "implementer", "planner", "publisher", "reflector", "reviewer"]);
});

test("readiness parks the run when the ticket is not ready", () => {
  assert.equal(edge("readiness", ctx(), ok({ ...clear, ready: false, questions: ["a", "b"] })).to, NEEDS_INPUT);
  assert.equal(edge("readiness", ctx(), ok({ ...clear, ready: true, acceptanceCriteria: ["x"] })).to, "plan");
  assert.equal(edge("readiness", ctx(), ok({ blocked: { is: true, reason: "no access" } })).to, FAIL);
  // A park with nothing to ask, or a plan with no spec, is a broken verdict — never a wait.
  assert.equal(edge("readiness", ctx(), ok({ ...clear, ready: false, questions: [] })).to, FAIL);
  assert.equal(edge("readiness", ctx(), ok({ ...clear, ready: true, acceptanceCriteria: [] })).to, FAIL);
});

test("checkReadiness: keeps 3 PO questions, and a 'done' without proof for every criterion is downgraded", () => {
  const many = checkReadiness({ questions: ["q1", "q2", "q3", "q4", "q5"], missing: ["m"] });
  assert.deepEqual(many.data.questions, ["q1", "q2", "q3"]);
  assert.equal((many.data.missing as string[]).length, 3);
  const ev = [{ ac: "AC1", repo: "api", proof: "PR 1" }];
  const short = checkReadiness({ acceptanceCriteria: ["AC1", "AC2"], delivery: { status: "done", evidence: ev } });
  assert.deepEqual(short.data.delivery, { status: "partial", evidence: ev });
  assert.equal(short.notes.length, 1);
  // Proof naming no criterion of the ticket backs nothing.
  assert.equal((checkReadiness({ acceptanceCriteria: ["AC1"], delivery: { status: "done", evidence: [{ ac: "other", repo: "api", proof: "x" }] } }).data.delivery as { status: string }).status, "none");
  // A verdict the proof backs is left alone.
  const full = checkReadiness({ acceptanceCriteria: ["AC1"], delivery: { status: "done", evidence: ev } });
  assert.deepEqual(full.notes, []);
});

test("readiness ends the run when every criterion is already delivered", () => {
  const evidence = [{ ac: "AC1", repo: "api", proof: "PR 11407" }];
  const done = edge("readiness", ctx(), ok({ ...clear, ready: true, acceptanceCriteria: ["AC1"], delivery: { status: "done", evidence } }));
  assert.equal(done.to, END);
  assert.match(done.reason, /already delivered/);
  const part = edge("readiness", ctx(), ok({ ...clear, ready: true, acceptanceCriteria: ["AC1", "AC2"], delivery: { status: "partial", evidence } }));
  assert.equal(part.to, "plan");
  assert.match(part.reason, /1 already delivered/);
  assert.deepEqual(deliveryOf(ctx({ readiness: { delivery: { status: "bogus" } } })), { status: "none", evidence: [] });
});

test("plan check re-plans once, then fails", () => {
  assert.equal(edge("planCheck", ctx({}, { plan: 1 }), ok({ passed: false, issues: ["x"] })).to, "plan");
  assert.equal(edge("planCheck", ctx({}, { plan: MAX_PLAN_ATTEMPTS }), ok({ passed: false, issues: ["x"] })).to, FAIL);
  assert.equal(edge("planCheck", ctx(), ok({ passed: true, issues: [] })).to, "implement");
});

test("sync and diff guard warnings go to the reviewer; their blockers go straight to the fixer, never past the fix budget", () => {
  assert.equal(edge("syncBase", ctx(), ok({ warnings: [{ source: "syncBase", file: "", issue: "not synced" }] })).to, "diffGuard");
  const d = edge("diffGuard", ctx(), ok({ warnings: [{ source: "diffGuard", file: "", issue: "x" }] }));
  assert.equal(d.to, "evaluate");
  assert.match(d.reason, /1 warning/);
  const conflict = ok({ blockers: [{ source: "syncBase", file: "api/", issue: "conflicts in a.ts" }], warnings: [] });
  assert.deepEqual(edge("syncBase", ctx(), conflict), { to: "fix", reason: "1 rebase conflict → fix" });
  assert.equal(edge("syncBase", ctx({}, { fix: MAX_FIX_ATTEMPTS }), conflict).to, FAIL);
  const secret = ok({ blockers: [{ source: "diffGuard", file: "api/.env", issue: "secret" }], warnings: [] });
  assert.equal(edge("diffGuard", ctx(), secret).to, "fix");
  assert.match(edge("diffGuard", ctx({}, { fix: MAX_FIX_ATTEMPTS }), secret).reason, /stands after 5 fix attempt/);
});

test("the fixer works on the newest refusal: a rebase conflict, then a hard diff violation, else the review", () => {
  const review = { evaluate: { verdict: "changes-required", blockers: [{ file: "x.ts", issue: "bug" }] } };
  const conflict = { source: "syncBase", file: "api/", issue: "conflicts in a.ts" };
  const secret = { source: "diffGuard", file: "api/.env", issue: "secret" };
  assert.deepEqual(fixBlockersOf(ctx({ ...review, syncBase: { blockers: [conflict] } })), [conflict]);
  assert.deepEqual(fixBlockersOf(ctx({ ...review, syncBase: { blockers: [] }, diffGuard: { blockers: [secret] } })), [secret]);
  assert.deepEqual(fixBlockersOf(ctx({ ...review, syncBase: { blockers: [] }, diffGuard: { blockers: [] } })).map((r) => r.source), ["evaluate"]);
  const brief = fixPrompt(ctx({ syncBase: { blockers: [conflict] } }));
  assert.match(brief, /## Blockers from the harness checks\n1\. \[syncBase\] api\/ — conflicts in a\.ts/);
  assert.match(brief, /never touch the base's commits/);
  assert.match(fixPrompt(ctx(review)), /## Review blockers/);
});

test("checkReview flags an unproven pass; the PR and the reviewer get the review's open points and manual checks", () => {
  assert.deepEqual(checkReview({ verdict: "pass", checked: [{ result: "ok" }], blockers: [] }), []);
  assert.equal(checkReview({ verdict: "pass", checked: [], blockers: [] }).length, 1);
  assert.match(checkReview({ verdict: "pass", checked: [{ result: "issue" }], blockers: [] })[0], /1 check\(s\) marked issue/);
  const c = ctx({ implement: { manualChecks: [{ n: 5, check: "login on Dev" }] }, evaluate: { assumptions: ["AC5 not run locally"] }, diffGuard: { changed: [{ repo: "billing-api", branch: "b" }] } });
  assert.match(evaluatePrompt(c), /- AC 5: login on Dev/);
  assert.match(publishPrompt(c), /## Not verified by the automated review\n- AC5 not run locally/);
});

test("the PR description carries the review's proof per criterion; a re-sync that moved only the base skips the re-review", () => {
  const c = ctx({
    readiness: { ...DIGESTED, acceptanceCriteria: ["Historical rows import", "Approve still checks"] },
    plan: { branch: "b", planMd: "## Goal\nExempt Historical imports.\n\n## Steps\n1. x", acMap: [{ n: 1, ac: "a", change: "code", files: ["F.cs"], test: "T1" }, { n: 2, ac: "b", change: "none", files: [], test: "untouched" }] },
    implement: { summary: "Added a flag.", verification: { tests: "passed", build: "passed", acceptanceCriteria: "met" } },
    evaluate: { verdict: "pass", blockers: [], checked: [{ subject: "AC1 — Historical rows import", evidence: "F.cs:90 passes false", result: "ok" }], reviewedDiffs: { api: "h1" } },
  });
  const body = prBody(c);
  assert.match(body, /^## Summary\nExempt Historical imports\.\n\nAdded a flag\./);
  assert.match(body, /\| 1 \| Historical rows import \| F\.cs \| review: ok — F\.cs:90 passes false \|/);
  assert.match(body, /\| 2 \| Approve still checks \| no change \| planned: untouched \|/);
  assert.match(body, /Independent review: pass — 1 checks ok/);
  assert.equal(edge("diffGuard", c, ok({ blockers: [], warnings: [], diffHashes: { api: "h1" } })).to, "prePublish");
  assert.equal(edge("diffGuard", c, ok({ blockers: [], warnings: [], diffHashes: { api: "h2" } })).to, "evaluate");
});

test("a fix round that changes nothing stops the loop early; reflect is told so", () => {
  const given = [{ source: "evaluate", file: "src/a.ts:10", issue: "The total ignores the discount for annual plans" }];
  const again = [{ file: "src/a.ts:12", issue: "Total still ignores the discount on annual plans" }];
  const c = ctx({ fix: { input: given, summary: "s", deviations: [] }, evaluate: { verdict: "changes-required", blockers: again } }, { fix: 1, evaluate: 2 });
  const r = edge("evaluate", c, ok({ ...clear, verdict: "changes-required", blockers: again }));
  assert.equal(r.to, "reflect");
  assert.match(r.reason, /no progress/);
  assert.match(reflectPrompt(c), /made no progress/);
  // A different blocker is progress: the loop goes on.
  const other = ctx({ fix: { input: given }, evaluate: { verdict: "changes-required", blockers: [{ file: "src/b.ts", issue: "Null input crashes the parser" }] } }, { fix: 1 });
  assert.equal(edge("evaluate", other, ok({ ...clear, verdict: "changes-required", blockers: [] })).to, "fix");
});

test("hard diff rules block with a rewrite instruction; unplanned config stays a warning", () => {
  const { blockers, warnings } = violationRefusals([
    { rule: "no-secret-files", file: "api/.env" },
    { rule: "no-unplanned-config", file: "api/appsettings.json" },
  ]);
  assert.deepEqual(blockers.map((b) => b.file), ["api/.env"]);
  assert.match(blockers[0].expected ?? "", /a later commit that deletes it still pushes it/);
  assert.deepEqual(warnings.map((w) => w.file), ["api/appsettings.json"]);
});

test("diff guard catches Azure keys, API keys and real connection-string passwords, not placeholders or local servers", () => {
  const hit = (line: string) => diffViolations([], [{ repo: "api", path: "a.json", line }], []).length > 0;
  assert.ok(hit(`"Storage": "DefaultEndpointsProtocol=https;AccountName=x;AccountKey=${"A".repeat(86)}=="`));
  assert.ok(hit(`Endpoint=sb://x.servicebus.windows.net/;SharedAccessKeyName=root;SharedAccessKey=${"b".repeat(44)}=`));
  assert.ok(hit(`key = "sk-ant-api03-${"x".repeat(40)}"`));
  assert.ok(hit(`"Default": "Server=tcp:prod.database.windows.net;Database=fee;User Id=app;Password=S3cr3tValue!;"`));
  assert.ok(!hit(`"Default": "Server=localhost;Database=fee;User Id=sa;Password=Local123!;"`));
  assert.ok(!hit(`"Default": "Server=tcp:prod.database.windows.net;Database=fee;Password=<your-password>;"`));
  assert.ok(!hit(`"Default": "Server=prod;Database=fee;Password=\${DB_PASSWORD};"`));
  assert.ok(!hit("const riskScore = computeRisk(task);"));
});

test("fix receives the review's blockers when the harness raised only warnings", () => {
  const channels = {
    implement: { verification: { tests: "failed", build: "passed", acceptanceCriteria: "met" } },
    syncBase: { warnings: [{ source: "syncBase", file: "api/", issue: "conflict" }] },
    diffGuard: { warnings: [{ source: "diffGuard", file: "a/CLAUDE.md", issue: "agent file" }] },
    evaluate: { verdict: "changes-required", blockers: [{ file: "x.ts:3", issue: "bug" }] },
  };
  const c = ctx(channels);
  assert.deepEqual(bundleOf(c), [{ source: "evaluate", file: "x.ts:3", issue: "bug" }]);
  assert.deepEqual(warningsOf(c).map((w) => w.source), ["syncBase", "diffGuard", "verification"]);
  const r = edge("evaluate", c, ok({ ...clear, verdict: "changes-required", blockers: [{ file: "x.ts:3", issue: "bug" }] }));
  assert.equal(r.to, "fix");
  assert.match(r.reason, /1 blocker/);
});

test("a passing review publishes even when the harness raised warnings", () => {
  const c = ctx({ diffGuard: { warnings: [{ source: "diffGuard", file: "a", issue: "x" }] }, evaluate: { verdict: "pass", blockers: [] } });
  assert.equal(edge("evaluate", c, ok({ ...clear, verdict: "pass", blockers: [] })).to, "prePublish");
});

test("an exhausted fix loop goes to reflect, and reflect always fails", () => {
  const c = ctx({ evaluate: { verdict: "changes-required", blockers: [{ file: "a", issue: "bug" }] } }, { fix: MAX_FIX_ATTEMPTS });
  assert.equal(edge("evaluate", c, ok({ ...clear, verdict: "changes-required", blockers: [{ file: "a", issue: "bug" }] })).to, "reflect");
  assert.equal(edge("reflect", c, ok({ recorded: true, lesson: "x" })).to, FAIL);
});

test("a blocked fixer records a lesson before failing; a turn error never reaches reflect", () => {
  const blocked = { blocked: { is: true, reason: "needs a repo" }, committed: false };
  assert.equal(edge("fix", ctx(), ok(blocked)).to, "reflect");
  const r = edge("reflect", ctx({ fix: blocked }), ok({ recorded: false, lesson: "" }));
  assert.equal(r.to, FAIL);
  assert.match(r.reason, /blocked: needs a repo/);
  assert.equal(edge("fix", ctx(), notOk("turn failed")).to, FAIL);
});

test("implement and fix must commit before anything is verified", () => {
  assert.equal(edge("implement", ctx(), ok({ ...clear, committed: false, filesChanged: 0, uncommitted: 3 })).to, FAIL);
  assert.equal(edge("implement", ctx(), ok({ ...clear, committed: false, filesChanged: 0, uncommitted: 0, blocked: { is: true, reason: "x" } })).to, FAIL);
  assert.equal(edge("fix", ctx(), ok({ ...clear, committed: false, filesChanged: 0, uncommitted: 0 })).to, FAIL);
  assert.equal(edge("fix", ctx(), ok({ ...clear, committed: true })).to, "syncBase");
  assert.equal(edge("implement", ctx(), notOk("turn failed")).to, FAIL);
});

test("an implement that rightly changes nothing parks for a person instead of failing", () => {
  const clean = ok({ ...clear, committed: false, filesChanged: 0, uncommitted: 0 });
  assert.deepEqual(GRAPH.edges.implement(ctx(), clean), { to: NEEDS_REVIEW, reason: "no code change needed — ended for review" });
  assert.equal(QA_GRAPH.edges.implement(ctx(), clean).to, NEEDS_REVIEW);
  assert.equal(REVIEW_GRAPH.edges.implement(ctx(), clean).to, FAIL);
  for (const id of ["dagent-implement-v2", "dagent-fix-qa-v1"]) {
    const old = graphById(id)!;
    assert.ok(!old.nodes.implement.next.includes(NEEDS_REVIEW), id);
    assert.equal(old.edges.implement(ctx(), clean).to, FAIL, id);
  }
  assert.equal(flowOf("dagent-fix-qa-v1"), "qa");
});

test("pre-publish re-syncs when the base moved, and fails on anything else", () => {
  assert.equal(edge("prePublish", ctx({}, { prePublish: 1 }), ok({ passed: false, baseMoved: true, issues: ["moved"] })).to, "syncBase");
  assert.equal(edge("prePublish", ctx({}, { prePublish: 1 }), ok({ passed: false, baseMoved: false, issues: ["dirty"] })).to, FAIL);
  assert.equal(edge("prePublish", ctx(), ok({ passed: true, issues: [] })).to, "publish");
});

test("publish needs every reported repo pushed with a PR; a read-back mismatch parks for a person", () => {
  assert.equal(edge("publish", ctx(), ok({ ...clear, prs: [{ repo: "a", pushed: true, prUrl: "u" }, { repo: "b", pushed: false, prUrl: "" }] })).to, FAIL);
  assert.equal(edge("publish", ctx(), ok({ ...clear, prs: [{ repo: "a", pushed: true, prUrl: "u" }] })).to, "verifyPublish");
  assert.equal(edge("verifyPublish", ctx(), ok({ passed: true, checks: [] })).to, END);
  assert.equal(edge("verifyPublish", ctx(), ok({ passed: false, checks: [{ name: "draft", ok: false }] })).to, NEEDS_REVIEW);
});

test("diff guard flags agent files, secrets and unplanned config", () => {
  const v = diffViolations(
    [
      { repo: "api", path: "CLAUDE.md" },
      { repo: "api", path: "CLAUDE.local.md" },
      { repo: "api", path: ".env" },
      { repo: "api", path: ".env.example" },
      { repo: "api", path: "appsettings.Development.json" },
      { repo: "api", path: "appsettings.json" },
      { repo: "api", path: "src/a.ts" },
    ],
    [{ repo: "api", path: "src/a.ts", line: "const k = 'AKIAABCDEFGHIJKLMNOP';" }],
    ["api/appsettings.json"],
  );
  assert.deepEqual(
    v.map((x) => `${x.rule}:${x.file}`),
    ["no-agent-files:api/CLAUDE.md", "no-agent-files:api/CLAUDE.local.md", "no-secret-files:api/.env", "no-unplanned-config:api/appsettings.Development.json", "no-secrets-in-diff:api/src/a.ts"],
  );
  assert.ok(isPlanned({ repo: "api", path: "src/Invoices/Csv.cs" }, ["Invoices/Csv.cs"]));
});

test("plan check names what is missing", () => {
  const issues = planIssues(["a", "b"], { branch: "", planMd: "", acMap: [{ n: 1, ac: "a", files: [], test: "" }], repos: ["web"] }, ["api"]);
  assert.deepEqual(issues, [
    "`planMd` is empty — the plan has no goal or steps.",
    "No branch name was proposed.",
    'Acceptance criterion 2 ("b") is not mapped.',
    'Acceptance criterion 1 ("a") changes code but names no file — or mark it change=none.',
    'Acceptance criterion 1 ("a") names no test.',
    'Repository "web" is not one this run was given (api).',
  ]);
  assert.deepEqual(planIssues(["a"], { branch: "feature/x", planMd: "## Goal", acMap: [{ n: 1, ac: "a", files: ["x"], test: "T" }], repos: ["api"] }, ["api"]), []);
});

test("plan check matches criteria by number, and a no-change criterion needs a way to verify, not a file", () => {
  const base = { branch: "b", planMd: "## Goal", repos: [] };
  // Two rows for AC 1 used to pass a count check while AC 2 was left out.
  assert.deepEqual(planIssues(["a", "b"], { ...base, acMap: [{ n: 1, ac: "a", files: ["f"], test: "t" }, { n: 1, ac: "a", files: ["g"], test: "t" }] }, []), [
    "Acceptance criterion 1 is mapped 2 times — map it once.",
    'Acceptance criterion 2 ("b") is not mapped.',
  ]);
  assert.deepEqual(planIssues(["branch exists on origin"], { ...base, acMap: [{ n: 1, ac: "branch exists", change: "none", files: [], test: "git ls-remote origin" }] }, []), []);
  assert.deepEqual(planIssues(["x"], { ...base, acMap: [{ n: 1, ac: "x", change: "none", files: [], test: "" }] }, []), ['Acceptance criterion 1 ("x") names no way to verify it.']);
  assert.deepEqual(planIssues(["x"], { ...base, acMap: [{ n: 3, ac: "x", files: ["f"], test: "t" }] }, []), [
    'Acceptance criterion 1 ("x") is not mapped.',
    'Acceptance criterion 3 ("x") has no number from 1 to 1.',
  ]);
});

test("the plan file is the planner's prose plus the AC map, risks and decisions rendered from its fields", () => {
  const md = renderPlan({
    planMd: "## Goal\nExempt Historical.",
    acMap: [
      { n: 1, ac: "Historical | passes", change: "code", files: ["a.cs", "b.cs"], test: "T1" },
      { n: 2, ac: "Approve still checks", change: "none", files: [], test: "diff leaves it untouched" },
    ],
    risks: ["mocks"],
    decisions: [{ point: "where", decision: "a flag", why: "AC3" }],
  });
  assert.match(md, /^## Goal\nExempt Historical\.\n\n## Acceptance criteria → files → test/);
  assert.match(md, /\| 1 \| Historical \\\| passes \| code \| a\.cs, b\.cs \| T1 \|/);
  assert.match(md, /\| 2 \| Approve still checks \| none \| — \| diff leaves it untouched \|/);
  assert.match(md, /## Risks\n- mocks/);
  assert.match(md, /\| 1 \| where \| a flag \| AC3 \|/);
  assert.match(renderPlan({ planMd: "x" }), /## Risks\nnone\n\n## Decisions\nnone$/);
});

test("planned files leave out no-change criteria; the briefs say no change and how it is verified", () => {
  const plan = { branch: "b", acMap: [{ n: 1, ac: "a", change: "code", files: ["x.ts"], test: "t" }, { n: 2, ac: "b", change: "none", files: ["y.ts"], test: "read y.ts" }] };
  assert.deepEqual(plannedFiles({ channels: { plan } }), ["x.ts"]);
  assert.match(implementPrompt(ctx({ plan })), /2\. b\n   no code change \(lives in y\.ts\)\n   verify: read y\.ts/);
});

test("the planner gets readiness's code leads; no other role does", () => {
  const readiness = { ...DIGESTED, acceptanceCriteria: ["a"], codeLeads: [{ at: "src/Import.cs:260", what: "the min-fee rule runs here" }] };
  const brief = planPrompt(ctx({ readiness }));
  assert.match(brief, /## Code leads\n.*read each before you rely on it\.\n- src\/Import\.cs:260 — the min-fee rule runs here/);
  assert.doesNotMatch(implementPrompt(ctx({ readiness })), /Code leads|Import\.cs/);
  assert.doesNotMatch(planPrompt(ctx({ readiness: DIGESTED })), /Code leads/);
});

test("plan check refuses a code change for a criterion readiness proved delivered", () => {
  const plan = { branch: "b", planMd: "## Goal", repos: [], acMap: [{ n: 1, ac: "a", change: "code", files: ["f"], test: "t" }, { n: 2, ac: "b", change: "none", files: [], test: "t" }] };
  assert.deepEqual(planIssues(["a", "b"], plan, [], ["b"]), []);
  assert.deepEqual(planIssues(["a", "b"], plan, [], ["a"]), [
    'Acceptance criterion 1 ("a") is already delivered on the base (readiness proved it) — map it change=none to where it lives.',
  ]);
});

test("a re-plan gets the refused plan to amend, not just the issues", () => {
  const plan = { branch: "b", planMd: "## Goal\nKeep me.", acMap: [{ n: 1, ac: "a", files: [], test: "" }], risks: [], decisions: [] };
  const brief = planPrompt(ctx({ readiness: { ...DIGESTED, acceptanceCriteria: ["a"] }, plan, planCheck: { passed: false, issues: ["AC 1 names no test."] } }));
  assert.match(brief, /1\. AC 1 names no test\./);
  assert.match(brief, /only what the issues name changed/);
  assert.match(brief, /## Goal\nKeep me\./);
  assert.doesNotMatch(planPrompt(ctx({ readiness: DIGESTED })), /Previous plan refused/);
});

test("the implement brief carries the plan steps and asks for manual checks; the PR description lists them", () => {
  const plan = { branch: "b", planMd: "## Steps\n1. Edit Foo.cs" };
  const brief = implementPrompt(ctx({ plan }));
  assert.match(brief, /## Plan steps\n## Steps\n1\. Edit Foo\.cs/);
  assert.match(brief, /you need not read it/);
  assert.match(brief, /`manualChecks`/);
  const c = ctx({ plan, implement: { manualChecks: [{ n: 4, check: "Dev URL shows the login page" }] }, fix: { manualChecks: [] }, diffGuard: { changed: [{ repo: "billing-api", branch: "b" }] } });
  assert.match(publishPrompt(c), /## Manual checks after deploy\n- \[ \] AC 4: Dev URL shows the login page/);
  assert.doesNotMatch(publishPrompt(ctx({ plan, diffGuard: c.channels.diffGuard })), /Manual checks/);
});

test("a code change with no tests run warns the reviewer; no change with no tests does not", () => {
  const warn = (d: Record<string, unknown>) => warningsOf(ctx({ implement: d })).map((w) => w.issue);
  assert.ok(warn({ filesChanged: 2, verification: { tests: "not-run", build: "passed", acceptanceCriteria: "met" } }).some((w) => /ran no tests/.test(w)));
  assert.ok(!warn({ filesChanged: 0, verification: { tests: "not-run", build: "passed", acceptanceCriteria: "met" } }).some((w) => /ran no tests/.test(w)));
});

test("the view shows a delivery's deviations and manual checks, and what the plan check covered", () => {
  const out = outputOf("implement", { summary: "s", filesChanged: 1, verification: {}, deviations: [{ what: "AC5 unverified", why: "no DB" }], manualChecks: [{ n: 4, check: "login" }] }, 1, "");
  assert.ok(out && out.node === "implement");
  assert.deepEqual(out.deviations, [{ what: "AC5 unverified", why: "no DB" }]);
  assert.deepEqual(out.manualChecks, [{ n: 4, check: "login" }]);
  const pc = outputOf("planCheck", { passed: true, issues: [], checked: { criteria: 2, mapped: 2, code: 1, none: 1, files: 3, repos: ["api"] } }, 1, "");
  assert.deepEqual(pc && pc.node === "planCheck" ? pc.checked : null, { criteria: 2, mapped: 2, code: 1, none: 1, files: 3, repos: ["api"] });
});

test("knowledge diff and PR numbers", () => {
  assert.deepEqual(knowledgeDiff("a\nb\n", "a\nc\n"), { added: ["c"], removed: ["b"] });
  assert.equal(knowledgeDiff("a", "a"), null);
  assert.equal(prNumber("https://dev.azure.com/o/p/_git/r/pullrequest/412"), 412);
});

test("an agent whose tools omit StructuredOutput is refused", () => {
  const def = parseAgent("---\nname: planner\ntools: Read, Grep\n---\nbody")!;
  assert.match(agentProblem("planner", def), /StructuredOutput/);
  assert.equal(agentProblem("planner", parseAgent("---\nname: planner\ndisallowedTools: Edit, Write\n---\nbody")!), "");
  assert.equal(agentProblem("planner", null), "Agent planner is not installed in ~/.claude/agents.");
});

test("a related repository's note comes from its line in the instructions", () => {
  const md = "## Related repositories\n- ReportingService — `C:\\src\\ReportingService` — PDF reports. Needed for report pages.\n- Report services: `C:\\src\\RFI`\n";
  assert.equal(companionNote(md, "C:\\src\\ReportingService"), "ReportingService — PDF reports. Needed for report pages.");
  assert.equal(companionNote(md, "C:\\src\\RFI"), "Report services");
});

test("related repositories are offered on demand before the plan, then scoped by it", () => {
  const companions = [
    { name: "ReportingService", path: "C:\\src\\ReportingService", cwd: "C:\\src\\ReportingService\\.te-worktrees\\dagent-r1", baseSha: "def", note: "PDF reports" },
    { name: "RFI", path: "C:\\src\\RFI", cwd: "C:\\src\\RFI\\.te-worktrees\\dagent-r1", baseSha: "123" },
  ];
  const before = readinessPrompt({ ...ctx(), companions });
  assert.match(before, /open one only when the ticket needs it/);
  assert.match(before, /"ReportingService".*PDF reports.*CLAUDE\.local\.md/);
  const after = implementPrompt({ ...ctx({ plan: { branch: "feature/x", repos: ["ReportingService"] } }), companions });
  assert.match(after, /"ReportingService" \(in scope/);
  assert.match(after, /do not read or change: RFI/);
});

test("the readiness brief is sectioned, and holds delivery proof to one line per delivered criterion", () => {
  const brief = readinessPrompt(ctx());
  const at = (h: string) => brief.indexOf(`## ${h}\n`);
  assert.ok(at("Context") === 0 && at("Context") < at("Checking delivery") && at("Checking delivery") < at("Your job") && at("Your job") < at("Skills"));
  assert.match(brief, /Partly done or unverified is not delivered/);
  assert.match(brief, /`proof` is one line/);
  assert.match(brief, /Never describe criteria that are not delivered there/);
  assert.match(brief, /Write `digest`/);
});

const DIGESTED = {
  title: "Export invoices",
  type: "User Story",
  digest: { summary: "Add a CSV export to the invoice list.", details: ["Column order: number, date, total", "PO: dates in ISO 8601"] },
  acceptanceCriteria: ["AC1"],
  ambiguities: [],
};

test("the readiness brief carries the work item the harness read, and a recheck names what was asked", () => {
  assert.equal(richToText("<p>Hello&nbsp;<b>world</b></p><ul><li>one</li><li>two &amp; three</li></ul><img src=x>"), "Hello world\n- one\n- two & three\n[image]");
  const workItem = { title: "Export invoices", type: "User Story", state: "Active", description: "Add a CSV export.", criteria: "- AC1", comments: [{ author: "PO", date: "Nov 4", text: "Use ISO dates." }] };
  const first = readinessPrompt({ ...ctx(), workItem });
  assert.match(first, /## Work item\n[\s\S]*Use ISO dates\./);
  assert.match(first, /1\. Read the work item above/);
  assert.doesNotMatch(first, /## Previous readiness check/);
  // No work item read (provider not wired, or the read failed): the analyst is sent to MCP as before.
  assert.match(readinessPrompt(ctx()), /through the provider's MCP server/);
  const recheck = readinessPrompt({ ...ctx({ readiness: { ready: false, questions: ["Which date format?"], missing: [], checkedAt: "2026-11-04T10:00:00Z" } }), workItem });
  assert.match(recheck, /## Previous readiness check\n[\s\S]*1\. Which date format\?[\s\S]*Never ask again/);
});

const ALL_BRIEFS = { readinessPrompt, planPrompt, implementPrompt, evaluatePrompt, fixPrompt, reflectPrompt, publishPrompt, qaTriagePrompt, qaImplementPrompt, reviewTriagePrompt, reviewImplementPrompt, respondPrompt };

test("every agent brief opens with Context and ends with Your job (bar the skill menu), with no empty section", () => {
  const c = ctx({
    readiness: DIGESTED,
    plan: { branch: "feature/x", acMap: [{ ac: "AC1", files: ["a.ts"], test: "t" }], repos: [], risks: [], decisions: [] },
    implement: { summary: "Did it.", deviations: [] },
    evaluate: { blockers: [{ file: "a.ts", issue: "x" }] },
  });
  for (const [name, build] of Object.entries(ALL_BRIEFS)) {
    const brief = build(c);
    assert.ok(brief.startsWith("## Context\n"), name);
    const job = brief.indexOf("## Your job\n");
    assert.ok(job > 0, `${name}: has Your job`);
    assert.doesNotMatch(brief, /## [^\n]+\n(\n|$)/, `${name}: no empty section`);
    const after = [...brief.slice(job + 1).matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(after.filter((h) => h !== "Skills"), [], `${name}: only the skill menu follows Your job`);
  }
});

test("every role after the judging one is briefed on the ticket digest instead of the work item", () => {
  const c = ctx({ readiness: DIGESTED, plan: { branch: "feature/x", acMap: [], repos: [], risks: [], decisions: [] } });
  const judging = ["readinessPrompt", "qaTriagePrompt", "reviewTriagePrompt"];
  for (const [name, build] of Object.entries(ALL_BRIEFS)) {
    const brief = build(c);
    if (judging.includes(name) || name === "respondPrompt") {
      assert.doesNotMatch(brief, /## Ticket\n/, `${name}: writes or does not need the digest`);
      continue;
    }
    assert.match(brief, /## Ticket\n/, name);
    assert.match(brief, /Title: Export invoices \(User Story\)/, name);
    assert.match(brief, /- Column order: number, date, total/, name);
    assert.ok(brief.indexOf("## Ticket\n") < brief.indexOf("## Your job\n"), `${name}: the digest leads with the shared header`);
  }
  for (const name of judging) assert.match(ALL_BRIEFS[name as keyof typeof ALL_BRIEFS](c), /`digest`/, `${name}: asked to write it`);
  assert.equal(digestOf(ctx({ readiness: { title: "x", digest: { summary: "", details: [] } } })), null);
});

test("roles that only push and reply are not briefed on project knowledge", () => {
  const c = ctx({ readiness: DIGESTED });
  assert.doesNotMatch(publishPrompt(c), /Project knowledge:/);
  assert.doesNotMatch(respondPrompt(c), /Project knowledge:/);
  assert.match(implementPrompt(c), /Project knowledge:/);
  assert.match(reflectPrompt(c), /Project knowledge:/);
});

test("the fixer gets the reviewer's evidence and expected result with each blocker", () => {
  const c = ctx({
    plan: { branch: "feature/x", acMap: [], repos: [], risks: [], decisions: [] },
    evaluate: { blockers: [{ file: "a.ts:12", issue: "Total drops tax", evidence: "`a.ts:12` `return net;`", expected: "Total includes tax" }] },
  });
  assert.deepEqual(bundleOf(c), [{ source: "evaluate", file: "a.ts:12", issue: "Total drops tax", evidence: "`a.ts:12` `return net;`", expected: "Total includes tax" }]);
  assert.match(fixPrompt(c), /1\. \[evaluate\] a\.ts:12 — Total drops tax\n {3}evidence: `a\.ts:12` `return net;`\n {3}expected: Total includes tax/);
});

test("a re-review is briefed on the delta since the heads the last review judged", () => {
  const first = evaluatePrompt(ctx({ diffGuard: { heads: { "billing-api": "h1" } } }, { evaluate: 1 }));
  assert.doesNotMatch(first, /## Re-review/);
  const again = evaluatePrompt(ctx({ evaluate: { blockers: [], reviewedHeads: { "billing-api": "h1" } }, fix: { input: [{ source: "evaluate", file: "a.ts", issue: "x" }] } }, { evaluate: 2 }));
  assert.match(again, /## Re-review\n/);
  assert.match(again, /billing-api: `git diff h1\.\.HEAD`/);
  assert.match(again, /Do not reopen what the last review passed/);
  assert.deepEqual(reviewedHeadsOf(ctx({})), {});
});

test("a skill is summarised by what it does and when to use it, each cut on a word", () => {
  assert.equal(skillSummary("Upgrades .NET to net10.0. Use when the user mentions it."), "Upgrades .NET to net10.0. Use when the user mentions it.");
  assert.equal(skillSummary("Fix a GitHub issue. Reads the issue first. Use for bug tickets."), "Fix a GitHub issue. Use for bug tickets.");
  assert.equal(skillSummary("Stage and commit the current changes"), "Stage and commit the current changes");
  assert.equal(skillSummary(""), "");
  const long = skillSummary(`${"word ".repeat(60)}end.`, 40);
  assert.ok(long.endsWith("…") && long.length <= 41 && !/wor…$/.test(long));
});

test("the view maps engine outputs onto the workflow UI shapes", () => {
  const ev = outputOf("evaluate", { verdict: "changes-required", blockers: [{ file: "a.ts", issue: "x" }] }, 2, "");
  assert.deepEqual(ev, { node: "evaluate", verdict: "changes-required", blockers: [{ source: "evaluate", file: "a.ts", issue: "x" }], reviewedDelta: true, checked: [], assumptions: [], reviewNotes: [] });
  const pub = outputOf("publish", { prs: [{ repo: "api", prUrl: "https://x/pullrequest/7", isDraft: true, reusedExisting: false }] }, 1, "");
  assert.deepEqual(pub, { node: "publish", prs: [{ repo: "api", number: 7, url: "https://x/pullrequest/7", draft: true, reusedExisting: false }] });
  assert.equal(outputOf("implement", {}, 1, ""), null);
});

test("an agent turn cannot invoke a Ticket Execution or hand-run skill, or spawn a subagent", () => {
  const args = turnArgs({ agent: "implementer", prompt: "p", schema: {}, mcpConfigPath: "", model: "", effort: "", cwd: "/nowhere", addDirs: [] }, "s1");
  const denied = args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--json-schema"));
  assert.deepEqual(denied, ["Agent", ...DENIED_SKILLS.map((s) => `Skill(${s})`)]);
  for (const s of [...BUNDLED_SKILLS, "implement-ticket", "fix-code-review", "dev-team"]) assert.ok(denied.includes(`Skill(${s})`), s);
});

test("the repo ships every agent the graph runs, each valid and versioned", () => {
  assert.deepEqual([...BUNDLED_AGENTS].sort(), allAgents().sort());
  for (const name of BUNDLED_AGENTS) {
    const file = path.join(process.cwd(), "agents", `${name}.md`);
    assert.equal(agentProblem(name, parseAgent(readFileSync(file, "utf8"))), "", name);
    assert.notEqual(readVersion(file), "0.0.0", `${name} has no version`);
  }
});

test("a skill's name and description come from its front matter, folded descriptions included", () => {
  assert.deepEqual(skillFrontMatter("---\nname: dotnet-upgrade-10\ndescription: Upgrades .NET to net10.0.\n---\n# body"), {
    name: "dotnet-upgrade-10",
    description: "Upgrades .NET to net10.0.",
  });
  assert.deepEqual(skillFrontMatter("---\r\nname: x\r\ndescription: >\r\n  first line\r\n  second line\r\n---\r\n"), { name: "x", description: "first line second line" });
  assert.deepEqual(skillFrontMatter("# no front matter"), { name: "", description: "" });
});

test("picked skills and their base branch reach every later brief and the publisher", () => {
  const readiness = {
    skills: [{ name: "dotnet-upgrade-10", file: "/home/.claude/skills/dotnet-upgrade-10/SKILL.md", reason: "upgrade ticket" }],
    bases: { "billing-api": "feature/dotnet-10-upgrade" },
  };
  const c = ctx({ readiness, plan: { branch: "feature/4182-x" }, diffGuard: { changed: [{ repo: "billing-api", branch: "feature/4182-x", files: 2 }] } });
  assert.equal(skillsOf(c).length, 1);
  assert.deepEqual(basesOf(c), { "billing-api": "feature/dotnet-10-upgrade" });
  const impl = implementPrompt(c);
  assert.match(impl, /dotnet-upgrade-10: \/home\/\.claude\/skills\/dotnet-upgrade-10\/SKILL\.md/);
  assert.match(impl, /this brief wins/);
  assert.match(impl, /billing-api on origin\/feature\/dotnet-10-upgrade/);
  assert.match(publishPrompt(c), /pull request into `feature\/dotnet-10-upgrade`/);
  assert.match(publishPrompt(ctx({ diffGuard: c.channels.diffGuard })), /pull request into the default branch/);
  assert.doesNotMatch(implementPrompt(ctx({ plan: { branch: "b" } })), /Skills that apply/);
});

test("implement, fix and evaluate briefs carry the plan's AC map, risks and scope as data", () => {
  const plan = {
    branch: "feature/x",
    acMap: [{ ac: "Y axis spans 0%..100%", files: ["chart1.xml", "Helper.cs"], test: "HelperTests.AxisRange" }],
    risks: ["Templates are read from Blob Storage"],
    repos: ["ReportingService"],
  };
  const c = ctx({ plan, implement: { summary: "s", deviations: [] } });
  for (const brief of [implementPrompt(c), fixPrompt(c), evaluatePrompt(c)]) {
    assert.match(brief, /1\. Y axis spans 0%\.\.100%\n   files: chart1\.xml, Helper\.cs\n   test: HelperTests\.AxisRange/);
    assert.match(brief, /- Templates are read from Blob Storage/);
    assert.match(brief, /Repositories in scope: ReportingService/);
  }
  assert.doesNotMatch(implementPrompt(ctx({})), /approved plan maps/);
});

test("evaluate gets the last delivery's summary and deviations as claims, not facts", () => {
  const implement = { summary: "Scaled the axis.", deviations: [{ what: "AC2 left out", why: "static layout" }] };
  const brief = evaluatePrompt(ctx({ implement }));
  assert.match(brief, /claims to check against the diff, not facts/);
  assert.match(brief, /Summary: Scaled the axis\./);
  assert.match(brief, /1\. AC2 left out — static layout/);
  // After a fix round the fixer's account replaces the implementer's.
  assert.match(evaluatePrompt(ctx({ implement, fix: { summary: "Fixed the label.", deviations: [] } })), /Summary: Fixed the label\./);
  assert.doesNotMatch(evaluatePrompt(ctx({})), /claims to check/);
});

test("buildView attaches each step's brief from its brief:<stepId> artifact", () => {
  const at = new Date(0);
  const row = { id: "r1", ticketId: "1", ticketUrl: "", ticketTitle: "", provider: "azure-devops", project: "p", rootRepo: "/r", graphId: GRAPH.id, state: "succeeded", waitReason: "", currentNodeId: "END", errorMessage: "", gates: [], retryOfId: "", entryNode: "", prUrl: "", startedAt: at, endedAt: at };
  const step = (id: string, nodeId: string) => ({ id, nodeId, attempt: 1, status: "succeeded", input: null, output: {}, errorMessage: "", logLines: [], costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, numTurns: 0, startedAt: at, endedAt: at });
  const view = buildView(row, [step("s1", "setup"), step("s2", "plan")], [], [{ kind: "brief:s2", body: "plan brief", createdAt: at }, { kind: "plan", body: "# P", createdAt: at }], null);
  assert.deepEqual(view.run.steps.map((s) => s.brief), ["", "plan brief"]);
});

test("the plan's decisions reach implement, fix, evaluate and the PR description; the reviewer may not reopen them", () => {
  const decisions = [{ point: "Do the 100%..30% labels move too", decision: "Yes, re-lay them out to 0%..100%", why: "they are static text boxes, word/document.xml" }];
  const c = ctx({
    plan: { branch: "feature/x", acMap: [{ ac: "a", files: ["f"], test: "t" }], decisions },
    diffGuard: { changed: [{ repo: "billing-api", branch: "feature/x" }] },
  });
  const line = /1\. Do the 100%\.\.30% labels move too → Yes, re-lay them out to 0%\.\.100% \(they are static text boxes, word\/document\.xml\)/;
  for (const brief of [implementPrompt(c), fixPrompt(c), evaluatePrompt(c)]) {
    assert.match(brief, /build to these, do not reopen them/);
    assert.match(brief, line);
  }
  assert.match(evaluatePrompt(c), /never for preferring another reasonable reading/);
  assert.match(publishPrompt(c), /## Decisions\n/);
  assert.match(publishPrompt(c), line);
  // No decisions: no extra lines anywhere.
  const bare = ctx({ plan: { branch: "feature/x" }, diffGuard: c.channels.diffGuard });
  assert.doesNotMatch(evaluatePrompt(bare), /judgement calls/);
  assert.doesNotMatch(publishPrompt(bare), /Decisions/);
});

test("planIssues refuses a decision that does not state both the point and the reading", () => {
  const plan = { branch: "b", planMd: "## Goal", acMap: [{ n: 1, ac: "a", files: ["f"], test: "t" }], repos: [] };
  assert.deepEqual(planIssues(["a"], { ...plan, decisions: [{ point: "unit", decision: "percent", why: "" }] }, []), []);
  assert.deepEqual(planIssues(["a"], { ...plan, decisions: [{ point: "unit", decision: " " }] }, []), [
    "Decision 1 does not state both the open point and the reading chosen.",
  ]);
  assert.deepEqual(planIssues(["a"], plan, []), []);
});

test("outputOf maps the plan's decisions, and an older plan without them reads as none", () => {
  const d = { point: "p", decision: "d", why: "w" };
  const out = outputOf("plan", { acMap: [], repos: [], risks: [], decisions: [d] }, 1, "");
  assert.deepEqual(out && out.node === "plan" ? out.decisions : null, [d]);
  const old = outputOf("plan", { acMap: [], repos: [], risks: [] }, 1, "");
  assert.deepEqual(old && old.node === "plan" ? old.decisions : null, []);
});

test("each plan attempt shows its own planMd, not the run's last plan artifact; old AC rows read as numbered code changes", () => {
  const out = outputOf("plan", { acMap: [{ ac: "a", files: ["f"], test: "t" }], planMd: "## Goal\nattempt 1" }, 1, "## Goal\nattempt 2");
  assert.ok(out && out.node === "plan");
  assert.equal(out.planMd, "## Goal\nattempt 1");
  assert.deepEqual(out.acMap, [{ n: 1, ac: "a", change: "code", files: ["f"], test: "t" }]);
});

test("the view keeps the reviewer's evidence on a blocker, shows it as a table, and keeps a judging role's digest", () => {
  const ev = outputOf("evaluate", { verdict: "changes-required", blockers: [{ file: "a.ts:3", issue: "x", evidence: "`return 1;`", expected: "returns 2" }] }, 1, "");
  assert.deepEqual(ev && ev.node === "evaluate" ? ev.blockers : null, [{ source: "evaluate", file: "a.ts:3", issue: "x", evidence: "`return 1;`", expected: "returns 2" }]);
  const [sec] = refusalSections(ev && ev.node === "evaluate" ? ev.blockers : []);
  assert.equal(sec.kind, "table");
  assert.ok(sec.kind === "table" && sec.expandable && sec.cols.join() === "Blocker,File,Evidence,Expected");
  assert.equal(refusalSections([{ source: "evaluate", issue: "y" }])[0].kind, "list");
  const r = outputOf("readiness", { ready: true, digest: { summary: "S", details: ["d1"] } }, 1, "");
  assert.deepEqual(r && r.node === "readiness" ? r.digest : null, { summary: "S", details: ["d1"] });
  assert.ok(outSections(r).some((s) => s.kind === "md" && s.text === "S\n\n- d1"));
  const old = outputOf("readiness", { ready: true }, 1, "");
  assert.equal(old && old.node === "readiness" ? old.digest : "x", undefined);
});

test("a brief is measured, outlined by its sections, and diffed line by line against the attempt before", () => {
  assert.deepEqual(briefOutline("## Context\na\n\n## Your job\nb"), [{ title: "Context", line: 0 }, { title: "Your job", line: 3 }]);
  assert.equal(briefTokens("x".repeat(9)), 3);
  assert.equal(cacheHit(0, 0), "—");
  assert.equal(cacheHit(250, 750), "75%");
  assert.deepEqual(lineDiff("a\nb\nc", "a\nc\nd"), [
    { op: "same", text: "a" },
    { op: "del", text: "b" },
    { op: "same", text: "c" },
    { op: "add", text: "d" },
  ]);
  assert.ok(lineDiff("same", "same").every((l) => l.op === "same"));
});
