import type { PullRequestOverview, ReviewComment, ReviewData, Ticket } from "./types";

// Parse "https://github.com/owner/repo" (or ".../owner/repo/...") into owner+repo.
export function parseRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
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
  return labels.map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean).map((s) => s.toLowerCase());
}

function typeFromLabels(labels: string[]): string {
  if (labels.some((l) => l.includes("bug"))) return "Bug";
  if (labels.some((l) => l.includes("feature") || l.includes("enhancement"))) return "Feature";
  if (labels.some((l) => l.includes("epic"))) return "Epic";
  return "Issue";
}

// Map GitHub state/labels onto the app's status vocabulary so gating (#6) works.
function statusFromIssue(state: string, labels: string[]): string {
  if (labels.some((l) => l.includes("in progress") || l === "wip")) return "In Progress";
  if (labels.some((l) => l.includes("ready for dev") || l.includes("ready"))) return "Ready for Dev";
  if (labels.some((l) => l.includes("review"))) return "Code Review";
  return state === "closed" ? "Done" : "To Do";
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
function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("pull");
    if (i >= 2 && parts[i + 1]) {
      const number = Number(parts[i + 1]);
      if (Number.isFinite(number)) return { owner: parts[0], repo: parts[1].replace(/\.git$/, ""), number };
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
  reviewThreads: { nodes: Array<{ isResolved: boolean; comments: { nodes: GhReviewThreadComment[] } }> };
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
export async function getGithubPullRequestReview(prUrl: string, token: string): Promise<ReviewData> {
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
    throw new Error(`GitHub ${res.status} ${res.statusText} — ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: { repository?: { pullRequest?: GhPullRequestNode | null } }; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
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
    reviewers: [...new Set((raw.reviews.nodes ?? []).map((r) => r.author?.login ?? "").filter(Boolean))],
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

  return { pr, comments, unresolvedCount: comments.filter((c) => c.status === "open").length };
}

export async function getGithubIssues(repoUrl: string, token: string): Promise<Ticket[]> {
  const parsed = parseRepo(repoUrl);
  if (!parsed) throw new Error(`Could not parse a GitHub owner/repo from "${repoUrl}".`);
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
    throw new Error(`GitHub ${res.status} ${res.statusText} — ${t.slice(0, 200)}`);
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
        status: statusFromIssue(i.state, labels),
        assignee: i.assignee?.login ?? "Unassigned",
        areaPath: `${owner}/${repo}`,
        project: repo,
        description: (i.body ?? "").trim(),
        criteria: criteriaFromBody(i.body ?? ""),
      } satisfies Ticket;
    });
}
