"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ProviderId } from "@/lib/providers";
import type { PreflightResult } from "@/lib/preflight";
import type { ClaudeModel } from "@/lib/claudeOptions";
import type { HistoryFilter, HistoryPage } from "@/lib/dagent/historyShape";
import type { InsightsPayload, InsightsPeriod } from "@/lib/dagent/insights";

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

// Run History: every D-Agent run, newest first, one numbered page per fetch. The prefix is swept by the run-list stream.
export const RUN_HISTORY_PREFIX = ["dagent", "history"] as const;
export const runHistoryKey = (f: HistoryFilter) => [...RUN_HISTORY_PREFIX, f.state, f.flow, f.q, f.page, f.size] as const;

export const fetchRunHistory = async (f: HistoryFilter): Promise<HistoryPage> => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
  const r = await fetch(`/api/dagent/runs/history?${qs}`, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(d?.rows)) throw new Error(d?.error || "Could not read the run history.");
  return d as HistoryPage;
};

// The page on screen stays while the next one loads, so paging never blanks the table.
export const useRunHistory = (f: HistoryFilter) =>
  useQuery({ queryKey: runHistoryKey(f), queryFn: () => fetchRunHistory(f), staleTime: 0, placeholderData: keepPreviousData });

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
