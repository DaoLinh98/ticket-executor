import type { Ticket, TicketComment, TicketActivity, ReviewData, ReviewComment, PullRequestOverview, PullRequestBrief, CommitSummary, CommitFile } from "./types";
import { isSamePerson, type DevIdentity } from "./identity";
import { resolveCredential } from "./providerCredentials";
import { buildUnifiedDiff } from "./diffText";
import { hasContent, markdownToHtml, sanitizeHtml } from "./richText";
import type { TicketScope } from "./ticketScope";
import { cached, invalidatePrefix } from "./redis";

const API = "api-version=7.0";

/**
 * How long a cached provider answer stays good, in seconds.
 *
 * Only the stable, slow lookups are in here. Tickets, pull requests and review
 * threads are deliberately absent: those are the reads the app performs right
 * after writing to the provider, and serving a stale one would show the user
 * their own change not having happened. Every entry below describes something a
 * person changes at project-setup pace, not at click pace, and the whole
 * namespace is dropped when the active organization switches.
 */
const TTL = {
  projects: 600,
  iterations: 300,
  workItemTypeStates: 3600,
  repositoryProject: 3600,
  identity: 3600,
  // Everything below moves at click pace rather than setup pace, so it is held
  // only long enough to cover navigating between pages — and every write this
  // app makes drops the affected keys outright (`invalidateWorkItems` /
  // `invalidatePullRequests`), so a change the user just made is never served
  // from here. What the TTL bounds is a change made by *somebody else*.
  tickets: 30,
  workItem: 30,
  workItemDetail: 300,
  comments: 60,
  review: 45,
  prOutcome: 120,
  commits: 60,
  // A commit's own diff cannot change; only the list of commits can.
  commitFiles: 86_400,
  prDraft: 15,
  activePullRequests: 60,
} as const;

/** Every key this module writes lives under it, so one prefix scan clears all. */
export const ADO_CACHE_PREFIX = "ado:";

/**
 * Drop the cached work-item reads for one organization.
 *
 * Called after this app changes a work item. Without it the ticket list, the
 * ticket itself and its comments would keep serving the state from before the
 * write for a whole TTL — which is the app showing the user their own change
 * not having happened, the one failure mode a cache in front of a tracker must
 * not have.
 */
async function invalidateWorkItems(org: string): Promise<void> {
  await Promise.all([
    invalidatePrefix(`${ADO_CACHE_PREFIX}tickets:${org}:`),
    invalidatePrefix(`${ADO_CACHE_PREFIX}workItem:${org}:`),
    invalidatePrefix(`${ADO_CACHE_PREFIX}comments:${org}:`),
  ]);
}

/** The same, for the pull-request reads, after publishing one or adding reviewers. */
async function invalidatePullRequests(org: string): Promise<void> {
  await Promise.all([
    invalidatePrefix(`${ADO_CACHE_PREFIX}review:${org}:`),
    invalidatePrefix(`${ADO_CACHE_PREFIX}prOutcome:${org}:`),
    invalidatePrefix(`${ADO_CACHE_PREFIX}prDraft:${org}:`),
    invalidatePrefix(`${ADO_CACHE_PREFIX}activePrs:${org}`),
  ]);
}

// Org / project / PAT are per-provider DB-backed credentials (Settings modal),
// not env vars. Resolved into a per-call `Creds` context at the top of every
// exported function and threaded through explicitly — never stored in module
// globals, because exported functions run concurrently (e.g. a ticket load and
// the 45s review poll overlap) and shared mutable state would let one call's
// empty project clobber another's mid-await, producing `.../org//_apis/...`
// (double slash → 404).
export type AdoCreds = { org: string; pat: string };

// Full per-call context: org + PAT (constant for the connection) plus the
// project scope for this specific call (empty for org-level endpoints).
type Creds = { org: string; project: string; pat: string };

/**
 * Parse whatever the user pasted into the Settings URL field into org + project.
 * Accepts the full project URL (the normal case), an org-only URL, the legacy
 * `org.visualstudio.com` host, and bare `org/project` text. Path segments are
 * URL-decoded, so "Application%20Support" becomes "Application Support".
 */
export function parseAdoUrl(raw: string | null | undefined): { org: string; project: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { org: "", project: "" };

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host = "";
  let segments: string[] = [];
  try {
    const u = new URL(withScheme);
    host = u.hostname.toLowerCase();
    segments = u.pathname.split("/").filter(Boolean);
  } catch {
    segments = trimmed.split("/").filter(Boolean);
  }

  // Legacy host form: https://{org}.visualstudio.com/{project}
  const legacy = host.match(/^([^.]+)\.visualstudio\.com$/);
  if (legacy) {
    return { org: legacy[1], project: decodeSegment(segments[0]) };
  }

  // dev.azure.com may include a "/tfs"-style collection prefix; ignore anything
  // that isn't part of {org}/{project}.
  const [org, project] = segments;
  return { org: decodeSegment(org), project: decodeSegment(project) };
}

// ADO omits unset numeric fields entirely — keep "not sized" distinct from 0.
function numOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

function decodeSegment(s: string | undefined): string {
  if (!s) return "";
  try {
    return decodeURIComponent(s).trim();
  } catch {
    return s.trim();
  }
}

/**
 * Saved Azure DevOps credentials, or null when the connection isn't configured
 * yet. The connection is configured at the *organization* level — the project
 * is selected per request (Projects page / ticket-execution dropdown), not
 * baked into the stored URL. A legacy stored project URL still parses to the
 * right org, so old configs keep working.
 */
export async function adoCreds(): Promise<AdoCreds | null> {
  const c = await resolveCredential("azure-devops");
  const { org } = parseAdoUrl(c.org);
  return org && c.pat ? { org, pat: c.pat } : null;
}

// Resolve the per-call credentials context. `project` is required for
// project-scoped endpoints (iterations, work items, comments) and passed in by
// the caller; org-level endpoints (project list, work-item batch, PR/repo GUID
// lookups) leave it empty. The returned object is local to the call — nothing
// is stored in module state — so concurrent calls can't stomp each other.
async function loadCreds(project?: string): Promise<Creds> {
  const c = await adoCreds();
  if (!c) {
    throw new Error(
      "Azure DevOps is not configured — set the organization URL (e.g. https://dev.azure.com/your-org) and a personal access token in Settings."
    );
  }
  return { org: c.org, pat: c.pat, project: project ?? "" };
}

function authHeader(pat: string): Record<string, string> {
  const b64 = Buffer.from(":" + pat).toString("base64");
  return { Authorization: "Basic " + b64 };
}

/**
 * One readable sentence for a failed ADO call. These messages end up in a toast,
 * so the previous `status statusText — <full url>\n<300 chars of body>` dump was
 * unreadable: on an auth failure the body is a whole HTML sign-in page. ADO's own
 * JSON envelope carries a `message` that says the useful thing, so use that when
 * present and fall back to a short explanation keyed on the status code. The full
 * response is logged server-side, where length costs nothing.
 */
function adoError(res: Response, body: string, opts: { write: boolean; url: string }): Error {
  console.warn(`[ado] ${res.status} ${res.statusText} ${opts.url}\n${body.slice(0, 2000)}`);
  let detail = "";
  try {
    const json = JSON.parse(body) as { message?: string };
    if (typeof json.message === "string") detail = json.message.trim();
  } catch {
    /* not JSON — an HTML error/sign-in page, which has nothing quotable in it */
  }
  if (!detail && (res.status === 401 || res.status === 403)) {
    detail = opts.write
      ? `Azure DevOps refused the change (${res.status}) — the personal access token in Settings needs Work Items (Read & Write) scope, and must not be expired.`
      : `Azure DevOps refused the request (${res.status}) — the personal access token in Settings may be expired or lack read access.`;
  }
  if (!detail) detail = `Azure DevOps returned ${res.status} ${res.statusText}.`;
  return new Error(detail.length > 260 ? `${detail.slice(0, 257)}…` : detail);
}

async function adoGet<T>(url: string, pat: string): Promise<T> {
  const res = await fetch(url, { headers: authHeader(pat), cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw adoError(res, body, { write: false, url });
  }
  return res.json() as Promise<T>;
}

/** Send a write and return the parsed response — ADO echoes the updated entity,
 *  so a caller can confirm what actually landed instead of assuming its request
 *  was applied verbatim. */
async function adoSend<T>(url: string, method: string, body: unknown, contentType: string, pat: string): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { ...authHeader(pat), "Content-Type": contentType },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw adoError(res, text, { write: true, url });
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Keep a rich-text field as (sanitized) HTML instead of flattening it.
 *
 * ADO stores Description and Acceptance Criteria as HTML, and real tickets use
 * that: numbered criteria with lettered sub-points, bold terms, links and pasted
 * screenshots. `htmlToText()` threw all of that away, so the app showed a
 * requirement in a shape its author never wrote.
 *
 * Embedded images point at `_apis/wit/attachments/<guid>`, which needs the PAT —
 * they are rewritten to `/api/attachments`, which re-issues the request with the
 * stored credential.
 */
function htmlToRich(html: string): string {
  const raw = html ?? "";
  const opts = {
    rewriteImageSrc: (src: string) =>
      /\/_apis\/wit\/attachments\//i.test(src) ? `/api/attachments?url=${encodeURIComponent(src)}` : src,
  };
  // ADO now lets a work item store these fields as Markdown instead of HTML,
  // and both shapes arrive on the same field. A body with no markup at all is
  // the Markdown one: rendered as HTML its newlines collapse and the whole
  // numbered list runs together in a single paragraph.
  return isHtml(raw) ? sanitizeHtml(raw, opts) : markdownToHtml(raw, opts);
}

/** Does this field value carry HTML markup, or is it a Markdown/plain body? */
function isHtml(value: string): boolean {
  return /<\/?(p|div|br|ul|ol|li|h[1-6]|table|img|span|strong|b|em|i|a|pre|code|blockquote)\b[^>]*>/i.test(value);
}

/** Convert ADO rich-text (HTML) to readable plain text. */
function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function lastAreaSegment(areaPath: string): string {
  if (!areaPath) return "";
  const parts = areaPath.split("\\");
  return parts[parts.length - 1].trim();
}

export type ProjectInfo = { id: string; name: string; description?: string };

type RawProject = { id: string; name: string; description?: string };

/** All projects in the configured organization (org-level, no project segment). */
export async function listProjects(): Promise<ProjectInfo[]> {
  const { org, pat } = await loadCreds();
  return cached(`${ADO_CACHE_PREFIX}projects:${org}`, TTL.projects, async () => {
    const url = `https://dev.azure.com/${org}/_apis/projects?${API}`;
    const data = await adoGet<{ value: RawProject[] }>(url, pat);
    return data.value
      .map((p) => ({ id: p.id, name: p.name, description: p.description }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

export type IterationInfo = {
  id: string;
  name: string;
  timeFrame?: "past" | "current" | "future";
  startDate?: string;
  finishDate?: string;
};

type RawIteration = {
  id: string;
  name: string;
  attributes?: { startDate?: string; finishDate?: string; timeFrame?: "past" | "current" | "future" };
};

/**
 * Iterations for the project's default team (used to resolve the current sprint
 * and to populate the sprint picker).
 *
 * Cached because every ticket load resolves its sprint through here and the
 * sprint picker asks for the same list in the same tick — one page load paid two
 * round-trips for an answer that only changes when someone creates a sprint,
 * which is not something that happens between two clicks. `cached()` also
 * single-flights those two callers into one request.
 *
 * Keyed by org + project: switching organization or project is a different
 * question, not a stale answer to this one.
 */
export async function listIterations(project: string): Promise<IterationInfo[]> {
  const { org, pat, project: proj } = await loadCreds(project);
  return cached(`${ADO_CACHE_PREFIX}iterations:${org}:${proj}`, TTL.iterations, async () => {
    // No team segment: ADO falls back to the project's default team, so the user
    // only has to configure the project URL.
    const url = `https://dev.azure.com/${org}/${encodeURIComponent(
      proj
    )}/_apis/work/teamsettings/iterations?${API}`;
    const data = await adoGet<{ value: RawIteration[] }>(url, pat);
    return data.value.map((i) => ({
      id: i.id,
      name: i.name,
      timeFrame: i.attributes?.timeFrame,
      startDate: i.attributes?.startDate,
      finishDate: i.attributes?.finishDate,
    }));
  });
}

/** Resolve which iteration to load: an explicit override name, else ADO's current iteration. */
async function resolveIteration(project: string, sprintOverride?: string): Promise<IterationInfo> {
  const iterations = await listIterations(project);
  const requested = sprintOverride?.trim();
  if (requested) {
    const found = iterations.find((i) => i.name === requested);
    if (!found) throw new Error(`Sprint "${requested}" not found among team iterations`);
    return found;
  }
  const current = iterations.find((i) => i.timeFrame === "current");
  if (current) return current;
  throw new Error("No current sprint found among team iterations");
}

type WorkItemRelations = { workItemRelations: { target?: { id: number } }[] };

type WorkItemDetail = {
  id: number;
  fields: Record<string, unknown>;
};

/**
 * The fields a *list* needs, which deliberately exclude `System.Description` and
 * `Microsoft.VSTS.Common.AcceptanceCriteria`.
 *
 * Those two are rich HTML — screenshots, tables, nested lists — and routinely run
 * to tens of kilobytes per work item. A 200-item view was transferring and
 * sanitizing every one of them so that the single ticket the user then clicked
 * could render two panels. They are read per ticket instead, by
 * `getWorkItemDetail`, on the same lazy path the discussion comments already use.
 */
const TICKET_FIELDS = [
  "System.Id",
  "System.Title",
  "System.State",
  "System.WorkItemType",
  "System.AssignedTo",
  "System.AreaPath",
  "System.IterationPath",
  "Microsoft.VSTS.Scheduling.OriginalEstimate",
  "Microsoft.VSTS.Scheduling.StoryPoints",
  // The kanban column the item sits in, which is **not** its state: a board maps
  // several states onto one column and may carry custom ones, so grouping a
  // board view by state draws a different board than Azure DevOps does.
  "System.BoardColumn",
].join(",");

/** The heavy rich-text fields, read for one ticket at a time.
 *  `Microsoft.VSTS.TCM.ReproSteps` is where a Bug keeps its description: the Bug
 *  form has no Description field at all, so reading only `System.Description`
 *  rendered every bug as "No description." */
const TICKET_DETAIL_FIELDS = [
  "System.Description",
  "Microsoft.VSTS.TCM.ReproSteps",
  "Microsoft.VSTS.Common.AcceptanceCriteria",
].join(",");

/** ADO's own cap on the `ids` parameter of the batch work-item read. */
const BATCH_SIZE = 200;

/**
 * Cap on one fetch. A sprint is bounded by its
 * iteration, but a backlog or a board is not — a 2000-item project would
 * otherwise hang the page load.
 */
const MAX_TICKETS = 200;

/**
 * States that mean the item has left the board. Named literally because WIQL
 * cannot query ADO's state *category*, and the names differ per process template
 * — Agile closes at "Closed", Scrum and Basic at "Done", and both Scrum and
 * Agile use "Removed" for abandoned work. Only backlog and board apply it; a
 * sprint is bounded by its iteration and shows its closed work on purpose.
 */
const CLOSED_STATES = ["Closed", "Removed", "Done"];

/** A WIQL string literal's body. Doubling a quote is ADO's own escape — a
 *  project or sprint name with an apostrophe would otherwise terminate the
 *  literal and produce a syntax error. */
function wiqlQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * The work items one view asks for.
 *
 * - `backlog` — open work not scheduled into any iteration yet. In ADO that is
 *   the iteration path still sitting at the project root, which is what an
 *   unassigned work item inherits.
 * - `board` — every open work item in the project, whatever iteration it is in.
 *   That is what a kanban board shows, and it is why this is not the sprint
 *   query with a filter: a board's cards routinely live in iterations the
 *   sprint view excludes.
 */
function wiqlFor(project: string, scope: Exclude<TicketScope, "sprint">): string {
  const clauses = [`[System.TeamProject] = '${wiqlQuoted(project)}'`];
  if (scope === "backlog") clauses.push(`[System.IterationPath] = '${wiqlQuoted(project)}'`);
  clauses.push(`[System.State] NOT IN (${CLOSED_STATES.map((s) => `'${s}'`).join(",")})`);
  return `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(" AND ")} ORDER BY [System.Id] DESC`;
}

/** Batch-read work items by id and map them to the UI `Ticket` shape. Shared by
 *  all three scopes so a field added for one view is present in the others. */
async function fetchWorkItems(creds: Creds, ids: number[]): Promise<Ticket[]> {
  const { org, pat, project: proj } = creds;
  const tickets: Ticket[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const batchUrl = `https://dev.azure.com/${org}/_apis/wit/workitems?ids=${chunk.join(
      ","
    )}&fields=${TICKET_FIELDS}&${API}`;
    const det = await adoGet<{ value: WorkItemDetail[] }>(batchUrl, pat);
    for (const w of det.value) {
      const f = w.fields;
      const area = (f["System.AreaPath"] as string) ?? "";
      const assignedTo = f["System.AssignedTo"] as { displayName?: string; uniqueName?: string } | undefined;
      tickets.push({
        id: String(f["System.Id"]),
        title: (f["System.Title"] as string) ?? "",
        type: (f["System.WorkItemType"] as string) ?? "Task",
        status: (f["System.State"] as string) ?? "New",
        assignee: assignedTo?.displayName ?? "Unassigned",
        assigneeEmail: assignedTo?.uniqueName,
        areaPath: area,
        iterationPath: (f["System.IterationPath"] as string) || undefined,
        project: lastAreaSegment(area) || (process.env.CLAUDE_DEFAULT_PROJECT ?? ""),
        // An organization-wide read has no project to scope the link to. Azure
        // DevOps resolves the project itself from the id, so the shorter form is
        // a real deep link and not a degraded one.
        url: proj
          ? `https://dev.azure.com/${org}/${encodeURIComponent(proj)}/_workitems/edit/${f["System.Id"]}`
          : `https://dev.azure.com/${org}/_workitems/edit/${f["System.Id"]}`,
        estimateHours: numOrUndefined(f["Microsoft.VSTS.Scheduling.OriginalEstimate"]),
        storyPoints: numOrUndefined(f["Microsoft.VSTS.Scheduling.StoryPoints"]),
        // Empty for a work item type that is not on a board (a Task, usually).
        // The caller falls back to the state, the closest true answer.
        boardColumn: (f["System.BoardColumn"] as string) || undefined,
      });
    }
  }
  return tickets;
}

/**
 * One view's work items, straight from Azure DevOps.
 *
 * The three scopes are three different questions, bounded differently at the
 * provider, and they reach two different endpoints on purpose:
 *
 * - `sprint` goes through **team iterations** (`work/teamsettings/iterations/
 *   {id}/workitems`), because that is the only scope a sprint has in ADO — it is
 *   the list the user sees at `_sprints/backlog/<team>/…`, and reading the
 *   project's classification tree instead returns every team's sub-tree at once.
 * - `backlog` and `board` have no team-scoped endpoint, so they are WIQL, using
 *   the same clauses `wiqlFor` builds.
 *
 * `truncated` is the honest half of `MAX_TICKETS`: neither a backlog nor a board
 * is bounded by an iteration, so a big project silently losing its tail would
 * read as a short board rather than a capped one.
 */
export async function getScopedTickets(
  project: string,
  scope: TicketScope,
  sprintOverride?: string
): Promise<{ tickets: Ticket[]; sprintName: string; truncated: boolean }> {
  const creds = await loadCreds(project);
  const { org, pat, project: proj } = creds;
  const key = `${ADO_CACHE_PREFIX}tickets:${org}:scoped:${proj}:${scope}:${sprintOverride ?? ""}`;
  return cached(key, TTL.tickets, async () => {
    if (scope === "sprint") {
      const { tickets, sprintName } = await getSprintTickets(project, sprintOverride);
      return { tickets, sprintName, truncated: false };
    }
    const wiqlUrl = `https://dev.azure.com/${org}/${encodeURIComponent(proj)}/_apis/wit/wiql?${API}`;
    const res = await adoSend<{ workItems?: { id: number }[] }>(
      wiqlUrl,
      "POST",
      { query: wiqlFor(proj, scope) },
      "application/json",
      pat
    );
    const found = (res.workItems ?? []).map((w) => w.id);
    const ids = found.slice(0, MAX_TICKETS);
    // Neither view is an iteration, so there is no sprint name to claim.
    return { tickets: await fetchWorkItems(creds, ids), sprintName: "", truncated: found.length > ids.length };
  });
}

/**
 * Every open work item in one project that is assigned to this developer,
 * whatever iteration it sits in — including none.
 *
 * This is not any of the three scopes and cannot be derived from them. A
 * developer's assigned work routinely lives outside the current iteration (an
 * unscheduled backlog item, a card still parked in last sprint's iteration),
 * and the board scope that would contain it is a whole-project query capped at
 * `MAX_TICKETS` — so on a busy project the developer's own older tickets are
 * exactly the rows that fall off the end. Filtering in the query instead of
 * after it makes the cap irrelevant.
 *
 * Closed work is excluded on purpose: the sprint fetch is the record of what an
 * iteration finished, and this query's job is only to find work still to do that
 * the iteration does not know about.
 *
 * Matches the email **and** the display name, the way `isMine()` does — but as
 * one `IN` list rather than a preference order, because a query cannot fall back.
 * Both are needed: the identity a connection stores is the address the developer
 * is known by *to us*, and an organization that federates its accounts knows them
 * by another one (`ken.nguyen@emesoft.net` here, `ken.nguyen@creativeplanning.com`
 * in the tracker). Querying the email alone returned nothing for exactly that
 * reason. An address the organization has never heard of is not an error to ADO,
 * it simply matches nothing, so listing both costs one round-trip and no risk.
 */
export async function getMyOpenWorkItems(
  project: string,
  identity: DevIdentity
): Promise<{ tickets: Ticket[]; truncated: boolean }> {
  const who = [identity.email, identity.name].filter(Boolean);
  if (who.length === 0) return { tickets: [], truncated: false };

  const creds = await loadCreds(project);
  const { org, pat, project: proj } = creds;
  // The identity is part of the key: the same project answers this differently
  // for each developer, and one connection can be several people over time.
  const key = `${ADO_CACHE_PREFIX}tickets:${org}:mine:${proj}:${who.join("|")}`;
  return cached(key, TTL.tickets, async () => {
    const query =
      `SELECT [System.Id] FROM WorkItems WHERE ` +
      `[System.TeamProject] = '${wiqlQuoted(proj)}' AND ` +
      `[System.AssignedTo] IN (${who.map((w) => `'${wiqlQuoted(w)}'`).join(",")}) AND ` +
      `[System.State] NOT IN (${CLOSED_STATES.map((st) => `'${st}'`).join(",")}) ` +
      `ORDER BY [System.Id] DESC`;

    const wiqlUrl = `https://dev.azure.com/${org}/${encodeURIComponent(proj)}/_apis/wit/wiql?${API}`;
    const res = await adoSend<{ workItems?: { id: number }[] }>(
      wiqlUrl,
      "POST",
      { query },
      "application/json",
      pat
    );
    const found = (res.workItems ?? []).map((w) => w.id);
    const ids = found.slice(0, MAX_TICKETS);
    return { tickets: await fetchWorkItems(creds, ids), truncated: found.length > ids.length };
  });
}

/**
 * The developer's open work anywhere in the organization.
 *
 * `getMyOpenWorkItems` above scopes the same question to one project, which is
 * what a sprint plan needs. A day's report does not: a developer routinely
 * touches two projects between two stand-ups, and asking per project would be
 * one round-trip per project to reconstruct an answer Azure DevOps already
 * gives in one — WIQL run at the organization endpoint, with no
 * `System.TeamProject` clause, spans every project the token can see.
 */
export async function getMyOpenWorkItemsAnyProject(
  identity: DevIdentity
): Promise<{ tickets: Ticket[]; truncated: boolean }> {
  const who = [identity.email, identity.name].filter(Boolean);
  if (who.length === 0) return { tickets: [], truncated: false };

  const creds = await loadCreds();
  const { org, pat } = creds;
  const key = `${ADO_CACHE_PREFIX}tickets:${org}:mine:__any__:${who.join("|")}`;
  return cached(key, TTL.tickets, async () => {
    const query =
      `SELECT [System.Id] FROM WorkItems WHERE ` +
      `[System.AssignedTo] IN (${who.map((w) => `'${wiqlQuoted(w)}'`).join(",")}) AND ` +
      `[System.State] NOT IN (${CLOSED_STATES.map((st) => `'${st}'`).join(",")}) ` +
      `ORDER BY [System.Id] DESC`;

    const wiqlUrl = `https://dev.azure.com/${org}/_apis/wit/wiql?${API}`;
    const res = await adoSend<{ workItems?: { id: number }[] }>(
      wiqlUrl,
      "POST",
      { query },
      "application/json",
      pat
    );
    const found = (res.workItems ?? []).map((w) => w.id);
    const ids = found.slice(0, MAX_TICKETS);
    return { tickets: await fetchWorkItems(creds, ids), truncated: found.length > ids.length };
  });
}

/** Fetch all tickets in a sprint, mapped to the UI Ticket shape. Defaults to
 *  ADO's current iteration. Reached through `getScopedTickets`, which is the
 *  module's one entry point for a ticket list — a second exported one is how a
 *  caller ends up serving a sprint when it was asked for a board. */
async function getSprintTickets(
  project: string,
  sprintOverride?: string
): Promise<{ tickets: Ticket[]; sprintName: string }> {
  const creds = await loadCreds(project);
  const { org, pat, project: proj } = creds;
  const iteration = await resolveIteration(project, sprintOverride);

  const wiUrl = `https://dev.azure.com/${org}/${encodeURIComponent(
    proj
  )}/_apis/work/teamsettings/iterations/${iteration.id}/workitems?${API}`;
  const rel = await adoGet<WorkItemRelations>(wiUrl, pat);
  const ids = Array.from(
    new Set(rel.workItemRelations.map((r) => r.target?.id).filter(Boolean) as number[])
  );
  if (ids.length === 0) return { tickets: [], sprintName: iteration.name };

  // Keep ADO's board order roughly stable by id.
  return { tickets: await fetchWorkItems(creds, ids), sprintName: iteration.name };
}

/**
 * One work item, in the UI's `Ticket` shape.
 *
 * The list queries are all bounded — by iteration, by backlog, by open state —
 * so a ticket the developer is sent to from a notification is routinely in none
 * of them: released work leaves the board, and a plan the scheduler worked may
 * belong to another project entirely. This reads that one item directly.
 */
export async function getWorkItemTicket(id: string): Promise<Ticket | null> {
  const creds = await loadCreds();
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) return null;
  return cached(`${ADO_CACHE_PREFIX}workItem:${creds.org}:${numeric}`, TTL.workItem, async () => {
    const [ticket] = await fetchWorkItems(creds, [numeric]);
    return ticket ?? null;
  });
}

/** The rich-text half of one work item — the fields `TICKET_FIELDS` leaves out.
 *  Read when a ticket is opened rather than for every row of a list. */
export async function getWorkItemDetail(id: string): Promise<{ description: string; criteria: string }> {
  const { org, pat } = await loadCreds();
  return cached(`${ADO_CACHE_PREFIX}workItem:${org}:detail:${id}`, TTL.workItemDetail, async () => {
    const url = `https://dev.azure.com/${org}/_apis/wit/workitems/${encodeURIComponent(
      id
    )}?fields=${TICKET_DETAIL_FIELDS}&${API}`;
    const data = await adoGet<{ fields?: Record<string, unknown> }>(url, pat);
    const f = data.fields ?? {};
    const description = (f["System.Description"] as string) || (f["Microsoft.VSTS.TCM.ReproSteps"] as string) || "";
    return {
      description: htmlToRich(description),
      criteria: htmlToRich((f["Microsoft.VSTS.Common.AcceptanceCriteria"] as string) ?? ""),
    };
  });
}

type RawWorkItemState = { name: string };

/** Real workflow states for a work item type (e.g. "Bug", "User Story"), as configured by this project's process template — not a hard-coded guess. */
export async function getWorkItemTypeStates(project: string, type: string): Promise<string[]> {
  const { org, pat, project: proj } = await loadCreds(project);
  return cached(
    `${ADO_CACHE_PREFIX}states:${org}:${proj}:${type}`,
    TTL.workItemTypeStates,
    async () => {
      const url = `https://dev.azure.com/${org}/${encodeURIComponent(
        proj
      )}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=7.1-preview.1`;
      const data = await adoGet<{ value: RawWorkItemState[] }>(url, pat);
      return data.value.map((s) => s.name);
    }
  );
}

/** Write the work item's State field back to Azure DevOps. */
/** Write the work item's state and return the state ADO actually recorded (its
 *  PATCH response echoes the updated fields). Returning the echo rather than the
 *  requested value is what lets the UI show the provider's truth instead of its
 *  own optimistic guess — a rule that fired on the way in could have landed the
 *  item somewhere else. */
export async function updateWorkItemState(id: string, state: string): Promise<string> {
  const { org, pat } = await loadCreds();
  const url = `https://dev.azure.com/${org}/_apis/wit/workitems/${encodeURIComponent(id)}?${API}`;
  const updated = await adoSend<{ fields?: { "System.State"?: string } }>(
    url,
    "PATCH",
    [{ op: "add", path: "/fields/System.State", value: state }],
    "application/json-patch+json",
    pat
  );
  await invalidateWorkItems(org);
  return updated.fields?.["System.State"] || state;
}

/** The work item's current state, read fresh. Used to re-sync the UI after a
 *  failed write, so a rejected change never leaves the app showing a status the
 *  provider never accepted. */
export async function getWorkItemState(id: string): Promise<string> {
  const { org, pat } = await loadCreds();
  const url = `https://dev.azure.com/${org}/_apis/wit/workitems/${encodeURIComponent(id)}?fields=System.State&${API}`;
  const data = await adoGet<{ fields?: { "System.State"?: string } }>(url, pat);
  return data.fields?.["System.State"] ?? "";
}

/**
 * Map a desired state label (e.g. "Code Review") onto one of the work item
 * type's real configured states — process templates vary (Agile: New/Active/
 * Resolved/Closed; Scrum: New/Approved/Committed/Done; Basic: To Do/Doing/
 * Done), so the literal label the caller wants often doesn't exist. Returns
 * null when nothing reasonable matches, so the caller can skip the write
 * instead of sending a PATCH that ADO will reject.
 */
export async function resolveWorkItemState(id: string, desired: string): Promise<string | null> {
  const { org, pat } = await loadCreds();
  const url = `https://dev.azure.com/${org}/_apis/wit/workitems/${encodeURIComponent(
    id
  )}?fields=System.WorkItemType,System.TeamProject&${API}`;
  const data = await adoGet<{ fields?: { "System.WorkItemType"?: string; "System.TeamProject"?: string } }>(url, pat);
  const type = data.fields?.["System.WorkItemType"];
  const project = data.fields?.["System.TeamProject"];
  if (!type || !project) return null;
  const states = await getWorkItemTypeStates(project, type);

  const want = desired.trim().toLowerCase();
  const exact = states.find((s) => s.toLowerCase() === want);
  if (exact) return exact;

  // Ignore spacing/punctuation differences ("Code Review" vs "code-review").
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const loose = states.find((s) => squash(s) === squash(want));
  if (loose) return loose;

  // Then a containment match either way ("Code Review" ↔ "In Code Review").
  const phrase = states.find((s) => {
    const sw = s.toLowerCase();
    return sw.includes(want) || want.includes(sw);
  });
  if (phrase) return phrase;

  // Last resort: a state that carries *every* word of the desired label. Matching
  // on any *single* word (what this used to do) is how "Code Review" could land on
  // an unrelated state that merely happened to contain "code".
  const wantWords = want.split(/\s+/).filter(Boolean);
  const allWords = states.find((s) => {
    const sw = s.toLowerCase();
    return wantWords.every((w) => sw.includes(w));
  });
  return allWords ?? null;
}

type RawComment = {
  text?: string;
  createdBy?: { displayName?: string };
  createdDate?: string;
};

/** Format an ISO date as a short "Mon D" label. */
function shortDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Fetch the discussion comments for a single work item, oldest first. */
/**
 * The work item's own team project.
 *
 * Comments are the one work-item read Azure DevOps scopes to a project — every
 * other read in this module addresses the item org-wide by id. The project the
 * caller has is the UI's project filter, which is empty until the user picks one
 * and, when set, is the *area path's* last segment rather than the team project.
 * Either way the comments URL came out wrong and the request 404'd, so the
 * Overview tab showed no discussion on tickets that have one. Read the item's
 * `System.TeamProject` instead of trusting what was passed in.
 */
async function workItemProject(org: string, pat: string, id: string): Promise<string> {
  return cached(`${ADO_CACHE_PREFIX}workItem:${org}:project:${id}`, TTL.workItemDetail, async () => {
    const url = `https://dev.azure.com/${org}/_apis/wit/workitems/${encodeURIComponent(id)}?fields=System.TeamProject&${API}`;
    const data = await adoGet<{ fields?: { "System.TeamProject"?: string } }>(url, pat);
    return data.fields?.["System.TeamProject"] ?? "";
  });
}

export async function getWorkItemComments(id: string): Promise<TicketComment[]> {
  const { org, pat } = await loadCreds();
  const proj = await workItemProject(org, pat, id);
  if (!proj) return [];
  return cached(`${ADO_CACHE_PREFIX}comments:${org}:${proj}:${id}`, TTL.comments, async () => {
    // Comments live behind a preview API version.
    const url = `https://dev.azure.com/${org}/${encodeURIComponent(
      proj
    )}/_apis/wit/workItems/${encodeURIComponent(id)}/comments?api-version=7.0-preview.3`;
    const data = await adoGet<{ comments?: RawComment[] }>(url, pat);
    return (data.comments ?? [])
      .map((c) => ({
        author: c.createdBy?.displayName ?? "Unknown",
        date: shortDate(c.createdDate),
        // Kept as rich text for the same reason Description is: a discussion
        // comment is routinely a pasted screenshot, a list or a link, and
        // flattening it to plain text left an image-only comment as the empty
        // string — which the filter below then dropped altogether.
        text: htmlToRich(c.text ?? ""),
      }))
      .filter((c) => hasContent(c.text));
  });
}

// ---- Pull request review (Resolve Review tab) ----

type ArtifactRelation = { rel?: string; url?: string };

type PrRef = { repositoryId: string; prId: string; project?: string };

/**
 * Base `.../repositories/{repositoryId}` URL for a ref. When the ref carries
 * no project (the artifact-link/GUID case), the project segment is omitted —
 * ADO resolves a repository GUID org-wide, which matters because the work
 * item's own repo can live in a different project than the one configured in
 * Settings (a single Settings connection only names one project, but tickets
 * fetched by ID are not restricted to it).
 */
function repoBaseUrl(org: string, ref: { repositoryId: string; project?: string }): string {
  const projectSegment = ref.project ? `${encodeURIComponent(ref.project)}/` : "";
  return `https://dev.azure.com/${org}/${projectSegment}_apis/git/repositories/${encodeURIComponent(ref.repositoryId)}`;
}

/** The repo's own project name, if the ref resolves to an accessible repo. */
async function resolveRepositoryProject(org: string, pat: string, ref: { repositoryId: string; project?: string }): Promise<string | null> {
  return cached(
    `${ADO_CACHE_PREFIX}repoProject:${org}:${ref.project ?? ""}:${ref.repositoryId}`,
    TTL.repositoryProject,
    async () => {
      const res = await fetch(`${repoBaseUrl(org, ref)}?${API}`, { headers: authHeader(pat), cache: "no-store" });
      if (!res.ok) return null;
      const repo = (await res.json()) as { project?: { name?: string } };
      return repo.project?.name ?? ref.project ?? null;
    }
  );
}

/**
 * Resolve the PR to read for a work item.
 *
 * The URL recorded on the ticket's most recent execution wins. A work item
 * accumulates one "Pull Request" artifact link per PR ever linked to it and
 * abandoning a PR never removes its link, so the relations list is a history,
 * not an answer — reading it first showed an abandoned PR's branch, commits and
 * threads for a ticket whose current PR is newer. Remaining artifact links are
 * tried newest PR id first, and only matter when nothing was recorded (a PR a
 * human opened) or when the recorded repo no longer resolves.
 *
 * Each candidate ref is verified against the repositories API before use — a
 * repository id can go stale (repo renamed/recreated, or the id belongs to a
 * repo the current PAT can't see), which otherwise 404s every review/commit
 * call for the ticket. The recorded candidate also carries the project parsed
 * out of its own URL (rather than the globally configured PROJECT), since the
 * ticket's repo may not live in the project Settings happens to be connected to.
 */
async function getLinkedPullRequestRef(creds: Creds, ticketId: string, fallbackPrUrl?: string | null): Promise<PrRef | null> {
  const { org, pat, project } = creds;
  const recorded = refFromRecordedPrUrl(fallbackPrUrl, project);
  if (recorded) {
    const resolved = await resolveRepositoryProject(org, pat, recorded);
    if (resolved) return { ...recorded, project: resolved };
  }
  const url = `https://dev.azure.com/${org}/_apis/wit/workitems/${encodeURIComponent(
    ticketId
  )}?$expand=relations&${API}`;
  const data = await adoGet<{ relations?: ArtifactRelation[] }>(url, pat);
  const linked: PrRef[] = [];
  for (const r of data.relations ?? []) {
    if (r.rel !== "ArtifactLink" || !r.url) continue;
    const m = r.url.match(/vstfs:\/\/\/Git\/PullRequestId\/[^%]+%2F([^%]+)%2F(\d+)/i);
    if (m && m[2] !== recorded?.prId) linked.push({ repositoryId: m[1], prId: m[2] });
  }
  linked.sort((a, b) => Number(b.prId) - Number(a.prId));
  for (const ref of linked) {
    const resolved = await resolveRepositoryProject(org, pat, ref);
    if (resolved) return { ...ref, project: resolved };
  }
  return null;
}

/** The repo/PR id named by a PR URL an execution recorded, if it is one. */
function refFromRecordedPrUrl(prUrl: string | null | undefined, project: string): PrRef | null {
  if (!prUrl) return null;
  const withProject = prUrl.match(/dev\.azure\.com\/[^/]+\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/i);
  if (withProject) {
    return { repositoryId: decodeURIComponent(withProject[2]), prId: withProject[3], project: decodeSegment(withProject[1]) };
  }
  const bare = prUrl.match(/_git\/([^/]+)\/pullrequest\/(\d+)/i);
  return bare ? { repositoryId: decodeURIComponent(bare[1]), prId: bare[2], project } : null;
}

/** The ref named by a recorded PR URL, verified by reading the PR itself.
 *
 *  Two calls' worth of work item + repository reads are skipped, and the read
 *  that replaces them is one the caller was going to make anyway. Returns null —
 *  never throws — when the URL no longer resolves, so the caller falls back to
 *  the thorough resolution instead of reporting a ticket as having no PR. */
async function quickPullRequest(creds: Creds, prUrl?: string | null): Promise<{ ref: PrRef; raw: RawPullRequest } | null> {
  if (!prUrl) return null;
  const { org, pat, project } = creds;
  const ref = refFromRecordedPrUrl(prUrl, project);
  if (!ref) return null;
  try {
    return { ref, raw: await adoGet<RawPullRequest>(`${repoBaseUrl(org, ref)}/pullrequests/${ref.prId}?${API}`, pat) };
  } catch {
    return null;
  }
}

type RawReviewer = { displayName?: string; vote?: number };
type RawPullRequest = {
  pullRequestId: number;
  title?: string;
  status?: string;
  createdBy?: { displayName?: string };
  reviewers?: RawReviewer[];
  sourceRefName?: string;
  targetRefName?: string;
  creationDate?: string;
  repository?: { name?: string; webUrl?: string };
};

/** The PR's page in the web UI.
 *
 *  Built from `repository.webUrl` when ADO returns it, because that is the one
 *  value guaranteed to name the repo the PR actually lives in. The hand-built
 *  form is only a fallback, and it is *never* built from a partial ref: an empty
 *  repo segment yields `.../_git//pullrequest/<n>`, which ADO answers with the
 *  project's pull-request *list* — the wrong-link bug this replaced. When
 *  nothing resolves, prefer the URL the run itself recorded over a guess. */
function prWebUrl(org: string, project: string, raw: RawPullRequest, fallbackPrUrl?: string | null): string {
  const id = raw.pullRequestId;
  const repoWeb = raw.repository?.webUrl;
  if (repoWeb) return `${repoWeb.replace(/\/+$/, "")}/pullrequest/${id}`;
  const repoName = raw.repository?.name;
  if (repoName && project) {
    return `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repoName)}/pullrequest/${id}`;
  }
  return fallbackPrUrl ?? "";
}

function prStatusLabel(raw: RawPullRequest): string {
  const status = (raw.status ?? "").toLowerCase();
  if (status === "completed") return "Completed";
  if (status === "abandoned") return "Abandoned";
  const reviewers = raw.reviewers ?? [];
  if (reviewers.some((r) => (r.vote ?? 0) <= -5)) return "Changes requested";
  if (reviewers.length && reviewers.every((r) => (r.vote ?? 0) >= 5)) return "Approved";
  return "Active";
}

type RawThreadComment = {
  id?: number;
  content?: string;
  commentType?: string;
  isDeleted?: boolean;
  author?: { displayName?: string };
  publishedDate?: string;
};
type RawThread = {
  id: number;
  status?: string;
  comments?: RawThreadComment[];
  threadContext?: { filePath?: string; rightFileStart?: { line?: number } };
};

const RESOLVED_THREAD_STATUSES = new Set(["fixed", "closed", "wontfix"]);

/** Fetch the PR (if any) linked to a work item, plus its review-comment threads.
 *
 *  `fast` skips straight to the PR named by `fallbackPrUrl`, spending two calls
 *  instead of four — the PR read is its own verification, since a repository or
 *  PR that does not resolve answers 404 and nothing is built from the guess.
 *  The review bell asks about a whole board on a timer and passes it; the
 *  Resolve Review tab opens one ticket and does not, because there the extra
 *  reads buy a link that survives a renamed repository. Either way a URL that
 *  fails falls back to the thorough resolution rather than reporting "no PR". */
export async function getPullRequestReview(
  ticketId: string,
  fallbackPrUrl?: string | null,
  opts?: { fast?: boolean }
): Promise<ReviewData> {
  const creds = await loadCreds();
  const { org, pat, project } = creds;
  // Keyed on the ticket plus the URL the caller offered, because those two are
  // what decide which pull request gets read. `fast` is not in the key: it
  // changes how the PR is found, never which one — the board poll and the
  // Resolve Review tab must not hold two answers about the same review.
  return cached(
    `${ADO_CACHE_PREFIX}review:${org}:${ticketId}:${fallbackPrUrl ?? ""}`,
    TTL.review,
    async () => {
  const quick = opts?.fast ? await quickPullRequest(creds, fallbackPrUrl) : null;
  const ref = quick?.ref ?? (await getLinkedPullRequestRef(creds, ticketId, fallbackPrUrl));
  if (!ref) return { pr: null, comments: [], unresolvedCount: 0 };

  const raw = quick?.raw ?? (await adoGet<RawPullRequest>(`${repoBaseUrl(org, ref)}/pullrequests/${ref.prId}?${API}`, pat));
  const pr: PullRequestOverview = {
    id: String(raw.pullRequestId),
    url: prWebUrl(org, ref.project ?? project, raw, fallbackPrUrl),
    title: raw.title ?? "",
    status: prStatusLabel(raw),
    branch: (raw.sourceRefName ?? "").replace(/^refs\/heads\//, ""),
    targetBranch: (raw.targetRefName ?? "").replace(/^refs\/heads\//, ""),
    author: raw.createdBy?.displayName ?? "Unknown",
    reviewers: (raw.reviewers ?? []).map((r) => r.displayName ?? "").filter(Boolean),
    createdAt: raw.creationDate ?? "",
  };

  const threadsData = await adoGet<{ value?: RawThread[] }>(`${repoBaseUrl(org, ref)}/pullrequests/${ref.prId}/threads?${API}`, pat);
  const comments: ReviewComment[] = [];
  for (const th of threadsData.value ?? []) {
    if (!th.threadContext) continue; // skip system threads (status/vote updates)
    const first = (th.comments ?? []).find((c) => !c.isDeleted && c.commentType !== "system");
    if (!first?.content) continue;
    comments.push({
      id: String(first.id ?? th.id),
      threadId: th.id,
      author: first.author?.displayName ?? "Unknown",
      text: first.content,
      filePath: th.threadContext.filePath,
      line: th.threadContext.rightFileStart?.line,
      status: RESOLVED_THREAD_STATUSES.has((th.status ?? "").toLowerCase()) ? "resolved" : "open",
      date: shortDate(first.publishedDate),
    });
  }

  return { pr, comments, unresolvedCount: comments.filter((c) => c.status === "open").length };
    }
  );
}

// ---- Dashboard delivery funnel ----

/** What became of one PR the engine opened. */
export type PrOutcome = { merged: boolean; abandoned: boolean; reviewComments: number };

// Parse a PR URL the engine recorded back into a ref. Unlike the review/commits
// path there's no work-item lookup here: the dashboard already has the URL, and
// resolving hundreds of them through the artifact-link API would be far too slow.
function refFromPrUrl(url: string): PrRef | null {
  const withProject = url.match(/dev\.azure\.com\/[^/]+\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/i);
  if (withProject) {
    return {
      repositoryId: decodeURIComponent(withProject[2]),
      prId: withProject[3],
      project: decodeSegment(withProject[1]),
    };
  }
  const m = url.match(/_git\/([^/]+)\/pullrequest\/(\d+)/i);
  return m ? { repositoryId: decodeURIComponent(m[1]), prId: m[2] } : null;
}

/**
 * Resolve what happened to each PR: merged (ADO "completed"), abandoned, and how
 * many human review threads it attracted. Two calls per PR, so callers must cap
 * the list — see loadDeliveryFunnel() in lib/tickets.ts.
 *
 * A URL that no longer resolves yields null rather than throwing, so one stale
 * PR can't blank out the whole funnel.
 */
export async function getPullRequestOutcomes(prUrls: string[]): Promise<(PrOutcome | null)[]> {
  const { org, pat } = await loadCreds();
  const CHUNK = 6; // keep ADO happy; these run against one org with one PAT
  const out: (PrOutcome | null)[] = [];
  for (let i = 0; i < prUrls.length; i += CHUNK) {
    // Keyed per pull request rather than per batch: the funnel asks about
    // overlapping sets as the range filter changes, and a batch-shaped key
    // would miss on every one of them.
    const batch = prUrls.slice(i, i + CHUNK).map((url): Promise<PrOutcome | null> =>
      cached(`${ADO_CACHE_PREFIX}prOutcome:${org}:${url}`, TTL.prOutcome, async () => {
      const ref = refFromPrUrl(url);
      if (!ref) return null;
      try {
        const raw = await adoGet<RawPullRequest>(`${repoBaseUrl(org, ref)}/pullrequests/${ref.prId}?${API}`, pat);
        const status = (raw.status ?? "").toLowerCase();
        const threads = await adoGet<{ value?: RawThread[] }>(
          `${repoBaseUrl(org, ref)}/pullrequests/${ref.prId}/threads?${API}`,
          pat
        );
        // threadContext is only present on threads anchored to a file — i.e. real
        // review comments, not ADO's own vote/status system threads.
        const reviewComments = (threads.value ?? []).filter(
          (th) => th.threadContext && (th.comments ?? []).some((c) => !c.isDeleted && c.commentType !== "system")
        ).length;
        return { merged: status === "completed", abandoned: status === "abandoned", reviewComments };
      } catch {
        return null;
      }
      })
    );
    out.push(...(await Promise.all(batch)));
  }
  return out;
}

// ---- Commits tab ----

type RawCommitRef = {
  commitId: string;
  comment?: string;
  author?: { name?: string; date?: string };
};

/** List every commit on the PR's source branch, newest first (as ADO returns them). */
export async function getPullRequestCommits(ticketId: string, fallbackPrUrl?: string | null): Promise<CommitSummary[]> {
  const creds = await loadCreds();
  const { org, pat, project } = creds;
  const ref = await getLinkedPullRequestRef(creds, ticketId, fallbackPrUrl);
  if (!ref) return [];

  return cached(`${ADO_CACHE_PREFIX}commits:${org}:${ref.repositoryId}:${ref.prId}`, TTL.commits, async () => {
  const data = await adoGet<{ value?: RawCommitRef[] }>(`${repoBaseUrl(org, ref)}/pullrequests/${ref.prId}/commits?${API}`, pat);
  return (data.value ?? []).map((c) => ({
    sha: c.commitId,
    shortSha: c.commitId.slice(0, 7),
    message: (c.comment ?? "").split(/\r?\n/)[0],
    author: c.author?.name ?? "Unknown",
    date: c.author?.date ?? "",
    url: `https://dev.azure.com/${org}/${encodeURIComponent(ref.project ?? project)}/_git/${ref.repositoryId}/commit/${c.commitId}`,
  }));
  });
}

type RawCommitChange = { item?: { path?: string; isFolder?: boolean }; changeType?: string };
type RawCommitDetail = { parents?: string[] };

const COMMIT_CHANGE_TYPE: Record<string, CommitFile["changeType"]> = {
  add: "added",
  delete: "deleted",
};

function commitChangeType(raw: string): CommitFile["changeType"] {
  if (COMMIT_CHANGE_TYPE[raw]) return COMMIT_CHANGE_TYPE[raw];
  if (raw.toLowerCase().includes("rename")) return "renamed";
  return "modified";
}

/** Fetch raw file content at a given commit, or null if the path didn't exist there. */
async function adoGetItemText(org: string, pat: string, ref: PrRef, path: string, sha: string): Promise<string | null> {
  const url = `${repoBaseUrl(org, ref)}/items?path=${encodeURIComponent(
    path
  )}&versionDescriptor.version=${sha}&versionDescriptor.versionType=commit&${API}&$format=text`;
  const res = await fetch(url, { headers: authHeader(pat), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ADO ${res.status} ${res.statusText} — ${url}`);
  return res.text();
}

const MAX_COMMIT_FILES = 60; // guard against pathological commits touching hundreds of files

/** Per-file changes for one commit, each with a unified diff built from before/after content. */
export async function getCommitFileChanges(ticketId: string, sha: string, fallbackPrUrl?: string | null): Promise<CommitFile[]> {
  const creds = await loadCreds();
  const { org, pat } = creds;
  const ref = await getLinkedPullRequestRef(creds, ticketId, fallbackPrUrl);
  if (!ref) return [];

  // Held for a day rather than a minute: a commit's own file changes cannot be
  // rewritten in place — a different diff is a different sha, and therefore a
  // different key. Only the *list* of commits moves, and that is `commits:`.
  return cached(`${ADO_CACHE_PREFIX}commitFiles:${org}:${ref.repositoryId}:${sha}`, TTL.commitFiles, async () => {
  const [changesData, detail] = await Promise.all([
    adoGet<{ changes?: RawCommitChange[] }>(`${repoBaseUrl(org, ref)}/commits/${sha}/changes?${API}`, pat),
    adoGet<RawCommitDetail>(`${repoBaseUrl(org, ref)}/commits/${sha}?${API}`, pat),
  ]);
  const parentSha = detail.parents?.[0];

  const files = (changesData.changes ?? []).filter((c) => c.item?.path && !c.item.isFolder).slice(0, MAX_COMMIT_FILES);
  const results: CommitFile[] = [];
  for (const c of files) {
    const path = c.item!.path!;
    const changeType = commitChangeType(c.changeType ?? "edit");
    const [oldContent, newContent] = await Promise.all([
      changeType === "added" || !parentSha ? Promise.resolve(null) : adoGetItemText(org, pat, ref, path, parentSha).catch(() => null),
      changeType === "deleted" ? Promise.resolve(null) : adoGetItemText(org, pat, ref, path, sha).catch(() => null),
    ]);
    const { diff, additions, deletions } = buildUnifiedDiff(path, oldContent, newContent);
    results.push({ path, changeType, diff, additions, deletions });
  }
  return results;
  });
}

// ---- release: taking a finished pull request out of draft ----
//
// The three writes below are what "hand this ticket to a reviewer" actually
// means at the provider, and they are deliberately three separate exported calls
// rather than one `release()`. They fail independently — publishing a draft can
// succeed while resolving a reviewer's identity does not — and the caller
// records each outcome on its own column, because a single success/failure flag
// for three writes is wrong in both directions.
//
// Every one of them is safe to call twice. A release that half-succeeded is
// retried, and a retry must not be a second event for the reviewer.

/** Is this pull request still a draft? `null` when the PR cannot be read at all,
 *  which the caller must not confuse with "already published". */
export async function isPullRequestDraft(prUrl: string): Promise<boolean | null> {
  const creds = await loadCreds();
  // The shortest TTL in the table: this gates a release, and the answer flips
  // exactly once per pull request. `publishPullRequest` drops the key itself,
  // so the window only ever covers somebody publishing outside the app.
  return cached(`${ADO_CACHE_PREFIX}prDraft:${creds.org}:${prUrl}`, TTL.prDraft, async () => {
    const found = await quickPullRequest(creds, prUrl);
    if (!found) return null;
    return !!(found.raw as { isDraft?: boolean }).isDraft;
  });
}

/**
 * Publish a draft pull request.
 *
 * This is the moment the reviewer is notified, so it is the moment the work
 * becomes visible — everything before it is the agent working ahead in private.
 * Already-published is a success, not an error: the caller is retrying a
 * half-finished release, and refusing here would strand it forever.
 */
export async function publishPullRequest(prUrl: string): Promise<{ ok: boolean; detail: string }> {
  const creds = await loadCreds();
  const found = await quickPullRequest(creds, prUrl);
  if (!found) return { ok: false, detail: "The pull request could not be read at Azure DevOps." };
  if (!(found.raw as { isDraft?: boolean }).isDraft) {
    return { ok: true, detail: "Already published." };
  }
  await adoSend(
    `${repoBaseUrl(creds.org, found.ref)}/pullrequests/${found.ref.prId}?${API}`,
    "PATCH",
    { isDraft: false },
    "application/json",
    creds.pat
  );
  await invalidatePullRequests(creds.org);
  return { ok: true, detail: "Draft published." };
}

type RawIdentity = { id?: string; providerDisplayName?: string; properties?: { Account?: { $value?: string } } };

/**
 * Resolve an email or display name to the identity id ADO needs to add a
 * reviewer.
 *
 * Reviewers are configured as email addresses because that is what a developer
 * knows; ADO wants a GUID. The lookup lives on a different host (`vssps`) and a
 * PAT without Identity read scope simply fails it — which is why the caller
 * treats a failed resolution as "reviewers not set" and says so, rather than
 * failing the whole release. The draft is published either way; a missing
 * reviewer is a message, not a reason to hide finished work.
 */
async function resolveIdentityId(org: string, pat: string, query: string): Promise<string | null> {
  const url = `https://vssps.dev.azure.com/${org}/_apis/identities?searchFilter=General&filterValue=${encodeURIComponent(
    query
  )}&${API}`;
  // A miss is cached as null too: an unresolvable reviewer is asked for on every
  // release attempt, and re-asking vssps each time only slows the retry down.
  return cached(
    `${ADO_CACHE_PREFIX}identity:${org}:${query.trim().toLowerCase()}`,
    TTL.identity,
    async () => {
      try {
        const res = await adoGet<{ value?: RawIdentity[] }>(url, pat);
        const rows = res.value ?? [];
        const wanted = query.trim().toLowerCase();
        const exact = rows.find(
          (r) => (r.properties?.Account?.$value ?? "").toLowerCase() === wanted
        );
        return (exact ?? rows[0])?.id ?? null;
      } catch {
        return null;
      }
    }
  );
}

/**
 * Add reviewers to a pull request.
 *
 * `PUT .../reviewers/{id}` is idempotent at ADO — adding somebody who is already
 * a reviewer is a no-op rather than a second notification — which is what makes
 * a half-finished release safe to retry.
 *
 * Returns which queries could not be resolved rather than throwing on the first
 * one: three reviewers where one has left the company should still get the other
 * two, and should say who was missed.
 */
export async function addPullRequestReviewers(
  prUrl: string,
  reviewers: string[]
): Promise<{ ok: boolean; added: string[]; unresolved: string[]; detail: string }> {
  const creds = await loadCreds();
  const found = await quickPullRequest(creds, prUrl);
  if (!found) {
    return { ok: false, added: [], unresolved: reviewers, detail: "The pull request could not be read at Azure DevOps." };
  }
  const added: string[] = [];
  const unresolved: string[] = [];
  for (const who of reviewers) {
    const id = await resolveIdentityId(creds.org, creds.pat, who);
    if (!id) { unresolved.push(who); continue; }
    try {
      await adoSend(
        `${repoBaseUrl(creds.org, found.ref)}/pullrequests/${found.ref.prId}/reviewers/${id}?${API}`,
        "PUT",
        { vote: 0, isRequired: false },
        "application/json",
        creds.pat
      );
      added.push(who);
    } catch {
      unresolved.push(who);
    }
  }
  if (added.length) await invalidatePullRequests(creds.org);
  return {
    ok: unresolved.length === 0,
    added,
    unresolved,
    detail: unresolved.length
      ? `Could not add: ${unresolved.join(", ")}. The token may lack Identity (Read) scope.`
      : `Added ${added.length} reviewer(s).`,
  };
}

// ---- The pull-request inbox (notification bell) ----

/** One page of the organization-wide listing. ADO caps a page well below this,
 *  so the value is a ceiling on the request rather than a promise about it. */
const PR_PAGE = 100;

/** How many pull requests the bell will look at, across pages. An organization
 *  with more active pull requests than this is one where the answer "which of
 *  these needs me" cannot be had from a listing at all, and it is better to
 *  stop at a known bound than to walk a hundred pages on a timer. */
const PR_SCAN_CAP = 300;

type RawInboxReviewer = { uniqueName?: string; displayName?: string; vote?: number };
type RawInboxPullRequest = {
  pullRequestId: number;
  title?: string;
  isDraft?: boolean;
  mergeStatus?: string;
  createdBy?: { uniqueName?: string; displayName?: string };
  reviewers?: RawInboxReviewer[];
  repository?: { name?: string; webUrl?: string; project?: { name?: string } };
};

/** A team reviewer's "unique name" is a `vstfs:///…` descriptor, not an
 *  address. Treated as no email at all, so identity matching cannot pair a
 *  person with a group that happens to contain them. */
function reviewerEmail(raw: RawInboxReviewer): string {
  const u = (raw.uniqueName ?? "").trim();
  return u.startsWith("vstfs:///") ? "" : u;
}

/**
 * Every active pull request in the organization, in one listing.
 *
 * This is the cheap half of the bell. The listing is **org-wide and
 * project-less** — verified against a live organization, where the project-less
 * route returns pull requests across every project while the per-project route
 * has to be asked once per project — and it already carries each reviewer's
 * vote, the draft flag and the merge status. So "which pull requests need me"
 * costs one round-trip whatever the board on screen is, instead of one per
 * ticket like the review-comment half.
 *
 * Filtering is left to the caller on purpose. ADO's own `creatorId` /
 * `reviewerId` criteria take an identity GUID, and this app cannot get one for
 * the account it knows the developer as: an identity lookup by that email
 * returns nothing under a normal PAT, and the GUID the PAT itself authenticates
 * as is a *different* account whenever the connection's `identityEmail` names
 * the person as their client's organization spells them. Matching on
 * email-then-name is the same rule `isMine()` already applies to work items.
 */
export async function listActivePullRequests(): Promise<PullRequestBrief[]> {
  const { org, pat } = await loadCreds();
  return cached(`${ADO_CACHE_PREFIX}activePrs:${org}`, TTL.activePullRequests, async () => {
  const out: PullRequestBrief[] = [];
  for (let skip = 0; skip < PR_SCAN_CAP; skip += PR_PAGE) {
    const url =
      `https://dev.azure.com/${org}/_apis/git/pullrequests` +
      `?searchCriteria.status=active&$top=${PR_PAGE}&$skip=${skip}&${API}`;
    const page = await adoGet<{ value?: RawInboxPullRequest[] }>(url, pat);
    const rows = page.value ?? [];
    for (const raw of rows) {
      out.push({
        id: String(raw.pullRequestId),
        url: prWebUrl(org, raw.repository?.project?.name ?? "", raw as RawPullRequest),
        title: raw.title ?? "",
        repo: raw.repository?.name ?? "",
        isDraft: raw.isDraft === true,
        mergeStatus: raw.mergeStatus ?? "",
        authorEmail: (raw.createdBy?.uniqueName ?? "").trim(),
        authorName: (raw.createdBy?.displayName ?? "").trim(),
        reviewers: (raw.reviewers ?? []).map((r) => ({
          email: reviewerEmail(r),
          name: (r.displayName ?? "").trim(),
          vote: r.vote ?? 0,
        })),
      });
    }
    // A short page is the last page. Checked against the requested size rather
    // than against a count field, which this endpoint does not promise.
    if (rows.length < PR_PAGE) break;
  }
  return out;
  });
}

// ---- Recent work-item activity (notification bell) ----

/** How many work items one poll will read comments for. The watermark keeps the
 *  normal answer at nought or a handful; this is the ceiling for the first poll
 *  after a restart, or a day somebody bulk-edited a sprint. */
const ACTIVITY_ITEM_CAP = 40;

/** Newest comments read per work item. A work item that collected more than this
 *  in one polling interval is having a conversation, not producing
 *  notifications, and the newest are the ones worth naming. */
const ACTIVITY_COMMENT_TOP = 10;

/**
 * The identity GUID Azure DevOps knows this connection as.
 *
 * `connectionData` answers it in one call with no extra scope, which matters
 * because the alternatives do not work: an identity lookup by email returns
 * nothing under an ordinary PAT.
 *
 * It is only returned when the authenticated account is the one the connection
 * says the developer is. A personal access token belonging to somebody else is
 * a misconfiguration, and reporting *their* mentions as yours would be a
 * confident wrong answer — so this returns null and mention detection goes
 * quiet instead.
 */
async function authenticatedIdentityId(org: string, pat: string, identity: DevIdentity): Promise<string | null> {
  const data = await adoGet<{
    authenticatedUser?: { id?: string; providerDisplayName?: string; properties?: { Account?: { $value?: string } } };
  }>(`https://dev.azure.com/${org}/_apis/connectionData?api-version=7.0-preview`, pat);
  const me = data.authenticatedUser;
  if (!me?.id) return null;
  const account = me.properties?.Account?.$value ?? "";
  const display = me.providerDisplayName ?? "";
  return isSamePerson(account, display, identity) ? me.id : null;
}

type RawWiqlResult = { workItems?: { id: number }[] };

async function wiqlIds(org: string, pat: string, query: string): Promise<string[]> {
  const data = await adoSend<RawWiqlResult>(
    `https://dev.azure.com/${org}/_apis/wit/wiql?${API}`,
    "POST",
    { query },
    "application/json",
    pat
  );
  return (data.workItems ?? []).map((w) => String(w.id));
}

type RawActivityComment = {
  id?: number;
  createdDate?: string;
  createdBy?: { uniqueName?: string; displayName?: string };
  mentions?: { targetId?: string }[];
};

/**
 * Comments that landed on the developer's work — or named them — since `since`.
 *
 * The shape of this is a watermark, and that is the whole point. Reading every
 * ticket's comments on a timer costs one round-trip per ticket forever; asking
 * "which work items changed at all" costs **two**, whatever the sprint holds,
 * and on a quiet interval the answer is none and nothing else is read.
 *
 * The two queries are different questions and both are needed. `AssignedTo`
 * finds new comments on the developer's own tickets. `System.History CONTAINS`
 * finds the ones that named them on somebody *else's* ticket — the case an
 * assignment filter cannot see, and the reason a mention is worth a
 * notification at all.
 *
 * Comments the developer wrote themselves are dropped: they were there.
 */
export async function listRecentTicketActivity(since: string, identity: DevIdentity): Promise<TicketActivity[]> {
  const { org, pat } = await loadCreds();
  const day = since.slice(0, 10);
  const mine = identity.email
    ? `SELECT [System.Id] FROM WorkItems WHERE [System.ChangedDate] >= '${day}' AND [System.AssignedTo] = '${identity.email.replace(/'/g, "''")}'`
    : "";
  const named = identity.name
    ? `SELECT [System.Id] FROM WorkItems WHERE [System.ChangedDate] >= '${day}' AND [System.History] CONTAINS '${identity.name.replace(/'/g, "''")}'`
    : "";

  const [myIdentityId, mineIds, namedIds] = await Promise.all([
    authenticatedIdentityId(org, pat, identity).catch(() => null),
    mine ? wiqlIds(org, pat, mine) : Promise.resolve([]),
    named ? wiqlIds(org, pat, named) : Promise.resolve([]),
  ]);

  const ids = [...new Set([...mineIds, ...namedIds])].slice(0, ACTIVITY_ITEM_CAP);
  if (!ids.length) return [];

  // The comments endpoint is project-scoped and nothing upstream carries the
  // project: a WIQL result names only ids, and the connection's own project is
  // the wrong answer anyway — a mention can land on a work item in a project
  // this connection was never pointed at. One batch read settles all of them.
  const batch = await adoGet<{ value?: { id: number; fields?: Record<string, string> }[] }>(
    `https://dev.azure.com/${org}/_apis/wit/workitems?ids=${ids.join(",")}&fields=System.TeamProject&${API}`,
    pat
  );
  const projectOf = new Map(
    (batch.value ?? []).map((w) => [String(w.id), w.fields?.["System.TeamProject"] ?? ""])
  );

  const cutoff = Date.parse(since);
  const perItem = await Promise.allSettled(
    ids.map(async (id) => {
      const project = projectOf.get(id);
      // A work item the batch could not place is one this token cannot read.
      // Asking for its comments would build `.../org//_apis/...`, which Azure
      // DevOps answers with a sign-in page rather than a 404.
      if (!project) return [];
      const url =
        `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/wit/workItems/${id}` +
        `/comments?api-version=7.0-preview.3&$top=${ACTIVITY_COMMENT_TOP}&order=desc`;
      const data = await adoGet<{ comments?: RawActivityComment[] }>(url, pat);
      const out: TicketActivity[] = [];
      for (const c of data.comments ?? []) {
        if (!c.id || !c.createdDate) continue;
        if (Date.parse(c.createdDate) <= cutoff) continue;
        if (isSamePerson(c.createdBy?.uniqueName ?? "", c.createdBy?.displayName ?? "", identity)) continue;
        out.push({
          ticketId: id,
          commentId: String(c.id),
          at: c.createdDate,
          authorName: c.createdBy?.displayName ?? "",
          // Without a trustworthy identity GUID this stays false, so such a
          // comment is reported as an ordinary one rather than as a mention.
          mentionsMe: myIdentityId ? (c.mentions ?? []).some((m) => m.targetId === myIdentityId) : false,
        });
      }
      return out;
    })
  );

  // A work item that cannot be read — deleted, or in a project this token does
  // not reach — costs its own notification, not the whole poll.
  return perItem.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
