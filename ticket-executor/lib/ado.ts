import type { Ticket, TicketComment, ReviewData, ReviewComment, PullRequestOverview, CommitSummary, CommitFile } from "./types";
import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";
import { buildUnifiedDiff } from "./diffText";
import { sanitizeHtml } from "./richText";

const API = "api-version=7.0";

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
  const c = await prisma.providerCredential.findUnique({ where: { provider: "azure-devops" } });
  const { org } = parseAdoUrl(c?.org);
  const pat = decryptSecret(c?.pat);
  return org && pat ? { org, pat } : null;
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
  return sanitizeHtml(html ?? "", {
    rewriteImageSrc: (src) =>
      /\/_apis\/wit\/attachments\//i.test(src) ? `/api/attachments?url=${encodeURIComponent(src)}` : src,
  });
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

function lastAreaSegment(areaPath: string, project: string): string {
  if (!areaPath) return "";
  const parts = areaPath.split("\\");
  const last = parts[parts.length - 1].trim();
  // If the area is just the project root (no sub-area), treat it as no project.
  return last === project ? "" : last;
}

export type ProjectInfo = { id: string; name: string; description?: string };

type RawProject = { id: string; name: string; description?: string };

/** All projects in the configured organization (org-level, no project segment). */
export async function listProjects(): Promise<ProjectInfo[]> {
  const { org, pat } = await loadCreds();
  const url = `https://dev.azure.com/${org}/_apis/projects?${API}`;
  const data = await adoGet<{ value: RawProject[] }>(url, pat);
  return data.value
    .map((p) => ({ id: p.id, name: p.name, description: p.description }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

/** Iterations for the project's default team (used to resolve the current sprint and to populate the sprint picker). */
export async function listIterations(project: string): Promise<IterationInfo[]> {
  const { org, pat, project: proj } = await loadCreds(project);
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

/** Fetch all tickets in a sprint, mapped to the UI Ticket shape. Defaults to ADO's current iteration. */
export async function getSprintTickets(
  project: string,
  sprintOverride?: string
): Promise<{ tickets: Ticket[]; sprintName: string }> {
  const { org, pat, project: proj } = await loadCreds(project);
  const iteration = await resolveIteration(project, sprintOverride);

  const wiUrl = `https://dev.azure.com/${org}/${encodeURIComponent(
    proj
  )}/_apis/work/teamsettings/iterations/${iteration.id}/workitems?${API}`;
  const rel = await adoGet<WorkItemRelations>(wiUrl, pat);
  const ids = Array.from(
    new Set(rel.workItemRelations.map((r) => r.target?.id).filter(Boolean) as number[])
  );
  if (ids.length === 0) return { tickets: [], sprintName: iteration.name };

  const fields = [
    "System.Id",
    "System.Title",
    "System.State",
    "System.WorkItemType",
    "System.AssignedTo",
    "System.AreaPath",
    "System.Description",
    "Microsoft.VSTS.Common.AcceptanceCriteria",
    "Microsoft.VSTS.Scheduling.OriginalEstimate",
    "Microsoft.VSTS.Scheduling.StoryPoints",
  ].join(",");

  // Work-item batch GET is capped at 200 ids; chunk to be safe.
  const tickets: Ticket[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const batchUrl = `https://dev.azure.com/${org}/_apis/wit/workitems?ids=${chunk.join(
      ","
    )}&fields=${fields}&${API}`;
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
        project: lastAreaSegment(area, proj) || (process.env.CLAUDE_DEFAULT_PROJECT ?? ""),
        description: htmlToRich((f["System.Description"] as string) ?? ""),
        criteria: htmlToRich((f["Microsoft.VSTS.Common.AcceptanceCriteria"] as string) ?? ""),
        url: `https://dev.azure.com/${org}/${encodeURIComponent(proj)}/_workitems/edit/${f["System.Id"]}`,
        estimateHours: numOrUndefined(f["Microsoft.VSTS.Scheduling.OriginalEstimate"]),
        storyPoints: numOrUndefined(f["Microsoft.VSTS.Scheduling.StoryPoints"]),
      });
    }
  }

  // Keep ADO's board order roughly stable by id.
  return { tickets, sprintName: iteration.name };
}

type RawWorkItemState = { name: string };

/** Real workflow states for a work item type (e.g. "Bug", "User Story"), as configured by this project's process template — not a hard-coded guess. */
export async function getWorkItemTypeStates(project: string, type: string): Promise<string[]> {
  const { org, pat, project: proj } = await loadCreds(project);
  const url = `https://dev.azure.com/${org}/${encodeURIComponent(
    proj
  )}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=7.1-preview.1`;
  const data = await adoGet<{ value: RawWorkItemState[] }>(url, pat);
  return data.value.map((s) => s.name);
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
export async function getWorkItemComments(project: string, id: string): Promise<TicketComment[]> {
  const { org, pat, project: proj } = await loadCreds(project);
  // Comments live behind a preview API version.
  const url = `https://dev.azure.com/${org}/${encodeURIComponent(
    proj
  )}/_apis/wit/workItems/${encodeURIComponent(id)}/comments?api-version=7.0-preview.3`;
  const data = await adoGet<{ comments?: RawComment[] }>(url, pat);
  return (data.comments ?? [])
    .map((c) => ({
      author: c.createdBy?.displayName ?? "Unknown",
      date: shortDate(c.createdDate),
      text: htmlToText(c.text ?? ""),
    }))
    .filter((c) => c.text.length > 0);
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
  const res = await fetch(`${repoBaseUrl(org, ref)}?${API}`, { headers: authHeader(pat), cache: "no-store" });
  if (!res.ok) return null;
  const repo = (await res.json()) as { project?: { name?: string } };
  return repo.project?.name ?? ref.project ?? null;
}

/**
 * Resolve the PR linked to a work item via its "Pull Request" artifact link
 * relation. ADO only creates that relation when the PR was explicitly linked
 * (e.g. `AB#<id>` in the PR description) — a PR opened by the execution
 * engine isn't guaranteed to have it. When it's missing, fall back to
 * parsing the repo/PR id out of the PR URL recorded on the ticket's most
 * recent execution.
 *
 * Each candidate ref is verified against the repositories API before use,
 * preferring the artifact link but falling through to the recorded PR URL
 * when it doesn't resolve — the artifact link's repository id can go stale
 * (repo renamed/recreated, or the id belongs to a repo the current PAT can't
 * see), which otherwise 404s every review/commit call for the ticket. The
 * fallback candidate also carries the project parsed out of its own URL
 * (rather than the globally configured PROJECT), since the ticket's repo may
 * not live in the project Settings happens to be connected to.
 */
async function getLinkedPullRequestRef(creds: Creds, ticketId: string, fallbackPrUrl?: string | null): Promise<PrRef | null> {
  const { org, pat, project } = creds;
  const url = `https://dev.azure.com/${org}/_apis/wit/workitems/${encodeURIComponent(
    ticketId
  )}?$expand=relations&${API}`;
  const data = await adoGet<{ relations?: ArtifactRelation[] }>(url, pat);
  const candidates: PrRef[] = [];
  for (const r of data.relations ?? []) {
    if (r.rel !== "ArtifactLink" || !r.url) continue;
    const m = r.url.match(/vstfs:\/\/\/Git\/PullRequestId\/[^%]+%2F([^%]+)%2F(\d+)/i);
    if (m) candidates.push({ repositoryId: m[1], prId: m[2] });
  }
  if (fallbackPrUrl) {
    const withProject = fallbackPrUrl.match(/dev\.azure\.com\/[^/]+\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/i);
    if (withProject) {
      candidates.push({ repositoryId: decodeURIComponent(withProject[2]), prId: withProject[3], project: decodeSegment(withProject[1]) });
    } else {
      const m = fallbackPrUrl.match(/_git\/([^/]+)\/pullrequest\/(\d+)/i);
      if (m) candidates.push({ repositoryId: decodeURIComponent(m[1]), prId: m[2], project });
    }
  }
  for (const ref of candidates) {
    const resolved = await resolveRepositoryProject(org, pat, ref);
    if (resolved) return { ...ref, project: resolved };
  }
  return null;
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

/** Fetch the PR (if any) linked to a work item, plus its review-comment threads. */
export async function getPullRequestReview(ticketId: string, fallbackPrUrl?: string | null): Promise<ReviewData> {
  const creds = await loadCreds();
  const { org, pat, project } = creds;
  const ref = await getLinkedPullRequestRef(creds, ticketId, fallbackPrUrl);
  if (!ref) return { pr: null, comments: [], unresolvedCount: 0 };

  const raw = await adoGet<RawPullRequest>(`${repoBaseUrl(org, ref)}/pullrequests/${ref.prId}?${API}`, pat);
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
    const batch = prUrls.slice(i, i + CHUNK).map(async (url): Promise<PrOutcome | null> => {
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
    });
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

  const data = await adoGet<{ value?: RawCommitRef[] }>(`${repoBaseUrl(org, ref)}/pullrequests/${ref.prId}/commits?${API}`, pat);
  return (data.value ?? []).map((c) => ({
    sha: c.commitId,
    shortSha: c.commitId.slice(0, 7),
    message: (c.comment ?? "").split(/\r?\n/)[0],
    author: c.author?.name ?? "Unknown",
    date: c.author?.date ?? "",
    url: `https://dev.azure.com/${org}/${encodeURIComponent(ref.project ?? project)}/_git/${ref.repositoryId}/commit/${c.commitId}`,
  }));
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
}
