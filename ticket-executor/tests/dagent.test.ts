import test from "node:test";
import assert from "node:assert/strict";
import { agentProblem, parseAgent } from "../lib/dagent/agents";
import { DENIED_SKILLS, turnArgs } from "../lib/dagent/cli";
import { agentsOf, allAgents, flowOf, GRAPH, GRAPHS, graphById, MAX_FIX_ATTEMPTS, MAX_PLAN_ATTEMPTS, QA_GRAPH, REVIEW_GRAPH } from "../lib/dagent/graph";
import { implementPrompt, publishPrompt, readinessPrompt } from "../lib/dagent/prompts";
import { basesOf, bundleOf, deliveryOf, diffViolations, isPlanned, knowledgeDiff, planIssues, prNumber, skillFrontMatter, skillsOf, warningsOf } from "../lib/dagent/rules";
import { companionNote } from "../lib/repoContext";
import { readFileSync } from "fs";
import path from "path";
import { BUNDLED_AGENTS } from "../lib/agentPack";
import { BUNDLED_SKILLS, readVersion } from "../lib/skillPack";
import { END, FAIL, NEEDS_INPUT, NEEDS_REVIEW, TERMINALS, ZERO_USAGE, type Ctx, type NodeResult } from "../lib/dagent/types";
import { outputOf } from "../lib/dagent/view";

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

test("sync and diff guard only warn — they never route to fix", () => {
  assert.equal(edge("syncBase", ctx(), ok({ warnings: [{ source: "syncBase", file: "", issue: "conflict" }] })).to, "diffGuard");
  const d = edge("diffGuard", ctx(), ok({ warnings: [{ source: "diffGuard", file: "", issue: "x" }] }));
  assert.equal(d.to, "evaluate");
  assert.match(d.reason, /1 warning/);
});

test("fix receives only the review's blockers; harness findings are warnings", () => {
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
  assert.deepEqual(GRAPH.edges.implement(ctx(), clean), { to: NEEDS_REVIEW, reason: "no code change needed — a person confirms" });
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
  const issues = planIssues(["a", "b"], { branch: "", acMap: [{ ac: "a", files: [], test: "" }], repos: ["web"] }, ["api"], false);
  assert.equal(issues.length, 6);
  assert.deepEqual(planIssues(["a"], { branch: "feature/x", acMap: [{ ac: "a", files: ["x"], test: "T" }], repos: ["api"] }, ["api"], true), []);
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

test("the view maps engine outputs onto the workflow UI shapes", () => {
  const ev = outputOf("evaluate", { verdict: "changes-required", blockers: [{ file: "a.ts", issue: "x" }] }, 2, "");
  assert.deepEqual(ev, { node: "evaluate", verdict: "changes-required", blockers: [{ source: "evaluate", file: "a.ts", issue: "x" }], reviewedDelta: true });
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
