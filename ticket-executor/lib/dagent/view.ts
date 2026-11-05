import { trackerStages, type TrackerFacts } from "../ticketLifecycle";
import { STAGES } from "../workflow/meta";
import type {
  FlowNodeDef,
  GateResult,
  LifecycleStage,
  LogLine,
  NodeKind,
  NodeOutput,
  PhaseKey,
  Refusal as UiRefusal,
  Run,
  RunState,
  Step,
  StepStatus,
  Transition,
} from "../workflow/types";
import { flowOf, GRAPH, graphById, MAX_FIX_ATTEMPTS, outline } from "./graph";
import { codeLeadsOf, deliveryOf, digestOf, HARD_RULES, prNumber, skillUse } from "./rules";
import { BRIEF_PREFIX, type Graph, type LogEntry } from "./types";

export type RunRow = {
  id: string;
  ticketId: string;
  ticketUrl: string;
  ticketTitle: string;
  provider: string;
  project: string;
  rootRepo: string;
  graphId: string;
  state: string;
  waitReason: string;
  currentNodeId: string;
  errorMessage: string;
  gates: unknown;
  retryOfId: string;
  entryNode: string;
  prUrl: string;
  startedAt: Date;
  endedAt: Date | null;
};

export type StepRow = {
  id: string;
  nodeId: string;
  attempt: number;
  status: string;
  input: unknown;
  output: unknown;
  errorMessage: string;
  logLines: unknown;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  numTurns: number;
  startedAt: Date;
  endedAt: Date | null;
};

export type TransitionRow = { seq: number; fromNode: string; toNode: string; reason: string; createdAt: Date };

export type ArtifactRow = { kind: string; body: string; createdAt: Date };

export type Live = { stepId: string; logs: LogEntry[] } | null;

export type TicketView = { id: string; title: string; url: string; provider: string; project: string; rootRepo: string };

/** `newest`: no later run exists for the ticket — only that run may be retried or cancelled.
 *  `retryOf`: the run this one retried ("" for a first run); `planMd`: the run's last plan artifact — a retry
 *  seeded with its predecessor's plan has one without a plan step, so it is read here rather than off a step. */
export type RunView = {
  run: Run;
  gates: GateResult[];
  lifecycle: LifecycleStage[];
  ticket: TicketView;
  retryEntries: string[];
  newest: boolean;
  retryOf: string;
  planMd: string;
};

export type RunListItem = { id: string; ticketId: string; title: string; state: string; startedAt: number };

const GATE_DEFS: FlowNodeDef[] = [
  { id: "preflight", label: "Preflight", phase: "pre-run", kind: "gate", effects: "pure", context: "", next: ["admission"] },
  { id: "admission", label: "Admission", phase: "pre-run", kind: "gate", effects: "pure", context: "", next: ["setup"] },
];

export function flowDefs(g: Graph = GRAPH): FlowNodeDef[] {
  return GATE_DEFS.map((d) => (d.id === "admission" ? { ...d, next: [g.entry] } : d)).concat(
    outline(g).map((n) => ({
      id: n.id,
      label: n.label,
      phase: n.phase,
      kind: n.kind as NodeKind,
      effects: n.effects as FlowNodeDef["effects"],
      context: n.context,
      next: n.next,
      maxVisits: n.maxVisits,
    })),
  );
}

type Data = Record<string, unknown>;

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : 0);

function refusals(v: unknown): UiRefusal[] {
  return arr<{ source?: string; file?: string; issue?: string; evidence?: string; expected?: string }>(v).map((r) => ({
    source: r.source ?? "",
    file: r.file || undefined,
    issue: r.issue ?? "",
    ...(r.evidence ? { evidence: r.evidence } : {}),
    ...(r.expected ? { expected: r.expected } : {}),
  }));
}

// The ticket digest a judging role wrote — kept on its output so /workflow shows what every later role was given.
function digestPart(d: Data): { digest?: { summary: string; details: string[] } } {
  const g = digestOf({ channels: { readiness: d } });
  return g ? { digest: { summary: g.summary, details: g.details } } : {};
}

export function outputOf(nodeId: string, raw: unknown, attempt: number, planMd: string): NodeOutput | null {
  const d = (raw ?? {}) as Data;
  if (!Object.keys(d).length) return null;
  switch (nodeId) {
    case "setup":
      return {
        node: "setup",
        branch: str(d.branch),
        baseSha: str(d.baseSha).slice(0, 7),
        repos: arr<Data>(d.repos).map((r) => ({ name: str(r.name), path: str(r.path), base: str(r.base).slice(0, 7), from: str(r.from), branch: str(r.branch) })),
        warnings: arr<string>(d.warnings).filter((w) => typeof w === "string"),
      };
    case "readiness":
      return {
        node: "readiness",
        ready: !!d.ready,
        acceptanceCriteria: arr<string>(d.acceptanceCriteria).map(String),
        skills: arr<Data>(d.skills).map((s) => ({ name: str(s.name), reason: str(s.reason) })),
        baseBranch: str(d.baseBranch),
        missing: arr(d.missing),
        ambiguities: arr(d.ambiguities),
        questions: arr(d.questions),
        delivery: d.delivery ? deliveryOf({ channels: { readiness: d } }) : undefined,
        codeLeads: codeLeadsOf({ channels: { readiness: d } }),
        ...digestPart(d),
      };
    case "plan":
      // Each attempt shows its own plan — the run's last plan artifact belongs to the last attempt only.
      return {
        node: "plan",
        acMap: arr<Data>(d.acMap).map((a, i) => ({
          n: typeof a.n === "number" ? a.n : i + 1,
          ac: str(a.ac),
          change: a.change === "none" ? "none" : "code",
          files: arr<string>(a.files).map(String),
          test: str(a.test),
        })),
        repos: arr(d.repos),
        risks: arr(d.risks),
        decisions: arr(d.decisions),
        planMd: str(d.planMd),
      };
    case "planCheck":
    case "prePublish": {
      const k = d.checked as Data | undefined;
      return {
        node: nodeId,
        passed: !!d.passed,
        issues: arr(d.issues),
        ...(k ? { checked: { criteria: num(k.criteria), mapped: num(k.mapped), code: num(k.code), none: num(k.none), files: num(k.files), repos: arr<string>(k.repos).map(String) } } : {}),
      };
    }
    case "implement":
    case "fix": {
      const v = (d.verification ?? {}) as Data;
      return {
        node: nodeId,
        commitSha: str(d.commitSha),
        summary: str(d.summary),
        filesChanged: num(d.filesChanged),
        verification: { tests: str(v.tests), build: str(v.build), acceptanceCriteria: str(v.acceptanceCriteria) },
        deviations: arr<Data>(d.deviations).map((x) => ({ what: str(x.what), why: str(x.why) })),
        manualChecks: arr<Data>(d.manualChecks).map((x) => ({ n: num(x.n), check: str(x.check) })),
        addressed: nodeId === "fix" ? refusals(d.input) : undefined,
      };
    }
    case "syncBase":
      return {
        node: "syncBase",
        rebased: !!d.rebased,
        behindBy: num(d.behindBy),
        conflicts: arr(d.conflicts),
        repos: arr<Data>(d.repos).map((r) => ({ name: str(r.name), upstream: str(r.upstream), behind: num(r.behind), status: str(r.status), base: str(r.base) })),
      };
    case "testGate":
      return { node: "testGate", passed: !!d.passed, results: arr(d.results) };
    case "diffGuard":
    {
      const s = d.summary as Data | undefined;
      return {
        node: "diffGuard",
        passed: !arr(d.violations).length,
        violations: arr<Data>(d.violations).map((v) => ({ rule: str(v.rule), file: str(v.file), hard: HARD_RULES.has(str(v.rule)) })),
        ...(s ? { summary: { changed: num(s.changed), planned: num(s.planned), unplanned: arr<string>(s.unplanned).map(String) } } : {}),
      };
    }
    case "evaluate":
      return {
        node: "evaluate",
        verdict: d.verdict === "pass" ? "pass" : "changes-required",
        blockers: refusals(arr<Data>(d.blockers).map((b) => ({ ...b, source: "evaluate" }))),
        reviewedDelta: attempt > 1,
        checked: arr<Data>(d.checked).map((x) => ({ subject: str(x.subject), how: str(x.how), evidence: str(x.evidence), result: str(x.result) })),
        assumptions: arr<string>(d.assumptions).map(String),
        // Absent on reviews before the harness checked them — those show no badge rather than a guessed one.
        reviewNotes: arr<string>(d.reviewNotes).map(String),
      };
    case "reflect":
      return { node: "reflect", recorded: !!d.recorded, lesson: str(d.lesson) };
    case "publish":
      return {
        node: "publish",
        prs: arr<Data>(d.prs).map((p) => ({ repo: str(p.repo), number: prNumber(str(p.prUrl)), url: str(p.prUrl), draft: !!p.isDraft, reusedExisting: !!p.reusedExisting })),
      };
    case "verifyPublish":
      return { node: "verifyPublish", passed: !!d.passed, checks: arr(d.checks) };
    case "reviewTriage":
      return { node: "reviewTriage", threads: arr(d.threads), planMd, ...digestPart(d) };
    case "qaTriage":
      return { node: "qaTriage", outcome: d.outcome === "no-fix-needed" ? "no-fix-needed" : "fix", findings: arr(d.findings), qaReply: str(d.qaReply), planMd, ...digestPart(d) };
    case "respond":
      return { node: "respond", pushed: !!d.pushed, threadsReplied: num(d.threadsReplied) };
  }
  return null;
}

const FLOW_LABEL = { implement: "implement", review: "fix-review", qa: "fix-qa" } as const;

const STEP_STATUS: Record<string, StepStatus> = { running: "running", succeeded: "succeeded", failed: "failed", refused: "refused", skipped: "skipped", abandoned: "failed" };

function runState(row: RunRow): RunState {
  if (row.state === "running" && row.currentNodeId === "setup") return "preparing";
  return (["running", "waiting", "succeeded", "failed", "cancelled"].includes(row.state) ? row.state : "failed") as RunState;
}

const last = <T>(list: T[]) => list[list.length - 1];

// The judging roles that pick a run's skills; their output names the picks.
const PICKERS = ["readiness", "qaTriage", "reviewTriage"];

export function buildView(row: RunRow, stepRows: StepRow[], transRows: TransitionRow[], artifacts: ArtifactRow[], live: Live, tracker: TrackerFacts | null = null): Omit<RunView, "newest"> {
  const graph = graphById(row.graphId) ?? GRAPH;
  const flow = FLOW_LABEL[flowOf(graph.id)];
  const defs = flowDefs(graph);
  const plans = artifacts.filter((a) => a.kind === "plan");
  const planMd = last(plans)?.body ?? "";
  const briefs = new Map(artifacts.filter((a) => a.kind.startsWith(BRIEF_PREFIX)).map((a) => [a.kind.slice(BRIEF_PREFIX.length), a.body]));
  const logs: LogLine[] = [];
  // The run's picked skills, for an agent step kept before briefs were saved (it has no "Skills to follow" to read).
  const runSkills = arr<{ name?: unknown }>(((stepRows.find((s) => PICKERS.includes(s.nodeId) && s.output)?.output ?? {}) as Data).skills).map((x) => str(x.name)).filter(Boolean);
  const steps: Step[] = stepRows.map((s, i) => {
    const entries = live && live.stepId === s.id && s.status === "running" ? live.logs : arr<LogEntry>(s.logLines);
    const from = logs.length;
    const picked = entries.map((e) => /^model (\S+)(?: · effort (\S+))?$/.exec(e.text)).find(Boolean);
    entries.forEach((e) => logs.push({ ts: e.t, lvl: e.lvl, node: s.nodeId, text: e.text, attempt: s.attempt }));
    const brief = briefs.get(s.id) ?? "";
    const picks = PICKERS.includes(s.nodeId) ? arr<{ name?: unknown }>((s.output as Data | null)?.skills).map((x) => str(x.name)).filter(Boolean) : [];
    const isPicker = PICKERS.includes(s.nodeId);
    const isAgent = defs.find((d) => d.id === s.nodeId)?.kind === "agent";
    const skills = isAgent && (brief || picks.length || runSkills.length) ? skillUse(brief, entries.map((e) => e.text), picks, isPicker ? [] : runSkills) : [];
    return {
      id: s.id || `st${i}`,
      nodeId: s.nodeId,
      attempt: s.attempt,
      status: STEP_STATUS[s.status] ?? "failed",
      startedAt: s.startedAt.getTime(),
      endedAt: s.endedAt ? s.endedAt.getTime() : null,
      costUsd: s.costUsd,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      cacheReadTokens: s.cacheReadTokens,
      numTurns: s.numTurns,
      errorMessage: s.errorMessage || (s.status === "abandoned" ? "Abandoned — the run was stopped mid-step." : ""),
      output: s.status === "running" ? null : outputOf(s.nodeId, s.output, s.attempt, planMd),
      logFrom: from,
      logTo: Math.max(from, logs.length - 1),
      input: s.input ? refusals(s.input) : null,
      brief,
      ...(picked ? { model: picked[1], ...(picked[2] ? { effort: picked[2] } : {}) } : {}),
      ...(skills.length ? { skills } : {}),
    };
  });

  const gates = arr<GateResult>(row.gates);
  const admitted = gates.find((g) => g.gate === "admission");
  const transitions: Transition[] = [
    { seq: 0, fromNode: "admission", toNode: graph.entry, reason: admitted?.reason ?? "admitted", at: row.startedAt.getTime() },
    ...transRows.filter((t) => t.toNode !== "CANCELLED").map((t) => ({ seq: t.seq, fromNode: t.fromNode, toNode: t.toNode, reason: t.reason, at: t.createdAt.getTime() })),
  ];

  const costByPhase = { prepare: 0, understand: 0, build: 0, verify: 0, publish: 0 } as Record<PhaseKey, number>;
  for (const s of steps) {
    const p = defs.find((d) => d.id === s.nodeId)?.phase as PhaseKey | undefined;
    if (p && p in costByPhase) costByPhase[p] += s.costUsd;
  }
  const fixSteps = steps.filter((s) => s.nodeId === "fix");
  const lastFix = last(fixSteps);
  const lastEval = last(stepRows.filter((s) => s.nodeId === "evaluate"));
  const reflect = last(steps.filter((s) => s.nodeId === "reflect"));
  const knowledgeRow = last(artifacts.filter((a) => a.kind === "knowledge"));
  const state = runState(row);
  const standing = lastFix?.input ?? [];

  const run: Run = {
    id: row.id,
    flow,
    state,
    waitReason: row.state === "waiting" ? (row.waitReason as Run["waitReason"]) : undefined,
    currentNodeId: row.currentNodeId,
    fixAttempts: fixSteps.length,
    maxFixAttempts: MAX_FIX_ATTEMPTS,
    costUsd: steps.reduce((n, s) => n + s.costUsd, 0),
    inputTokens: steps.reduce((n, s) => n + s.inputTokens, 0),
    outputTokens: steps.reduce((n, s) => n + s.outputTokens, 0),
    startedAt: row.startedAt.getTime(),
    endedAt: row.endedAt ? row.endedAt.getTime() : null,
    costByPhase,
    failure:
      row.state === "failed"
        ? {
            reason: row.errorMessage || "Reached FAIL",
            refusals: [...standing, ...(lastEval ? refusals(arr<Data>((lastEval.output as Data | null)?.blockers).map((b) => ({ ...b, source: "evaluate" }))) : [])],
            lesson: reflect?.output?.node === "reflect" ? reflect.output.lesson : "",
            retryableFrom: graph.retryEntries,
          }
        : undefined,
    knowledge: knowledgeRow ? (JSON.parse(knowledgeRow.body) as Run["knowledge"]) : undefined,
    defs,
    steps,
    transitions,
    bundle:
      lastFix && lastFix.status === "running" && lastFix.input
        ? { title: `Review blockers → fix #${lastFix.attempt}`, sub: "From the independent review", items: lastFix.input }
        : null,
    logs,
  };
  return { run, gates, lifecycle: lifecycleOf(row, steps, flow, tracker), ticket: ticketOf(row), retryEntries: graph.retryEntries, retryOf: row.retryOfId, planMd };
}

function ticketOf(row: RunRow): TicketView {
  return { id: row.ticketId, title: row.ticketTitle, url: row.ticketUrl, provider: row.provider, project: row.project, rootRepo: row.rootRepo };
}

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

function lifecycleOf(row: RunRow, steps: Step[], flow: string, tracker: TrackerFacts | null): LifecycleStage[] {
  const at = (s?: Step) => (s ? day(s.endedAt ?? s.startedAt) : "");
  const ready = last(steps.filter((s) => s.nodeId === "readiness"));
  const pub = last(steps.filter((s) => s.nodeId === "publish"));
  const cost = steps.reduce((n, s) => n + s.costUsd, 0);
  const chip = { key: row.id, flow, state: row.state, cost };
  const m: Record<string, Partial<LifecycleStage>> = {};
  if (ready?.output?.node === "readiness") {
    m.readiness = ready.output.ready
      ? { status: "done", at: at(ready), detail: ready.output.delivery?.status === "done" ? "Already delivered" : "Ready" }
      : { status: "blocked", at: at(ready), detail: `${ready.output.questions.length} question(s) for the PO`, action: "Copy questions" };
  }
  m[flow === "fix-review" ? "review" : flow === "fix-qa" ? "qa" : "implement"] =
    row.state === "succeeded"
      ? { status: "done", at: day(row.startedAt.getTime()), detail: "Succeeded", runs: [chip] }
      : row.state === "failed" || row.state === "cancelled"
        ? { status: "blocked", at: day(row.startedAt.getTime()), detail: row.state === "cancelled" ? "Cancelled" : "Failed", action: "Retry", runs: [chip] }
        : { status: "active", at: day(row.startedAt.getTime()), detail: row.state === "waiting" ? `Parked · ${row.waitReason}` : "Running", runs: [chip] };
  if (pub?.output?.node === "publish") {
    m.pr = { status: row.state === "waiting" ? "blocked" : "done", at: at(pub), detail: `${pub.output.prs.length} draft PR(s)` };
  }
  // An implement run that ended at readiness because the work is already on the base built nothing and
  // opened nothing — say so instead of leaving those stages "to do".
  if (flow === "implement" && row.state === "succeeded" && !pub && ready?.output?.node === "readiness" && ready.output.delivery?.status === "done") {
    m.implement = { ...m.implement, status: "skipped", detail: "Nothing to implement" };
    m.pr = { status: "skipped", at: "", detail: "No PR needed" };
  }
  if (tracker) {
    // The bar is the ticket's: the tracker's work item status and PR decide each stage. Only a run still
    // in flight (active) or stopped (blocked) on a stage outranks it.
    for (const [id, t] of Object.entries(trackerStages(tracker))) {
      const r = m[id];
      if (r?.status === "active" || r?.status === "blocked") continue;
      m[id] = r?.status === "done" && t.status === "done" ? r : { ...r, ...t, at: "" };
    }
  } else if (flow === "fix-review" || flow === "fix-qa") {
    // No tracker to ask: a review-fix / QA-fix run only exists once the ticket got that far, so every earlier stage was passed.
    const own = STAGES.findIndex(([id]) => id === (flow === "fix-review" ? "review" : "qa"));
    STAGES.slice(0, own).forEach(([id]) => {
      m[id] ??= { status: "done", detail: "Passed earlier" };
    });
  }
  return STAGES.map(([id, label]) => ({ id, label, status: "todo", at: "", detail: "", runs: [], ...(m[id] ?? {}) }));
}

export function listItem(row: Pick<RunRow, "id" | "ticketId" | "ticketTitle" | "state" | "startedAt">): RunListItem {
  return { id: row.id, ticketId: row.ticketId, title: row.ticketTitle, state: row.state, startedAt: row.startedAt.getTime() };
}
