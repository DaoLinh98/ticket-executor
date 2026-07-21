import type { Ticket, TicketComment, ReviewData, ReviewComment, PullRequestOverview } from "./types";

const ORG = process.env.AZURE_DEVOPS_ORG ?? "";
const PROJECT = process.env.AZURE_DEVOPS_PROJECT ?? "";
const TEAM = process.env.AZURE_DEVOPS_TEAM ?? "";
const SPRINT = process.env.AZURE_DEVOPS_SPRINT ?? "";
const PAT = process.env.AZURE_DEVOPS_TOKEN ?? "";
const API = "api-version=7.0";

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

/** All team iterations (used to resolve the current sprint and to populate the sprint picker). */
export async function listIterations(): Promise<IterationInfo[]> {
  const url = `https://dev.azure.com/${ORG}/${encodeURIComponent(
    PROJECT
  )}/${encodeURIComponent(TEAM)}/_apis/work/teamsettings/iterations?${API}`;
  const data = await adoGet<{ value: RawIteration[] }>(url);
  return data.value.map((i) => ({
    id: i.id,
    name: i.name,
    timeFrame: i.attributes?.timeFrame,
    startDate: i.attributes?.startDate,
    finishDate: i.attributes?.finishDate,
  }));
}

/** Resolve which iteration to load: an explicit override name, else ADO's current iteration, else the env-configured fallback. */
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
  const fallback = iterations.find((i) => i.name === SPRINT);
  if (!fallback) throw new Error("No current sprint found among team iterations");
  return fallback;
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
  const iteration = await resolveIteration(sprintOverride);

  const wiUrl = `https://dev.azure.com/${ORG}/${encodeURIComponent(
    PROJECT
  )}/${encodeURIComponent(
    TEAM
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
  const url = `https://dev.azure.com/${ORG}/${encodeURIComponent(
    PROJECT
  )}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=7.1-preview.1`;
  const data = await adoGet<{ value: RawWorkItemState[] }>(url);
  return data.value.map((s) => s.name);
}

/** Write the work item's State field back to Azure DevOps. */
export async function updateWorkItemState(id: string, state: string): Promise<void> {
  const url = `https://dev.azure.com/${ORG}/_apis/wit/workitems/${encodeURIComponent(id)}?${API}`;
  await adoSend(url, "PATCH", [{ op: "add", path: "/fields/System.State", value: state }], "application/json-patch+json");
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

/** Resolve the PR linked to a work item via its "Pull Request" artifact link relation. */
async function getLinkedPullRequestRef(
  ticketId: string
): Promise<{ repositoryId: string; prId: string } | null> {
  const url = `https://dev.azure.com/${ORG}/_apis/wit/workitems/${encodeURIComponent(
    ticketId
  )}?$expand=relations&${API}`;
  const data = await adoGet<{ relations?: ArtifactRelation[] }>(url);
  for (const r of data.relations ?? []) {
    if (r.rel !== "ArtifactLink" || !r.url) continue;
    const m = r.url.match(/vstfs:\/\/\/Git\/PullRequestId\/[^%]+%2F([^%]+)%2F(\d+)/i);
    if (m) return { repositoryId: m[1], prId: m[2] };
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
export async function getPullRequestReview(ticketId: string): Promise<ReviewData> {
  const ref = await getLinkedPullRequestRef(ticketId);
  if (!ref) return { pr: null, comments: [], unresolvedCount: 0 };

  const prApiUrl = `https://dev.azure.com/${ORG}/${encodeURIComponent(
    PROJECT
  )}/_apis/git/repositories/${ref.repositoryId}/pullrequests/${ref.prId}?${API}`;
  const raw = await adoGet<RawPullRequest>(prApiUrl);
  const pr: PullRequestOverview = {
    id: String(raw.pullRequestId),
    url: `https://dev.azure.com/${ORG}/${encodeURIComponent(PROJECT)}/_git/${encodeURIComponent(
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

  const threadsUrl = `https://dev.azure.com/${ORG}/${encodeURIComponent(
    PROJECT
  )}/_apis/git/repositories/${ref.repositoryId}/pullrequests/${ref.prId}/threads?${API}`;
  const threadsData = await adoGet<{ value?: RawThread[] }>(threadsUrl);
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
