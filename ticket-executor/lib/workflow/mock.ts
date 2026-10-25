import { STAGES, plural } from "./meta";
import type {
  Effects,
  FlowNodeDef,
  GateResult,
  LifecycleStage,
  NodeKind,
  NodeOutput,
  PhaseKey,
  Refusal,
  Run,
  RunChip,
  RunFailure,
  RunState,
  Scenario,
  Step,
  StepStatus,
  Transition,
  WaitReason,
  KnowledgeDiff,
  RefusalBundle,
} from "./types";

type Ctx = "" | "fresh" | "resume";

const D = (
  id: string,
  label: string,
  phase: string,
  kind: NodeKind,
  effects: Effects,
  context: Ctx,
  next: string[],
  maxVisits?: number,
): FlowNodeDef => ({ id, label, phase, kind, effects, context, next, maxVisits });

const GATES = [
  D("preflight", "Preflight", "pre-run", "gate", "pure", "", ["admission"]),
  D("admission", "Admission", "pre-run", "gate", "pure", "", ["setup"]),
];

const IMPL: FlowNodeDef[] = GATES.concat([
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
]);

const fixFlow = (withEval: boolean): FlowNodeDef[] =>
  GATES.concat([
    D("setup", "Prepare workspace", "prepare", "check", "local", "", ["syncBase"]),
    D("syncBase", "Sync with base", "build", "check", "local", "", ["fix"]),
    D("fix", "Fix refusals", "verify", "agent", "local", "resume", ["testGate", "reflect"], 5),
    D("testGate", "Test gate", "verify", "check", "pure", "", ["diffGuard", "fix"]),
    D("diffGuard", "Diff guard", "verify", "check", "pure", "", [withEval ? "evaluate" : "prePublish", "fix"]),
    ...(withEval ? [D("evaluate", "Independent review", "verify", "agent", "pure", "fresh", ["prePublish", "fix"])] : []),
    D("reflect", "Record lesson", "verify", "agent", "local", "fresh", ["FAIL"]),
    D("prePublish", "Pre-publish check", "publish", "check", "pure", "", ["publish"]),
    D("publish", "Push fix", "publish", "harness", "external", "", ["verifyPublish"], 1),
    D("verifyPublish", "Verify PR", "publish", "check", "pure", "", ["END", "NEEDS_REVIEW"]),
  ]);

const prUrl = (repo: string, n: number) => `https://dev.azure.com/contoso/billing/_git/${repo}/pullrequest/${n}`;

const R: Record<string, Refusal> = {
  t1: { source: "testGate", file: "billing-api/", issue: "billing-api: the change adds or updates no test and gives no reason in `testExemption`" },
  d1: { source: "diffGuard", file: "billing-api/appsettings.Development.json", issue: "Config file outside the plan (rule: no-unplanned-config)" },
  e1: { source: "evaluate", file: "billing-web/src/invoices/ExportButton.tsx", issue: "Export ignores the active ledger filter (AC2)" },
  e2: { source: "evaluate", file: "billing-api/Invoices/CsvWriter.cs", issue: "Amounts use the current culture; AC4 needs invariant, 2 dp" },
  e3: { source: "evaluate", file: "billing-api/Invoices/ExportController.cs", issue: "Buffers every row in memory; the plan says stream" },
  e4: { source: "evaluate", file: "billing-api/Invoices/CsvColumns.cs", issue: "Header order differs from the ticket sample" },
  a1: { source: "acceptance", issue: "AC3 has no test for a 24-month range" },
  c1: { source: "ci", file: "billing-web/src/invoices/ExportButton.test.tsx", issue: 'Job web-unit · "disables while exporting" timed out (5000 ms)' },
  c2: { source: "ci", file: "billing-api/Invoices/CsvWriter.cs:88", issue: "Job api-lint · CA1305 culture-specific ToString" },
  r1: { source: "review-thread", file: "billing-api/Invoices/ExportController.cs", issue: "Rename the route to /invoices/export.csv" },
  r2: { source: "review-thread", file: "billing-web/src/invoices/ExportButton.tsx", issue: "Use the shared <AsyncButton> instead of local state" },
  q1: { source: "qa", issue: "Export of a 0-invoice ledger downloads an empty file without header (Edge)" },
};

type OutOverride = Record<string, unknown>;

function output(id: string, k: number, ov?: OutOverride): NodeOutput {
  const base: Record<string, NodeOutput> = {
    setup: { node: "setup", mode: "worktree", branch: "feature/AB-4182-invoice-csv", baseSha: "a41c9e2", repos: [{ name: "billing-api", path: "~/.te/wt/AB-4182/billing-api" }, { name: "billing-web", path: "~/.te/wt/AB-4182/billing-web" }] },
    readiness: { node: "readiness", ready: true, missing: [], ambiguities: [], questions: [] },
    plan: {
      node: "plan",
      acMap: [
        { ac: "AC1 · Export button on the invoice list", files: ["billing-web/src/invoices/ExportButton.tsx", "billing-web/src/invoices/InvoiceList.tsx"], test: "ExportButton.test.tsx" },
        { ac: "AC2 · Export honours the active ledger filter", files: ["billing-api/Invoices/InvoiceQuery.cs"], test: "InvoiceQueryTests.FilterByLedger" },
        { ac: "AC3 · Date range up to 24 months", files: ["billing-api/Invoices/ExportController.cs"], test: "ExportControllerTests.RangeLimit" },
        { ac: "AC4 · Amounts in invariant culture, 2 dp", files: ["billing-api/Invoices/CsvWriter.cs", "billing-api/Invoices/CsvColumns.cs"], test: "CsvWriterTests.InvariantAmounts" },
      ],
      repos: ["billing-api", "billing-web"],
      risks: ["Large ledgers — stream rows instead of buffering", "Ledger filter lives in URL state on web and in the query DTO on api"],
      planMd: "Approach\n1. Add GET /invoices/export that streams text/csv.\n2. Reuse InvoiceQuery so the export matches the list filters.\n3. Add ExportButton next to the filter bar; disable it while exporting.\n\nOut of scope\nPDF export, scheduled exports.",
    },
    planCheck: { node: "planCheck", passed: true, issues: [] },
    implement: { node: "implement", commitSha: "9f3b21c", summary: "Streaming CSV export endpoint and an ExportButton wired to the ledger filter.", filesChanged: 14, testExemption: "", verification: { tests: "passed", build: "passed", acceptanceCriteria: "met" } },
    syncBase: { node: "syncBase", rebased: false, behindBy: 0, conflicts: [] },
    testGate: { node: "testGate", passed: true, results: [{ repo: "billing-api", branch: "feature/AB-4182-invoice-csv", files: 9, tests: ["billing-api/tests/CsvWriterTests.cs", "billing-api/tests/ExportControllerTests.cs"], passed: true, issue: "" }, { repo: "billing-web", branch: "feature/AB-4182-invoice-csv", files: 5, tests: ["billing-web/src/invoices/ExportButton.test.tsx"], passed: true, issue: "" }] },
    diffGuard: { node: "diffGuard", passed: true, violations: [] },
    evaluate: { node: "evaluate", verdict: "pass", blockers: [], reviewedDelta: k > 1 },
    fix: { node: "fix", commitSha: `c${k}e7a10`, summary: "Addressed the refusal bundle.", filesChanged: 3, testExemption: "", verification: { tests: "passed", build: "passed", acceptanceCriteria: "met" }, addressed: [] },
    reflect: { node: "reflect", recorded: true, lesson: "" },
    prePublish: { node: "prePublish", passed: true, issues: [] },
    publish: { node: "publish", prs: [{ repo: "billing-api", number: 412, url: prUrl("billing-api", 412), draft: true, reusedExisting: false }, { repo: "billing-web", number: 198, url: prUrl("billing-web", 198), draft: true, reusedExisting: false }] },
    verifyPublish: { node: "verifyPublish", passed: true, checks: [{ name: "billing-api #412 is a draft", ok: true }, { name: "billing-web #198 is a draft", ok: true }, { name: "Branches are feature/AB-4182-invoice-csv", ok: true }, { name: "AB#4182 linked on both PRs", ok: true }] },
  };
  return { ...base[id], ...(ov ?? {}) } as NodeOutput;
}

const failTestGate: OutOverride = {
  passed: false,
  results: [
    { repo: "billing-api", branch: "feature/AB-4182-invoice-csv", files: 6, tests: [], passed: false, issue: "the change adds or updates no test and gives no reason in `testExemption`" },
    { repo: "billing-web", branch: "feature/AB-4182-invoice-csv", files: 5, tests: ["billing-web/src/invoices/ExportButton.test.tsx"], passed: true, issue: "" },
  ],
};

type StepSpec = [
  nodeId: string,
  status: StepStatus,
  seconds: number,
  extra?: { cost?: number; reason?: string; out?: OutOverride; input?: Refusal[]; err?: string },
];

type RunOpts = {
  state?: RunState;
  waitReason?: WaitReason;
  resumeAt?: number;
  runningFor?: number;
  endAt?: number;
  current?: string;
  terminal?: string;
  terminalReason?: string;
  ended?: boolean;
  failure?: RunFailure;
  knowledge?: KnowledgeDiff;
  bundle?: RefusalBundle;
  idSuffix?: string;
};

function makeRun(now: number, flow: string, defs: FlowNodeDef[], script: StepSpec[], o: RunOpts = {}): Run {
  const gap = 2;
  let total = 0;
  script.forEach((s) => {
    if (s[1] !== "running") total += s[2] + gap;
  });
  const endAt = o.endAt ?? now;
  let t = endAt - (o.runningFor ?? 0) * 1000 - total * 1000;
  const startedAt = t - 4000;
  const steps: Step[] = [];
  const transitions: Transition[] = [];
  const att: Record<string, number> = {};
  let seq = 1;
  transitions.push({ seq: seq++, fromNode: "admission", toNode: script[0][0], reason: "Admitted · slot 1 of 2 free", at: startedAt + 1000 });
  script.forEach((s, i) => {
    const [nodeId, status, d, x = {}] = s;
    att[nodeId] = (att[nodeId] ?? 0) + 1;
    const running = status === "running";
    const st = t;
    const en = running ? null : t + d * 1000;
    const cost = x.cost ?? 0;
    steps.push({
      id: `st${i + 1}`,
      nodeId,
      attempt: att[nodeId],
      status,
      startedAt: st,
      endedAt: en,
      costUsd: cost,
      inputTokens: Math.round(cost * 140000),
      outputTokens: Math.round(cost * 9000),
      cacheReadTokens: Math.round(cost * 90000),
      numTurns: cost ? Math.max(2, Math.round(cost * 12)) : 0,
      errorMessage: x.err ?? "",
      output: running || status === "skipped" ? null : output(nodeId, att[nodeId], x.out),
      logFrom: i * 6,
      logTo: i * 6 + 5,
      input: x.input ?? null,
    });
    if (en !== null) t = en + gap * 1000;
    const nx = script[i + 1];
    if (nx) transitions.push({ seq: seq++, fromNode: nodeId, toNode: nx[0], reason: x.reason ?? "ok", at: t });
  });
  const last = script[script.length - 1];
  if (o.terminal) transitions.push({ seq: seq++, fromNode: last[0], toNode: o.terminal, reason: o.terminalReason ?? "", at: t });
  const costByPhase = { prepare: 0, understand: 0, build: 0, verify: 0, publish: 0 } as Record<PhaseKey, number>;
  let cost = 0;
  let tin = 0;
  let tout = 0;
  steps.forEach((s) => {
    const d = defs.find((x) => x.id === s.nodeId);
    if (d && d.phase in costByPhase) costByPhase[d.phase as PhaseKey] += s.costUsd;
    cost += s.costUsd;
    tin += s.inputTokens;
    tout += s.outputTokens;
  });
  return {
    id: `run_${flow}_${o.idSuffix ?? "1"}`,
    flow,
    state: o.state ?? "running",
    waitReason: o.waitReason,
    resumeAt: o.resumeAt,
    currentNodeId: o.current ?? last[0],
    fixAttempts: steps.filter((s) => s.nodeId === "fix" && s.status !== "skipped").length,
    maxFixAttempts: 5,
    costUsd: cost,
    inputTokens: tin,
    outputTokens: tout,
    startedAt,
    endedAt: o.ended ? t : null,
    costByPhase,
    failure: o.failure,
    knowledge: o.knowledge,
    defs,
    steps,
    transitions,
    bundle: o.bundle ?? null,
  };
}

const PREFIX: StepSpec[] = [
  ["setup", "succeeded", 14, { reason: "Worktree ready · base a41c9e2" }],
  ["readiness", "succeeded", 38, { cost: 0.11, reason: "Ready · 4 acceptance criteria" }],
  ["plan", "succeeded", 142, { cost: 0.62, reason: "Plan written · 4 AC → 6 files" }],
  ["planCheck", "succeeded", 2, { reason: "All repos known" }],
  ["implement", "succeeded", 611, { cost: 2.84, reason: "14 files changed · self-check passed" }],
  ["syncBase", "succeeded", 9, { reason: "Up to date with main" }],
];

const fixOut = (list: Refusal[], files: number): OutOverride => ({
  addressed: list,
  filesChanged: files,
  summary: `Fixed ${plural(list.length, "refusal")} from the bundle.`,
});

const happyTail = (fixes: number): StepSpec[] => [
  ["testGate", "succeeded", 180, { reason: "test gate passed" }],
  ["diffGuard", "succeeded", 3, { reason: "Diff clean" }],
  ["evaluate", "succeeded", 118, { cost: 0.46, reason: "Pass", out: { reviewedDelta: fixes > 0 } }],
  ["prePublish", "succeeded", 4, { reason: "Base unchanged · branch clean" }],
  ["publish", "succeeded", 21, { reason: "2 draft PRs opened" }],
  ["verifyPublish", "succeeded", 6, { reason: "4/4 read-back checks" }],
];

function implementSucceeded(now: number, idSuffix: string): Run {
  return makeRun(
    now,
    "implement",
    IMPL,
    [
      ...PREFIX,
      ["testGate", "succeeded", 176, { reason: "test gate passed" }],
      ["diffGuard", "succeeded", 3, { reason: "Diff clean" }],
      ["evaluate", "refused", 124, { cost: 0.47, reason: "Changes required · 2 blockers → fix", out: { verdict: "changes-required", blockers: [R.e1, R.e2] } }],
      ["fix", "succeeded", 244, { cost: 1.08, reason: "Addressed 2 refusals", out: fixOut([R.e1, R.e2], 3) }],
      ["syncBase", "succeeded", 6, { reason: "Up to date" }],
      ...happyTail(1),
    ],
    { state: "succeeded", terminal: "END", terminalReason: "PRs verified", ended: true, endAt: now - 38 * 60e3, current: "verifyPublish", idSuffix },
  );
}

function fixRun(now: number, flow: string, bundle: Refusal[], idSuffix: string, endMinAgo: number): Run {
  const withEval = flow !== "fix-ci";
  const script: StepSpec[] = [
    ["setup", "succeeded", 8, { reason: "Reused worktree" }],
    ["syncBase", "succeeded", 7, { reason: "Rebased · was 2 behind", out: { rebased: true, behindBy: 2 } }],
    ["fix", "succeeded", 210, { cost: 0.94, reason: `Addressed ${plural(bundle.length, "refusal")}`, out: fixOut(bundle, 2), input: bundle }],
    ["testGate", "succeeded", 170, { reason: "test gate passed" }],
    ["diffGuard", "succeeded", 3, { reason: "Diff clean" }],
    ...(withEval ? ([["evaluate", "succeeded", 96, { cost: 0.38, reason: "Pass", out: { reviewedDelta: true } }]] as StepSpec[]) : []),
    ["prePublish", "succeeded", 3, { reason: "Branch clean" }],
    ["publish", "succeeded", 9, { reason: "Pushed to existing PRs", out: { prs: [{ repo: "billing-api", number: 412, url: prUrl("billing-api", 412), draft: false, reusedExisting: true }, { repo: "billing-web", number: 198, url: prUrl("billing-web", 198), draft: false, reusedExisting: true }] } }],
    ["verifyPublish", "succeeded", 5, { reason: "Read-back ok", out: { checks: [{ name: "Push landed on both PRs", ok: true }, { name: "Branches unchanged", ok: true }, { name: "AB#4182 still linked", ok: true }] } }],
  ];
  return makeRun(now, flow, fixFlow(withEval), script, {
    state: "succeeded",
    terminal: "END",
    terminalReason: "Pushed and verified",
    ended: true,
    endAt: now - endMinAgo * 60e3,
    current: "verifyPublish",
    idSuffix,
  });
}

const stagesOf = (m: Record<string, Partial<LifecycleStage>>): LifecycleStage[] =>
  STAGES.map(([id, label]) => ({ id, label, status: "todo", at: "", detail: "", runs: [], ...(m[id] ?? {}) }));

const chip = (key: string, flow: string, state: string, cost: number): RunChip => ({ key, flow, state, cost });

const ticks = (a: boolean, b: boolean, c: boolean) => [
  { t: "PR published", short: "PR", ok: a },
  { t: "Reviewers set", short: "Rev", ok: b },
  { t: "Status moved", short: "Status", ok: c },
];

const GATES_OK: GateResult[] = [
  { gate: "preflight", status: "passed", reason: "Root repo ok · ADO MCP reachable · skills v3.2 current", at: "09:12" },
  { gate: "admission", status: "passed", reason: "Not a duplicate · slot 1 of 2 free · quota ok", at: "09:12" },
];

const READY = { status: "done", at: "Thu 22 Oct", detail: "Ready · 4 AC" } as const;
const PLANNED = { at: "Thu 29 Oct", detail: "Planned", ticks: ticks(false, false, false) };

export const SCENARIO_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;

export function buildScenarios(now: number): Record<string, Scenario> {
  const S: Record<string, Scenario> = {};
  const add = (key: string, label: string, runKey: string | null, lifecycle: LifecycleStage[], runs: Record<string, () => Run>, gates: GateResult[] = GATES_OK) => {
    S[key] = { key, label, runKey, gates, lifecycle, runs };
  };

  add("A", "Preparing", "implement",
    stagesOf({ readiness: READY, implement: { status: "active", at: "Fri 23 Oct", detail: "Preparing workspace", runs: [chip("implement", "implement", "preparing", 0)] }, release: PLANNED }),
    { implement: () => makeRun(now, "implement", IMPL, [["setup", "running", 0]], { state: "preparing", runningFor: 12 }) });

  add("B", "Needs input", "implement",
    stagesOf({ readiness: { status: "blocked", at: "Fri 23 Oct", detail: "3 questions for the PO", action: "Copy questions" }, implement: { status: "active", detail: "Parked · needs input", runs: [chip("implement", "implement", "waiting", 0.11)] }, release: PLANNED }),
    {
      implement: () =>
        makeRun(
          now,
          "implement",
          IMPL,
          [
            ...PREFIX.slice(0, 1),
            ["readiness", "succeeded", 41, {
              cost: 0.11,
              reason: "Not ready · 3 open questions",
              out: {
                ready: false,
                missing: ["Expected column order for the CSV"],
                ambiguities: ['"Ledger filter" — the filter on screen, or every ledger the user can access?', "Maximum date range is not stated"],
                questions: [
                  "Should the export respect the ledger filter currently applied on the list, or include every ledger the user can access?",
                  "What is the maximum date range per export — 12 or 24 months?",
                  "Is there a required column order? If so, please attach a sample CSV.",
                ],
              },
            }],
          ] as StepSpec[],
          { state: "waiting", waitReason: "needs-input", terminal: "NEEDS_INPUT", terminalReason: "Not ready · 3 questions drafted for the PO", current: "readiness", endAt: now - 6 * 60e3 },
        ),
    });

  add("C", "Verify · fix round 2", "implement",
    stagesOf({ readiness: READY, implement: { status: "active", at: "Fri 23 Oct", detail: "Verify · fix round 2 / 5", runs: [chip("implement", "implement", "running", 7.39)] }, release: PLANNED }),
    {
      implement: () =>
        makeRun(
          now,
          "implement",
          IMPL,
          [
            ...PREFIX,
            ["testGate", "succeeded", 184, { reason: "test gate passed" }],
            ["diffGuard", "succeeded", 3, { reason: "Diff clean" }],
            ["evaluate", "refused", 121, { cost: 0.48, reason: "Changes required · bundle of 3 → fix", out: { verdict: "changes-required", blockers: [R.e3, R.e4, R.a1] } }],
            ["fix", "succeeded", 268, { cost: 1.12, reason: "Addressed 3 refusals", out: fixOut([R.e3, R.e4, R.a1], 4), input: [R.e3, R.e4, R.a1] }],
            ["syncBase", "succeeded", 6, { reason: "Up to date" }],
            ["testGate", "refused", 190, { reason: "1 refusal · collecting", out: failTestGate }],
            ["diffGuard", "refused", 3, { reason: "1 violation · collecting", out: { passed: false, violations: [{ rule: "no-unplanned-config", file: "billing-api/appsettings.Development.json" }] } }],
            ["evaluate", "refused", 133, { cost: 0.51, reason: "Merged bundle of 4 → fix", out: { verdict: "changes-required", blockers: [R.e1, R.e2], reviewedDelta: true } }],
            ["fix", "succeeded", 301, { cost: 1.36, reason: "Addressed 4 refusals", out: fixOut([R.t1, R.d1, R.e1, R.e2], 5), input: [R.t1, R.d1, R.e1, R.e2] }],
            ["syncBase", "succeeded", 5, { reason: "Up to date" }],
            ["testGate", "succeeded", 188, { reason: "test gate passed" }],
            ["diffGuard", "succeeded", 3, { reason: "Diff clean" }],
            ["evaluate", "running", 0],
          ] as StepSpec[],
          { state: "running", runningFor: 47, bundle: { title: "Last refusal bundle → fix #2", sub: "Merged after testGate, diffGuard and evaluate · now being re-verified", items: [R.t1, R.d1, R.e1, R.e2] } },
        ),
    });

  add("D", "Succeeded", "implement",
    stagesOf({ readiness: READY, implement: { status: "done", at: "Fri 23 Oct", detail: "Succeeded · 1 fix round", runs: [chip("implement", "implement", "succeeded", 5.58)] }, pr: { status: "done", at: "Fri 23 Oct", detail: "2 draft PRs" }, ci: { status: "active", detail: "Pipeline running · 3/5 jobs" }, release: PLANNED }),
    { implement: () => implementSucceeded(now, "1") });

  add("E", "Failed", "implement",
    stagesOf({ readiness: READY, implement: { status: "blocked", at: "Fri 23 Oct", detail: "Fix loop exhausted (5/5)", action: "Retry from Sync with base", runs: [chip("implement", "implement", "failed", 11.92)] }, release: { at: "Thu 29 Oct", detail: "At risk", ticks: ticks(false, false, false) } }),
    {
      implement: () => {
        let s: StepSpec[] = PREFIX.slice();
        for (let k = 1; k <= 5; k++) {
          s = s.concat([
            ["testGate", "refused", 186, { reason: "1 refusal · collecting", out: failTestGate }],
            ["diffGuard", "succeeded", 3, { reason: "Diff clean" }],
            ["evaluate", "refused", 110, { cost: 0.44, reason: "Merged bundle of 2 → fix", out: { verdict: "changes-required", blockers: [R.e3], reviewedDelta: k > 1 } }],
            ["fix", "succeeded", 230 + k * 9, { cost: 0.98, reason: `Attempt ${k} · tests still red`, out: fixOut([R.t1, R.e3], 2), input: [R.t1, R.e3] }],
            ["syncBase", "succeeded", 6, { reason: "Up to date" }],
          ] as StepSpec[]);
        }
        s = s.concat([
          ["testGate", "refused", 184, { reason: "1 refusal · collecting", out: failTestGate }],
          ["diffGuard", "succeeded", 3, { reason: "Diff clean" }],
          ["evaluate", "refused", 108, { cost: 0.43, reason: "Bundle of 2 → fix", out: { verdict: "changes-required", blockers: [R.e3], reviewedDelta: true } }],
          ["fix", "skipped", 0, { reason: "Fix budget exhausted (5/5) → reflect" }],
          ["reflect", "succeeded", 52, { cost: 0.21, reason: "Lesson recorded", out: { recorded: true, lesson: "CsvWriter streams rows lazily, so the header is only written when the first row arrives. An empty ledger therefore produces an empty file. Write the header eagerly before enumerating." } }],
        ] as StepSpec[]);
        return makeRun(now, "implement", IMPL, s, {
          state: "failed",
          terminal: "FAIL",
          terminalReason: "Fix loop exhausted (5/5)",
          ended: true,
          endAt: now - 9 * 60e3,
          current: "reflect",
          failure: {
            reason: "Fix loop exhausted (5/5). CsvWriterTests.ExportsEmptyLedger_WritesHeaderOnly still fails after every fix, and the review still flags buffering.",
            refusals: [R.t1, R.e3],
            lesson: "CsvWriter streams rows lazily, so the header is only written when the first row arrives. Write the header eagerly before enumerating.",
            retryableFrom: ["syncBase", "implement", "plan"],
          },
          knowledge: {
            added: ["billing-api: CsvWriter must write the header before enumerating rows — empty ledgers still need it.", "billing-api: run CsvWriterTests with TZ=UTC; fixtures assume UTC."],
            removed: ["billing-api: CSV export is synchronous (outdated)."],
          },
        });
      },
    });

  add("F", "Rate-limited", "implement",
    stagesOf({ readiness: READY, implement: { status: "active", at: "Fri 23 Oct", detail: "Rate-limited · resumes soon", runs: [chip("implement", "implement", "waiting", 1.95)] }, release: PLANNED }),
    { implement: () => makeRun(now, "implement", IMPL, [...PREFIX.slice(0, 4), ["implement", "running", 0, { cost: 1.22 }]] as StepSpec[], { state: "waiting", waitReason: "rate-limited", runningFor: 380, resumeAt: now + 872e3 }) });

  add("G", "Needs review", "implement",
    stagesOf({ readiness: READY, implement: { status: "blocked", at: "Fri 23 Oct", detail: "Publish needs a human check", action: "Check branch & tracker", runs: [chip("implement", "implement", "waiting", 4.03)] }, pr: { status: "blocked", at: "Fri 23 Oct", detail: "billing-api #412 is not a draft" }, release: PLANNED }),
    {
      implement: () =>
        makeRun(
          now,
          "implement",
          IMPL,
          [
            ...PREFIX,
            ["testGate", "succeeded", 180, { reason: "test gate passed" }],
            ["diffGuard", "succeeded", 3, { reason: "Diff clean" }],
            ["evaluate", "succeeded", 117, { cost: 0.46, reason: "Pass" }],
            ["prePublish", "succeeded", 4, { reason: "Base unchanged" }],
            ["publish", "succeeded", 24, { reason: "1 PR reused · 1 opened", out: { prs: [{ repo: "billing-api", number: 412, url: prUrl("billing-api", 412), draft: false, reusedExisting: true }, { repo: "billing-web", number: 198, url: prUrl("billing-web", 198), draft: true, reusedExisting: false }] } }],
            ["verifyPublish", "refused", 6, { reason: "Read-back mismatch", out: { passed: false, checks: [{ name: "billing-api #412 is a draft", ok: false }, { name: "billing-web #198 is a draft", ok: true }, { name: "Branches are feature/AB-4182-invoice-csv", ok: true }, { name: "AB#4182 linked on both PRs", ok: true }] } }],
          ] as StepSpec[],
          { state: "waiting", waitReason: "needs-review", terminal: "NEEDS_REVIEW", terminalReason: "billing-api #412 is not a draft (reused an existing PR)", current: "verifyPublish", endAt: now - 3 * 60e3 },
        ),
    });

  add("H", "Refused", null,
    stagesOf({ readiness: READY, implement: { status: "blocked", detail: "Refused at admission · no slot", action: "Fix it" }, release: PLANNED }),
    {},
    [
      { gate: "preflight", status: "passed", reason: "Root repo ok · ADO MCP reachable · skills current", at: "09:40" },
      { gate: "admission", status: "refused", reason: "No concurrency slot: AB#4177 and AB#4180 are running (2 of 2).", at: "09:40", howTo: "Wait for AB#4177 (≈ 8 min left) or raise Settings → Runs → Concurrent runs to 3. The ticket re-checks the gates when a slot frees." },
    ]);

  add("I", "CI red · fix-ci", "fix-ci-1",
    stagesOf({
      readiness: READY,
      implement: { status: "done", at: "Fri 23 Oct", detail: "Succeeded", runs: [chip("implement", "implement", "succeeded", 5.58)] },
      pr: { status: "done", at: "Fri 23 Oct", detail: "2 draft PRs" },
      ci: { status: "blocked", at: "Fri 23 Oct", detail: "Red · 2 failing jobs", action: "fix-ci run in progress", runs: [chip("fix-ci-1", "fix-ci", "running", 0.41)] },
      release: { status: "todo", at: "Thu 29 Oct", detail: "Scheduled", ticks: ticks(false, false, false) },
    }),
    {
      implement: () => implementSucceeded(now, "1"),
      "fix-ci-1": () =>
        makeRun(
          now,
          "fix-ci",
          fixFlow(false),
          [
            ["setup", "succeeded", 8, { reason: "Reused worktree" }],
            ["syncBase", "succeeded", 7, { reason: "Rebased · was 2 behind", out: { rebased: true, behindBy: 2 } }],
            ["fix", "running", 0, { cost: 0.41, input: [R.c1, R.c2] }],
          ] as StepSpec[],
          { state: "running", runningFor: 95, idSuffix: "ci1", bundle: { title: "Fixing CI refusals → fix #1", sub: "From pipeline #8812 on feature/AB-4182-invoice-csv", items: [R.c1, R.c2] } },
        ),
    });

  add("J", "Lifecycle complete", "implement",
    stagesOf({
      readiness: READY,
      implement: { status: "done", at: "Fri 23 Oct", detail: "Succeeded · 1 fix round", runs: [chip("implement", "implement", "succeeded", 5.58)] },
      pr: { status: "done", at: "Fri 23 Oct", detail: "2 draft PRs" },
      ci: { status: "done", at: "Fri 23 Oct", detail: "Green" },
      release: { status: "done", at: "Thu 29 Oct", detail: "Published · 3/3", ticks: ticks(true, true, true) },
      review: { status: "done", at: "Fri 30 Oct", detail: "2 rounds · 0 open threads", runs: [chip("fix-review-1", "fix-review", "succeeded", 1.32), chip("fix-review-2", "fix-review", "succeeded", 0.88)] },
      qa: { status: "done", at: "Mon 2 Nov", detail: "Passed after 1 round", runs: [chip("fix-qa-1", "fix-qa", "succeeded", 1.04)] },
      merged: { status: "done", at: "Mon 2 Nov", detail: "Squash-merged" },
      closed: { status: "done", at: "Mon 2 Nov", detail: "Est 6h · actual 7.5h · 4 fix rounds · $8.82" },
    }),
    {
      implement: () => implementSucceeded(now, "1"),
      "fix-review-1": () => fixRun(now, "fix-review", [R.r1, R.r2], "r1", 4000),
      "fix-review-2": () => fixRun(now, "fix-review", [R.r2], "r2", 3000),
      "fix-qa-1": () => fixRun(now, "fix-qa", [R.q1], "q1", 1500),
    });

  return S;
}

export const DEFAULT_DEFS = IMPL;
