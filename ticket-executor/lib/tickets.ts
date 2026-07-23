import type { CommitFile, CommitSummary, Ticket, TicketComment, ReviewData, ReviewSummaryEntry } from "./types";
import {
  adoCreds, getSprintTickets, getWorkItemComments, getPullRequestReview, getWorkItemTypeStates, updateWorkItemState,
  getPullRequestCommits, getCommitFileChanges, resolveWorkItemState, listProjects, type ProjectInfo,
} from "./ado";
import {
  getGithubIssues, getGithubPullRequestReview, getGithubStatusOptions, updateGithubStatus,
  getGithubPullRequestCommits, getGithubCommitFiles,
} from "./github";
import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";
import { DEFAULT_PROVIDER, type ProviderId } from "./providers";

export type TicketLoadResult = {
  tickets: Ticket[];
  sprint: string; // current sprint / context label for the header
  connected: boolean; // whether the provider is actually wired up
  notice?: string; // user-facing message for scaffold providers
};

// "personal" scope config: only tickets assigned to (and PRs authored by) this
// account are shown. Provider-agnostic — matched against whatever identifier
// each provider's ticket/PR data exposes (display name, email, or login).
export type PersonalFilter = { scope: "team" | "personal"; account: string };

// Loose, case-insensitive match: exact match on either identifier, or one
// contains the other (handles "sara.lin@company.com" vs "Sara Lin" style
// mismatches without requiring an exact provider-specific identifier).
function matchesAccount(candidates: Array<string | undefined>, account: string): boolean {
  const needle = account.trim().toLowerCase();
  if (!needle) return true; // no account configured yet — don't filter anything out
  return candidates.some((c) => {
    const v = (c ?? "").trim().toLowerCase();
    if (!v) return false;
    return v === needle || v.includes(needle) || needle.includes(v);
  });
}

function applyPersonalFilter(tickets: Ticket[], filter?: PersonalFilter): Ticket[] {
  if (!filter || filter.scope !== "personal" || !filter.account.trim()) return tickets;
  return tickets.filter((t) => matchesAccount([t.assignee, t.assigneeEmail], filter.account));
}

// Dispatch ticket loading by provider. Azure DevOps is fully wired; the other
// providers are scaffolded — they return a graceful empty result rather than
// throwing, so the UI can show a "not connected yet" state.
export async function loadTickets(
  provider: ProviderId,
  project?: string,
  sprintOverride?: string,
  personalFilter?: PersonalFilter
): Promise<TicketLoadResult> {
  switch (provider) {
    case "azure-devops": {
      if (!(await adoCreds())) {
        return {
          tickets: [],
          sprint: "",
          connected: false,
          notice: "Azure DevOps is not configured — set the organization URL and a personal access token in Settings.",
        };
      }
      if (!project) {
        return { tickets: [], sprint: "", connected: true, notice: "Select a project to load its tickets." };
      }
      const { tickets, sprintName } = await getSprintTickets(project, sprintOverride);
      return { tickets: applyPersonalFilter(tickets, personalFilter), sprint: sprintName, connected: true };
    }
    case "github": {
      const creds = await githubCreds();
      if (!creds) {
        return { tickets: [], sprint: "", connected: false, notice: "GitHub is not configured — set the repository URL and access token in Settings." };
      }
      const tickets = await getGithubIssues(creds.url, creds.token);
      return { tickets: applyPersonalFilter(tickets, personalFilter), sprint: parseRepoLabel(creds.url), connected: true };
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

export type ProjectLoadResult = {
  projects: ProjectInfo[];
  connected: boolean;
  notice?: string;
};

// List the projects available for a provider's configured organization. Azure
// DevOps is wired; other providers degrade to an empty "not connected" result.
export async function loadProjects(provider: ProviderId): Promise<ProjectLoadResult> {
  switch (provider) {
    case "azure-devops": {
      if (!(await adoCreds())) {
        return {
          projects: [],
          connected: false,
          notice: "Azure DevOps is not configured — set the organization URL and a personal access token in Settings.",
        };
      }
      return { projects: await listProjects(), connected: true };
    }
    default:
      return { projects: [], connected: false, notice: `${labelFor(provider)} does not expose a project list yet.` };
  }
}

// Load the discussion comments for a single ticket. Only Azure DevOps is wired;
// other providers return an empty list so the section simply hides.
export async function loadTicketComments(provider: ProviderId, id: string, project?: string): Promise<TicketComment[]> {
  if (provider === "azure-devops") return getWorkItemComments(project ?? "", id);
  return [];
}

// Load the PR review overview + comments for a single ticket. Azure DevOps and
// GitHub are wired; other providers report no linked PR (Resolve Review tab
// stays empty).
export async function loadReview(provider: ProviderId, ticketId: string): Promise<ReviewData> {
  if (provider === "azure-devops") return getPullRequestReview(ticketId, await latestPrUrlForTicket(ticketId));
  if (provider === "github") return loadGithubReview(ticketId);
  return { pr: null, comments: [], unresolvedCount: 0 };
}

// GitHub has no work-item-to-PR link API like ADO — reuse the PR URL recorded
// on the ticket's most recent execution (see `Execution.prUrl`) instead.
async function loadGithubReview(ticketId: string): Promise<ReviewData> {
  const creds = await githubCreds();
  if (!creds) return { pr: null, comments: [], unresolvedCount: 0 };
  const prUrl = await latestPrUrlForTicket(ticketId);
  if (!prUrl) return { pr: null, comments: [], unresolvedCount: 0 };
  return getGithubPullRequestReview(prUrl, creds.token);
}

// The most recent PR URL recorded against a ticket's executions. ADO uses this
// as a fallback when the work item has no server-side ArtifactLink relation
// yet (e.g. PR wasn't explicitly linked); GitHub has no link API at all and
// relies on this exclusively.
async function latestPrUrlForTicket(ticketId: string): Promise<string | null> {
  const exec = await prisma.execution.findFirst({
    where: { adoTicketId: ticketId, NOT: { prUrl: "" } },
    orderBy: { startedAt: "desc" },
    select: { prUrl: true },
  });
  return exec?.prUrl || null;
}

async function githubCreds(): Promise<{ url: string; token: string } | null> {
  const c = await prisma.providerCredential.findUnique({ where: { provider: "github" } });
  const url = (c?.org ?? "").trim();
  const token = decryptSecret(c?.pat);
  return url && token ? { url, token } : null;
}

// Load every commit on the ticket's linked PR source branch. Azure DevOps and
// GitHub are wired; other providers report no commits (Commits tab stays empty).
export async function loadPullRequestCommits(provider: ProviderId, ticketId: string): Promise<CommitSummary[]> {
  if (provider === "azure-devops") return getPullRequestCommits(ticketId, await latestPrUrlForTicket(ticketId));
  if (provider === "github") {
    const creds = await githubCreds();
    if (!creds) return [];
    const prUrl = await latestPrUrlForTicket(ticketId);
    if (!prUrl) return [];
    return getGithubPullRequestCommits(prUrl, creds.token);
  }
  return [];
}

// Load the file changes (each with a unified diff) for a single commit.
export async function loadCommitFileChanges(provider: ProviderId, ticketId: string, sha: string): Promise<CommitFile[]> {
  if (provider === "azure-devops") return getCommitFileChanges(ticketId, sha, await latestPrUrlForTicket(ticketId));
  if (provider === "github") {
    const creds = await githubCreds();
    if (!creds) return [];
    const prUrl = await latestPrUrlForTicket(ticketId);
    if (!prUrl) return [];
    return getGithubCommitFiles(prUrl, sha, creds.token);
  }
  return [];
}

// Real, per-provider workflow states for a ticket's status dropdown — never a
// hard-coded shared list. Azure DevOps: the work item type's configured states.
// GitHub: the linked Projects v2 board's Status field (Todo/In Progress/Done),
// falling back to the repo's "status: X" labels if the issue isn't on a board.
// Jira/GitLab: not wired yet.
export async function getStatusOptions(provider: ProviderId, ticketId: string, ticketType: string, project?: string): Promise<string[]> {
  if (provider === "azure-devops") return getWorkItemTypeStates(project ?? "", ticketType);
  if (provider === "github") {
    const creds = await githubCreds();
    return creds ? getGithubStatusOptions(creds.url, creds.token, ticketId) : [];
  }
  return [];
}

// Map a desired status label onto a real state the ticket's provider actually
// supports. Azure DevOps' workflow states vary per work item type/process
// template, so a caller-supplied label like "Code Review" often doesn't exist
// verbatim — this finds the closest real match (or null if none fits).
// Other providers pass the label through unchanged (unaffected by this fix).
export async function resolveStatusForUpdate(
  provider: ProviderId,
  ticketId: string,
  desired: string
): Promise<string | null> {
  if (provider === "azure-devops") return resolveWorkItemState(ticketId, desired);
  return desired;
}

// Write a ticket's status back to its provider — the counterpart to getStatusOptions.
// Throws for providers that aren't wired yet, so the caller can surface a real error
// instead of silently pretending the change synced.
export async function updateTicketStatus(provider: ProviderId, ticketId: string, status: string): Promise<void> {
  if (provider === "azure-devops") return updateWorkItemState(ticketId, status);
  if (provider === "github") {
    const creds = await githubCreds();
    if (!creds) throw new Error("GitHub is not configured — set the repository URL and access token in Settings.");
    return updateGithubStatus(creds.url, creds.token, ticketId, status);
  }
  throw new Error(`${labelFor(provider)} status sync is not wired up yet.`);
}

// Aggregate unresolved-review-comment counts across a set of tickets, for the
// header bell. Only tickets with a linked PR and open comments are returned.
export async function loadReviewsSummary(
  provider: ProviderId,
  ticketIds: string[],
  personalFilter?: PersonalFilter
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
    // Personal scope: only surface notifications for PRs this account authored.
    if (personalFilter?.scope === "personal" && personalFilter.account.trim() && !matchesAccount([review.pr.author], personalFilter.account)) continue;
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
