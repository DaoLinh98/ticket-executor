export type Ticket = {
  id: string; // ADO work item id (string)
  title: string;
  type: string; // User Story | Bug | Task | Feature | ...
  status: string; // ADO state, e.g. "In Progress"
  assignee: string;
  assigneeEmail?: string; // used to match Settings' personalAccount in "personal" scope
  project: string; // last segment of area path, or default project
  areaPath: string;
  description: string; // plain text
  criteria: string[]; // acceptance criteria, one line each
  url: string; // deep link to the ticket in ADO/GitHub
  // The team's own sizing of this ticket, snapshotted onto a run so the dashboard
  // can compare "what we thought it would take" against what the agent spent.
  // Providers expose one, the other, or neither — the conversion from points to
  // hours is a setting, applied where the run is started, not here.
  estimateHours?: number;
  storyPoints?: number;
};

export type TicketComment = {
  author: string;
  date: string; // short human date, e.g. "Jul 2"
  text: string; // plain text (may contain @mentions and newlines)
};

// "awaiting-approval": the plan phase finished and the run is parked, holding no
// child process, until the user accepts / asks for changes / cancels the plan.
export type ExecStatus = "not started" | "running" | "awaiting-approval" | "completed" | "failed";

// Which half of a two-phase (implement-ticket-v3) run the entry is in.
export type ExecPhase = "plan" | "implement";

export type PlanStatus = "none" | "pending" | "approved" | "rejected";

export type LogLine = { text: string; kind: string };

// One file touched by a run, with its unified diff against the base commit the
// worktree started from — powers the Result tab's file-change diff popup.
export type FileChange = {
  path: string;
  changeType: "added" | "modified" | "deleted" | "renamed";
  diff: string;
};

export type Execution = {
  id: string;
  adoTicketId: string;
  projectName: string;
  skillName: string;
  model?: string;
  effort?: string;
  status: ExecStatus;
  command: string;
  logLines: LogLine[];
  resultText: string;
  errorMessage: string;
  filesChanged?: FileChange[];
  startedAt: string;
  completedAt: string | null;
};

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
