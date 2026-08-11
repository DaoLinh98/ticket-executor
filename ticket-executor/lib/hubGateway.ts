// The provider, as reached through EmeHub.
//
// With `Setting.hubEnabled` on, this app holds no provider credential and makes
// no provider call: every read and write in here is an HTTP call to the hub,
// which owns the PAT and talks to Azure DevOps on our behalf. `lib/tickets.ts`
// picks between this module and the direct clients (`lib/ado.ts`,
// `lib/github.ts`) on that one setting, and nothing else in the app knows which
// side it is on.
//
// **Flag off is not a degraded mode.** It is the original behaviour, byte for
// byte: `lib/ado.ts` is untouched and still the only path a non-hub install
// takes. Nothing in this file runs unless the flag is on.
//
// `lib/hub.ts` is the transport underneath — the session, `hubFetch`, and the
// typed failures. This module is the domain layer: it maps the hub's shapes onto
// the `Ticket` / `ReviewData` / `CommitSummary` types the rest of the app already
// speaks, so hub mode is a different *source*, never a different vocabulary.
//
// ## Everything goes to /dagent/*
//
// The hub exposes one router built for this app (`api/app/routers/dagent.py`),
// separate from the endpoints QAgent and the hub UI use. That separation is why
// these reads can be exactly what this app needs — work items arrive as the
// provider's own rich text, carrying their deep link, original estimate and
// story points, none of which the hub's shared ticket store keeps.
//
// One call does **not** go to `/dagent`: the PAT, at
// `GET /connections/{id}/secret` (`lib/hub.ts`). The Claude CLI reaches the
// provider over MCP, which the hub does not proxy, so a run still needs the
// credential itself — and that endpoint is the single audited crossing designed
// for exactly that (emehub ADR 0010).

import { prisma } from "@/lib/prisma";
import { hubFetch, listHubConnections } from "@/lib/hub";
import { sanitizeHtml } from "@/lib/richText";
import type {
  CommitFile,
  CommitSummary,
  PullRequestOverview,
  ReviewComment,
  ReviewData,
  Ticket,
  TicketComment,
} from "@/lib/types";
import type { ProviderId } from "@/lib/providers";
import type { TicketScope } from "@/lib/ticketScope";

/** The hub connection every call routes through, resolved from the setting. */
export type HubRoute = {
  hubId: number;
  provider: ProviderId;
  orgUrl: string;
  /** The connection's default project, when it declared one. */
  project: string;
  label: string;
};

/** Thrown when hub mode is on but nothing usable is selected. Distinct from a
 *  hub failure: the fix is a choice on the Settings page, not a retry. */
export class HubNotRouted extends Error {}

/**
 * Which hub connection this provider's calls go through.
 *
 * **No fallback to the first row.** With several connections of the same kind at
 * the hub, guessing means running against an organization nobody chose — the
 * exact failure hub mode exists to remove. Nothing selected is an error the user
 * resolves, not one this function papers over.
 */
export async function hubRoute(provider: string): Promise<HubRoute> {
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  const selected = Number(setting?.hubConnectionId ?? "");
  if (!selected) {
    throw new HubNotRouted(
      "No EmeHub connection is selected. Pick one in Settings — hub mode never guesses which organization to run against.",
    );
  }
  const conn = (await listHubConnections()).find((c) => c.hubId === selected);
  if (!conn) {
    throw new HubNotRouted(
      "The selected EmeHub connection no longer exists at the hub. Pick another one in Settings.",
    );
  }
  if (conn.provider !== provider) {
    throw new HubNotRouted(
      `The selected EmeHub connection is a ${conn.provider} connection, but this app is set to ${provider}. Pick a matching one in Settings.`,
    );
  }
  return {
    hubId: conn.hubId,
    provider: conn.provider,
    orgUrl: conn.orgUrl,
    project: conn.project,
    label: conn.label,
  };
}

/** `/dagent/connections/{id}` for the routed connection. Every call below hangs
 *  off this, so the routing rule above is enforced exactly once. */
async function base(provider: string): Promise<{ path: string; route: HubRoute }> {
  const route = await hubRoute(provider);
  return { path: `/dagent/connections/${route.hubId}`, route };
}

// ---------------------------------------------------------------- projects

export type HubProject = { id: string; name: string; description: string };

export async function hubProjects(provider: string): Promise<HubProject[]> {
  const { path } = await base(provider);
  const rows = await hubFetch<Array<Record<string, unknown>>>({ path: `${path}/projects` });
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    id: String(r.id ?? r.name ?? ""),
    name: String(r.name ?? ""),
    description: String(r.description ?? ""),
  }));
}

// ---------------------------------------------------------------- sprints

export type HubSprint = { id: string; name: string; path: string; startDate: string; finishDate: string; timeFrame: string };

/** The project's iterations plus which one is current. The hub computes the
 *  time frame — Azure DevOps' classification-node API returns the dates but not
 *  the classification, and the picker needs one to choose a default.
 *
 *  `project` is not optional in practice even though the parameter is: one hub
 *  connection spans an organisation, and the header picks a project inside it.
 *  Omitting it makes the hub answer for whichever project the connection names,
 *  which is how the picker came to disagree with the ticket list beside it. */
export async function hubSprints(
  provider: string,
  project: string,
): Promise<{ sprints: HubSprint[]; current: string }> {
  const { path } = await base(provider);
  const res = await hubFetch<{ items: Array<Record<string, unknown>>; current: string }>({
    path: `${path}/sprints`,
    query: { project },
  });
  return {
    sprints: (res.items ?? []).map((r) => ({
      id: String(r.id ?? r.path ?? r.name ?? ""),
      name: String(r.name ?? ""),
      // The rooted `System.IterationPath`, and the value that goes back to the
      // hub as `sprint`. A name is not a path, and ADO rejects a query built
      // from one with a 400 rather than matching nothing.
      path: String(r.path ?? r.name ?? ""),
      startDate: String(r.startDate ?? ""),
      finishDate: String(r.finishDate ?? ""),
      timeFrame: String(r.timeFrame ?? ""),
    })),
    current: String(res.current ?? ""),
  };
}

/** The states this work item *type* may hold — not the union across the project.
 *  A dropdown built from the union offers transitions the provider rejects. */
export async function hubStatusOptions(
  provider: string,
  ticketId: string,
  workItemType: string,
  project?: string,
): Promise<string[]> {
  const { path } = await base(provider);
  const res = await hubFetch<{ items: string[] }>({
    path: `${path}/tickets/${encodeURIComponent(ticketId)}/states`,
    query: { workItemType, project },
  });
  return res.items ?? [];
}

// ---------------------------------------------------------------- tickets

/**
 * One view's work items, read live at the provider by the hub.
 *
 * One call, and no fidelity lost: `/dagent/.../tickets` answers with the
 * provider's own HTML for the description and acceptance criteria, the work
 * item's deep link, and its original estimate and story points. That is the
 * reason the hub has a DAgent-specific router at all — its shared ticket store
 * flattens the rich text and keeps none of the other three, so a run started
 * through it would carry no sizing and the dashboard's value tier would quietly
 * read zero.
 *
 * `scope` chooses between the sprint, the unscheduled backlog and the board.
 * The hub builds a different provider query for each — they are not filters
 * this side could apply to a sprint fetch, because a backlog item and most of a
 * board sit outside the iteration the sprint query is bounded by.
 */
export async function hubTickets(
  provider: string,
  project: string,
  sprint?: string,
  scope: TicketScope = "sprint",
): Promise<{ tickets: Ticket[]; sprint: string; truncated: boolean }> {
  const { path } = await base(provider);
  const res = await hubFetch<{
    items: Array<Record<string, unknown>>;
    sprint: string;
    truncated?: boolean;
  }>({
    path: `${path}/tickets`,
    query: { project, sprint, scope },
  });
  return {
    tickets: (res.items ?? []).map(toTicket),
    // Only the sprint scope has a label to echo; the other two span iterations,
    // so the caller's `sprint` is not the answer to fall back to there.
    sprint: String(res.sprint ?? "") || (scope === "sprint" ? sprint ?? "" : ""),
    truncated: !!res.truncated,
  };
}

/**
 * The hub's ticket shape → this app's.
 *
 * `description` and `criteria` arrive as the provider's own markup and are
 * sanitised here, exactly as `lib/ado.ts` does on the direct path — a provider's
 * HTML is never trusted, whichever side of the boundary it came from.
 *
 * The two sizing fields are `undefined` when the hub sent null, never `0`. A
 * zero estimate is a real claim ("the team sized this at nothing") and would
 * flow onto `Run.estimateHours` and deflate the dashboard's hours-saved and ROI
 * tiles without anything looking wrong.
 */
function toTicket(row: Record<string, unknown>): Ticket {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    type: String(row.type ?? ""),
    status: String(row.status ?? ""),
    assignee: String(row.assignee ?? ""),
    assigneeEmail: String(row.assigneeEmail ?? "") || undefined,
    project: String(row.project ?? ""),
    areaPath: String(row.areaPath ?? ""),
    description: sanitizeHtml(String(row.description ?? "")),
    criteria: sanitizeHtml(String(row.criteria ?? "")),
    url: String(row.url ?? ""),
    estimateHours: numOrUndefined(row.estimateHours),
    storyPoints: numOrUndefined(row.storyPoints),
    boardColumn: String(row.boardColumn ?? "") || undefined,
  };
}

function numOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** One ticket's comment thread, read live at the provider by the hub. */
export async function hubTicketComments(provider: string, ticketId: string): Promise<TicketComment[]> {
  const { path } = await base(provider);
  const res = await hubFetch<{ items: Array<Record<string, unknown>>; supported: boolean }>({
    path: `${path}/tickets/${encodeURIComponent(ticketId)}/comments`,
  });
  // `supported: false` means the provider has no comment concept — a different
  // answer from "there are none", though both render as an empty thread, which
  // is the one place the distinction does not change what the user sees.
  if (!res.supported) return [];
  return (res.items ?? []).map((c) => ({
    author: String(c.author ?? ""),
    date: String(c.date ?? ""),
    text: String(c.text ?? ""),
  }));
}

/** Transition a work item. The hub resolves the requested label against the
 *  type's real configured states before writing, and a rejection comes back
 *  carrying the provider's own reason. */
export async function hubUpdateStatus(provider: string, ticketId: string, status: string): Promise<string> {
  const { path } = await base(provider);
  const res = await hubFetch<{ status: string }>({
    method: "POST",
    path: `${path}/tickets/${encodeURIComponent(ticketId)}/status`,
    body: { targetStatus: status },
  });
  return String(res.status ?? status);
}

/** The ticket's current state at the provider — read back after a write, and
 *  after a failed one, so what is displayed is the provider's answer rather than
 *  an optimistic local guess that quietly drifted. */
export async function hubTicketStatus(provider: string, ticketId: string): Promise<string> {
  const { path } = await base(provider);
  const res = await hubFetch<{ status: string }>({
    path: `${path}/tickets/${encodeURIComponent(ticketId)}/status`,
  });
  return String(res.status ?? "");
}

// ---------------------------------------------------------- pull requests

/**
 * The PR linked to a work item, and its review threads.
 *
 * Both selectors are sent. `ticketId` resolves through the work item's
 * ArtifactLink, which exists only when the PR was explicitly linked; `prUrl` is
 * what this app's own run recorded, which is the case an agent-opened PR usually
 * falls into. The hub verifies each candidate before using it, so a stale
 * artifact link falls through to the recorded URL instead of 404ing the tab.
 */
export async function hubReview(
  provider: string,
  ticketId: string,
  prUrl?: string | null,
): Promise<ReviewData> {
  const { path } = await base(provider);
  const res = await hubFetch<{
    pr: Record<string, unknown> | null;
    comments: Array<Record<string, unknown>>;
    unresolvedCount: number;
  }>({ path: `${path}/pull-request`, query: { ticketId, prUrl: prUrl ?? undefined } });

  if (!res.pr) return { pr: null, comments: [], unresolvedCount: 0 };
  const raw = res.pr;
  const pr: PullRequestOverview = {
    id: String(raw.id ?? ""),
    url: String(raw.url ?? ""),
    title: String(raw.title ?? ""),
    status: String(raw.status ?? ""),
    branch: String(raw.branch ?? ""),
    targetBranch: String(raw.targetBranch ?? ""),
    author: String(raw.author ?? ""),
    reviewers: Array.isArray(raw.reviewers) ? raw.reviewers.map(String) : [],
    createdAt: String(raw.createdAt ?? ""),
  };
  const comments: ReviewComment[] = (res.comments ?? []).map((c) => ({
    id: String(c.id ?? ""),
    threadId: Number(c.threadId ?? 0),
    author: String(c.author ?? ""),
    text: String(c.text ?? ""),
    filePath: String(c.filePath ?? "") || undefined,
    line: typeof c.line === "number" ? c.line : undefined,
    status: c.status === "resolved" ? "resolved" : "open",
    date: String(c.date ?? ""),
  }));
  return { pr, comments, unresolvedCount: Number(res.unresolvedCount ?? 0) };
}

/** Every commit on the PR's source branch, newest first. */
export async function hubCommits(
  provider: string,
  ticketId: string,
  prUrl?: string | null,
): Promise<CommitSummary[]> {
  const { path } = await base(provider);
  const res = await hubFetch<{ items: Array<Record<string, unknown>> }>({
    path: `${path}/pull-request/commits`,
    query: { ticketId, prUrl: prUrl ?? undefined },
  });
  return (res.items ?? []).map((c) => ({
    sha: String(c.sha ?? ""),
    shortSha: String(c.shortSha ?? ""),
    message: String(c.message ?? ""),
    author: String(c.author ?? ""),
    date: String(c.date ?? ""),
    url: String(c.url ?? "") || undefined,
  }));
}

/** One commit's file changes, each with a unified diff the hub built. */
export async function hubCommitFiles(
  provider: string,
  ticketId: string,
  sha: string,
  prUrl?: string | null,
): Promise<CommitFile[]> {
  const { path } = await base(provider);
  const res = await hubFetch<{ items: Array<Record<string, unknown>> }>({
    path: `${path}/pull-request/commits/${encodeURIComponent(sha)}`,
    query: { ticketId, prUrl: prUrl ?? undefined },
  });
  return (res.items ?? []).map((f) => ({
    path: String(f.path ?? ""),
    changeType: (["added", "modified", "deleted", "renamed"] as const).includes(
      f.changeType as "added",
    )
      ? (f.changeType as CommitFile["changeType"])
      : "modified",
    diff: String(f.diff ?? ""),
    additions: Number(f.additions ?? 0),
    deletions: Number(f.deletions ?? 0),
  }));
}

export type HubReviewSummary = {
  ticketId: string;
  prId: string;
  prUrl: string;
  prTitle: string;
  author: string;
  reviewers: string[];
  unresolvedCount: number;
  latestAuthor: string;
  latestText: string;
  latestDate: string;
};

/**
 * The review bell's whole board, in one request.
 *
 * The batch form of `hubReview()`. Asking per ticket cost one round-trip *and*
 * one full review payload per ticket on every poll, nearly all of it discarded
 * on arrival — this carries the count and the newest open comment and nothing
 * else. Answers positionally, `null` where there is nothing to notify about.
 *
 * A whole batch that could not be read is a 502 from the hub, which arrives here
 * as a thrown `HubRejected` rather than a list of nulls: the bell has to be able
 * to tell an outage from an empty board.
 */
export async function hubReviewSummaries(
  provider: string,
  items: Array<{ ticketId: string; prUrl?: string | null }>,
): Promise<(HubReviewSummary | null)[]> {
  if (!items.length) return [];
  const { path } = await base(provider);
  const res = await hubFetch<{ items: Array<Record<string, unknown> | null> }>({
    method: "POST",
    path: `${path}/pull-request/review-summaries`,
    body: { items: items.map((i) => ({ ticketId: i.ticketId, prUrl: i.prUrl ?? "" })) },
  });
  return (res.items ?? []).map((r, index) =>
    r
      ? {
          // The hub echoes the id back; fall back to position so a future shape
          // change cannot silently attach a review to the wrong ticket.
          ticketId: String(r.ticketId ?? items[index]?.ticketId ?? ""),
          prId: String(r.prId ?? ""),
          prUrl: String(r.prUrl ?? ""),
          prTitle: String(r.prTitle ?? ""),
          author: String(r.author ?? ""),
          reviewers: Array.isArray(r.reviewers) ? r.reviewers.map(String) : [],
          unresolvedCount: Number(r.unresolvedCount ?? 0),
          latestAuthor: String(r.latestAuthor ?? ""),
          latestText: String(r.latestText ?? ""),
          latestDate: String(r.latestDate ?? ""),
        }
      : null,
  );
}

export type HubPrOutcome = { merged: boolean; abandoned: boolean; reviewComments: number };

/** What became of a batch of PRs — the dashboard's delivery funnel.
 *
 *  POST because a dashboard sends dozens of URLs. The hub parses a repository
 *  and PR id out of each and builds the request from the connection's own base
 *  URL, so nothing the caller sends becomes an upstream address. Answers
 *  positionally, with nulls where a URL no longer resolves. */
export async function hubPrOutcomes(provider: string, prUrls: string[]): Promise<(HubPrOutcome | null)[]> {
  const { path } = await base(provider);
  const res = await hubFetch<{ items: Array<Record<string, unknown> | null> }>({
    method: "POST",
    path: `${path}/pull-request/outcomes`,
    body: { prUrls },
  });
  return (res.items ?? []).map((o) =>
    o
      ? {
          merged: !!o.merged,
          abandoned: !!o.abandoned,
          reviewComments: Number(o.reviewComments ?? 0),
        }
      : null,
  );
}
