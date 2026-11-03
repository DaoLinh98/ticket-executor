// The daily work report, as text.
//
// The format is not this app's invention: a line is exactly what Azure DevOps'
// "Copy to clipboard" button puts on the clipboard for a work item —
// `{type} {id}: {title}` — which is how the report was written by hand before
// this page existed. Reproducing it from the three fields the ticket already
// carries is why no extra provider call is needed here.
//
// Pure and Prisma-free, like `sprintPlan.ts`: the output is pasted into a chat
// group unread, so the part worth asserting is the text itself.

import type { Ticket } from "./types";

/** The progress values a Today line may carry. Percentages and lane names sit in
 *  one list because that is how the report reads them — "what state is it in" —
 *  and the report is the only consumer. */
export const PROGRESS_OPTIONS = [
  "20%",
  "40%",
  "50%",
  "60%",
  "80%",
  "100%",
  "Code Review",
  "In QA",
  "Done",
  "Review ticket",
  "Investigate ticket",
  "Support testing",
  "Fix issues",
  "Update ACs",
] as const;

export type Progress = (typeof PROGRESS_OPTIONS)[number];

/**
 * The two halves of the report, ticked independently rather than chosen between:
 * a ticket worked on today and not finished is carried into tomorrow, and it has
 * to appear in both sections to say so. Tomorrow never carries progress — it is
 * a statement of intent, not of state.
 */
export type ReportEntry = {
  today: boolean;
  tomorrow: boolean;
  progress: string;
  /** Repeat this ticket under `Comments:`. */
  comment: boolean;
  /** Repeat this ticket under `Blocks:`. */
  block: boolean;
};

/** Whether this entry is in the report at all. `Comments:` and `Blocks:` speak
 *  about work the report already names, so neither can carry a ticket that
 *  appears in neither section. */
export function isListed(e: ReportEntry): boolean {
  return e.today || e.tomorrow;
}

/**
 * Everything the page holds for one day, and the whole of what is persisted.
 *
 * Keyed by ticket id rather than kept as a list so a ticket that leaves the
 * sprint simply stops being rendered instead of leaving a hole — and so an entry
 * survives being unticked, which is what makes a mis-click cost nothing.
 */
export type ReportDraftState = {
  name: string;
  /** The lines that are not work items, keyed by `REPORT_TASKS` id. Fixed
   *  rather than free text: they are the only recurring non-ticket entries
   *  this report carries. */
  tasks: Record<ReportTaskId, { today: boolean; tomorrow: boolean }>;
  entries: Record<string, ReportEntry>;
  /** Tickets the developer searched for and added by hand — work that is not
   *  assigned to them (pairing, support) but belongs in today's report. */
  manual?: Ticket[];
  /** Assigned tickets the developer dismissed from this day's report. */
  hidden?: string[];
  edited?: { text: string; base: string };
};

export const REPORT_TASKS = [
  { id: "sprintPlanning", label: "Sprint planning" },
  { id: "fixBugs", label: "Fix bugs (if any)" },
  { id: "focusQa", label: "Focus on QA tickets" },
] as const;

export type ReportTaskId = (typeof REPORT_TASKS)[number]["id"];

export function emptyTasks(): ReportDraftState["tasks"] {
  return Object.fromEntries(
    REPORT_TASKS.map((t) => [t.id, { today: false, tomorrow: false }])
  ) as ReportDraftState["tasks"];
}

export function emptyDraft(name = ""): ReportDraftState {
  return { name, tasks: emptyTasks(), entries: {} };
}

export function defaultEntry(ticket: Ticket): ReportEntry {
  return {
    today: false,
    tomorrow: false,
    progress: defaultProgress(ticket),
    comment: false,
    block: false,
  };
}

/**
 * The progress a ticket's own lane implies, so opening the page is already
 * nearly the answer. The board column wins over the state: a board maps several
 * states onto one column, and the column is what the team says out loud.
 */
export function defaultProgress(ticket: Ticket): string {
  const s = (ticket.boardColumn || ticket.status || "").trim().toLowerCase();
  if (["done", "closed", "completed", "resolved"].includes(s)) return "Done";
  if (["code review", "in code review", "in review", "review", "peer review"].includes(s))
    return "Code Review";
  if (["in qa", "ready for qa", "qa", "testing"].includes(s)) return "In QA";
  return "50%";
}

/** The line Azure DevOps' copy button produces. */
export function ticketLine(ticket: Pick<Ticket, "id" | "type" | "title">): string {
  return `${ticket.type} ${ticket.id}: ${ticket.title}`;
}

/** `YYYY-MM-DD` as the report heads its date: `21/09/2026`. */
export function formatReportDay(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : day;
}

function section(lines: string[], indent: string): string {
  const body = lines.length ? lines : ["None"];
  return body.map((l) => `${indent}- ${l}`).join("\n");
}

/**
 * The whole report, ready to paste.
 *
 * Ticket order is the order handed in — the page shows the same list, so what is
 * read on screen is what lands in the chat group.
 */
export function buildReport(opts: {
  day: string;
  name: string;
  tickets: Ticket[];
  draft: ReportDraftState;
}): string {
  const { day, name, tickets, draft } = opts;

  const chosen = tickets
    .map((t) => ({ ticket: t, entry: draft.entries[String(t.id)] }))
    .filter((r): r is { ticket: Ticket; entry: ReportEntry } => !!r.entry && isListed(r.entry));

  const today: string[] = [];
  const tomorrow: string[] = [];
  for (const task of REPORT_TASKS) {
    if (draft.tasks[task.id]?.today) today.push(task.label);
    if (draft.tasks[task.id]?.tomorrow) tomorrow.push(task.label);
  }

  for (const { ticket, entry } of chosen) {
    const line = ticketLine(ticket);
    if (entry.today) today.push(entry.progress ? `${line} - ${entry.progress}` : line);
    if (entry.tomorrow) tomorrow.push(line);
  }

  const comments = chosen.filter((r) => r.entry.comment).map((r) => ticketLine(r.ticket));
  const blocks = chosen.filter((r) => r.entry.block).map((r) => ticketLine(r.ticket));

  return [
    `Report ${formatReportDay(day)} of ${name}`,
    " 1. Today",
    section(today, "  "),
    " 2. Tomorrow",
    section(tomorrow, "  "),
    "Comments:",
    section(comments, " "),
    "Blocks:",
    section(blocks, " "),
    "Thanks",
  ].join("\n");
}
