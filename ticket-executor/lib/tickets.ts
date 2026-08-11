import type { CommitFile, CommitSummary, Ticket, TicketComment, ReviewData, ReviewSummaryEntry } from "./types";
import {
  adoCreds, getSprintTickets, getWorkItemComments, getPullRequestReview, getWorkItemTypeStates, updateWorkItemState,
  getPullRequestCommits, getCommitFileChanges, resolveWorkItemState, listProjects, getPullRequestOutcomes,
  getWorkItemState, listIterations,
  type ProjectInfo,
} from "./ado";
import {
  getGithubIssues, getGithubPullRequestReview, getGithubStatusOptions, updateGithubStatus,
  getGithubPullRequestCommits, getGithubCommitFiles,
} from "./github";
import { prisma } from "./prisma";
import { resolveCredential } from "./providerCredentials";
import { DEFAULT_PROVIDER, type ProviderId } from "./providers";
import type { TicketScope } from "./ticketScope";
import {
  hubCommitFiles, hubCommits, hubPrOutcomes, hubProjects, hubReview, hubReviewSummaries,
  hubSprints, hubStatusOptions, hubTicketComments, hubTicketStatus, hubTickets, hubUpdateStatus,
} from "./hubGateway";

/**
 * Is EmeHub the gateway for this app's provider calls?
 *
 * Every dispatch below asks this **first**, before it asks which provider it is
 * talking to. That order is the whole point: with the hub on, this app makes no
 * provider call at all, and a function that checked the provider first would
 * find a perfectly good `lib/ado.ts` path and take it — authenticating with a
 * credential that, in hub mode, does not exist.
 *
 * Off is not a degraded mode. It is the original behaviour, unchanged.
 */
async function viaHub(): Promise<boolean> {
  try {
    return !!(await prisma.setting.findUnique({ where: { id: "default" } }))?.hubEnabled;
  } catch {
    // The DB is down. Answering "no" sends the caller to the direct client,
    // which needs the same DB for its credential and will fail there with a
    // better message than this function could produce.
    return false;
  }
}

/** A hub failure, as the message a user should read. The typed errors already
 *  say which of the four cases it is (lib/hub.ts); this is where that reaches
 *  the UI without every call site re-deriving it. */
function hubNotice(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type TicketLoadResult = {
  tickets: Ticket[];
  sprint: string; // current sprint / context label for the header ("" off the sprint scope)
  connected: boolean; // whether the provider is actually wired up
  notice?: string; // user-facing message for scaffold providers
  /** The provider had more to give than the view's cap. Reported so a capped
   *  backlog or board does not read as a short one. */
  truncated?: boolean;
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
  personalFilter?: PersonalFilter,
  scope: TicketScope = "sprint"
): Promise<TicketLoadResult> {
  if (await viaHub()) {
    if (!project) return { tickets: [], sprint: "", connected: true, notice: "Select a project to load its tickets." };
    try {
      const { tickets, sprint, truncated } = await hubTickets(provider, project, sprintOverride, scope);
      return { tickets: applyPersonalFilter(tickets, personalFilter), sprint, connected: true, truncated };
    } catch (e) {
      // Never an empty list with `connected: true` — that reads as an empty
      // sprint, and INTEGRATION.md §5 is explicit that a failed read must not
      // be mistaken for one that returned nothing.
      return { tickets: [], sprint: "", connected: false, notice: hubNotice(e) };
    }
  }
  // Off the hub, only the sprint view exists. Said rather than silently served
  // as a sprint: the two lists look alike enough that a wrong one would be
  // taken at face value, and the fix ("turn on EmeHub") is not one the user
  // could guess from a list of the wrong tickets.
  if (scope !== "sprint") {
    return {
      tickets: [],
      sprint: "",
      connected: true,
      notice: `The ${scope} view reads through EmeHub. Turn on "Part of EmeHub" in Settings, or switch back to Sprint.`,
    };
  }
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
  if (await viaHub()) {
    try {
      return { projects: await hubProjects(provider), connected: true };
    } catch (e) {
      return { projects: [], connected: false, notice: hubNotice(e) };
    }
  }
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
  if (await viaHub()) return hubTicketComments(provider, id);
  if (provider === "azure-devops") return getWorkItemComments(project ?? "", id);
  return [];
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
 * The sprint picker's iterations. Lives here rather than in the route so hub
 * mode is decided in the same place as every other provider read — a route that
 * called `listIterations()` directly would be the one call site still reaching
 * for a credential hub mode does not have.
 */
export async function loadSprints(provider: ProviderId, project: string): Promise<SprintLoadResult> {
  if (await viaHub()) {
    if (!project) return { sprints: [], current: "" };
    try {
      // Already sorted newest-first with `current` resolved by the hub, which is
      // where the iteration dates are. The project has to go with it: one hub
      // connection spans an organisation, and without it the hub answers for
      // whichever project the *connection* names — which is how this picker
      // came to be empty while the ticket list beside it, which does send the
      // project, kept working.
      return await hubSprints(provider, project);
    } catch (e) {
      return { sprints: [], current: "", notice: hubNotice(e) };
    }
  }
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
    if (await viaHub()) return hubReview(provider, ticketId, known);
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
 * Two sources, and the second is why the bell stays cheap. `Run.prUrl` covers a
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
    prisma.run.findMany({
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
  if (await viaHub()) return hubCommits(provider, ticketId, await latestPrUrlForTicket(provider, ticketId));
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
  if (await viaHub()) return hubCommitFiles(provider, ticketId, sha, await latestPrUrlForTicket(provider, ticketId));
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
  if (await viaHub()) {
    // An empty dropdown is recoverable (the user keeps the current status); an
    // exception here would take the whole ticket detail pane down with it.
    return hubStatusOptions(provider, ticketId, ticketType, project).catch(() => []);
  }
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
  // The hub resolves the target state itself and answers 502 with the
  // provider's own reason when it cannot, so there is nothing to pre-resolve
  // here — passing the label through lets that reason reach the user intact.
  if (await viaHub()) return desired;
  if (provider === "azure-devops") return resolveWorkItemState(ticketId, desired);
  return desired;
}

// Write a ticket's status back to its provider — the counterpart to getStatusOptions.
// Throws for providers that aren't wired yet, so the caller can surface a real error
// instead of silently pretending the change synced. Returns the status the provider
// actually ended up in, which is not always the one that was requested.
export async function updateTicketStatus(provider: ProviderId, ticketId: string, status: string): Promise<string> {
  if (await viaHub()) return hubUpdateStatus(provider, ticketId, status);
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
  if (await viaHub()) return hubTicketStatus(provider, ticketId).catch(() => "");
  if (provider === "azure-devops") return getWorkItemState(ticketId);
  return "";
}

/** What the review bell got back. `degraded` means the answer is incomplete —
 *  the provider (or the hub) refused, so an empty list here is not the same
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
  personalFilter?: PersonalFilter,
  prUrls?: Map<string, string>
): Promise<ReviewsSummaryResult> {
  if (!ticketIds.length) return { reviews: [], degraded: false };
  const hub = await viaHub();
  if (!hub && provider !== "azure-devops" && provider !== "github") {
    return { reviews: [], degraded: false };
  }
  const urls = prUrls ?? (await latestPrUrls(provider, ticketIds));

  // Hub mode answers the whole board in one request — see hubReviewSummaries().
  // The direct-provider paths below still fan out, because neither Azure DevOps
  // nor GitHub offers a batch equivalent this app could call.
  if (hub) return hubSummaries(provider, ticketIds, urls, personalFilter);

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
      if (!firstFailure) firstFailure = hubNotice(r.reason);
      continue;
    }
    const { id, review } = r.value;
    // Recorded before the filters below, not after. A PR with nothing open is
    // the common case and is exactly the one that must not pay a fresh
    // four-call resolution on every poll for the rest of its life.
    if (review.pr?.url) resolved.push({ ticketId: id, prUrl: review.pr.url });
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
  // Every read failing is the signature of a dead hub or an expired session, and
  // it must not render as a quiet "no reviews". One ticket failing is ordinary —
  // a deleted PR, a permission gap — and the rest of the answer is still good.
  const degraded = failed > 0 && failed === results.length;
  await rememberPrUrls(provider, urls, resolved);
  return { reviews: entries, degraded, notice: degraded ? firstFailure : undefined };
}

/**
 * The hub's answer for the whole board, as bell entries.
 *
 * One request, and the failure story is simpler than the fan-out's: the hub has
 * already decided that a batch it could not read at all is a 502, so a throw
 * here means degraded and a returned list means the answer is complete.
 */
async function hubSummaries(
  provider: ProviderId,
  ticketIds: string[],
  urls: Map<string, string>,
  personalFilter?: PersonalFilter
): Promise<ReviewsSummaryResult> {
  let rows: Awaited<ReturnType<typeof hubReviewSummaries>>;
  try {
    rows = await hubReviewSummaries(
      provider,
      ticketIds.map((id) => ({ ticketId: id, prUrl: urls.get(id) ?? null }))
    );
  } catch (e) {
    return { reviews: [], degraded: true, notice: hubNotice(e) };
  }
  const reviews: ReviewSummaryEntry[] = [];
  const resolved: Array<{ ticketId: string; prUrl: string }> = [];
  for (const row of rows) {
    if (!row) continue;
    // The hub answers with an entry for every PR it resolved, open comments or
    // not, precisely so this line can run before the notification filter below.
    if (row.prUrl) resolved.push({ ticketId: row.ticketId, prUrl: row.prUrl });
    if (row.unresolvedCount === 0) continue;
    // Personal scope: only surface notifications for PRs this account authored.
    if (personalFilter?.scope === "personal" && personalFilter.account.trim() && !matchesAccount([row.author], personalFilter.account)) continue;
    reviews.push({
      ticketId: row.ticketId,
      prId: row.prId,
      prUrl: row.prUrl,
      prTitle: row.prTitle,
      reviewer: row.latestAuthor || row.reviewers[0] || "",
      unresolvedCount: row.unresolvedCount,
      latestComment: row.latestText,
      latestAt: row.latestDate,
    });
  }
  await rememberPrUrls(provider, urls, resolved);
  return { reviews, degraded: false };
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
  if (await viaHub()) {
    const sample = prUrls.slice(0, FUNNEL_SAMPLE_CAP);
    if (!sample.length) return { ...empty, providerBacked: true, sampled: 0 };
    try {
      const resolved = (await hubPrOutcomes(provider, sample)).filter((o) => !!o);
      return {
        prCreated: prUrls.length,
        merged: resolved.filter((o) => o!.merged).length,
        mergedClean: resolved.filter((o) => o!.merged && o!.reviewComments === 0).length,
        sampled: resolved.length,
        providerBacked: true,
        notice:
          prUrls.length > sample.length
            ? `Showing the ${sample.length} most recent PRs of ${prUrls.length}.`
            : undefined,
      };
    } catch (e) {
      // `providerBacked: false` makes the dashboard render "not measured"
      // rather than zero merges — a funnel that reports nothing merged because
      // a call failed is worse than one that admits it does not know.
      return { ...empty, providerBacked: false, notice: hubNotice(e) };
    }
  }
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
