import { prisma } from "../prisma";
import { cached, DB_CACHE_PREFIX } from "../redis";
import type { FileChange, KnowledgeChange, LogLine, RunState } from "../types";
import { asLogLines, fmtDuration, safeParseJson } from "./format";
import { graphById, graphOutline, type NodeOutline } from "./graph/graphs";
import { reviewEscapes } from "./loopMetrics";
import { cumulativeStarts, logRanges, type StepStatus, type StepTrace, type TransitionView } from "../runTrace";
import type { Graph } from "./graph/types";
import { store } from "./store";

// ---- progress ----

/** One node of the run's graph, as the UI draws it. The progress list is derived
 *  from the graph, so adding a node adds a step with no second array to maintain
 *  — this is what replaced the hand-kept STEPS constant. */
export type NodeView = {
  id: string;
  label: string;
  /** "agent" | "check". Reported so the UI can ask what a node *is* rather
   *  than recognising it by name. */
  kind: string;
  effects: string;
  context: string;
  next: string[];
  state: "pending" | "running" | "done" | "failed";
  attempts: number;
};

type StepRow = { nodeId: string; status: string; attempt: number };

function nodeViews(graph: Graph, steps: StepRow[], currentNodeId: string, runState: RunState): NodeView[] {
  const latest = new Map<string, StepRow>();
  const attempts = new Map<string, number>();
  for (const s of steps) {
    attempts.set(s.nodeId, Math.max(attempts.get(s.nodeId) ?? 0, s.attempt));
    const prev = latest.get(s.nodeId);
    if (!prev || s.attempt >= prev.attempt) latest.set(s.nodeId, s);
  }
  return Object.values(graph.nodes).map((n) => {
    const s = latest.get(n.id);
    let state: NodeView["state"] = "pending";
    if (s?.status === "succeeded") state = "done";
    else if (s?.status === "failed" || s?.status === "abandoned") state = "failed";
    else if (s?.status === "running") state = "running";
    // A node the run is parked on before its Step opens would otherwise read as
    // "pending" while it is precisely the active node.
    if (state === "pending" && n.id === currentNodeId && (runState === "running" || runState === "waiting")) {
      state = "running";
    }
    return {
      id: n.id,
      label: n.label,
      kind: n.kind,
      effects: n.effects,
      context: n.kind === "agent" ? n.context : "",
      next: n.next,
      state,
      attempts: attempts.get(n.id) ?? 0,
    };
  });
}

// ---- read models ----

export type RunView = {
  id: string;
  ticketId: string;
  project: string;
  skill: string;
  graphId: string;
  state: RunState;
  currentNodeId: string;
  nodes: NodeView[];
  steps: StepTrace[];
  transitions: TransitionView[];
  endReason: string;
  logLines: LogLine[];
  resultText: string;
  errorMessage: string;
  prUrl: string;
  companionPrUrls: string[];
  branch: string;
  /** The latest plan Artifact, once the implement node has written one. */
  planMarkdown: string;
  filesChanged: FileChange[];
  knowledgeChange: KnowledgeChange | null;
  /** Per-node structured output — the Result tab renders verification, deviations
   *  and assumptions straight out of the contract rather than out of prose. */
  channels: Record<string, Record<string, unknown>>;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  duration?: string;
  startedAt: string;
  endedAt: string | null;
};

const STEP_SELECT = {
  id: true, nodeId: true, label: true, attempt: true, status: true, effects: true, output: true, errorMessage: true,
  costUsd: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true,
  numTurns: true, durationMs: true, startedAt: true, endedAt: true,
} as const;

type StepRowFull = {
  id: string; nodeId: string; label: string; attempt: number; status: string; effects: string; output: unknown;
  errorMessage: string; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number;
  cacheCreationTokens: number; numTurns: number; durationMs: number; startedAt: Date; endedAt: Date | null;
};

function stepTraces(rows: StepRowFull[], froms: (number | undefined)[], total: number): StepTrace[] {
  const ranges = logRanges(froms, total);
  return rows.map((s, i) => ({
    id: s.id,
    nodeId: s.nodeId,
    label: s.label,
    attempt: s.attempt,
    status: s.status as StepStatus,
    effects: s.effects,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    durationMs: s.durationMs,
    costUsd: s.costUsd,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    cacheReadTokens: s.cacheReadTokens,
    cacheCreationTokens: s.cacheCreationTokens,
    numTurns: s.numTurns,
    errorMessage: s.errorMessage,
    output: s.output && typeof s.output === "object" ? (s.output as Record<string, unknown>) : {},
    logFrom: ranges[i].from,
    logTo: ranges[i].to,
  }));
}

async function loadTransitions(runId: string): Promise<TransitionView[]> {
  const rows = await prisma.transition.findMany({
    where: { runId },
    orderBy: { seq: "asc" },
    select: { seq: true, fromNode: true, toNode: true, reason: true, createdAt: true },
  });
  return rows.map((t) => ({ seq: t.seq, fromNode: t.fromNode, toNode: t.toNode, reason: t.reason, at: t.createdAt.toISOString() }));
}

async function loadExtras(runId: string) {
  const [plan, diff, knowledge] = await Promise.all([
    prisma.artifact.findFirst({ where: { runId, kind: "plan" }, orderBy: { version: "desc" } }),
    prisma.artifact.findFirst({ where: { runId, kind: "diff" }, orderBy: { version: "desc" } }),
    prisma.artifact.findFirst({ where: { runId, kind: "knowledge" }, orderBy: { version: "desc" } }),
  ]);
  return {
    planMarkdown: plan?.body ?? "",
    filesChanged: diff ? safeParseJson<FileChange[]>(diff.body, []) : [],
    knowledgeChange: knowledge ? safeParseJson<KnowledgeChange | null>(knowledge.body, null) : null,
  };
}

/** Live view of a run still held in the in-process store. Falls back to the DB
 *  when the store lost it (restart) — callers get one shape either way. */
export async function getRun(id: string): Promise<RunView | null> {
  const live = store.get(id);
  if (!live) return getPersistedRun(id);

  const [steps, extras, transitions] = await Promise.all([
    prisma.step.findMany({ where: { runId: id }, orderBy: { startedAt: "asc" }, select: STEP_SELECT }),
    loadExtras(id),
    loadTransitions(id),
  ]);
  const graph = graphById(live.graphId);
  const agg = await prisma.step.aggregate({
    where: { runId: id },
    _sum: { costUsd: true, inputTokens: true, outputTokens: true },
  });

  return {
    id: live.id,
    ticketId: live.ctx.ticketId,
    project: live.ctx.project,
    skill: live.ctx.skill,
    graphId: live.graphId,
    state: live.state,
    currentNodeId: live.currentNodeId,
    nodes: nodeViews(graph, steps, live.currentNodeId, live.state),
    steps: stepTraces(steps, steps.map((s) => live.stepLogStarts?.[s.id]), live.logLines.length),
    transitions,
    endReason: live.endReason,
    logLines: live.logLines,
    resultText: live.resultText,
    errorMessage: live.errorMessage,
    prUrl: live.prUrl,
    companionPrUrls: live.companionPrUrls,
    branch: live.branch,
    planMarkdown: extras.planMarkdown,
    filesChanged: extras.filesChanged,
    knowledgeChange: extras.knowledgeChange,
    channels: live.ctx.channels,
    costUsd: agg._sum.costUsd ?? 0,
    inputTokens: agg._sum.inputTokens ?? 0,
    outputTokens: agg._sum.outputTokens ?? 0,
    duration: live.endedAt ? fmtDuration(live.endedAt - live.startedAt) : undefined,
    startedAt: new Date(live.startedAt).toISOString(),
    endedAt: live.endedAt ? new Date(live.endedAt).toISOString() : null,
  };
}

export async function getPersistedRun(id: string): Promise<RunView | null> {
  const row = await prisma.run.findUnique({
    where: { id },
    include: { steps: { orderBy: { startedAt: "asc" } } },
  });
  if (!row) return null;
  const [extras, transitions] = await Promise.all([loadExtras(id), loadTransitions(id)]);
  const graph = graphById(row.graphId);

  const logLines: LogLine[] = [];
  const lengths: number[] = [];
  for (const s of row.steps) {
    const ls = asLogLines(s.logLines);
    lengths.push(ls.length);
    logLines.push(...ls);
  }

  return {
    id: row.id,
    ticketId: row.ticketId,
    project: row.project,
    skill: row.skill,
    graphId: row.graphId,
    state: row.state as RunState,
    currentNodeId: row.currentNodeId,
    nodes: nodeViews(graph, row.steps, row.currentNodeId, row.state as RunState),
    steps: stepTraces(row.steps, cumulativeStarts(lengths), logLines.length),
    transitions,
    endReason: row.endReason,
    logLines,
    resultText: row.resultText,
    errorMessage: row.errorMessage,
    prUrl: row.prUrl,
    companionPrUrls: row.companionPrUrls,
    branch: row.branch,
    planMarkdown: extras.planMarkdown,
    filesChanged: extras.filesChanged,
    knowledgeChange: extras.knowledgeChange,
    channels: (row.channels as Record<string, Record<string, unknown>>) ?? {},
    costUsd: row.steps.reduce((s, x) => s + x.costUsd, 0),
    inputTokens: row.steps.reduce((s, x) => s + x.inputTokens, 0),
    outputTokens: row.steps.reduce((s, x) => s + x.outputTokens, 0),
    duration: row.endedAt ? fmtDuration(row.endedAt.getTime() - row.startedAt.getTime()) : undefined,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
  };
}

/** Summaries of past runs for a ticket, newest first (history panel). */
export async function listRuns(ticketId: string) {
  const rows = await prisma.run.findMany({
    where: { ticketId },
    orderBy: { startedAt: "desc" },
    take: 20,
    select: {
      id: true, state: true, skill: true, prUrl: true, branch: true, resultText: true,
      endReason: true, filesTouched: true, linesAdded: true, linesDeleted: true,
      startedAt: true, endedAt: true,
      steps: { select: { costUsd: true, inputTokens: true, outputTokens: true } },
      // The Result tab renders each past run's own diff, so the blob is loaded
      // here. Bounded by the take: 20 above — unlike the dashboard aggregate,
      // which must never touch it.
      artifacts: {
        where: { kind: "diff" },
        orderBy: { version: "desc" },
        take: 1,
        select: { body: true },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    state: r.state as RunState,
    skill: r.skill,
    prUrl: r.prUrl,
    branch: r.branch,
    resultText: r.resultText,
    endReason: r.endReason,
    filesChanged: r.artifacts[0] ? safeParseJson<FileChange[]>(r.artifacts[0].body, []) : [],
    filesTouched: r.filesTouched,
    linesAdded: r.linesAdded,
    linesDeleted: r.linesDeleted,
    startedAt: r.startedAt.toISOString(),
    duration: r.endedAt ? fmtDuration(r.endedAt.getTime() - r.startedAt.getTime()) : undefined,
    costUsd: r.steps.reduce((s, x) => s + x.costUsd, 0),
    inputTokens: r.steps.reduce((s, x) => s + x.inputTokens, 0),
    outputTokens: r.steps.reduce((s, x) => s + x.outputTokens, 0),
  }));
}

/** The graph a skill will run on, for the UI's pre-run progress preview. */
export function outlineForSkill(skill: string): NodeOutline[] {
  return graphOutline(skill);
}

// ---- dashboard aggregation ----

export type CountEntry = { key: string; count: number };

/** Per-skill spread of run duration. A standardized skill should produce a tight
 *  distribution; a wide one means the workflow isn't actually repeatable. */
export type SkillConsistency = {
  skill: string;
  count: number;
  p50Ms: number;
  p95Ms: number;
  /** Coefficient of variation of duration (stddev / mean) — lower = more predictable. */
  cv: number;
  avgCostUsd: number;
};

export type DashboardMetrics = {
  filters: { providers: string[]; projects: string[] };
  range: { days: number; from: string | null; to: string | null };
  // ---- Tier 1: value. What the app adds over driving the Claude CLI by hand,
  // where the honest baseline is one developer running one CLI session at a time.
  leverage: {
    compressionFactor: number;
    concurrentPeak: number;
    hoursSaved: number;
    agentActiveHours: number;
    wallClockHours: number;
    humanWaitHours: number;
    blockedBeforeSpawn: number;
    wasteAvertedUsd: number;
    sessionsRecovered: number;
  };
  // ---- Tier 2: quality. Measured per TICKET, not per run — rework is the point.
  quality: {
    ticketsAttempted: number;
    ticketsShipped: number;
    firstPassRate: number;
    reworkFactor: number;
    /** Share of reviewed runs that needed no fix round. */
    loopPassRate: number;
    /** Runs that reached the independent reviewer. */
    loopRuns: number;
    avgFixRounds: number;
    reviewPassedRuns: number;
    reviewEscapes: number;
    testGateChecks: number;
    testGateRefusals: number;
    reflections: number;
    lessonsFromFailures: number;
    reviewFixRatio: number;
    implementRuns: number;
    fixReviewRuns: number;
    avgFilesPerRun: number;
    avgLinesPerRun: number;
    /** Runs stopped by the harness *before* publishing because the contract said
     *  a check had failed. Only measurable now that verification is a typed field
     *  rather than a sentence in the transcript. */
    blockedOnVerification: number;
  };
  roi: {
    configured: boolean;
    hourlyRateUsd: number;
    estimatedHours: number;
    estimatedValueUsd: number;
    tokenSpendUsd: number;
    netUsd: number;
    multiple: number;
    sizedTickets: number;
    coverage: number;
  };
  funnel: {
    runs: number;
    prCreated: number;
    merged: number;
    mergedClean: number;
    providerBacked: boolean;
  };
  consistency: SkillConsistency[];
  // ---- Tier 3: operations.
  volume: { total: number; byProvider: CountEntry[]; byProject: CountEntry[]; bySkill: CountEntry[] };
  reliability: {
    completed: number;
    failed: number;
    cancelled: number;
    running: number;
    awaitingApproval: number;
    successRate: number;
  };
  speed: { count: number; avgMs: number; p50Ms: number; p95Ms: number };
  cost: {
    totalUsd: number;
    avgUsdPerRun: number;
    costPerShippedTicket: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    avgTokensPerRun: number;
    withUsageCount: number;
    trend: { date: string; costUsd: number; runs: number; shipped: number }[];
  };
  efficiency: { cacheReadTokens: number; inputTokens: number; cacheHitRatio: number };
  ops: { avgTurns: number; byModel: CountEntry[]; byEffort: CountEntry[] };
  /** Per-node spend and reliability. New with the graph: "which step costs the
   *  money and which step fails" is a question a single Execution row could not
   *  answer. */
  nodes: { nodeId: string; label: string; runs: number; failures: number; avgCostUsd: number; avgMs: number }[];
};

function countBy(rows: { key: string }[]): CountEntry[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = r.key || "(unknown)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

// ---- interval math (the parallelism metrics) ----

type Interval = { start: number; end: number };

// Wall-clock during which at least one run was in flight. Compared against the
// summed per-run wall-clock, this is what shows concurrency actually happened.
function unionMs(ivs: Interval[]): number {
  if (!ivs.length) return 0;
  const s = [...ivs].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = s[0].start;
  let curEnd = s[0].end;
  for (let i = 1; i < s.length; i++) {
    if (s[i].start > curEnd) {
      total += curEnd - curStart;
      curStart = s[i].start;
      curEnd = s[i].end;
    } else if (s[i].end > curEnd) {
      curEnd = s[i].end;
    }
  }
  return total + (curEnd - curStart);
}

// Sweep line over start/end events. Ends are processed before starts at the same
// instant so a run ending exactly as another begins doesn't read as overlap.
function peakConcurrency(ivs: Interval[]): number {
  const events = ivs.flatMap((i) => [
    { t: i.start, d: 1 },
    { t: i.end, d: -1 },
  ]);
  events.sort((a, b) => a.t - b.t || a.d - b.d);
  let cur = 0;
  let peak = 0;
  for (const e of events) {
    cur += e.d;
    if (cur > peak) peak = cur;
  }
  return peak;
}

function coeffOfVariation(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  if (!mean) return 0;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance) / mean;
}

// Calendar day in the SERVER's timezone. toISOString() would bucket a 9pm GMT+7
// run into the next day, visibly skewing the cost trend.
function localDay(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const isImplementSkill = (skill: string) => skill.startsWith("implement-ticket");
const isFixReviewSkill = (skill: string) => skill.startsWith("fix-code-review");

// A run the user cancelled, or whose plan the reviewer discarded, is a human
// decision and not an agent failure — it must never drag down the success rate.
const isHumanEnded = (endReason: string) => endReason === "cancelled" || endReason === "plan-rejected";

/** Read-only aggregate for the dashboard.
 *
 *  Money and tokens come from the Step rows and are summed per run in one
 *  groupBy, so the Run table stays free of duplicated totals and the aggregate
 *  never touches a blob: the diffs live in Artifact rows and the logs in Step
 *  rows, neither of which is selected here. */
export async function dashboardMetrics(filter?: {
  provider?: string;
  /** Organization URL of the active connection, and the provider it belongs to.
   *  History belongs to the organization it was run against, so the dashboard
   *  follows the header's organization switch the way every provider-backed page
   *  does — but only over that provider's own runs: an Azure DevOps organization
   *  says nothing about a GitHub run. */
  org?: string;
  orgProvider?: string;
  project?: string;
  /** Lookback window in days; 0 or undefined = all time. */
  days?: number;
}): Promise<DashboardMetrics> {
  // The one Prisma read in the app worth caching: it scans the whole Run table
  // plus a groupBy over Step, and it answers a reporting question — nobody
  // opens the dashboard to confirm a write they made a second ago. Everything
  // else this module exports (a run, its steps, a ticket's history) is live
  // execution state that the UI polls, and caching that would freeze the screen.
  //
  // TTL only, with no invalidation hook: runs are written from a dozen places
  // in the engine, and a minute-old aggregate is the honest cost of not
  // threading a cache-drop through all of them.
  const key = `${DB_CACHE_PREFIX}dashboard:${JSON.stringify([
    filter?.provider ?? "", filter?.org ?? "", filter?.orgProvider ?? "",
    filter?.project ?? "", filter?.days ?? 0,
  ])}`;
  return cached(key, DASHBOARD_TTL, () => computeDashboardMetrics(filter));
}

const DASHBOARD_TTL = 60;

async function computeDashboardMetrics(filter?: {
  provider?: string;
  org?: string;
  orgProvider?: string;
  project?: string;
  days?: number;
}): Promise<DashboardMetrics> {
  const days = filter?.days && filter.days > 0 ? filter.days : 0;
  const since = days ? new Date(Date.now() - days * 86400000) : null;

  const [rows, distinct, blocked, setting, stepSums, nodeStats] = await Promise.all([
    prisma.run.findMany({
      where: since ? { startedAt: { gte: since } } : undefined,
      select: {
        id: true, ticketId: true, provider: true, org: true, project: true, skill: true, graphId: true,
        state: true, endReason: true, prUrl: true, model: true, effort: true,
        humanWaitMs: true, resumedAfterRestart: true,
        filesTouched: true, linesAdded: true, linesDeleted: true, estimateHours: true,
        startedAt: true, endedAt: true,
      },
    }),
    // Filter option lists must span ALL runs, not just the selected window —
    // otherwise narrowing the range hides the project you wanted to select.
    prisma.run.findMany({ select: { provider: true, org: true, project: true }, distinct: ["provider", "org", "project"] }),
    prisma.blockedAttempt.findMany({
      where: since ? { createdAt: { gte: since } } : undefined,
      select: { provider: true, org: true, projectName: true },
    }),
    prisma.setting.findUnique({ where: { id: "default" }, select: { hourlyRateUsd: true } }),
    prisma.step.groupBy({
      by: ["runId"],
      _sum: {
        costUsd: true, inputTokens: true, outputTokens: true,
        cacheReadTokens: true, numTurns: true, durationMs: true,
      },
    }),
    prisma.step.groupBy({
      by: ["nodeId", "label", "status"],
      _count: { _all: true },
      _avg: { costUsd: true, durationMs: true },
    }),
  ]);

  const sums = new Map(stepSums.map((s) => [s.runId, s._sum]));
  const usage = (id: string) => ({
    costUsd: sums.get(id)?.costUsd ?? 0,
    inputTokens: sums.get(id)?.inputTokens ?? 0,
    outputTokens: sums.get(id)?.outputTokens ?? 0,
    cacheReadTokens: sums.get(id)?.cacheReadTokens ?? 0,
    numTurns: sums.get(id)?.numTurns ?? 0,
    durationMs: sums.get(id)?.durationMs ?? 0,
  });

  const providers = [...new Set(distinct.map((r) => r.provider).filter(Boolean))].sort();
  // A run is in the selected organization when it targeted it, or when it
  // belongs to a different provider entirely (that provider has its own
  // organization, and this filter is not about it).
  const inOrg = (rowProvider: string, rowOrg: string) =>
    !filter?.org || rowProvider !== filter.orgProvider || rowOrg === filter.org;

  const projects = [
    ...new Set(distinct.filter((r) => inOrg(r.provider, r.org)).map((r) => r.project).filter(Boolean)),
  ].sort();

  const scoped = rows.filter(
    (r) =>
      (!filter?.provider || r.provider === filter.provider) &&
      inOrg(r.provider, r.org) &&
      (!filter?.project || r.project === filter.project)
  );
  const scopedBlocked = blocked.filter(
    (b) =>
      (!filter?.provider || b.provider === filter.provider) &&
      inOrg(b.provider, b.org) &&
      (!filter?.project || b.projectName === filter.project)
  );

  const completed = scoped.filter((r) => r.state === "succeeded").length;
  const failed = scoped.filter((r) => r.state === "failed" && !isHumanEnded(r.endReason)).length;
  const cancelled = scoped.filter((r) => r.state === "cancelled" || isHumanEnded(r.endReason)).length;
  const running = scoped.filter((r) => r.state === "running").length;
  // `waiting` alone would also count runs parked on the Claude account's usage
  // limit, and this number is read as "how many runs are sitting on somebody's
  // desk" — held after a restart mid-publish. A run waiting for a quota is on
  // nobody's desk.
  const awaitingApproval = scoped.filter((r) => r.state === "waiting" && r.endReason !== "rate-limited").length;
  const decided = completed + failed;

  // ---- leverage (parallelism) ----
  // Baseline: one developer, one terminal, one CLI session — strictly sequential.
  const now = Date.now();
  const intervals: Interval[] = scoped
    .map((r) => ({ start: r.startedAt.getTime(), end: r.endedAt?.getTime() ?? now }))
    .filter((i) => i.end > i.start);
  const summedRunMs = intervals.reduce((s, i) => s + (i.end - i.start), 0);
  const busyMs = unionMs(intervals);
  const agentActiveMs = scoped.reduce((s, r) => {
    const d = usage(r.id).durationMs;
    return s + (d > 0 ? d : Math.max(0, (r.endedAt?.getTime() ?? now) - r.startedAt.getTime()));
  }, 0);
  const humanWaitMs = scoped.reduce((s, r) => s + r.humanWaitMs, 0);

  // ---- quality (per ticket, not per run) ----
  const implementRows = scoped.filter((r) => isImplementSkill(r.skill));
  const fixReviewRuns = scoped.filter((r) => isFixReviewSkill(r.skill)).length;
  const byTicket = new Map<string, typeof implementRows>();
  for (const r of implementRows) {
    const list = byTicket.get(r.ticketId) ?? [];
    list.push(r);
    byTicket.set(r.ticketId, list);
  }
  let ticketsShipped = 0;
  let firstPassTickets = 0;
  let sizedTickets = 0;
  let estimatedHours = 0;
  for (const list of byTicket.values()) {
    const ordered = [...list].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    const shipped = ordered.some((r) => r.state === "succeeded");
    if (shipped) ticketsShipped += 1;
    if (ordered[0]?.state === "succeeded") firstPassTickets += 1;
    // Credit the estimate once per ticket, not once per run — re-running a ticket
    // must not inflate the value it delivered.
    const estimate = ordered.find((r) => r.estimateHours > 0)?.estimateHours ?? 0;
    if (shipped && estimate > 0) {
      sizedTickets += 1;
      estimatedHours += estimate;
    }
  }
  const ticketsAttempted = byTicket.size;
  const changedRuns = scoped.filter((r) => r.filesTouched > 0);

  // How the check / review / fix loop is doing. A run that reached the reviewer
  // was judged; one that needed no `fix` step passed the test gate and the
  // reviewer as written. Each refusal is one more attempt at the fix node, so
  // the count of those Steps *is* the fix-round count.
  const loopSteps = await prisma.step.groupBy({
    by: ["runId", "nodeId"],
    where: { nodeId: { in: ["evaluate", "fix"] }, runId: { in: scoped.map((r) => r.id) } },
    _count: { _all: true },
  });
  const reviewedRunIds = new Set(loopSteps.filter((s) => s.nodeId === "evaluate").map((s) => s.runId));
  const fixedRunIds = new Set(loopSteps.filter((s) => s.nodeId === "fix").map((s) => s.runId));
  const loopRuns = reviewedRunIds.size;
  const loopCleanRuns = [...reviewedRunIds].filter((id) => !fixedRunIds.has(id)).length;
  const fixSteps = loopSteps
    .filter((s) => s.nodeId === "fix" && reviewedRunIds.has(s.runId))
    .reduce((n, s) => n + s._count._all, 0);
  const escapes = reviewEscapes(scoped, reviewedRunIds);
  const scopedIds = { in: scoped.map((r) => r.id) };
  const [testGateChecks, testGateRefusals, reflections, lessonsFromFailures] = await Promise.all([
    prisma.step.count({ where: { nodeId: "check", status: "succeeded", runId: scopedIds } }),
    prisma.step.count({ where: { nodeId: "check", status: "succeeded", runId: scopedIds, output: { path: ["passed"], equals: false } } }),
    prisma.step.count({ where: { nodeId: "reflect", runId: scopedIds } }),
    prisma.step.count({ where: { nodeId: "reflect", runId: scopedIds, output: { path: ["recorded"], equals: true } } }),
  ]);
  // Counted off the routing decision itself, not guessed from the run's shape.
  // The old proxy — "failed, and no PR" — counted *every* agent failure, so a run
  // that died on a missing credential was reported as one the harness had stopped
  // for shipping unverified code. These reason strings are produced by the
  // implement edge from the typed `verification` field, so the metric is now tied
  // to the contract that actually did the blocking.
  const blockedOnVerification = await prisma.transition.count({
    where: {
      runId: { in: scoped.map((r) => r.id) },
      toNode: "FAIL",
      reason: { startsWith: "verification." },
    },
  });

  // ---- consistency (per skill) ----
  const skillDurations = new Map<string, { ms: number[]; cost: number[] }>();
  for (const r of scoped) {
    if (r.state !== "succeeded" || !r.endedAt) continue;
    const ms = r.endedAt.getTime() - r.startedAt.getTime();
    if (ms < 0) continue;
    const acc = skillDurations.get(r.skill) ?? { ms: [], cost: [] };
    acc.ms.push(ms);
    acc.cost.push(usage(r.id).costUsd);
    skillDurations.set(r.skill, acc);
  }
  const consistency: SkillConsistency[] = [...skillDurations.entries()]
    .map(([skill, acc]) => {
      const sorted = [...acc.ms].sort((a, b) => a - b);
      return {
        skill,
        count: sorted.length,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        cv: coeffOfVariation(acc.ms),
        avgCostUsd: acc.cost.reduce((s, x) => s + x, 0) / acc.cost.length,
      };
    })
    .sort((a, b) => b.count - a.count);

  const durations = scoped
    .filter((r) => r.state === "succeeded" && r.endedAt)
    .map((r) => r.endedAt!.getTime() - r.startedAt.getTime())
    .filter((ms) => ms >= 0)
    .sort((a, b) => a - b);
  const avgMs = durations.length ? durations.reduce((s, x) => s + x, 0) / durations.length : 0;

  const withUsage = scoped.filter((r) => usage(r.id).costUsd > 0 || usage(r.id).inputTokens > 0);
  const totalUsd = scoped.reduce((s, r) => s + usage(r.id).costUsd, 0);
  const totalInputTokens = scoped.reduce((s, r) => s + usage(r.id).inputTokens, 0);
  const totalOutputTokens = scoped.reduce((s, r) => s + usage(r.id).outputTokens, 0);
  const totalTokens = totalInputTokens + totalOutputTokens;
  const cacheReadTokens = scoped.reduce((s, r) => s + usage(r.id).cacheReadTokens, 0);
  const totalTurns = scoped.reduce((s, r) => s + usage(r.id).numTurns, 0);
  const hourlyRateUsd = setting?.hourlyRateUsd ?? 0;

  const trendMap = new Map<string, { costUsd: number; runs: number; shipped: number }>();
  for (const r of scoped) {
    const date = localDay(r.startedAt);
    const acc = trendMap.get(date) ?? { costUsd: 0, runs: 0, shipped: 0 };
    acc.costUsd += usage(r.id).costUsd;
    acc.runs += 1;
    if (r.state === "succeeded") acc.shipped += 1;
    trendMap.set(date, acc);
  }
  const trend = [...trendMap.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Per-node roll-up. Grouped in the database rather than in memory because the
  // Step table grows several rows per run.
  const nodeMap = new Map<string, { label: string; runs: number; failures: number; cost: number; ms: number }>();
  for (const s of nodeStats) {
    const acc = nodeMap.get(s.nodeId) ?? { label: s.label || s.nodeId, runs: 0, failures: 0, cost: 0, ms: 0 };
    const n = s._count._all;
    acc.runs += n;
    if (s.status === "failed" || s.status === "abandoned") acc.failures += n;
    acc.cost += (s._avg.costUsd ?? 0) * n;
    acc.ms += (s._avg.durationMs ?? 0) * n;
    nodeMap.set(s.nodeId, acc);
  }
  const nodes = [...nodeMap.entries()]
    .map(([nodeId, a]) => ({
      nodeId,
      label: a.label,
      runs: a.runs,
      failures: a.failures,
      avgCostUsd: a.runs ? a.cost / a.runs : 0,
      avgMs: a.runs ? a.ms / a.runs : 0,
    }))
    .sort((a, b) => b.avgCostUsd - a.avgCostUsd);

  return {
    filters: { providers, projects },
    range: { days, from: since ? localDay(since) : trend[0]?.date ?? null, to: trend[trend.length - 1]?.date ?? null },
    leverage: {
      compressionFactor: busyMs ? summedRunMs / busyMs : 0,
      concurrentPeak: peakConcurrency(intervals),
      hoursSaved: Math.max(0, summedRunMs - busyMs) / 3600000,
      agentActiveHours: agentActiveMs / 3600000,
      wallClockHours: busyMs / 3600000,
      humanWaitHours: humanWaitMs / 3600000,
      blockedBeforeSpawn: scopedBlocked.length,
      // Valued at what an average run costs: each blocked request is one run the
      // CLI would otherwise have started and failed part-way through.
      wasteAvertedUsd: scopedBlocked.length * (withUsage.length ? totalUsd / withUsage.length : 0),
      sessionsRecovered: scoped.filter((r) => r.resumedAfterRestart).length,
    },
    quality: {
      ticketsAttempted,
      ticketsShipped,
      firstPassRate: ticketsAttempted ? firstPassTickets / ticketsAttempted : 0,
      reworkFactor: ticketsAttempted ? implementRows.length / ticketsAttempted : 0,
      loopPassRate: loopRuns ? loopCleanRuns / loopRuns : 0,
      loopRuns,
      avgFixRounds: loopRuns ? fixSteps / loopRuns : 0,
      reviewPassedRuns: escapes.passed,
      reviewEscapes: escapes.escaped,
      testGateChecks,
      testGateRefusals,
      reflections,
      lessonsFromFailures,
      reviewFixRatio: implementRows.length ? fixReviewRuns / implementRows.length : 0,
      implementRuns: implementRows.length,
      fixReviewRuns,
      avgFilesPerRun: changedRuns.length
        ? changedRuns.reduce((s, r) => s + r.filesTouched, 0) / changedRuns.length
        : 0,
      avgLinesPerRun: changedRuns.length
        ? changedRuns.reduce((s, r) => s + r.linesAdded + r.linesDeleted, 0) / changedRuns.length
        : 0,
      blockedOnVerification,
    },
    roi: {
      configured: hourlyRateUsd > 0,
      hourlyRateUsd,
      estimatedHours,
      estimatedValueUsd: estimatedHours * hourlyRateUsd,
      tokenSpendUsd: totalUsd,
      netUsd: estimatedHours * hourlyRateUsd - totalUsd,
      multiple: totalUsd > 0 ? (estimatedHours * hourlyRateUsd) / totalUsd : 0,
      sizedTickets,
      coverage: ticketsShipped ? sizedTickets / ticketsShipped : 0,
    },
    funnel: {
      runs: scoped.length,
      // prUrl is a contract field now, not a regex hit on the log — this count is
      // exact rather than best-effort.
      prCreated: scoped.filter((r) => !!r.prUrl).length,
      merged: 0, // filled in by /api/dashboard/funnel (provider poll)
      mergedClean: 0,
      providerBacked: false,
    },
    consistency,
    volume: {
      total: scoped.length,
      byProvider: countBy(scoped.map((r) => ({ key: r.provider }))),
      byProject: countBy(scoped.map((r) => ({ key: r.project }))),
      bySkill: countBy(scoped.map((r) => ({ key: r.skill }))),
    },
    reliability: { completed, failed, cancelled, running, awaitingApproval, successRate: decided ? completed / decided : 0 },
    speed: { count: durations.length, avgMs, p50Ms: percentile(durations, 50), p95Ms: percentile(durations, 95) },
    cost: {
      totalUsd,
      avgUsdPerRun: withUsage.length ? totalUsd / withUsage.length : 0,
      costPerShippedTicket: ticketsShipped ? totalUsd / ticketsShipped : 0,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      avgTokensPerRun: withUsage.length ? totalTokens / withUsage.length : 0,
      withUsageCount: withUsage.length,
      trend,
    },
    efficiency: {
      cacheReadTokens,
      inputTokens: totalInputTokens,
      cacheHitRatio: cacheReadTokens + totalInputTokens ? cacheReadTokens / (cacheReadTokens + totalInputTokens) : 0,
    },
    ops: {
      avgTurns: scoped.length ? totalTurns / scoped.length : 0,
      byModel: countBy(scoped.map((r) => ({ key: r.model || "(default)" }))),
      byEffort: countBy(scoped.map((r) => ({ key: r.effort || "(default)" }))),
    },
    nodes,
  };
}
