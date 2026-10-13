"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProviderId } from "@/lib/providers";
import type { PreflightResult } from "@/lib/preflight";

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
