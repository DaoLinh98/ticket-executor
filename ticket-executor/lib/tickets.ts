import type { Ticket, TicketComment, ReviewData, ReviewSummaryEntry } from "./types";
import { getSprintTickets, getWorkItemComments, getPullRequestReview } from "./ado";
import { getGithubIssues, getGithubPullRequestReview } from "./github";
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

// Load the discussion comments for a single ticket. Only Azure DevOps is wired;
// other providers return an empty list so the section simply hides.
export async function loadTicketComments(provider: ProviderId, id: string): Promise<TicketComment[]> {
  if (provider === "azure-devops") return getWorkItemComments(id);
  return [];
}

// Load the PR review overview + comments for a single ticket. Azure DevOps and
// GitHub are wired; other providers report no linked PR (Resolve Review tab
// stays empty).
export async function loadReview(provider: ProviderId, ticketId: string): Promise<ReviewData> {
  if (provider === "azure-devops") return getPullRequestReview(ticketId);
  if (provider === "github") return loadGithubReview(ticketId);
  return { pr: null, comments: [], unresolvedCount: 0 };
}

// GitHub has no work-item-to-PR link API like ADO — reuse the PR URL recorded
// on the ticket's most recent execution (see `Execution.prUrl`) instead.
async function loadGithubReview(ticketId: string): Promise<ReviewData> {
  const s = await prisma.setting.findUnique({ where: { id: "default" } });
  const token = decryptSecret(s?.pat);
  if (!token) return { pr: null, comments: [], unresolvedCount: 0 };
  const exec = await prisma.execution.findFirst({
    where: { adoTicketId: ticketId, NOT: { prUrl: "" } },
    orderBy: { startedAt: "desc" },
    select: { prUrl: true },
  });
  if (!exec?.prUrl) return { pr: null, comments: [], unresolvedCount: 0 };
  return getGithubPullRequestReview(exec.prUrl, token);
}

// Aggregate unresolved-review-comment counts across a set of tickets, for the
// header bell. Only tickets with a linked PR and open comments are returned.
export async function loadReviewsSummary(
  provider: ProviderId,
  ticketIds: string[]
): Promise<ReviewSummaryEntry[]> {
  if (provider !== "azure-devops" && provider !== "github") return [];
  const loadOne = provider === "azure-devops" ? getPullRequestReview : loadGithubReview;
  const results = await Promise.allSettled(
    ticketIds.map(async (id) => ({ id, review: await loadOne(id) }))
  );
  const entries: ReviewSummaryEntry[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { id, review } = r.value;
    if (!review.pr || review.unresolvedCount === 0) continue;
    const latest = [...review.comments].reverse().find((c) => c.status === "open");
    entries.push({
      ticketId: id,
      prId: review.pr.id,
      prUrl: review.pr.url,
      prTitle: review.pr.title,
      reviewer: latest?.author ?? review.pr.reviewers[0] ?? "",
      unresolvedCount: review.unresolvedCount,
      latestComment: latest?.text ?? "",
      latestAt: latest?.date ?? "",
    });
  }
  return entries;
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
