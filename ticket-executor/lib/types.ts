export type Ticket = {
  id: string; // ADO work item id (string)
  title: string;
  type: string; // User Story | Bug | Task | Feature | ...
  status: string; // ADO state, e.g. "In Progress"
  assignee: string;
  assigneeEmail?: string; // used to match Settings' personalAccount in "personal" scope
  project: string; // last segment of area path, or default project
  areaPath: string;
  // Both fields are **sanitized HTML**, not plain text: a provider stores them as
  // rich text and real tickets use it (nested numbered criteria, bold terms,
  // links, pasted screenshots). Flattening them to lines lost the structure the
  // requirement was written in. Producers must pass provider HTML through
  // `sanitizeHtml()` (lib/richText.ts) — never assign raw provider markup here.
  description: string;
  criteria: string; // acceptance criteria, as one rich-text block
  url: string; // deep link to the ticket in ADO/GitHub
  // The team's own sizing of this ticket, snapshotted onto a run so the dashboard
  // can compare "what we thought it would take" against what the agent spent.
  // Providers expose one, the other, or neither — the conversion from points to
  // hours is a setting, applied where the run is started, not here.
  estimateHours?: number;
  storyPoints?: number;
  // The kanban column this item sits in, which is **not** its status: a board
  // maps several states onto one column and can carry custom ones, so a board
  // grouped by status draws a different board than the provider does. Absent for
  // a type that is not on a board (a Task, usually) and for providers that have
  // no board concept — the board view falls back to `status` there.
  boardColumn?: string;
};

export type TicketComment = {
  author: string;
  date: string; // short human date, e.g. "Jul 2"
  text: string; // plain text (may contain @mentions and newlines)
};

// Where a run is. This is the whole answer — there is deliberately no separate
// phase/planStatus pair to keep consistent with it; which *node* the run sits on
// carries that, and the node comes from the graph.
//   waiting — parked at a gate (or held for human review after a crash on an
//             external node). No child process is alive.
export type RunState = "running" | "waiting" | "succeeded" | "failed" | "cancelled";

/** RunState plus the one thing the engine has no opinion about: a ticket that
 *  has never been run. "No run" is the absence of a Run row, not a sixth state,
 *  so it exists only in the UI's vocabulary. */
export type UiRunState = RunState | "none";

/** Why a run ended somewhere other than plain success. `cancelled` and
 *  `plan-rejected` are human decisions and must never be scored as agent
 *  failures by anything computing a success rate. */
export type EndReason =
  | ""
  | "cancelled"
  | "plan-rejected"
  | "blocked"
  | "hop-limit"
  | "needs-review";

export type LogLine = { text: string; kind: string };

// One file touched by a run, with its unified diff against the base commit the
// worktree started from — powers the Result tab's file-change diff popup.
export type FileChange = {
  path: string;
  changeType: "added" | "modified" | "deleted" | "renamed";
  diff: string;
};

// The run's view model is not declared here: it is derived from the graph a run
// is walking, so it lives next to that code as `RunView` in
// lib/execution/queries.ts and reaches the UI through the API.

export type PullRequestOverview = {
  id: string;
  url: string;
  title: string;
  status: string; // Active | Approved | Changes requested | Completed | Abandoned
  branch: string;
  targetBranch: string;
  author: string;
  reviewers: string[];
  createdAt: string; // ISO
};

export type ReviewComment = {
  id: string;
  threadId: number;
  author: string;
  text: string;
  filePath?: string;
  line?: number;
  status: "open" | "resolved";
  date: string;
};

export type ReviewData = {
  pr: PullRequestOverview | null;
  comments: ReviewComment[];
  unresolvedCount: number;
};

// One commit on a PR's source branch — powers the Commits tab's list.
export type CommitSummary = {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string; // ISO
  url?: string;
};

// One file changed by a single commit, with its unified diff — powers the
// Commits tab's per-commit file-changes popup.
export type CommitFile = FileChange & { additions: number; deletions: number };

export type ReviewSummaryEntry = {
  ticketId: string;
  prId: string;
  prUrl: string;
  prTitle: string;
  reviewer: string;
  unresolvedCount: number;
  latestComment: string;
  latestAt: string;
};
