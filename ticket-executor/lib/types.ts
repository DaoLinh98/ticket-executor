export type Ticket = {
  id: string; // ADO work item id (string)
  title: string;
  type: string; // User Story | Bug | Task | Feature | ...
  status: string; // ADO state, e.g. "In Progress"
  assignee: string;
  assigneeEmail?: string; // used to match Settings' personalAccount in "personal" scope
  project: string; // last segment of area path, or default project
  areaPath: string;
  // The provider's iteration path, verbatim ("Project\Release 1\Sprint 67", or
  // just "Project" for an item nobody has scheduled). Kept raw rather than
  // reduced to a sprint name because "which iteration" and "is it scheduled at
  // all" are both read off it, and the second question needs the whole path.
  // Absent for providers with no iteration concept.
  iterationPath?: string;
  // Both fields are **sanitized HTML**, not plain text: a provider stores them as
  // rich text and real tickets use it (nested numbered criteria, bold terms,
  // links, pasted screenshots). Flattening them to lines lost the structure the
  // requirement was written in. Producers must pass provider HTML through
  // `sanitizeHtml()` (lib/richText.ts) — never assign raw provider markup here.
  //
  // `undefined` means *not loaded yet*, which is not the same claim as an empty
  // description: a provider that carries the text in its list response (GitHub)
  // fills both in, and one that does not (Azure DevOps) leaves them absent until
  // the ticket is opened. The distinction is what tells the UI whether to fetch.
  description?: string;
  criteria?: string; // acceptance criteria, as one rich-text block
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

// The reactions this app offers. Azure DevOps stores six kinds; a developer
// reading a ticket wants to acknowledge a comment, not grade it, so only the
// two affirmative ones are surfaced.
export const REACTION_KINDS = ["like", "heart"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export type TicketReaction = {
  kind: ReactionKind;
  count: number;
  mine: boolean; // the PAT owner is one of the engaged users
};

export type TicketComment = {
  id: string; // the provider's comment id — what a reaction write addresses
  author: string;
  date: string; // short human date, e.g. "Jul 2"
  text: string; // sanitized HTML, like Ticket.description — render with RichText
  reactions: TicketReaction[];
};

// A person a comment can @mention. `id` is the provider's identity id — what the
// stored mention points at, so the tracker notifies them.
export type MentionCandidate = {
  id: string;
  name: string;
  email: string;
};

// Where a run is. This is the whole answer — there is deliberately no separate
// phase/planStatus pair to keep consistent with it; which *node* the run sits on
// carries that, and the node comes from the graph.
//   waiting — parked on the account's usage limit, or held for human review
//             after a crash on an external node. No child process is alive.
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
  | "needs-review"
  // Not an ending at all while the run is `waiting`: the account this machine is
  // logged in as ran out of quota mid-node, and the run holds here until
  // `resumeAt`. It only *ends* under this reason when the ceiling on those parks
  // is reached, which is a run a person has to look at.
  | "rate-limited";

export type LogLine = { text: string; kind: string };

// One file touched by a run, with its unified diff against the base commit the
// worktree started from — powers the Result tab's file-change diff popup.
export type FileChange = {
  path: string;
  changeType: "added" | "modified" | "deleted" | "renamed";
  diff: string;
};

export type KnowledgeChange = { file: string; added: string[]; removed: string[]; lines: number };

export const KNOWLEDGE_MAX_LINES = 200;

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
  approved: boolean;
};

/** One reviewer's standing on a pull request. `vote` is the provider's own
 *  scale, not a normalized one — see `VOTE` in `lib/notifications.ts`. */
export type PullRequestReviewer = {
  /** Empty for a *team* reviewer, which carries a `vstfs:///…` descriptor
   *  instead of an address. A person added only through a team therefore cannot
   *  be matched by identity. */
  email: string;
  name: string;
  vote: number;
};

/**
 * A pull request as it arrives from a whole-organization listing — enough to
 * decide whether it needs the developer, without a second read per PR.
 *
 * Deliberately not `PullRequestOverview`: that type is the Resolve Review tab's
 * detail view of *one* PR resolved from a work item, and it flattens reviewers
 * to display names, which is exactly the information a vote check needs.
 */
export type PullRequestBrief = {
  id: string;
  url: string;
  title: string;
  repo: string;
  isDraft: boolean;
  /** Provider's own value; "conflicts" is the one this app acts on. */
  mergeStatus: string;
  authorEmail: string;
  authorName: string;
  reviewers: PullRequestReviewer[];
};

/**
 * One comment that landed on a work item recently — the bell's "somebody said
 * something about your work" source.
 *
 * Carries no comment text on purpose. The bell names the ticket and gets the
 * developer to it; the conversation itself is the provider's page, one click
 * away, and copying it into a header dropdown means rendering somebody's HTML.
 */
export type TicketActivity = {
  ticketId: string;
  /** The provider's comment id — stable, so the same comment is never reported
   *  twice and read state survives a re-poll. */
  commentId: string;
  at: string; // ISO
  authorName: string;
  /** Was the developer @mentioned in it? */
  mentionsMe: boolean;
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
  at?: string;
  automated?: boolean;
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
  latestIso: string;
  latestAutomated: boolean;
  approved: boolean;
  prStatus: string;
};
