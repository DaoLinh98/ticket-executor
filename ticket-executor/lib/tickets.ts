import type { Ticket } from "./types";
import { getSprintTickets } from "./ado";
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
export async function loadTickets(provider: ProviderId): Promise<TicketLoadResult> {
  switch (provider) {
    case "azure-devops": {
      const tickets = await getSprintTickets();
      return { tickets, sprint: (process.env.AZURE_DEVOPS_SPRINT ?? "").trim(), connected: true };
    }
    case "github":
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
