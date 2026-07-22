import { prisma } from "../prisma";
import type { ExecPhase, ExecStatus, FileChange, PlanStatus } from "../types";
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
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  };
}

// ---- dashboard aggregation ----

export type CountEntry = { key: string; count: number };

export type DashboardMetrics = {
  // Distinct values across ALL runs (unfiltered), for the filter dropdowns.
  filters: { providers: string[]; projects: string[] };
  volume: {
    total: number;
    byProvider: CountEntry[];
    byProject: CountEntry[];
    bySkill: CountEntry[];
  };
  reliability: {
    completed: number;
    failed: number;
    running: number;
    awaitingApproval: number;
    successRate: number; // completed / (completed + failed), 0..1
  };
  speed: { count: number; avgMs: number; p50Ms: number; p95Ms: number };
  cost: {
    totalUsd: number;
    avgUsdPerRun: number; // over runs that recorded usage
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    avgTokensPerRun: number; // over runs that recorded usage
    withUsageCount: number;
    trend: { date: string; costUsd: number; runs: number }[]; // by day, ascending
  };
  efficiency: {
    cacheReadTokens: number;
    inputTokens: number;
    cacheHitRatio: number; // cacheRead / (cacheRead + input), 0..1
  };
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

// Read-only aggregate over the Execution table for the dashboard. `provider` is
// only meaningfully populated on runs recorded after that column was added
// (older rows carry "" and are grouped as "(unknown)").
export async function dashboardMetrics(filter?: {
  provider?: string;
  project?: string;
}): Promise<DashboardMetrics> {
  const rows = await prisma.execution.findMany({
    select: {
      provider: true, projectName: true, skillName: true, status: true,
      costUsd: true, inputTokens: true, outputTokens: true,
      cacheReadTokens: true, startedAt: true, completedAt: true,
    },
  });

  // Filter option lists come from the full set; metrics from the filtered set.
  const providers = [...new Set(rows.map((r) => r.provider).filter(Boolean))].sort();
  const projects = [...new Set(rows.map((r) => r.projectName).filter(Boolean))].sort();

  const scoped = rows.filter(
    (r) =>
      (!filter?.provider || r.provider === filter.provider) &&
      (!filter?.project || r.projectName === filter.project)
  );

  const completed = scoped.filter((r) => r.status === "completed").length;
  const failed = scoped.filter((r) => r.status === "failed").length;
  const running = scoped.filter((r) => r.status === "running").length;
  const awaitingApproval = scoped.filter((r) => r.status === "awaiting-approval").length;
  const decided = completed + failed;

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

  const trendMap = new Map<string, { costUsd: number; runs: number }>();
  for (const r of scoped) {
    const date = r.startedAt.toISOString().slice(0, 10);
    const acc = trendMap.get(date) ?? { costUsd: 0, runs: 0 };
    acc.costUsd += r.costUsd;
    acc.runs += 1;
    trendMap.set(date, acc);
  }
  const trend = [...trendMap.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    filters: { providers, projects },
    volume: {
      total: scoped.length,
      byProvider: countBy(scoped.map((r) => ({ key: r.provider }))),
      byProject: countBy(scoped.map((r) => ({ key: r.projectName }))),
      bySkill: countBy(scoped.map((r) => ({ key: r.skillName }))),
    },
    reliability: {
      completed, failed, running, awaitingApproval,
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
  }));
}
