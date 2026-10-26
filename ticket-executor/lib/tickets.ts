import type { CommitFile, CommitSummary, MentionCandidate, PullRequestBrief, ReactionKind, Ticket, TicketActivity, TicketComment, TicketReaction, ReviewData, ReviewSummaryEntry } from "./types";
import {
  adoCreds, getScopedTickets, getMyOpenWorkItems, getMyOpenWorkItemsAnyProject, getWorkItemComments, addWorkItemComment, searchIdentities, setWorkItemCommentReaction, getPullRequestReview, getWorkItemTypeStates, updateWorkItemState,
  getPullRequestCommits, getCommitFileChanges, resolveWorkItemState, listProjects, getPullRequestOutcomes,
  getWorkItemState, listIterations, getWorkItemDetail, getWorkItemTicket, listActivePullRequests, listRecentTicketActivity,
  getLinkedPullRequest, getWorkItemCommentMarks, getWorkItemsByIds, searchWorkItems, isPullRequestAbandoned,
  type CommentMark, type LinkedPullRequest, type ProjectInfo,
} from "./ado";
import {
  getGithubIssues, getGithubPullRequestReview, getGithubStatusOptions, updateGithubStatus, isGithubPullRequestAbandoned,
  getGithubPullRequestCommits, getGithubCommitFiles,
} from "./github";
import { prisma } from "./prisma";
import { prNumberFromUrl } from "./execution/reviewTargets";
import { hasIdentity, type DevIdentity } from "./identity";
import { resolveCredential } from "./providerCredentials";
import { DEFAULT_PROVIDER, type ProviderId } from "./providers";
import type { TicketScope } from "./ticketScope";

export type TicketLoadResult = {
  tickets: Ticket[];
  sprint: string; // current sprint / context label for the header ("" off the sprint scope)
  connected: boolean; // whether the provider is actually wired up
  notice?: string; // user-facing message for scaffold providers
  /** The provider had more to give than the view's cap. Reported so a capped
   *  backlog or board does not read as a short one. */
  truncated?: boolean;
  /** Served from an expired cache entry while a refresh runs; the caller re-asks. */
  stale?: boolean;
};

// Dispatch ticket loading by provider. Azure DevOps is fully wired; the other
// providers are scaffolded — they return a graceful empty result rather than
// throwing, so the UI can show a "not connected yet" state.
export async function loadTickets(
  provider: ProviderId,
  project?: string,
  sprintOverride?: string,
  scope: TicketScope = "sprint",
  serveStale = false
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
      // All three views. Each is its own provider
      // query (`getScopedTickets`) — none of them is a filter this side could
      // apply to a sprint fetch, because a backlog item and most of a board sit
      // outside the iteration the sprint query is bounded by.
      const { tickets, sprintName, truncated, stale } = await getScopedTickets(project, scope, sprintOverride, serveStale);
      return { tickets, sprint: sprintName, connected: true, truncated, stale };
    }
    case "github": {
      const creds = await githubCreds();
      if (!creds) {
        return { tickets: [], sprint: "", connected: false, notice: "GitHub is not configured — set the repository URL and access token in Settings." };
      }
      // Only the sprint view is wired for GitHub: issues have no iteration and
      // no kanban column here, so a backlog or a board would be the same list
      // under a different name — a claim the user would take at face value.
      if (scope !== "sprint") {
        return {
          tickets: [],
          sprint: "",
          connected: true,
          notice: `The ${scope} view is not wired for GitHub yet — switch back to Sprint.`,
        };
      }
      const tickets = await getGithubIssues(creds.url, creds.token);
      return { tickets, sprint: parseRepoLabel(creds.url), connected: true };
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

/**
 * The developer's sprint, widened to wherever their assigned work actually is.
 *
 * Two reads, and they answer two different questions:
 *
 * - `sprintTickets` is the whole team's iteration, every state included. The
 *   claim rules need it unfiltered: only a ticket still sitting in the iteration
 *   under somebody else's name distinguishes "handed to QA" from "moved out".
 * - `outside` is the developer's own open work that the iteration does not
 *   contain — an unscheduled backlog item, or a card still parked in an earlier
 *   sprint. This is the flexibility the Ticket Execution screen already has
 *   through its Backlog and Board tabs, applied to one person's work instead of
 *   the project's.
 *
 * `tickets` is the union, iteration rows winning a duplicate: the iteration
 * fetch is the more authoritative read of a ticket that is in both.
 *
 * The widening is Azure DevOps only, and silently skipped elsewhere. GitHub
 * issues carry no iteration, so "outside the sprint" has no meaning there and
 * every issue would come back as out-of-sprint work.
 */
export type MySprintLoad = TicketLoadResult & {
  /** The iteration on its own — what "N of the team's M tickets" counts. */
  sprintTickets: Ticket[];
  /** The developer's open tickets found outside the iteration. */
  outside: Ticket[];
  /** Whether the wider search actually ran. False when it was switched off, when
   *  the provider does not support it, or when no identity is configured — the
   *  page says which rather than showing an unexplained short list. */
  widened: boolean;
};

export async function loadMySprintTickets(
  provider: ProviderId,
  project: string | undefined,
  sprintOverride: string | undefined,
  identity: DevIdentity,
  includeWider: boolean
): Promise<MySprintLoad> {
  const base = await loadTickets(provider, project, sprintOverride, "sprint");
  const narrow: MySprintLoad = { ...base, sprintTickets: base.tickets, outside: [], widened: false };

  if (!includeWider || provider !== "azure-devops" || !project) return narrow;
  if (!base.connected || !hasIdentity(identity)) return narrow;

  // A failed widening must not take the sprint down with it: the iteration is
  // the plan's backbone and is already in hand.
  let found: { tickets: Ticket[]; truncated: boolean };
  try {
    found = await getMyOpenWorkItems(project, identity);
  } catch {
    return narrow;
  }

  const inSprint = new Set(base.tickets.map((t) => String(t.id)));
  const outside = found.tickets.filter((t) => !inSprint.has(String(t.id)));
  return {
    ...base,
    tickets: [...base.tickets, ...outside],
    sprintTickets: base.tickets,
    outside,
    widened: true,
    truncated: base.truncated || found.truncated,
  };
}

/**
 * Every open ticket assigned to the developer, across every project.
 *
 * What the Report page needs and `loadMySprintTickets` deliberately is not: a
 * sprint read is one project's iteration, while a day's report is one person's
 * day, and those are the same list only when the person worked in one project.
 *
 * Azure DevOps answers this in a single organization-wide query. Every other
 * provider degrades to "not connected" rather than throwing — the same rule the
 * rest of this module follows.
 */
export async function loadMyOpenTickets(
  provider: ProviderId,
  identity: DevIdentity,
  since: string
): Promise<TicketLoadResult> {
  if (!hasIdentity(identity))
    return { tickets: [], sprint: "", connected: true, truncated: false, notice: "" };
  if (provider !== "azure-devops")
    return {
      tickets: [],
      sprint: "",
      connected: false,
      truncated: false,
      notice: "Reporting across all projects is available for Azure DevOps only.",
    };
  try {
    const found = await getMyOpenWorkItemsAnyProject(identity, since);
    return { tickets: found.tickets, sprint: "", connected: true, truncated: found.truncated, notice: "" };
  } catch (err) {
    return {
      tickets: [],
      sprint: "",
      connected: false,
      truncated: false,
      notice: err instanceof Error ? err.message : String(err),
    };
  }
}

export type SprintCycle = {
  anchorProject: string;
  sprint: string;
  startDate: string;
  finishDate: string;
};

const CYCLE_FALLBACK_DAYS = 14;

export async function loadSprintCycle(provider: ProviderId, anchorProject: string): Promise<SprintCycle> {
  const empty: SprintCycle = { anchorProject, sprint: "", startDate: "", finishDate: "" };
  if (!anchorProject) return empty;
  const { sprints, current } = await loadSprints(provider, anchorProject);
  const iteration = sprints.find((s) => s.name === current);
  if (!iteration) return empty;
  return {
    anchorProject,
    sprint: iteration.name,
    startDate: (iteration.startDate ?? "").slice(0, 10),
    finishDate: (iteration.finishDate ?? "").slice(0, 10),
  };
}

export function cycleSince(cycle: SprintCycle, today: string): string {
  if (cycle.startDate) return cycle.startDate;
  const d = new Date(today + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() - CYCLE_FALLBACK_DAYS);
  return d.toISOString().slice(0, 10);
}

export async function loadMyCycle(
  provider: ProviderId,
  identity: DevIdentity,
  anchorProject: string,
  today: string
): Promise<{ cycle: SprintCycle; loaded: TicketLoadResult; cycleNotice: string }> {
  let cycle: SprintCycle = { anchorProject, sprint: "", startDate: "", finishDate: "" };
  let cycleNotice = "";
  try {
    cycle = await loadSprintCycle(provider, anchorProject);
  } catch (err) {
    cycleNotice = err instanceof Error ? err.message : String(err);
  }
  if (!cycleNotice && !cycle.sprint) {
    cycleNotice = anchorProject
      ? `${anchorProject} has no current iteration — showing the last ${CYCLE_FALLBACK_DAYS} days.`
      : `Pick the project whose sprint calendar to follow — showing the last ${CYCLE_FALLBACK_DAYS} days.`;
  }
  const loaded = await loadMyOpenTickets(provider, identity, cycleSince(cycle, today));
  return { cycle, loaded, cycleNotice };
}

export async function loadCommentMarks(provider: ProviderId, id: string): Promise<CommentMark[]> {
  if (provider !== "azure-devops") return [];
  return getWorkItemCommentMarks(id);
}

export async function loadTicketsByIds(provider: ProviderId, ids: string[]): Promise<Ticket[]> {
  if (provider !== "azure-devops") return [];
  return getWorkItemsByIds(ids);
}

export async function loadLinkedPullRequest(
  provider: ProviderId,
  ticketId: string,
  knownPrUrl?: string | null
): Promise<LinkedPullRequest | null> {
  if (provider !== "azure-devops") return null;
  return getLinkedPullRequest(ticketId, knownPrUrl);
}

/** The source branch of one pull request and the repository it lives in — what a D-Agent review run checks out. */
export async function loadPullRequestBranch(provider: ProviderId, ticketId: string, prUrl: string): Promise<{ branch: string; repo: string }> {
  if (provider !== "azure-devops" && provider !== "github") return { branch: "", repo: "" };
  const review = provider === "azure-devops" ? await getPullRequestReview(ticketId, prUrl, { fast: true }) : await githubReviewFor(ticketId, prUrl);
  return { branch: review.pr?.branch ?? "", repo: review.pr?.repo ?? "" };
}

/** Whether a pull request was abandoned, read fresh. Unknown — another provider, no credentials, unreadable — is false. */
export async function readPullRequestAbandoned(provider: ProviderId, prUrl: string): Promise<boolean> {
  try {
    if (provider === "azure-devops") return (await adoCreds()) ? await isPullRequestAbandoned(prUrl) : false;
    if (provider === "github") {
      const creds = await githubCreds();
      return creds ? await isGithubPullRequestAbandoned(prUrl, creds.token) : false;
    }
  } catch {
    return false;
  }
  return false;
}

export async function searchTickets(provider: ProviderId, query: string): Promise<Ticket[]> {
  if (provider !== "azure-devops") return [];
  if (!(await adoCreds())) return [];
  return searchWorkItems(query);
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

/**
 * One ticket by id, outside any list.
 *
 * The three scoped queries are each bounded — an iteration, the unscheduled
 * backlog, the project's open board — so a ticket a notification points at is
 * routinely in none of them. Released work has left the board, and the
 * scheduler's plan may belong to a project the developer is not looking at.
 * Only Azure DevOps is wired; GitHub issues arrive with their list.
 */
export async function loadTicket(provider: ProviderId, id: string): Promise<Ticket | null> {
  if (provider !== "azure-devops") return null;
  if (!(await adoCreds())) return null;
  return getWorkItemTicket(id);
}

/**
 * The rich-text fields for one ticket — description and acceptance criteria.
 *
 * They are not in the list payload for Azure DevOps (see `TICKET_FIELDS`), so
 * the UI asks for them when a ticket is opened. GitHub already carries both in
 * its issue list, so it has nothing left to fetch and returns them unset — the
 * caller keeps what it has rather than overwriting good text with blanks.
 */
export async function loadTicketDetail(
  provider: ProviderId,
  id: string
): Promise<{ description: string; criteria: string } | null> {
  if (provider === "azure-devops") return getWorkItemDetail(id);
  return null;
}

// Load the discussion comments for a single ticket. Only Azure DevOps is wired;
// other providers return an empty list so the section simply hides.
export async function loadTicketComments(provider: ProviderId, id: string): Promise<TicketComment[]> {
  if (provider === "azure-devops") return getWorkItemComments(id);
  return [];
}

// Post a comment back to the provider. Unlike a read, an unwired provider
// throws: a discussion that silently went nowhere is worse than an error.
export async function postTicketComment(
  provider: ProviderId,
  id: string,
  text: string,
  mentions: MentionCandidate[] = []
): Promise<TicketComment> {
  if (provider === "azure-devops") return addWorkItemComment(id, text, mentions);
  throw new Error("Commenting is only wired for Azure DevOps.");
}

// People a comment can @mention. Unwired providers offer nobody.
export async function searchMentionCandidates(provider: ProviderId, query: string): Promise<MentionCandidate[]> {
  if (provider === "azure-devops") return searchIdentities(query);
  return [];
}

// Engage or disengage the connected identity's reaction on one comment.
export async function setTicketCommentReaction(
  provider: ProviderId,
  id: string,
  commentId: string,
  kind: ReactionKind,
  on: boolean
): Promise<TicketReaction> {
  if (provider === "azure-devops") return setWorkItemCommentReaction(id, commentId, kind, on);
  throw new Error("Reactions are only wired for Azure DevOps.");
}

export type SprintLoadResult = {
  // `path` is the provider's rooted iteration path and is what a ticket load
  // sends back as `sprint`. The direct Azure DevOps client has none — it
  // resolves the override by name against the team's iterations — so it stays
  // optional, and the caller falls back to the name exactly where that is the
  // value the provider wants.
  sprints: Array<{ id?: string; name: string; path?: string; startDate?: string; finishDate?: string; timeFrame?: string }>;
  current: string;
  notice?: string;
};

/**
 * The sprint picker's iterations. Lives here rather than in the route so every
 * provider read is dispatched from one place.
 */
export async function loadSprints(provider: ProviderId, project: string): Promise<SprintLoadResult> {
  if (provider !== "azure-devops" || !project) return { sprints: [], current: "" };
  const iterations = await listIterations(project);
  return {
    sprints: [...iterations].sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? "")),
    current: iterations.find((i) => i.timeFrame === "current")?.name ?? "",
  };
}

// Load the PR review overview + comments for a single ticket. Azure DevOps and
// GitHub are wired; other providers report no linked PR (Resolve Review tab
// stays empty).
export async function loadReview(provider: ProviderId, ticketId: string): Promise<ReviewData> {
  const known = await latestPrUrlForTicket(provider, ticketId);
  const review = await (async () => {
    if (provider === "azure-devops") return getPullRequestReview(ticketId, known);
    if (provider === "github") return githubReviewFor(ticketId, known);
    return { pr: null, comments: [], unresolvedCount: 0 };
  })();
  // Opening this tab is often the first thing that resolves a human-opened PR.
  // Writing it down here is what stops the bell paying for that resolution again.
  if (review.pr?.url) {
    await rememberPrUrls(provider, new Map(known ? [[ticketId, known]] : []), [
      { ticketId, prUrl: review.pr.url },
    ]);
  }
  return review;
}

// GitHub has no work-item-to-PR link API like ADO, so the known PR URL is not a
// fallback there — it is the only way in. Callers resolve it once (for one ticket
// or for a whole board) and pass it down rather than looking it up again here.
async function githubReviewFor(_ticketId: string, prUrl: string | null): Promise<ReviewData> {
  const creds = await githubCreds();
  if (!creds || !prUrl) return { pr: null, comments: [], unresolvedCount: 0 };
  return getGithubPullRequestReview(prUrl, creds.token);
}

// The PR URL known for one ticket — from a run this app made, or from whatever
// last resolved one (see `TicketPullRequest`). ADO uses it as a fallback when the
// work item has no server-side ArtifactLink relation yet (e.g. the PR wasn't
// explicitly linked); GitHub has no link API at all and relies on it exclusively.
async function latestPrUrlForTicket(provider: ProviderId, ticketId: string): Promise<string | null> {
  return (await latestPrUrls(provider, [ticketId])).get(ticketId) ?? null;
}

/**
 * The known PR URL for many tickets, in **two** queries.
 *
 * Two sources, and the second is why the bell stays cheap. `DagentRun.prUrl` covers a
 * PR this app opened. `TicketPullRequest` covers every PR anything has since
 * resolved, including the ones a human opened — without it, those tickets pay
 * the provider's full four-call resolution on every poll, forever, because
 * nothing ever writes down the answer.
 *
 * The recorded run wins on a tie: it is the PR this app is actually working, and
 * the cache row may have been written from an older resolution.
 *
 * This is also the bell's candidate filter — a ticket in here has a PR, so it is
 * worth polling whatever state the tracker says it is in.
 */
export async function latestPrUrls(provider: ProviderId, ticketIds: string[]): Promise<Map<string, string>> {
  if (!ticketIds.length) return new Map();
  const [runs, cached] = await Promise.all([
    prisma.dagentRun.findMany({
      where: { ticketId: { in: ticketIds }, NOT: { prUrl: "" } },
      orderBy: { startedAt: "desc" },
      distinct: ["ticketId"],
      select: { ticketId: true, prUrl: true },
    }),
    prisma.ticketPullRequest.findMany({
      where: { provider, ticketId: { in: ticketIds }, NOT: { prUrl: "" } },
      select: { ticketId: true, prUrl: true },
    }),
  ]);
  const map = new Map<string, string>();
  for (const row of cached) map.set(row.ticketId, row.prUrl);
  for (const row of runs) if (row.prUrl) map.set(row.ticketId, row.prUrl);
  return map;
}

/**
 * Write down a PR URL a provider read just resolved, so the next one does not
 * have to resolve it again.
 *
 * Best-effort on purpose: this only ever shortens a future lookup, so a failed
 * write must not fail the read that produced it. Skips URLs already known, which
 * is the overwhelmingly common case once a ticket has been seen once.
 */
async function rememberPrUrls(
  provider: ProviderId,
  known: Map<string, string>,
  found: Array<{ ticketId: string; prUrl: string }>
): Promise<void> {
  const fresh = found.filter((f) => f.ticketId && f.prUrl && known.get(f.ticketId) !== f.prUrl);
  if (!fresh.length) return;
  try {
    await Promise.all(
      fresh.map((f) =>
        prisma.ticketPullRequest.upsert({
          where: { provider_ticketId: { provider, ticketId: f.ticketId } },
          create: { provider, ticketId: f.ticketId, prUrl: f.prUrl },
          update: { prUrl: f.prUrl },
        })
      )
    );
  } catch {
    /* a lookup shortcut that could not be saved is not an error worth raising */
  }
}

async function githubCreds(): Promise<{ url: string; token: string } | null> {
  const c = await resolveCredential("github");
  const url = c.org.trim();
  return url && c.pat ? { url, token: c.pat } : null;
}

// Load every commit on the ticket's linked PR source branch. Azure DevOps and
// GitHub are wired; other providers report no commits (Commits tab stays empty).
export async function loadPullRequestCommits(provider: ProviderId, ticketId: string): Promise<CommitSummary[]> {
  if (provider === "azure-devops") return getPullRequestCommits(ticketId, await latestPrUrlForTicket(provider, ticketId));
  if (provider === "github") {
    const creds = await githubCreds();
    if (!creds) return [];
    const prUrl = await latestPrUrlForTicket(provider, ticketId);
    if (!prUrl) return [];
    return getGithubPullRequestCommits(prUrl, creds.token);
  }
  return [];
}

// Load the file changes (each with a unified diff) for a single commit.
export async function loadCommitFileChanges(provider: ProviderId, ticketId: string, sha: string): Promise<CommitFile[]> {
  if (provider === "azure-devops") return getCommitFileChanges(ticketId, sha, await latestPrUrlForTicket(provider, ticketId));
  if (provider === "github") {
    const creds = await githubCreds();
    if (!creds) return [];
    const prUrl = await latestPrUrlForTicket(provider, ticketId);
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
// instead of silently pretending the change synced. Returns the status the provider
// actually ended up in, which is not always the one that was requested.
export async function updateTicketStatus(provider: ProviderId, ticketId: string, status: string): Promise<string> {
  if (provider === "azure-devops") return updateWorkItemState(ticketId, status);
  if (provider === "github") {
    const creds = await githubCreds();
    if (!creds) throw new Error("GitHub is not configured — set the repository URL and access token in Settings.");
    await updateGithubStatus(creds.url, creds.token, ticketId, status);
    return status;
  }
  throw new Error(`${labelFor(provider)} status sync is not wired up yet.`);
}

// The ticket's current status straight from the provider. The app reads this back
// after a write (and after a failed one) so what it displays is the provider's
// state rather than an optimistic local guess that quietly drifted out of sync.
// Returns "" when the provider isn't wired up — the caller then keeps what it has.
export async function readTicketStatus(provider: ProviderId, ticketId: string): Promise<string> {
  if (provider === "azure-devops") return getWorkItemState(ticketId);
  return "";
}

function summaryEntry(ticketId: string, review: ReviewData): ReviewSummaryEntry {
  const pr = review.pr!;
  const latest = [...review.comments].reverse().find((c) => c.status === "open");
  return {
    ticketId,
    prId: pr.id,
    prUrl: pr.url,
    prTitle: pr.title,
    reviewer: latest?.author ?? pr.reviewers[0] ?? "",
    unresolvedCount: review.unresolvedCount,
    latestComment: latest?.text ?? "",
    latestAt: latest?.date ?? "",
    latestIso: latest?.at ?? "",
    latestAutomated: latest?.automated ?? false,
    approved: pr.approved,
    prStatus: pr.status,
  };
}

export type PrReviewOutcome = { entry: ReviewSummaryEntry | null; failed: boolean };

export async function loadPrReviews(
  provider: ProviderId,
  targets: Array<{ ticketId: string; prUrl: string }>
): Promise<{ outcomes: PrReviewOutcome[]; degraded: boolean; notice?: string }> {
  if (!targets.length) return { outcomes: [], degraded: false };
  if (provider !== "azure-devops" && provider !== "github") {
    return { outcomes: targets.map(() => ({ entry: null, failed: false })), degraded: false };
  }
  const loadOne =
    provider === "azure-devops"
      ? (t: { ticketId: string; prUrl: string }) => getPullRequestReview(t.ticketId, t.prUrl, { fast: true })
      : (t: { ticketId: string; prUrl: string }) => githubReviewFor(t.ticketId, t.prUrl);
  const results = await Promise.allSettled(targets.map(loadOne));
  let firstFailure = "";
  const outcomes = results.map((r, i): PrReviewOutcome => {
    if (r.status !== "fulfilled") {
      if (!firstFailure) firstFailure = r.reason instanceof Error ? r.reason.message : String(r.reason);
      return { entry: null, failed: true };
    }
    const review = r.value;
    if (!review.pr) return { entry: null, failed: false };
    const wanted = prNumberFromUrl(targets[i].prUrl);
    if (wanted && review.pr.id !== wanted) return { entry: null, failed: true };
    return { entry: review.unresolvedCount > 0 ? summaryEntry(targets[i].ticketId, review) : null, failed: false };
  });
  const degraded = outcomes.every((o) => o.failed);
  return { outcomes, degraded, notice: degraded ? firstFailure : undefined };
}

/** What the review bell got back. `degraded` means the answer is incomplete —
 *  the provider refused, so an empty list here is not the same
 *  claim as "nothing to review", and the UI must keep what it had. */
export type ReviewsSummaryResult = {
  reviews: ReviewSummaryEntry[];
  degraded: boolean;
  notice?: string;
};

/**
 * Aggregate unresolved-review-comment counts across a set of tickets, for the
 * header bell. Only tickets with a linked PR and open comments are returned.
 *
 * The caller is expected to have narrowed `ticketIds` to plausible candidates
 * already (see the route): this fans out one provider read per ticket, so the
 * cost of asking about a whole sprint is paid at the provider, not here.
 *
 * `prUrls` is the ticket → recorded-PR map, passed in so the route's candidate
 * filter and this fan-out share one database query instead of doing the same
 * lookup twice.
 */
export async function loadReviewsSummary(
  provider: ProviderId,
  ticketIds: string[],
  prUrls?: Map<string, string>
): Promise<ReviewsSummaryResult> {
  if (!ticketIds.length) return { reviews: [], degraded: false };
  if (provider !== "azure-devops" && provider !== "github") {
    return { reviews: [], degraded: false };
  }
  const urls = prUrls ?? (await latestPrUrls(provider, ticketIds));

  const loadOne =
    provider === "azure-devops"
      ? (id: string) => getPullRequestReview(id, urls.get(id) ?? null, { fast: true })
      : (id: string) => githubReviewFor(id, urls.get(id) ?? null);

  const results = await Promise.allSettled(
    ticketIds.map(async (id) => ({ id, review: await loadOne(id) }))
  );
  const entries: ReviewSummaryEntry[] = [];
  const resolved: Array<{ ticketId: string; prUrl: string }> = [];
  let firstFailure = "";
  let failed = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") {
      failed += 1;
      if (!firstFailure) firstFailure = r.reason instanceof Error ? r.reason.message : String(r.reason);
      continue;
    }
    const { id, review } = r.value;
    // Recorded before the filters below, not after. A PR with nothing open is
    // the common case and is exactly the one that must not pay a fresh
    // four-call resolution on every poll for the rest of its life.
    if (review.pr?.url) resolved.push({ ticketId: id, prUrl: review.pr.url });
    if (!review.pr || review.unresolvedCount === 0) continue;
    entries.push(summaryEntry(id, review));
  }
  // Every read failing is the signature of a dead credential or a provider
  // outage, and it must not render as a quiet "no reviews". One ticket failing is ordinary —
  // a deleted PR, a permission gap — and the rest of the answer is still good.
  const degraded = failed > 0 && failed === results.length;
  await rememberPrUrls(provider, urls, resolved);
  return { reviews: entries, degraded, notice: degraded ? firstFailure : undefined };
}

export type DeliveryFunnel = {
  prCreated: number;
  merged: number;
  /** Merged without a single human review comment on the PR. */
  mergedClean: number;
  /** How many of the PR URLs were actually resolved against the provider. */
  sampled: number;
  /** false → this provider can't report PR outcomes yet; merged/mergedClean are meaningless. */
  providerBacked: boolean;
  notice?: string;
};

// Two calls per PR against Azure DevOps (one GraphQL call on GitHub), so the
// dashboard caps how many it resolves rather than fanning out over all history.
const FUNNEL_SAMPLE_CAP = 60;

/**
 * Resolve what became of the PRs the engine opened: how many merged, and how
 * many merged without a reviewer having to comment. Azure DevOps and GitHub are
 * wired; other providers degrade to `providerBacked: false` so the UI can show
 * "not measured" rather than a misleading zero.
 *
 * `prUrls` should already be newest-first — anything past FUNNEL_SAMPLE_CAP is
 * dropped, and `sampled` reports how many were actually checked.
 */
export async function loadDeliveryFunnel(provider: ProviderId, prUrls: string[]): Promise<DeliveryFunnel> {
  const empty = { prCreated: prUrls.length, merged: 0, mergedClean: 0, sampled: 0 };
  if (provider !== "azure-devops" && provider !== "github") {
    return { ...empty, providerBacked: false, notice: `${labelFor(provider)} cannot report PR outcomes yet.` };
  }
  const sample = prUrls.slice(0, FUNNEL_SAMPLE_CAP);
  if (!sample.length) return { ...empty, providerBacked: true, sampled: 0 };

  try {
    let outcomes: Array<{ merged: boolean; reviewComments: number } | null>;
    if (provider === "azure-devops") {
      if (!(await adoCreds())) return { ...empty, providerBacked: false, notice: "Azure DevOps is not configured." };
      outcomes = await getPullRequestOutcomes(sample);
    } else {
      const creds = await githubCreds();
      if (!creds) return { ...empty, providerBacked: false, notice: "GitHub is not configured." };
      const settled = await Promise.allSettled(
        sample.map(async (url) => {
          const review = await getGithubPullRequestReview(url, creds.token);
          if (!review.pr) return null;
          return { merged: review.pr.status === "Completed", reviewComments: review.comments.length };
        })
      );
      outcomes = settled.map((r) => (r.status === "fulfilled" ? r.value : null));
    }
    const resolved = outcomes.filter((o): o is { merged: boolean; reviewComments: number } => !!o);
    return {
      prCreated: prUrls.length,
      merged: resolved.filter((o) => o.merged).length,
      mergedClean: resolved.filter((o) => o.merged && o.reviewComments === 0).length,
      sampled: resolved.length,
      providerBacked: true,
      notice:
        prUrls.length > sample.length
          ? `Showing the ${sample.length} most recent PRs of ${prUrls.length}.`
          : undefined,
    };
  } catch (e) {
    return { ...empty, providerBacked: false, notice: e instanceof Error ? e.message : String(e) };
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

/**
 * Every active pull request in the organization, for the notification bell.
 *
 * One provider round-trip whatever the board on screen is — the cost does not
 * scale with the number of tickets, which is what separates this source from
 * the review-comment one. The caller decides which of them are the developer's
 * (`isMyPullRequest` / `myVoteOn`), because the identity rule belongs in
 * `lib/identity.ts` and not in a provider client.
 *
 * GitHub is not wired: its search API answers the same question in one call
 * (`is:pr is:open review-requested:@me`) and is worth adding, but it needs its
 * own paging and rate-limit handling rather than a shape-shim over this one.
 * Unwired providers report no pull requests, so the bell simply says nothing
 * about them.
 */
export async function loadPullRequestInbox(provider: ProviderId): Promise<PullRequestBrief[]> {
  if (provider !== "azure-devops") return [];
  return listActivePullRequests();
}

/**
 * Comments that landed on the developer's work, or named them, since `since`.
 *
 * Two provider round-trips to find out whether anything happened, and reads
 * beyond that only for the work items that actually changed — see
 * `listRecentTicketActivity`. GitHub is not wired: its notifications API
 * answers the same question far better than polling issues would, and shimming
 * it into this shape would waste that.
 */
export async function loadTicketActivity(
  provider: ProviderId,
  identity: DevIdentity,
  since: string
): Promise<TicketActivity[]> {
  if (provider !== "azure-devops") return [];
  if (!hasIdentity(identity)) return [];
  return listRecentTicketActivity(since, identity);
}
