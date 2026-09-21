import { prisma } from "@/lib/prisma";
import { hasIdentity, isMyPullRequest, myVoteOn, type DevIdentity } from "@/lib/identity";
import type { PullRequestSource, ReviewSource } from "@/lib/notifications";
import { resolveCredential } from "@/lib/providerCredentials";
import { getOrCreateSetting } from "@/lib/settings";
import { loadPullRequestInbox, loadReviewsSummary, loadTicketActivity, normalizeProvider } from "@/lib/tickets";
import type { ProviderId } from "@/lib/providers";
import type { PullRequestBrief, TicketActivity } from "@/lib/types";

export type NotificationSources = {
  automation: Awaited<ReturnType<typeof automationSources>>;
  pullRequests: PullRequestSource[];
  ticketActivity: TicketActivity[];
  reviews: ReviewSource[];
};

/** How far back the bell looks. The scheduler's log is an audit trail and keeps
 *  everything; a notification is news. Opening the app after a week off should
 *  show what happened overnight, not replay the fortnight. */
const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const TAKE = 50;

/** How far back the *first* activity read of a process reaches. The watermark
 *  below takes over from there; this only bounds the cold start, so a restart
 *  surfaces this morning's comments rather than the quarter's. */
const ACTIVITY_COLD_START_MS = 24 * 60 * 60 * 1000;

/**
 * The high-water mark of the last activity read, and what those reads found.
 *
 * Both live in memory, per connection, and both are here for the same reason:
 * this source is the only *incremental* one. Every other source re-states the
 * whole current answer on each poll — the open review comments, the active pull
 * requests, the last three days of automation — so the browser can replace what
 * it holds. A comment, by contrast, happens once. Asking "what is new since
 * last time" and handing back only that would make each notification live
 * exactly one polling interval before the next empty answer erased it.
 *
 * So the watermark governs what is *fetched* and the buffer governs what is
 * *returned*: the same rolling window the scheduler's log is read over, rebuilt
 * from reads that each cost almost nothing.
 *
 * Losing either to a restart is cheap and getting them wrong is not, which is
 * why neither is persisted: a watermark that drifted ahead of reality would
 * skip comments silently and for good, while forgetting one costs a single
 * wider read. Re-reading a comment is harmless — a notification is keyed by the
 * provider's own comment id, so the same one never appears twice and stays read
 * once read.
 */
const activityWatermark = new Map<string, number>();
const activityBuffer = new Map<string, TicketActivity[]>();

/** Enough to hold a busy few days without letting a runaway board grow the
 *  buffer without bound. Oldest first out, since the window drops them anyway. */
const ACTIVITY_BUFFER_CAP = 100;

async function ticketActivitySources(provider: ProviderId, org: string, identity: DevIdentity) {
  const key = `${provider}:${org}:${identity.email}`;
  const since = activityWatermark.get(key) ?? Date.now() - ACTIVITY_COLD_START_MS;
  const startedAt = Date.now();

  try {
    const fresh = await loadTicketActivity(provider, identity, new Date(since).toISOString());
    // Advanced only after a successful read, so a failed poll re-asks the same
    // window instead of stepping over it.
    activityWatermark.set(key, startedAt);

    const floor = Date.now() - WINDOW_MS;
    const byId = new Map<string, TicketActivity>();
    for (const row of [...(activityBuffer.get(key) ?? []), ...fresh]) {
      if (Date.parse(row.at) >= floor) byId.set(row.commentId, row);
    }
    const merged = [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-ACTIVITY_BUFFER_CAP);
    activityBuffer.set(key, merged);
    return merged;
  } catch {
    // A provider refusing says nothing about what was already known.
    return activityBuffer.get(key) ?? [];
  }
}

/**
 * The pull requests that concern the developer, narrowed from the whole
 * organization's active ones and paired with the work item this app knows each
 * belongs to.
 *
 * Two thirds of the listing is somebody else's work nobody has asked them
 * about, so the narrowing happens here rather than in the browser: what crosses
 * the wire is the handful that produce a notification.
 *
 * The ticket pairing is one query against the table the review poll already
 * fills (`TicketPullRequest`), so a pull request this app opened deep-links to
 * its ticket while one it has never seen — the reviewer-inbox case — carries
 * its own URL instead.
 */
async function pullRequestSources(provider: ProviderId, identity: DevIdentity): Promise<PullRequestSource[]> {
  let prs: PullRequestBrief[];
  try {
    prs = await loadPullRequestInbox(provider);
  } catch {
    // One provider refusing must not take the scheduler half of this endpoint
    // down with it — the bell keeps whatever it last knew about pull requests.
    return [];
  }

  const relevant = prs
    .map((pr) => ({ pr, mine: isMyPullRequest(pr, identity), myVote: myVoteOn(pr, identity) }))
    .filter(({ mine, myVote }) => mine || myVote !== null);
  if (!relevant.length) return [];

  const known = await prisma.ticketPullRequest.findMany({
    where: { provider, prUrl: { in: relevant.map(({ pr }) => pr.url) } },
    select: { ticketId: true, prUrl: true },
  });
  const ticketOf = new Map(known.map((k) => [k.prUrl, k.ticketId]));

  return relevant.map(({ pr, mine, myVote }) => {
    const votes = pr.reviewers.map((r) => r.vote).filter((v) => v !== 0);
    return {
      prId: pr.id,
      title: pr.title,
      url: pr.url,
      repo: pr.repo,
      mergeStatus: pr.mergeStatus,
      authorName: pr.authorName,
      mine,
      myVote,
      worstVote: votes.length ? Math.min(...votes) : 0,
      bestVote: votes.length ? Math.max(...votes) : 0,
      ticketId: ticketOf.get(pr.url) ?? "",
    };
  });
}

/**
 * Unresolved review comments on the pull requests the scheduler opened.
 *
 * The board-scoped review poll already asks this question, but only about the
 * tickets on screen. A plan's ticket is not necessarily one of them — the
 * scheduler works the plan while the developer looks at another sprint — so a
 * pull request this app opened and released could collect review comments that
 * the bell never mentioned. Scoped by **identity and active plan**, exactly as
 * the automation source above is, for the same reason.
 *
 * Only planned tickets that already have a pull request are asked about, so
 * this costs the provider two calls per released ticket, not one per ticket in
 * the plan. Overlap with the board poll is expected and harmless: both produce
 * the same `pr.review-comment` key, and the client merges them.
 */
async function planReviewSources(provider: ProviderId, org: string, identity: DevIdentity): Promise<ReviewSource[]> {
  const planned = await prisma.plannedTicket.findMany({
    where: {
      prUrl: { not: "" },
      plan: { provider, org, identityEmail: identity.email, status: "active" },
    },
    select: { ticketId: true, prUrl: true },
  });
  if (!planned.length) return [];

  try {
    const { reviews } = await loadReviewsSummary(
      provider,
      planned.map((p) => p.ticketId),
      new Map(planned.map((p) => [p.ticketId, p.prUrl]))
    );
    return reviews;
  } catch {
    // Same claim as the other sources make when a provider refuses: nothing
    // known, rather than "nothing open".
    return [];
  }
}

/**
 * What the scheduler did, out of the plans belonging to this developer.
 *
 * Scoped by **identity**, not by the project or sprint the page happens to be
 * showing. The scheduler works a plan while the developer looks at something
 * else; an overnight run that aborted is news whichever board is on screen.
 *
 * Rows with no ticket are all `skipped` decisions (see the `logAutomation` call
 * sites), and `fromAutomation()` drops those before they can become a
 * notification with nothing to click.
 */
async function automationSources(provider: ProviderId, org: string, identity: DevIdentity) {
  const plans = await prisma.sprintPlan.findMany({
    where: { provider, org, identityEmail: identity.email, status: "active" },
    select: { id: true },
  });
  if (!plans.length) return [];

  const events = await prisma.automationEvent.findMany({
    where: {
      planId: { in: plans.map((p) => p.id) },
      createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: TAKE,
    select: { id: true, ticketId: true, action: true, outcome: true, reason: true, createdAt: true },
  });
  return events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }));
}

/**
 * The notification sources the server owns: the scheduler's log, the pull
 * request inbox, and recent comments on the developer's work.
 *
 * One database query and, for Azure DevOps, three provider round-trips — flat,
 * whatever board is on screen and however many tickets it holds. Only the last
 * of the three can grow, and only when work items actually changed since the
 * previous poll. That is what lets all of it ride the same two-minute tick as
 * the review-comment poll without meaningfully changing what that tick costs.
 *
 * The three are fetched together but fail apart: each holds an independent
 * claim, and one being unavailable is not evidence about the others.
 */
export async function collectNotificationSources(providerParam?: string): Promise<NotificationSources> {
  const setting = await getOrCreateSetting();
  const provider = normalizeProvider(providerParam || setting.provider);
  const { org, identity } = await resolveCredential(provider);

  // No identity is the absence of a filter, not a filter matching nobody — and
  // an unscoped read here would hand this developer the whole team's automation
  // and every pull request in the organization.
  if (!hasIdentity(identity)) {
    return { automation: [], pullRequests: [], ticketActivity: [], reviews: [] };
  }

  const [automation, pullRequests, ticketActivity, reviews] = await Promise.all([
    automationSources(provider, org, identity),
    pullRequestSources(provider, identity),
    ticketActivitySources(provider, org, identity),
    planReviewSources(provider, org, identity),
  ]);

  return { automation, pullRequests, ticketActivity, reviews };
}
