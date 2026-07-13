import type { Ticket } from "./types";

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
