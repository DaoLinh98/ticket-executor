import type { Ticket } from "./types";
import { getSprintTickets } from "./ado";
import { getGithubIssues } from "./github";
import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";
import { DEFAULT_PROVIDER, type ProviderId } from "./providers";

export type TicketLoadResult = {
  tickets: Ticket[];
  sprint: string; // current sprint / context label for the header
  connected: boolean; // whether the provider is actually wired up
  notice?: string; // user-facing message for scaffold providers
};

// Dispatch ticket loading by provider. Azure DevOps is fully wired; the other
// providers are scaffolded — they return a graceful empty result rather than
// throwing, so the UI can show a "not connected yet" state.
export async function loadTickets(provider: ProviderId, sprintOverride?: string): Promise<TicketLoadResult> {
  switch (provider) {
    case "azure-devops": {
      const { tickets, sprintName } = await getSprintTickets(sprintOverride);
      return { tickets, sprint: sprintName, connected: true };
    }
    case "github": {
      const s = await prisma.setting.findUnique({ where: { id: "default" } });
      const url = (s?.org ?? "").trim();
      const token = decryptSecret(s?.pat);
      if (!url || !token) {
        return { tickets: [], sprint: "", connected: false, notice: "GitHub is not configured — set the repository URL and access token in Settings." };
      }
      const tickets = await getGithubIssues(url, token);
      return { tickets, sprint: parseRepoLabel(url), connected: true };
    }
    case "jira":
    case "gitlab":
      return {
        tickets: [],
        sprint: "",
        connected: false,
        notice: `${labelFor(provider)} integration is not connected yet — configure it in Settings.`,
      };
    default:
      return { tickets: [], sprint: "", connected: false, notice: "Unknown provider." };
  }
}

function parseRepoLabel(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}/${parts[1].replace(/\.git$/, "")}` : "";
  } catch {
    return "";
  }
}

function labelFor(provider: ProviderId): string {
  switch (provider) {
    case "github":
      return "GitHub";
    case "jira":
      return "Jira";
    case "gitlab":
      return "GitLab";
    default:
      return "Azure DevOps";
  }
}

export function normalizeProvider(value: string | null | undefined): ProviderId {
  const ok: ProviderId[] = ["azure-devops", "github", "jira", "gitlab"];
  return ok.includes(value as ProviderId) ? (value as ProviderId) : DEFAULT_PROVIDER;
}
