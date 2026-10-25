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
import { GRAPH, MAX_FIX_ATTEMPTS, outline } from "./graph";
import { deliveryOf, prNumber } from "./rules";
import type { LogEntry } from "./types";

export type RunRow = {
  id: string;
  ticketId: string;
  ticketUrl: string;
  ticketTitle: string;
  provider: string;
  project: string;
  rootRepo: string;
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

export type RunView = { run: Run; gates: GateResult[]; lifecycle: LifecycleStage[]; ticket: TicketView; retryEntries: string[] };

export type RunListItem = { id: string; ticketId: string; title: string; state: string; startedAt: number };

const GATE_DEFS: FlowNodeDef[] = [
  { id: "preflight", label: "Preflight", phase: "pre-run", kind: "gate", effects: "pure", context: "", next: ["admission"] },
  { id: "admission", label: "Admission", phase: "pre-run", kind: "gate", effects: "pure", context: "", next: ["setup"] },
];

export function flowDefs(): FlowNodeDef[] {
  return GATE_DEFS.concat(
    outline().map((n) => ({
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
  return arr<{ source?: string; file?: string; issue?: string }>(v).map((r) => ({ source: r.source ?? "", file: r.file || undefined, issue: r.issue ?? "" }));
}

export function outputOf(nodeId: string, raw: unknown, attempt: number, planMd: string): NodeOutput | null {
  const d = (raw ?? {}) as Data;
  if (!Object.keys(d).length) return null;
  switch (nodeId) {
    case "setup":
      return { node: "setup", mode: str(d.mode), branch: str(d.branch), baseSha: str(d.baseSha).slice(0, 7), repos: arr(d.repos) };
    case "readiness":
      return {
        node: "readiness",
        ready: !!d.ready,
        missing: arr(d.missing),
        ambiguities: arr(d.ambiguities),
        questions: arr(d.questions),
        delivery: d.delivery ? deliveryOf({ channels: { readiness: d } }) : undefined,
      };
    case "plan":
      return { node: "plan", acMap: arr(d.acMap), repos: arr(d.repos), risks: arr(d.risks), planMd };
    case "planCheck":
    case "prePublish":
      return { node: nodeId, passed: !!d.passed, issues: arr(d.issues) };
    case "implement":
    case "fix": {
      const v = (d.verification ?? {}) as Data;
      return {
        node: nodeId,
        commitSha: str(d.commitSha),
        summary: str(d.summary),
        filesChanged: num(d.filesChanged),
        testExemption: str(d.testExemption),
        verification: { tests: str(v.tests), build: str(v.build), acceptanceCriteria: str(v.acceptanceCriteria) },
        addressed: nodeId === "fix" ? refusals(d.input) : undefined,
      };
    }
    case "syncBase":
      return { node: "syncBase", rebased: !!d.rebased, behindBy: num(d.behindBy), conflicts: arr(d.conflicts) };
    case "testGate":
      return { node: "testGate", passed: !!d.passed, results: arr(d.results) };
    case "diffGuard":
      return { node: "diffGuard", passed: !arr(d.violations).length, violations: arr(d.violations) };
    case "evaluate":
      return {
        node: "evaluate",
        verdict: d.verdict === "pass" ? "pass" : "changes-required",
        blockers: arr<{ file?: string; issue?: string }>(d.blockers).map((b) => ({ source: "evaluate", file: b.file || undefined, issue: b.issue ?? "" })),
        reviewedDelta: attempt > 1,
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
  }
  return null;
}

const STEP_STATUS: Record<string, StepStatus> = { running: "running", succeeded: "succeeded", failed: "failed", refused: "refused", skipped: "skipped", abandoned: "failed" };

function runState(row: RunRow): RunState {
  if (row.state === "running" && row.currentNodeId === "setup") return "preparing";
  return (["running", "waiting", "succeeded", "failed", "cancelled"].includes(row.state) ? row.state : "failed") as RunState;
}

const last = <T>(list: T[]) => list[list.length - 1];

export function buildView(row: RunRow, stepRows: StepRow[], transRows: TransitionRow[], artifacts: ArtifactRow[], live: Live): RunView {
  const defs = flowDefs();
  const plans = artifacts.filter((a) => a.kind === "plan");
  const planMd = last(plans)?.body ?? "";
  const logs: LogLine[] = [];
  const steps: Step[] = stepRows.map((s, i) => {
    const entries = live && live.stepId === s.id && s.status === "running" ? live.logs : arr<LogEntry>(s.logLines);
    const from = logs.length;
    entries.forEach((e) => logs.push({ ts: e.t, lvl: e.lvl, node: s.nodeId, text: e.text, attempt: s.attempt }));
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
    };
  });

  const gates = arr<GateResult>(row.gates);
  const admitted = gates.find((g) => g.gate === "admission");
  const transitions: Transition[] = [
    { seq: 0, fromNode: "admission", toNode: "setup", reason: admitted?.reason ?? "admitted", at: row.startedAt.getTime() },
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
    flow: "implement",
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
            retryableFrom: GRAPH.retryEntries,
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
  return { run, gates, lifecycle: lifecycleOf(row, steps), ticket: ticketOf(row), retryEntries: GRAPH.retryEntries };
}

function ticketOf(row: RunRow): TicketView {
  return { id: row.ticketId, title: row.ticketTitle, url: row.ticketUrl, provider: row.provider, project: row.project, rootRepo: row.rootRepo };
}

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

function lifecycleOf(row: RunRow, steps: Step[]): LifecycleStage[] {
  const at = (s?: Step) => (s ? day(s.endedAt ?? s.startedAt) : "");
  const ready = last(steps.filter((s) => s.nodeId === "readiness"));
  const pub = last(steps.filter((s) => s.nodeId === "publish"));
  const cost = steps.reduce((n, s) => n + s.costUsd, 0);
  const chip = { key: "implement", flow: "implement", state: row.state, cost };
  const m: Record<string, Partial<LifecycleStage>> = {};
  if (ready?.output?.node === "readiness") {
    m.readiness = ready.output.ready
      ? { status: "done", at: at(ready), detail: ready.output.delivery?.status === "done" ? "Already delivered" : "Ready" }
      : { status: "blocked", at: at(ready), detail: `${ready.output.questions.length} question(s) for the PO`, action: "Copy questions" };
  }
  m.implement =
    row.state === "succeeded"
      ? { status: "done", at: day(row.startedAt.getTime()), detail: "Succeeded", runs: [chip] }
      : row.state === "failed" || row.state === "cancelled"
        ? { status: "blocked", at: day(row.startedAt.getTime()), detail: row.state === "cancelled" ? "Cancelled" : "Failed", action: "Retry from…", runs: [chip] }
        : { status: "active", at: day(row.startedAt.getTime()), detail: row.state === "waiting" ? `Parked · ${row.waitReason}` : "Running", runs: [chip] };
  if (pub?.output?.node === "publish") {
    m.pr = { status: row.state === "waiting" ? "blocked" : "done", at: at(pub), detail: `${pub.output.prs.length} draft PR(s)` };
  }
  return STAGES.map(([id, label]) => ({ id, label, status: "todo", at: "", detail: "", runs: [], ...(m[id] ?? {}) }));
}

export function listItem(row: Pick<RunRow, "id" | "ticketId" | "ticketTitle" | "state" | "startedAt">): RunListItem {
  return { id: row.id, ticketId: row.ticketId, title: row.ticketTitle, state: row.state, startedAt: row.startedAt.getTime() };
}
