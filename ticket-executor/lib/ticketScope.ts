/**
 * Which of the provider's three views the Ticket Execution screen is showing.
 *
 * Its own module, and a very small one, because both sides need it: the server
 * dispatch in `lib/tickets.ts` (which imports Prisma and can never reach a
 * client component) and the header's view switcher. This is the same reason
 * `lib/mcp.ts` was split out of `lib/providers.ts`.
 *
 * The three are **not** filters over one list. Each is a different question the
 * provider is asked, bounded differently:
 *
 * - `sprint`  — one iteration, closed items included: it is the record of what
 *               that sprint worked on.
 * - `backlog` — open work not scheduled into any iteration yet.
 * - `board`   — every open work item, whatever iteration it sits in, carrying
 *               the kanban column it is in.
 *
 * A backlog item and most of a board live outside the iteration the sprint
 * query is bounded by, so none of them can be derived from a sprint fetch on
 * this side. The scope travels to the hub, and the hub builds the query.
 */
export type TicketScope = "sprint" | "backlog" | "board";

export const TICKET_SCOPES: TicketScope[] = ["sprint", "backlog", "board"];

/** Header labels. Also the sidebar's list heading, so it reads as one word. */
export const SCOPE_LABEL: Record<TicketScope, string> = {
  sprint: "Sprint",
  backlog: "Backlog",
  board: "Board",
};

/** Anything unrecognised is the sprint — the view that existed before the other
 *  two and the one every caller that sends no scope means. */
export function normalizeScope(value: string | null | undefined): TicketScope {
  return TICKET_SCOPES.includes(value as TicketScope) ? (value as TicketScope) : "sprint";
}
