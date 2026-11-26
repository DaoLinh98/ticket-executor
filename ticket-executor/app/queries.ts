"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ProviderId } from "@/lib/providers";
import type { PreflightResult } from "@/lib/preflight";
import type { ClaudeModel } from "@/lib/claudeOptions";
import type { ClaudeCredentialView } from "@/lib/claudeAccounts";
import type { Quota } from "@/lib/claudeQuota";
import { HISTORY_SIZES, type HistoryFilter, type HistoryPage } from "@/lib/dagent/historyShape";
import type { InsightsPayload, InsightsPeriod } from "@/lib/dagent/insights";
import type { RunListItem as RunRow, RunView } from "@/lib/dagent/view";

export type ConnectionRow = {
  id: string; label: string; org: string; isActive: boolean;
  hasPat?: boolean; identityEmail?: string; identityName?: string; reviewers?: string[];
};
export type ConnectionsPayload = { provider: ProviderId | ""; connections: ConnectionRow[] };
export type ProjectRow = { id?: string; name: string; [k: string]: unknown };
export type ProjectsPayload = { projects: ProjectRow[]; error: string; notice: string };

export const connectionsKey = (provider = "") => ["connections", provider] as const;
export const projectsKey = (provider = "") => ["projects", provider] as const;

export const fetchConnections = async (provider = ""): Promise<ConnectionsPayload> => {
  const r = await fetch(provider ? `/api/connections?provider=${provider}` : "/api/connections");
  const d = await r.json();
  return {
    provider: (d?.provider as ProviderId) ?? "",
    connections: Array.isArray(d?.connections) ? d.connections : [],
  };
};

export const fetchProjectsPayload = async (provider = ""): Promise<ProjectsPayload> => {
  const r = await fetch(provider ? `/api/projects?provider=${provider}` : "/api/projects");
  const d = await r.json();
  return {
    projects: Array.isArray(d?.projects) ? d.projects : [],
    error: typeof d?.error === "string" ? d.error : "",
    notice: typeof d?.notice === "string" ? d.notice : "",
  };
};

export const useConnections = (provider = "", opts: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: connectionsKey(provider), queryFn: () => fetchConnections(provider), staleTime: 30_000, enabled: opts.enabled ?? true });

export const useProjects = (provider = "") =>
  useQuery({ queryKey: projectsKey(provider), queryFn: () => fetchProjectsPayload(provider), staleTime: 60_000 });

export const PREFLIGHT_KEY = ["preflight"] as const;

export const fetchPreflight = async (deep = false): Promise<PreflightResult> => {
  const r = await fetch(`/api/preflight${deep ? "?deep=1" : ""}`);
  const d = await r.json();
  if (!r.ok || !d.checks) throw new Error(d.error || "Preflight failed to run.");
  return d as PreflightResult;
};

export const usePreflight = () => useQuery({ queryKey: PREFLIGHT_KEY, queryFn: () => fetchPreflight() });

export type SettingsPayload = { settings?: Record<string, unknown> & { provider?: string } };

export const SETTINGS_KEY = ["settings"] as const;

export const fetchSettings = async (): Promise<SettingsPayload> => {
  const r = await fetch("/api/settings", { cache: "no-store" });
  return (await r.json()) as SettingsPayload;
};

/** The Claude account's session / weekly usage (`/api/claude/usage`); `quota` is null when it cannot be read. */
export type ClaudeUsagePayload = { account: string; quota: Quota | null };

export const CLAUDE_USAGE_KEY = ["claude-usage"] as const;

// Anthropic's meter, not our DB — nothing pushes it, so it is polled; focus refetches too (the default).
export const useClaudeUsage = () =>
  useQuery({
    queryKey: CLAUDE_USAGE_KEY,
    queryFn: async (): Promise<ClaudeUsagePayload> => {
      const r = await fetch("/api/claude/usage", { cache: "no-store" });
      if (!r.ok) throw new Error("Could not read the Claude usage.");
      return (await r.json()) as ClaudeUsagePayload;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

/** One machine skill and whether D-Agent runs are offered it (`/api/dagent/skills`). */
export type DagentSkill = { name: string; description: string; enabled: boolean };

export const DAGENT_SKILLS_KEY = ["dagent-skills"] as const;

const readSkills = async (r: Response): Promise<DagentSkill[]> => {
  const d = await r.json();
  if (!r.ok || !Array.isArray(d?.skills)) throw new Error(d?.error || "Could not read the skills.");
  return d.skills as DagentSkill[];
};

export const useDagentSkills = () =>
  useQuery({ queryKey: DAGENT_SKILLS_KEY, queryFn: async () => readSkills(await fetch("/api/dagent/skills", { cache: "no-store" })), staleTime: 0 });

/** Switches one skill on or off; resolves to the whole list as the server now has it. */
export const putDagentSkill = async (name: string, enabled: boolean): Promise<DagentSkill[]> =>
  readSkills(await fetch("/api/dagent/skills", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, enabled }) }));

export const CLAUDE_MODELS_KEY = ["claude-models"] as const;

export const useClaudeModels = () =>
  useQuery({
    queryKey: CLAUDE_MODELS_KEY,
    queryFn: async (): Promise<{ models: ClaudeModel[] }> => {
      const r = await fetch("/api/claude-models");
      const d = await r.json();
      if (!r.ok || !Array.isArray(d?.models)) throw new Error(d?.error || "Could not read the Claude model list.");
      return d;
    },
    staleTime: 600_000,
  });

// Settings → Claude: the saved Claude accounts, in the order runs try them. Status (limited / rejected) changes
// while runs go on, so it is refetched on every visit.
export const CLAUDE_CREDENTIALS_KEY = ["claude-credentials"] as const;

export const fetchClaudeCredentials = async (): Promise<{ credentials: ClaudeCredentialView[] }> => {
  const r = await fetch("/api/claude-credentials", { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(d?.credentials)) throw new Error(d?.error || "Could not read the Claude credentials.");
  return d;
};

export const useClaudeCredentials = () =>
  useQuery({ queryKey: CLAUDE_CREDENTIALS_KEY, queryFn: fetchClaudeCredentials, staleTime: 0 });

export type RunListItem = {
  id: string;
  ticketId: string;
  ticketTitle: string;
  flow: string;
  state: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  costUsd?: number;
  prUrl?: string;
  branch?: string;
  stepCount?: number;
};
export type RunsPayload = { runs: RunListItem[] };
export const RUNS_KEY = ["dagent", "runs"] as const;

export const fetchDagentRuns = async (): Promise<RunsPayload> => {
  const r = await fetch("/api/dagent/runs", { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(d?.runs)) throw new Error(d?.error || "Could not read the D-Agent runs.");
  return d as RunsPayload;
};

// The run list and one run's full view as /workflow reads them (the richer view types, unlike the card above).
export const runViewKey = (id: string | null) => ["dagent", "run", id] as const;

export const fetchRunRows = async (): Promise<{ runs: RunRow[] }> => {
  const r = await fetch("/api/dagent/runs", { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(d?.runs)) throw new Error(d?.error || "Could not read the D-Agent runs.");
  return d as { runs: RunRow[] };
};

export const fetchRunView = async (id: string): Promise<RunView> => {
  const r = await fetch(`/api/dagent/runs/${id}`, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || `Could not read run ${id}.`);
  return d as RunView;
};

export const useDagentRuns = () =>
  useQuery({ queryKey: RUNS_KEY, queryFn: fetchDagentRuns, staleTime: 0 });

// Run History: every D-Agent run, newest first, loaded a page at a time as the list is scrolled. The prefix is swept
// by the run-list stream, which refetches every page already loaded.
export const RUN_HISTORY_PREFIX = ["dagent", "history"] as const;
export type RunHistoryFilter = Pick<HistoryFilter, "state" | "flow" | "q">;
export const runHistoryKey = (f: RunHistoryFilter) => [...RUN_HISTORY_PREFIX, f.state, f.flow, f.q] as const;

export const fetchRunHistory = async (f: RunHistoryFilter, page: number): Promise<HistoryPage> => {
  const qs = new URLSearchParams(Object.entries({ ...f, page, size: HISTORY_SIZES[0] }).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
  const r = await fetch(`/api/dagent/runs/history?${qs}`, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(d?.rows)) throw new Error(d?.error || "Could not read the run history.");
  return d as HistoryPage;
};

// The list on screen stays while a changed filter loads, so the table never blanks.
export const useRunHistory = (f: RunHistoryFilter) =>
  useInfiniteQuery({
    queryKey: runHistoryKey(f),
    queryFn: ({ pageParam }) => fetchRunHistory(f, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.reduce((n, p) => n + p.rows.length, 0) < last.total && last.rows.length ? last.page + 1 : undefined),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

// Insights: run cost, failure and pace metrics for one window. Refetched on focus; the page sweeps the prefix on
// the run-list stream, so a run that ends updates the numbers without a reload.
export const INSIGHTS_PREFIX = ["dagent", "insights"] as const;
export const insightsKey = (period: InsightsPeriod) => [...INSIGHTS_PREFIX, period] as const;

export const fetchInsights = async (period: InsightsPeriod): Promise<InsightsPayload> => {
  const r = await fetch(`/api/dagent/insights?period=${period}`, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d?.totals) throw new Error(d?.error || "Could not read the insights.");
  return d as InsightsPayload;
};

export const useInsights = (period: InsightsPeriod) =>
  useQuery({ queryKey: insightsKey(period), queryFn: () => fetchInsights(period), staleTime: 0, placeholderData: keepPreviousData });

// A ticket's row in the active Flow Runner plan, for the Workflow page's link back. Invalidated by the run's and the plan's streams.
// My Sprint's sprint read and the ticket search its toolbar runs. Both throw on a failed read.
export const SPRINT_KEY = ["my-sprint"] as const;

export const fetchSprint = async (): Promise<import("./(app)/my-sprint/model").MySprint> => {
  const r = await fetch("/api/my-sprint");
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || "Could not read the sprint.");
  return d;
};

// The commits of a ticket's PR and one commit's per-file diffs — the same routes the Commits tab reads. A commit's own
// diff cannot change, so its files are never stale; the list is refreshed by the run's stream.
export const ticketCommitsKey = (ticketId: string, provider: string) => ["ticket-commits", ticketId, provider] as const;
export const commitFilesKey = (ticketId: string, provider: string, sha: string) => ["commit-files", ticketId, provider, sha] as const;

export const fetchTicketCommits = async (ticketId: string, provider: string): Promise<import("@/lib/types").CommitSummary[]> => {
  const r = await fetch(`/api/tickets/${ticketId}/commits?provider=${provider}`, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.error || !Array.isArray(d?.commits)) throw new Error(d?.error || "Could not read the commits.");
  return d.commits;
};

export const fetchCommitFiles = async (ticketId: string, provider: string, sha: string): Promise<import("@/lib/types").CommitFile[]> => {
  const r = await fetch(`/api/tickets/${ticketId}/commits/${sha}?provider=${provider}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.error || !Array.isArray(d?.files)) throw new Error(d?.error || "Could not read the commit's files.");
  return d.files;
};

// What the scheduler's next tick would do for a plan. Refreshed by the plan's stream (any row or event change).
export const tickPreviewKey = (planId: string) => ["my-sprint", "tick-preview", planId] as const;

export const fetchTickPreview = async (planId: string): Promise<import("@/lib/execution/tickPreview").TickPreviewResult> => {
  const r = await fetch(`/api/my-sprint/plan/preview?plan=${encodeURIComponent(planId)}`, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(d?.steps)) throw new Error(d?.error || "Could not read the scheduler preview.");
  return d;
};

export const ticketSearchKey = (q: string) => ["ticket-search", q] as const;

export const fetchTicketSearch = async (q: string, signal?: AbortSignal): Promise<import("@/lib/types").Ticket[]> => {
  const r = await fetch("/api/tickets/search?q=" + encodeURIComponent(q), { signal });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || "The ticket search failed.");
  return Array.isArray(d.tickets) ? d.tickets : [];
};

export type PlanRowPayload = { planId: string; sprint: string; queuePosition: number | null; queueLength: number; row: import("./(app)/my-sprint/model").PlannedRow | null };

export const planRowKey = (ticketId: string, provider: string) => ["my-sprint", "plan-row", provider, ticketId] as const;

export const fetchPlanRow = async (ticketId: string, provider: string): Promise<PlanRowPayload> => {
  const qs = new URLSearchParams({ ticket: ticketId, provider });
  const r = await fetch(`/api/my-sprint/plan/row?${qs}`, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !("row" in d)) throw new Error(d?.error || "Could not read the Flow Runner plan row.");
  return d as PlanRowPayload;
};

export const usePlanRow = (ticketId: string, provider: string) =>
  useQuery({ queryKey: planRowKey(ticketId, provider), queryFn: () => fetchPlanRow(ticketId, provider), enabled: !!ticketId, staleTime: 0 });

