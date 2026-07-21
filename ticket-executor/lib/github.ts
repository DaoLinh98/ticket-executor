import type {
  CommitFile,
  CommitSummary,
  PullRequestOverview,
  ReviewComment,
  ReviewData,
  Ticket,
} from "./types";

// Parse "https://github.com/owner/repo" (or ".../owner/repo/...") into owner+repo.
export function parseRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2)
      return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    /* fall through */
  }
  return null;
}

type GhLabel = { name: string };
type GhUser = { login: string };
type GhIssue = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: (GhLabel | string)[];
  assignee: GhUser | null;
  pull_request?: unknown;
};

function labelNames(labels: (GhLabel | string)[]): string[] {
  return labels
    .map((l) => (typeof l === "string" ? l : l.name))
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

// Original-case label names (status extraction needs to preserve the text after the prefix).
function rawLabelNames(labels: (GhLabel | string)[]): string[] {
  return labels
    .map((l) => (typeof l === "string" ? l : l.name))
    .filter(Boolean);
}

function titleCase(s: string): string {
  return s.replace(
    /\w\S*/g,
    (w) => w[0].toUpperCase() + w.slice(1).toLowerCase(),
  );
}

function typeFromLabels(labels: string[]): string {
  if (labels.some((l) => l.includes("bug"))) return "Bug";
  if (labels.some((l) => l.includes("feature") || l.includes("enhancement")))
    return "Feature";
  if (labels.some((l) => l.includes("epic"))) return "Epic";
  return "Issue";
}

// GitHub issues have no native workflow-state field, only open/closed — so a repo-configured
// "status: X" label (a common GitHub convention) is the only honest source for a richer status.
// Falls back to the native open/closed state when the repo doesn't use that convention.
const STATUS_LABEL_PREFIX = /^status:\s*/i;

function statusFromIssue(state: string, rawLabels: string[]): string {
  const statusLabel = rawLabels.find((l) => STATUS_LABEL_PREFIX.test(l));
  if (statusLabel)
    return titleCase(statusLabel.replace(STATUS_LABEL_PREFIX, "").trim());
  return state === "closed" ? "Done" : "Todo";
}

// Pull acceptance-criteria-style checklist items out of the issue body.
function criteriaFromBody(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*[-*]\s*\[[ xX]\]\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => m[1].trim());
}

// Parse "https://github.com/owner/repo/pull/123" into owner+repo+number.
function parsePrUrl(
  url: string,
): { owner: string; repo: string; number: number } | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("pull");
    if (i >= 2 && parts[i + 1]) {
      const number = Number(parts[i + 1]);
      if (Number.isFinite(number))
        return {
          owner: parts[0],
          repo: parts[1].replace(/\.git$/, ""),
          number,
        };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function shortDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function prStatusLabel(state: string, merged: boolean): string {
  if (merged) return "Completed";
  if (state === "CLOSED") return "Abandoned";
  return "Active";
}

type GhReviewThreadComment = {
  id: string;
  body: string;
  path: string | null;
  line: number | null;
  createdAt: string;
  author: { login: string } | null;
};

type GhPullRequestNode = {
  number: number;
  title: string;
  url: string;
  state: string;
  merged: boolean;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  author: { login: string } | null;
  reviews: { nodes: Array<{ author: { login: string } | null }> };
  reviewThreads: {
    nodes: Array<{
      isResolved: boolean;
      comments: { nodes: GhReviewThreadComment[] };
    }>;
  };
};

const PR_REVIEW_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        number
        title
        url
        state
        merged
        headRefName
        baseRefName
        createdAt
        author { login }
        reviews(first: 20) { nodes { author { login } } }
        reviewThreads(first: 100) {
          nodes {
            isResolved
            comments(first: 1) {
              nodes { id body path line createdAt author { login } }
            }
          }
        }
      }
    }
  }
`;

// PR-level review overview for a ticket: given the PR URL recorded on its most
// recent execution, fetch the PR + its review-thread resolution state. Uses
// GraphQL because the REST API does not expose whether a review thread is resolved.
export async function getGithubPullRequestReview(
  prUrl: string,
  token: string,
): Promise<ReviewData> {
  const ref = parsePrUrl(prUrl);
  if (!ref) return { pr: null, comments: [], unresolvedCount: 0 };

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: PR_REVIEW_QUERY,
      variables: { owner: ref.owner, repo: ref.repo, number: ref.number },
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(
      `GitHub ${res.status} ${res.statusText} — ${t.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as {
    data?: { repository?: { pullRequest?: GhPullRequestNode | null } };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length)
    throw new Error(json.errors.map((e) => e.message).join("; "));
  const raw = json.data?.repository?.pullRequest;
  if (!raw) return { pr: null, comments: [], unresolvedCount: 0 };

  const pr: PullRequestOverview = {
    id: String(raw.number),
    url: raw.url,
    title: raw.title ?? "",
    status: prStatusLabel(raw.state, raw.merged),
    branch: raw.headRefName ?? "",
    targetBranch: raw.baseRefName ?? "",
    author: raw.author?.login ?? "Unknown",
    reviewers: [
      ...new Set(
        (raw.reviews.nodes ?? [])
          .map((r) => r.author?.login ?? "")
          .filter(Boolean),
      ),
    ],
    createdAt: raw.createdAt ?? "",
  };

  const comments: ReviewComment[] = [];
  (raw.reviewThreads.nodes ?? []).forEach((th, i) => {
    const first = th.comments.nodes[0];
    if (!first) return;
    comments.push({
      id: first.id,
      threadId: i,
      author: first.author?.login ?? "Unknown",
      text: first.body,
      filePath: first.path ?? undefined,
      line: first.line ?? undefined,
      status: th.isResolved ? "resolved" : "open",
      date: shortDate(first.createdAt),
    });
  });

  return {
    pr,
    comments,
    unresolvedCount: comments.filter((c) => c.status === "open").length,
  };
}

type GhCommitListNode = {
  sha: string;
  html_url: string;
  commit: { message: string; author?: { name?: string; date?: string } };
  author?: { login?: string } | null;
};

// ---- Commits tab ----

/** List every commit on the PR's source branch, oldest first (as GitHub returns them). */
export async function getGithubPullRequestCommits(
  prUrl: string,
  token: string,
): Promise<CommitSummary[]> {
  const ref = parsePrUrl(prUrl);
  if (!ref) return [];
  const res = await fetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/commits?per_page=100`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as GhCommitListNode[];
  return data.map((c) => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: c.commit.message.split(/\r?\n/)[0],
    author: c.commit.author?.name ?? c.author?.login ?? "Unknown",
    date: c.commit.author?.date ?? "",
    url: c.html_url,
  }));
}

type GhCommitFileNode = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
};

const GH_CHANGE_TYPE: Record<string, CommitFile["changeType"]> = {
  added: "added",
  removed: "deleted",
  renamed: "renamed",
};

/** Per-file changes for one commit — GitHub's commit API already returns a text patch per file. */
export async function getGithubCommitFiles(
  prUrl: string,
  sha: string,
  token: string,
): Promise<CommitFile[]> {
  const ref = parsePrUrl(prUrl);
  if (!ref) return [];
  const res = await fetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/commits/${sha}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { files?: GhCommitFileNode[] };
  return (data.files ?? []).map((f) => ({
    path: f.filename,
    changeType: GH_CHANGE_TYPE[f.status] ?? "modified",
    diff: f.patch ? `--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}` : "",
    additions: f.additions,
    deletions: f.deletions,
  }));
}

export async function getGithubIssues(
  repoUrl: string,
  token: string,
): Promise<Ticket[]> {
  const parsed = parseRepo(repoUrl);
  if (!parsed)
    throw new Error(`Could not parse a GitHub owner/repo from "${repoUrl}".`);
  const { owner, repo } = parsed;

  const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(
      `GitHub ${res.status} ${res.statusText} — ${t.slice(0, 200)}`,
    );
  }
  const issues = (await res.json()) as GhIssue[];
  return issues
    .filter((i) => !i.pull_request) // the issues endpoint also returns PRs
    .map((i) => {
      const labels = labelNames(i.labels);
      return {
        id: String(i.number),
        title: i.title ?? "",
        type: typeFromLabels(labels),
        status: statusFromIssue(i.state, rawLabelNames(i.labels)),
        assignee: i.assignee?.login ?? "Unassigned",
        areaPath: `${owner}/${repo}`,
        project: repo,
        description: (i.body ?? "").trim(),
        criteria: criteriaFromBody(i.body ?? ""),
        url: `https://github.com/${owner}/${repo}/issues/${i.number}`,
      } satisfies Ticket;
    });
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// The repo's real "status: X" labels (see statusFromIssue above) — empty when the repo
// doesn't use that convention, so the UI can gracefully fall back to open/closed only.
export async function getGithubStatusLabelOptions(
  repoUrl: string,
  token: string,
): Promise<string[]> {
  const parsed = parseRepo(repoUrl);
  if (!parsed)
    throw new Error(`Could not parse a GitHub owner/repo from "${repoUrl}".`);
  const { owner, repo } = parsed;
  const url = `https://api.github.com/repos/${owner}/${repo}/labels?per_page=100`;
  const res = await fetch(url, {
    headers: githubHeaders(token),
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(
      `GitHub ${res.status} ${res.statusText} — ${t.slice(0, 200)}`,
    );
  }
  const labels = (await res.json()) as GhLabel[];
  return labels
    .map((l) => l.name)
    .filter((n) => STATUS_LABEL_PREFIX.test(n))
    .map((n) => titleCase(n.replace(STATUS_LABEL_PREFIX, "").trim()));
}

// Swap the issue's "status: X" label for the new one — a real write to GitHub, not a
// local-only override. Other labels (type, etc.) are left untouched.
export async function updateGithubIssueStatus(
  repoUrl: string,
  token: string,
  issueNumber: string,
  newStatus: string,
): Promise<void> {
  const parsed = parseRepo(repoUrl);
  if (!parsed)
    throw new Error(`Could not parse a GitHub owner/repo from "${repoUrl}".`);
  const { owner, repo } = parsed;
  const headers = githubHeaders(token);
  const issueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
  const getRes = await fetch(issueUrl, { headers, cache: "no-store" });
  if (!getRes.ok) {
    const t = await getRes.text().catch(() => "");
    throw new Error(
      `GitHub ${getRes.status} ${getRes.statusText} — ${t.slice(0, 200)}`,
    );
  }
  const issue = (await getRes.json()) as GhIssue;
  const otherLabels = rawLabelNames(issue.labels).filter(
    (l) => !STATUS_LABEL_PREFIX.test(l),
  );
  const patchRes = await fetch(issueUrl, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ labels: [...otherLabels, `status: ${newStatus}`] }),
  });
  if (!patchRes.ok) {
    const t = await patchRes.text().catch(() => "");
    throw new Error(
      `GitHub ${patchRes.status} ${patchRes.statusText} — ${t.slice(0, 200)}`,
    );
  }
}

// ---- GitHub Projects (v2) "Status" field — the real Todo/In Progress/Done board ----
// An issue can be linked to a classic Projects v2 board; that board's built-in "Status"
// single-select field is the canonical Todo/In Progress/Done workflow GitHub itself
// surfaces in its UI (unlike the "status: X" label convention above, which is a
// community workaround for repos with no Project at all). We discover the linked
// project via the issue itself (GraphQL `projectItems`), so no separate project
// number/URL needs to be configured in Settings.

type GhProjectV2FieldOption = { id: string; name: string };
type GhProjectV2ItemNode = {
  id: string; // the project item id (needed for the update mutation)
  project: { id: string; title: string };
  fieldValueByName: {
    optionId?: string;
    field: { id: string; options: GhProjectV2FieldOption[] };
  } | null;
};

const PROJECT_STATUS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 10) {
          nodes {
            id
            project { id title }
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                optionId
                field {
                  ... on ProjectV2SingleSelectField {
                    id
                    options { id name }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

async function githubGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(
      `GitHub ${res.status} ${res.statusText} — ${t.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data as T;
}

// The first linked Projects v2 board that has a "Status" single-select field —
// null if the issue isn't on any project board (or the board has no Status field).
async function getIssueProjectStatusItem(
  repoUrl: string,
  token: string,
  issueNumber: string,
): Promise<{ projectId: string; itemId: string; fieldId: string; options: GhProjectV2FieldOption[]; current?: string } | null> {
  const parsed = parseRepo(repoUrl);
  if (!parsed)
    throw new Error(`Could not parse a GitHub owner/repo from "${repoUrl}".`);
  const data = await githubGraphql<{
    repository?: { issue?: { projectItems: { nodes: GhProjectV2ItemNode[] } } };
  }>(token, PROJECT_STATUS_QUERY, {
    owner: parsed.owner,
    repo: parsed.repo,
    number: Number(issueNumber),
  });
  const nodes = data.repository?.issue?.projectItems.nodes ?? [];
  const withStatus = nodes.find((n) => n.fieldValueByName?.field?.options?.length);
  if (!withStatus || !withStatus.fieldValueByName) return null;
  return {
    projectId: withStatus.project.id,
    itemId: withStatus.id,
    fieldId: withStatus.fieldValueByName.field.id,
    options: withStatus.fieldValueByName.field.options,
    current: withStatus.fieldValueByName.optionId,
  };
}

// Real per-ticket status options: the linked Project v2 board's Status field options
// (Todo/In Progress/Done) when the issue is on a board, otherwise falling back to the
// "status: X" label convention.
export async function getGithubStatusOptions(
  repoUrl: string,
  token: string,
  issueNumber: string,
): Promise<string[]> {
  const projectItem = await getIssueProjectStatusItem(repoUrl, token, issueNumber);
  if (projectItem) return projectItem.options.map((o) => o.name);
  return getGithubStatusLabelOptions(repoUrl, token);
}

const UPDATE_PROJECT_STATUS_MUTATION = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
      value: { singleSelectOptionId: $optionId }
    }) {
      clientMutationId
    }
  }
`;

// Writes the new status back to GitHub: updates the linked Project v2 board's Status
// field when the issue is on a board, otherwise falls back to the "status: X" label.
export async function updateGithubStatus(
  repoUrl: string,
  token: string,
  issueNumber: string,
  newStatus: string,
): Promise<void> {
  const projectItem = await getIssueProjectStatusItem(repoUrl, token, issueNumber);
  if (!projectItem) return updateGithubIssueStatus(repoUrl, token, issueNumber, newStatus);
  const option = projectItem.options.find((o) => o.name.toLowerCase() === newStatus.trim().toLowerCase());
  if (!option) throw new Error(`"${newStatus}" is not a valid Status option on this project board.`);
  await githubGraphql(token, UPDATE_PROJECT_STATUS_MUTATION, {
    projectId: projectItem.projectId,
    itemId: projectItem.itemId,
    fieldId: projectItem.fieldId,
    optionId: option.id,
  });
}
