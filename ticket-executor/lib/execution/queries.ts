import { prisma } from "../prisma";
import type { ExecPhase, ExecStatus, FileChange, PlanStatus } from "../types";
import { isFixReviewSkill } from "../ui";
import { fmtDuration, safeParseJson, safeParseLogs } from "./format";
import { store } from "./store";

// Live view of an execution still held in the in-process store.
export function getExecution(id: string) {
  const e = store.get(id);
  if (!e) return null;
  return {
    id: e.id,
    adoTicketId: e.ticketId,
    projectName: e.project,
    skillName: e.skill,
    model: e.model,
    effort: e.effort,
    command: e.command,
    status: e.status,
    logLines: e.logLines,
    resultText: e.resultText,
    errorMessage: e.error,
    prUrl: e.prUrl,
    branch: e.branch,
    currentStep: e.currentStep,
    filesChanged: e.filesChanged,
    phase: e.phase,
    planStatus: e.planStatus,
    planMarkdown: e.planMarkdown,
    duration: e.completedAt ? fmtDuration(e.completedAt - e.startedAt) : undefined,
    costUsd: e.costUsd,
    inputTokens: e.inputTokens,
    outputTokens: e.outputTokens,
    startedAt: new Date(e.startedAt).toISOString(),
    completedAt: e.completedAt ? new Date(e.completedAt).toISOString() : null,
  };
}

// Load a finished execution from the database (used after a server restart or
// for history, when it is no longer in the in-memory store).
export async function getPersistedExecution(id: string) {
  const r = await prisma.execution.findUnique({ where: { id } });
  if (!r) return null;
  return {
    id: r.id,
    adoTicketId: r.adoTicketId,
    projectName: r.projectName,
    skillName: r.skillName,
    model: r.model,
    effort: r.effort,
    command: r.command,
    status: r.status as ExecStatus,
    logLines: safeParseLogs(r.logLines),
    resultText: r.resultText,
    errorMessage: r.errorMessage,
    prUrl: r.prUrl,
    branch: r.branch,
    currentStep: r.currentStep,
    filesChanged: safeParseJson<FileChange[]>(r.filesChanged, []),
    phase: r.phase as ExecPhase,
    planStatus: r.planStatus as PlanStatus,
    planMarkdown: r.planMarkdown,
    duration: r.completedAt ? fmtDuration(r.completedAt.getTime() - r.startedAt.getTime()) : undefined,
    costUsd: r.costUsd,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  };
}

// ---- dashboard aggregation ----

export type CountEntry = { key: string; count: number };

// Per-skill spread of run duration. A standardized skill should produce a tight
// distribution; a wide one means the workflow isn't actually repeatable.
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
  // Distinct values across ALL runs (unfiltered), for the filter dropdowns.
  filters: { providers: string[]; projects: string[] };
  range: { days: number; from: string | null; to: string | null };
  // ---- Tier 1: value. What the app adds over driving the Claude CLI by hand,
  // where the honest baseline is one developer running one CLI session at a time.
  leverage: {
    /** Σ per-run wall-clock ÷ wall-clock the system was busy at all. 1.0 = fully
     *  sequential (what a single terminal session can do); >1 = real overlap. */
    compressionFactor: number;
    concurrentPeak: number;
    hoursSaved: number; // (Σ run wall-clock − busy wall-clock)
    agentActiveHours: number; // CLI-reported compute time
    wallClockHours: number; // union of run intervals
    humanWaitHours: number; // run wall-clock not spent computing (≈ parked at the plan gate)
    blockedBeforeSpawn: number; // runs preflight rejected before any token was spent
    wasteAvertedUsd: number;
    sessionsRecovered: number; // parked plans resumed after a server restart
  };
  // ---- Tier 2: quality. Measured per TICKET, not per run — rework is the point.
  quality: {
    ticketsAttempted: number;
    ticketsShipped: number;
    firstPassRate: number; // shipped on the first attempt / attempted
    reworkFactor: number; // implement runs per attempted ticket (1.0 = no retries)
    planApprovalRate: number; // approved / (approved + rejected)
    planReviewedCount: number;
    avgPlanRevisions: number;
    reviewFixRatio: number; // fix-code-review runs / implement runs
    implementRuns: number;
    fixReviewRuns: number;
    avgFilesPerRun: number;
    avgLinesPerRun: number;
  };
  // A SECOND, different baseline from `leverage`: what the tickets would have
  // cost with no agent at all, priced from the team's own estimates. Only
  // meaningful where tickets are actually sized, hence `coverage`.
  roi: {
    /** false → no hourly rate configured; the UI must hide this rather than guess one. */
    configured: boolean;
    hourlyRateUsd: number;
    estimatedHours: number; // Σ estimate of shipped, sized tickets
    estimatedValueUsd: number;
    tokenSpendUsd: number;
    netUsd: number;
    multiple: number; // estimatedValueUsd / tokenSpendUsd
    sizedTickets: number;
    coverage: number; // sized / shipped, 0..1
  };
  funnel: {
    runs: number;
    prCreated: number;
    merged: number;
    mergedClean: number;
    /** false → merged/mergedClean were not resolved against the provider. */
    providerBacked: boolean;
  };
  consistency: SkillConsistency[];
  // ---- Tier 3: operations.
  volume: {
    total: number;
    byProvider: CountEntry[];
    byProject: CountEntry[];
    bySkill: CountEntry[];
  };
  reliability: {
    completed: number;
    failed: number;
    cancelled: number;
    running: number;
    awaitingApproval: number;
    successRate: number; // completed / (completed + failed) — cancelled excluded
  };
  speed: { count: number; avgMs: number; p50Ms: number; p95Ms: number };
  cost: {
    totalUsd: number;
    avgUsdPerRun: number; // over runs that recorded usage
    costPerShippedTicket: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    avgTokensPerRun: number; // over runs that recorded usage
    withUsageCount: number;
    trend: { date: string; costUsd: number; runs: number; shipped: number }[]; // by local day, ascending
  };
  efficiency: {
    cacheReadTokens: number;
    inputTokens: number;
    cacheHitRatio: number; // cacheRead / (cacheRead + input), 0..1
  };
  ops: { avgTurns: number; byModel: CountEntry[]; byEffort: CountEntry[] };
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

// Read-only aggregate over the Execution table for the dashboard. `provider` is
// only meaningfully populated on runs recorded after that column was added
// (older rows carry "" and are grouped as "(unknown)").
//
// Deliberately narrow `select`: filesChanged / logLines / planMarkdown are large
// text blobs and must never be pulled into an aggregate over the whole table.
export async function dashboardMetrics(filter?: {
  provider?: string;
  project?: string;
  /** Lookback window in days; 0 or undefined = all time. */
  days?: number;
}): Promise<DashboardMetrics> {
  const days = filter?.days && filter.days > 0 ? filter.days : 0;
  const since = days ? new Date(Date.now() - days * 86400000) : null;

  const [rows, distinct, blocked, setting] = await Promise.all([
    prisma.execution.findMany({
      where: since ? { startedAt: { gte: since } } : undefined,
      select: {
        adoTicketId: true, provider: true, projectName: true, skillName: true, status: true,
        endReason: true, planStatus: true, planRevisions: true, prUrl: true, model: true, effort: true,
        costUsd: true, inputTokens: true, outputTokens: true, cacheReadTokens: true,
        numTurns: true, durationMs: true, humanWaitMs: true, resumedAfterRestart: true,
        filesTouched: true, linesAdded: true, linesDeleted: true, estimateHours: true,
        startedAt: true, completedAt: true,
      },
    }),
    // Filter option lists must span ALL runs, not just the selected window —
    // otherwise narrowing the range hides the project you wanted to select.
    prisma.execution.findMany({ select: { provider: true, projectName: true }, distinct: ["provider", "projectName"] }),
    prisma.blockedAttempt.findMany({
      where: since ? { createdAt: { gte: since } } : undefined,
      select: { provider: true, projectName: true },
    }),
    prisma.setting.findUnique({ where: { id: "default" }, select: { hourlyRateUsd: true } }),
  ]);

  const providers = [...new Set(distinct.map((r) => r.provider).filter(Boolean))].sort();
  const projects = [...new Set(distinct.map((r) => r.projectName).filter(Boolean))].sort();

  const scoped = rows.filter(
    (r) =>
      (!filter?.provider || r.provider === filter.provider) &&
      (!filter?.project || r.projectName === filter.project)
  );

  const scopedBlocked = blocked.filter(
    (b) =>
      (!filter?.provider || b.provider === filter.provider) &&
      (!filter?.project || b.projectName === filter.project)
  );

  const completed = scoped.filter((r) => r.status === "completed").length;
  // A run the user cancelled or whose plan the reviewer discarded is a human
  // decision, not an agent failure — it must not drag down the success rate.
  const isHumanEnded = (endReason: string) => endReason === "cancelled" || endReason === "plan-rejected";
  const failed = scoped.filter((r) => r.status === "failed" && !isHumanEnded(r.endReason)).length;
  const cancelled = scoped.filter((r) => r.status === "failed" && isHumanEnded(r.endReason)).length;
  const running = scoped.filter((r) => r.status === "running").length;
  const awaitingApproval = scoped.filter((r) => r.status === "awaiting-approval").length;
  const decided = completed + failed;

  // ---- leverage (parallelism) ----
  // Baseline: one developer, one terminal, one CLI session — strictly sequential.
  // A still-running run is measured up to now so live concurrency is visible.
  const now = Date.now();
  const intervals: Interval[] = scoped
    .map((r) => ({ start: r.startedAt.getTime(), end: (r.completedAt?.getTime() ?? now) }))
    .filter((i) => i.end > i.start);
  const summedRunMs = intervals.reduce((s, i) => s + (i.end - i.start), 0);
  const busyMs = unionMs(intervals);
  const compressionFactor = busyMs ? summedRunMs / busyMs : 0;
  // durationMs is the CLI-reported compute time, accumulated across a run's turns.
  // Rows predating that column carry 0 — fall back to wall-clock so they still count.
  const agentActiveMs = scoped.reduce((s, r) => {
    if (r.durationMs > 0) return s + r.durationMs;
    return s + Math.max(0, (r.completedAt?.getTime() ?? now) - r.startedAt.getTime());
  }, 0);
  // Measured directly at the plan gate (park → resolve), so this is real waiting
  // on a human rather than the difference between two clocks.
  const humanWaitMs = scoped.reduce((s, r) => s + r.humanWaitMs, 0);

  // ---- quality (per ticket, not per run) ----
  const implementRows = scoped.filter((r) => isImplementSkill(r.skillName));
  const fixReviewRuns = scoped.filter((r) => isFixReviewSkill(r.skillName)).length;
  const byTicket = new Map<string, typeof implementRows>();
  for (const r of implementRows) {
    const list = byTicket.get(r.adoTicketId) ?? [];
    list.push(r);
    byTicket.set(r.adoTicketId, list);
  }
  let ticketsShipped = 0;
  let firstPassTickets = 0;
  let sizedTickets = 0;
  let estimatedHours = 0;
  for (const list of byTicket.values()) {
    const ordered = [...list].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    // "Shipped" = the skill ran through to the end at least once. prUrl is a
    // log-scraped best-effort value, so it drives the funnel but not this.
    const shipped = ordered.some((r) => r.status === "completed");
    if (shipped) ticketsShipped += 1;
    if (ordered[0]?.status === "completed") firstPassTickets += 1;
    // Credit the estimate once per ticket, not once per run — re-running a
    // ticket must not inflate the value it delivered.
    const estimate = ordered.find((r) => r.estimateHours > 0)?.estimateHours ?? 0;
    if (shipped && estimate > 0) {
      sizedTickets += 1;
      estimatedHours += estimate;
    }
  }
  const ticketsAttempted = byTicket.size;

  // Rows predating the denormalized change-size columns carry 0 and would drag
  // the average toward zero, so the mean is taken over runs that recorded one.
  const changedRuns = scoped.filter((r) => r.filesTouched > 0);

  const planApproved = scoped.filter((r) => r.planStatus === "approved").length;
  const planRejected = scoped.filter((r) => r.planStatus === "rejected").length;
  const planReviewedCount = planApproved + planRejected;

  // ---- consistency (per skill) ----
  const skillDurations = new Map<string, { ms: number[]; cost: number[] }>();
  for (const r of scoped) {
    if (r.status !== "completed" || !r.completedAt) continue;
    const ms = r.completedAt.getTime() - r.startedAt.getTime();
    if (ms < 0) continue;
    const acc = skillDurations.get(r.skillName) ?? { ms: [], cost: [] };
    acc.ms.push(ms);
    acc.cost.push(r.costUsd);
    skillDurations.set(r.skillName, acc);
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

  // Speed: wall-clock duration of completed runs (always present, unlike the
  // CLI-reported durationMs which only exists for runs recorded after Part A).
  const durations = scoped
    .filter((r) => r.status === "completed" && r.completedAt)
    .map((r) => r.completedAt!.getTime() - r.startedAt.getTime())
    .filter((ms) => ms >= 0)
    .sort((a, b) => a - b);
  const avgMs = durations.length ? durations.reduce((s, x) => s + x, 0) / durations.length : 0;

  const withUsage = scoped.filter((r) => r.costUsd > 0 || r.inputTokens > 0);
  const totalUsd = scoped.reduce((s, r) => s + r.costUsd, 0);
  const totalInputTokens = scoped.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutputTokens = scoped.reduce((s, r) => s + r.outputTokens, 0);
  const totalTokens = totalInputTokens + totalOutputTokens;
  const cacheReadTokens = scoped.reduce((s, r) => s + r.cacheReadTokens, 0);
  const totalTurns = scoped.reduce((s, r) => s + r.numTurns, 0);
  const hourlyRateUsd = setting?.hourlyRateUsd ?? 0;

  const trendMap = new Map<string, { costUsd: number; runs: number; shipped: number }>();
  for (const r of scoped) {
    const date = localDay(r.startedAt);
    const acc = trendMap.get(date) ?? { costUsd: 0, runs: 0, shipped: 0 };
    acc.costUsd += r.costUsd;
    acc.runs += 1;
    if (r.status === "completed") acc.shipped += 1;
    trendMap.set(date, acc);
  }
  const trend = [...trendMap.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    filters: { providers, projects },
    range: {
      days,
      from: since ? localDay(since) : trend[0]?.date ?? null,
      to: trend[trend.length - 1]?.date ?? null,
    },
    leverage: {
      compressionFactor,
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
      planApprovalRate: planReviewedCount ? planApproved / planReviewedCount : 0,
      planReviewedCount,
      avgPlanRevisions: planReviewedCount
        ? scoped.reduce((s, r) => s + r.planRevisions, 0) / planReviewedCount
        : 0,
      reviewFixRatio: implementRows.length ? fixReviewRuns / implementRows.length : 0,
      implementRuns: implementRows.length,
      fixReviewRuns,
      avgFilesPerRun: changedRuns.length
        ? changedRuns.reduce((s, r) => s + r.filesTouched, 0) / changedRuns.length
        : 0,
      avgLinesPerRun: changedRuns.length
        ? changedRuns.reduce((s, r) => s + r.linesAdded + r.linesDeleted, 0) / changedRuns.length
        : 0,
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
      prCreated: scoped.filter((r) => !!r.prUrl).length,
      merged: 0, // filled in Phase 3 (provider poll)
      mergedClean: 0,
      providerBacked: false,
    },
    consistency,
    volume: {
      total: scoped.length,
      byProvider: countBy(scoped.map((r) => ({ key: r.provider }))),
      byProject: countBy(scoped.map((r) => ({ key: r.projectName }))),
      bySkill: countBy(scoped.map((r) => ({ key: r.skillName }))),
    },
    reliability: {
      completed, failed, cancelled, running, awaitingApproval,
      successRate: decided ? completed / decided : 0,
    },
    speed: {
      count: durations.length,
      avgMs,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
    },
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
  };
}

// Summaries of past runs for a ticket, newest first (for the history panel).
export async function listExecutions(ticketId: string) {
  const rows = await prisma.execution.findMany({
    where: { adoTicketId: ticketId },
    orderBy: { startedAt: "desc" },
    take: 20,
    select: {
      id: true, status: true, skillName: true, prUrl: true, branch: true,
      resultText: true, filesChanged: true, startedAt: true, completedAt: true,
      costUsd: true, inputTokens: true, outputTokens: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status as ExecStatus,
    skillName: r.skillName,
    prUrl: r.prUrl,
    branch: r.branch,
    resultText: r.resultText,
    filesChanged: safeParseJson<FileChange[]>(r.filesChanged, []),
    startedAt: r.startedAt.toISOString(),
    duration: r.completedAt ? fmtDuration(r.completedAt.getTime() - r.startedAt.getTime()) : undefined,
    costUsd: r.costUsd,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
  }));
}
