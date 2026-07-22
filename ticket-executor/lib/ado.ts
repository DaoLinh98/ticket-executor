import type { Ticket, TicketComment, ReviewData, ReviewComment, PullRequestOverview, CommitSummary, CommitFile } from "./types";
import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";
import { buildUnifiedDiff } from "./diffText";

const API = "api-version=7.0";

// Org / project / PAT are per-provider DB-backed credentials (Settings modal),
// not env vars. Re-fetched at the top of every exported function below.
let ORG = "";
let PROJECT = "";
let PAT = "";

export type AdoCreds = { org: string; project: string; pat: string };

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

function decodeSegment(s: string | undefined): string {
  if (!s) return "";
  try {
    return decodeURIComponent(s).trim();
  } catch {
    return s.trim();
  }
}

/** Saved Azure DevOps credentials, or null when the connection isn't configured yet. */
export async function adoCreds(): Promise<AdoCreds | null> {
  const c = await prisma.providerCredential.findUnique({ where: { provider: "azure-devops" } });
  const { org, project } = parseAdoUrl(c?.org);
  const pat = decryptSecret(c?.pat);
  return org && project && pat ? { org, project, pat } : null;
}

async function loadCreds(): Promise<void> {
  const c = await adoCreds();
  if (!c) {
    throw new Error(
      "Azure DevOps is not configured — set the project URL (e.g. https://dev.azure.com/your-org/your-project) and a personal access token in Settings."
    );
  }
  ORG = c.org;
  PROJECT = c.project;
  PAT = c.pat;
}

function authHeader(): Record<string, string> {
  const b64 = Buffer.from(":" + PAT).toString("base64");
  return { Authorization: "Basic " + b64 };
}

async function adoGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeader(), cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ADO ${res.status} ${res.statusText} — ${url}\n${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function adoSend(url: string, method: string, body: unknown, contentType: string): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: { ...authHeader(), "Content-Type": contentType },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ADO ${res.status} ${res.statusText} — ${url}\n${text.slice(0, 300)}`);
  }
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

/** Split acceptance-criteria HTML into individual lines. */
function htmlToLines(html: string): string[] {
  return htmlToText(html)
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((l) => l.length > 0);
}

function lastAreaSegment(areaPath: string): string {
  if (!areaPath) return "";
  const parts = areaPath.split("\\");
  const last = parts[parts.length - 1].trim();
  // If the area is just the project root (no sub-area), treat it as no project.
  return last === PROJECT ? "" : last;
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
export async function listIterations(): Promise<IterationInfo[]> {
  await loadCreds();
  // No team segment: ADO falls back to the project's default team, so the user
  // only has to configure the project URL.
  const url = `https://dev.azure.com/${ORG}/${encodeURIComponent(
    PROJECT
  )}/_apis/work/teamsettings/iterations?${API}`;
  const data = await adoGet<{ value: RawIteration[] }>(url);
  return data.value.map((i) => ({
    id: i.id,
    name: i.name,
    timeFrame: i.attributes?.timeFrame,
    startDate: i.attributes?.startDate,
    finishDate: i.attributes?.finishDate,
  }));
}

/** Resolve which iteration to load: an explicit override name, else ADO's current iteration. */
async function resolveIteration(sprintOverride?: string): Promise<IterationInfo> {
  const iterations = await listIterations();
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
  sprintOverride?: string
): Promise<{ tickets: Ticket[]; sprintName: string }> {
  await loadCreds();
  const iteration = await resolveIteration(sprintOverride);

  const wiUrl = `https://dev.azure.com/${ORG}/${encodeURIComponent(
    PROJECT
  )}/_apis/work/teamsettings/iterations/${iteration.id}/workitems?${API}`;
  const rel = await adoGet<WorkItemRelations>(wiUrl);
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
  ].join(",");

  // Work-item batch GET is capped at 200 ids; chunk to be safe.
  const tickets: Ticket[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const batchUrl = `https://dev.azure.com/${ORG}/_apis/wit/workitems?ids=${chunk.join(
      ","
    )}&fields=${fields}&${API}`;
    const det = await adoGet<{ value: WorkItemDetail[] }>(batchUrl);
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
        project: lastAreaSegment(area) || (process.env.CLAUDE_DEFAULT_PROJECT ?? ""),
        description: htmlToText((f["System.Description"] as string) ?? ""),
        criteria: htmlToLines(
          (f["Microsoft.VSTS.Common.AcceptanceCriteria"] as string) ?? ""
        ),
        url: `https://dev.azure.com/${ORG}/${encodeURIComponent(PROJECT)}/_workitems/edit/${f["System.Id"]}`,
      });
    }
  }

  // Keep ADO's board order roughly stable by id.
  return { tickets, sprintName: iteration.name };
}

type RawWorkItemState = { name: string };

/** Real workflow states for a work item type (e.g. "Bug", "User Story"), as configured by this project's process template — not a hard-coded guess. */
export async function getWorkItemTypeStates(type: string): Promise<string[]> {
  await loadCreds();
  const url = `https://dev.azure.com/${ORG}/${encodeURIComponent(
    PROJECT
  )}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=7.1-preview.1`;
  const data = await adoGet<{ value: RawWorkItemState[] }>(url);
  return data.value.map((s) => s.name);
}

/** Write the work item's State field back to Azure DevOps. */
export async function updateWorkItemState(id: string, state: string): Promise<void> {
  await loadCreds();
  const url = `https://dev.azure.com/${ORG}/_apis/wit/workitems/${encodeURIComponent(id)}?${API}`;
  await adoSend(url, "PATCH", [{ op: "add", path: "/fields/System.State", value: state }], "application/json-patch+json");
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
  await loadCreds();
  const url = `https://dev.azure.com/${ORG}/_apis/wit/workitems/${encodeURIComponent(
    id
  )}?fields=System.WorkItemType&${API}`;
  const data = await adoGet<{ fields?: { "System.WorkItemType"?: string } }>(url);
  const type = data.fields?.["System.WorkItemType"];
  if (!type) return null;
  const states = await getWorkItemTypeStates(type);

  const want = desired.trim().toLowerCase();
  const exact = states.find((s) => s.toLowerCase() === want);
  if (exact) return exact;

  const wantWords = want.split(/\s+/).filter(Boolean);
  const byWord = states.find((s) => {
    const sw = s.toLowerCase();
    return wantWords.some((w) => sw.includes(w));
  });
  return byWord ?? null;
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
export async function getWorkItemComments(id: string): Promise<TicketComment[]> {
  await loadCreds();
  // Comments live behind a preview API version.
  const url = `https://dev.azure.com/${ORG}/${encodeURIComponent(
    PROJECT
  )}/_apis/wit/workItems/${encodeURIComponent(id)}/comments?api-version=7.0-preview.3`;
  const data = await adoGet<{ comments?: RawComment[] }>(url);
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
function repoBaseUrl(ref: { repositoryId: string; project?: string }): string {
  const projectSegment = ref.project ? `${encodeURIComponent(ref.project)}/` : "";
  return `https://dev.azure.com/${ORG}/${projectSegment}_apis/git/repositories/${encodeURIComponent(ref.repositoryId)}`;
}

/** The repo's own project name, if the ref resolves to an accessible repo. */
async function resolveRepositoryProject(ref: { repositoryId: string; project?: string }): Promise<string | null> {
  const res = await fetch(`${repoBaseUrl(ref)}?${API}`, { headers: authHeader(), cache: "no-store" });
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
async function getLinkedPullRequestRef(ticketId: string, fallbackPrUrl?: string | null): Promise<PrRef | null> {
  const url = `https://dev.azure.com/${ORG}/_apis/wit/workitems/${encodeURIComponent(
    ticketId
  )}?$expand=relations&${API}`;
  const data = await adoGet<{ relations?: ArtifactRelation[] }>(url);
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
      if (m) candidates.push({ repositoryId: decodeURIComponent(m[1]), prId: m[2], project: PROJECT });
    }
  }
  for (const ref of candidates) {
    const project = await resolveRepositoryProject(ref);
    if (project) return { ...ref, project };
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
  repository?: { name?: string };
};

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
  await loadCreds();
  const ref = await getLinkedPullRequestRef(ticketId, fallbackPrUrl);
  if (!ref) return { pr: null, comments: [], unresolvedCount: 0 };

  const raw = await adoGet<RawPullRequest>(`${repoBaseUrl(ref)}/pullrequests/${ref.prId}?${API}`);
  const pr: PullRequestOverview = {
    id: String(raw.pullRequestId),
    url: `https://dev.azure.com/${ORG}/${encodeURIComponent(ref.project ?? PROJECT)}/_git/${encodeURIComponent(
      raw.repository?.name ?? ""
    )}/pullrequest/${raw.pullRequestId}`,
    title: raw.title ?? "",
    status: prStatusLabel(raw),
    branch: (raw.sourceRefName ?? "").replace(/^refs\/heads\//, ""),
    targetBranch: (raw.targetRefName ?? "").replace(/^refs\/heads\//, ""),
    author: raw.createdBy?.displayName ?? "Unknown",
    reviewers: (raw.reviewers ?? []).map((r) => r.displayName ?? "").filter(Boolean),
    createdAt: raw.creationDate ?? "",
  };

  const threadsData = await adoGet<{ value?: RawThread[] }>(`${repoBaseUrl(ref)}/pullrequests/${ref.prId}/threads?${API}`);
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

// ---- Commits tab ----

type RawCommitRef = {
  commitId: string;
  comment?: string;
  author?: { name?: string; date?: string };
};

/** List every commit on the PR's source branch, newest first (as ADO returns them). */
export async function getPullRequestCommits(ticketId: string, fallbackPrUrl?: string | null): Promise<CommitSummary[]> {
  await loadCreds();
  const ref = await getLinkedPullRequestRef(ticketId, fallbackPrUrl);
  if (!ref) return [];

  const data = await adoGet<{ value?: RawCommitRef[] }>(`${repoBaseUrl(ref)}/pullrequests/${ref.prId}/commits?${API}`);
  return (data.value ?? []).map((c) => ({
    sha: c.commitId,
    shortSha: c.commitId.slice(0, 7),
    message: (c.comment ?? "").split(/\r?\n/)[0],
    author: c.author?.name ?? "Unknown",
    date: c.author?.date ?? "",
    url: `https://dev.azure.com/${ORG}/${encodeURIComponent(ref.project ?? PROJECT)}/_git/${ref.repositoryId}/commit/${c.commitId}`,
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
async function adoGetItemText(ref: PrRef, path: string, sha: string): Promise<string | null> {
  const url = `${repoBaseUrl(ref)}/items?path=${encodeURIComponent(
    path
  )}&versionDescriptor.version=${sha}&versionDescriptor.versionType=commit&${API}&$format=text`;
  const res = await fetch(url, { headers: authHeader(), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ADO ${res.status} ${res.statusText} — ${url}`);
  return res.text();
}

const MAX_COMMIT_FILES = 60; // guard against pathological commits touching hundreds of files

/** Per-file changes for one commit, each with a unified diff built from before/after content. */
export async function getCommitFileChanges(ticketId: string, sha: string, fallbackPrUrl?: string | null): Promise<CommitFile[]> {
  await loadCreds();
  const ref = await getLinkedPullRequestRef(ticketId, fallbackPrUrl);
  if (!ref) return [];

  const [changesData, detail] = await Promise.all([
    adoGet<{ changes?: RawCommitChange[] }>(`${repoBaseUrl(ref)}/commits/${sha}/changes?${API}`),
    adoGet<RawCommitDetail>(`${repoBaseUrl(ref)}/commits/${sha}?${API}`),
  ]);
  const parentSha = detail.parents?.[0];

  const files = (changesData.changes ?? []).filter((c) => c.item?.path && !c.item.isFolder).slice(0, MAX_COMMIT_FILES);
  const results: CommitFile[] = [];
  for (const c of files) {
    const path = c.item!.path!;
    const changeType = commitChangeType(c.changeType ?? "edit");
    const [oldContent, newContent] = await Promise.all([
      changeType === "added" || !parentSha ? Promise.resolve(null) : adoGetItemText(ref, path, parentSha).catch(() => null),
      changeType === "deleted" ? Promise.resolve(null) : adoGetItemText(ref, path, sha).catch(() => null),
    ]);
    const { diff, additions, deletions } = buildUnifiedDiff(path, oldContent, newContent);
    results.push({ path, changeType, diff, additions, deletions });
  }
  return results;
}
