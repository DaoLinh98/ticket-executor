// Ownership of a ticket **over the sprint**, as opposed to ownership right now.
//
// `identity.ts` answers "is this ticket assigned to me", which is a question
// about this instant. It is the wrong question for a sprint report. A ticket
// finished on Tuesday and handed to QA on Wednesday stops being assigned to the
// developer, and a sprint defined as "what is assigned to me" therefore shrinks
// every time the developer succeeds at something — by the end of a good sprint
// it reports almost no work at all.
//
// So the sprint is the set of tickets that were **ever** the developer's, and
// each one carries how that claim stands today. The evidence for "was mine" is
// deliberately not the tracker's revision history: reading it costs one API call
// per work item on every page load. It is the app's own record — a plan row, a
// run, a pull request it opened — which is free, already durable, and answers a
// better question anyway. "I did the work" is the reason a ticket belongs on the
// developer's sprint report; "it still bears my name" never was.
//
// Pure and Prisma-free, like `identity.ts` and `sprintPlan.ts`: the caller
// gathers the evidence, this module decides what it means.

import { isMine, type DevIdentity } from "@/lib/identity";
import type { Ticket } from "@/lib/types";

/**
 * - `mine` — still assigned to the developer. Counts everywhere, including
 *   against the hours they have left.
 * - `handed-off` — no longer theirs, but the app has evidence they did the work.
 *   Counts as delivered; costs no remaining capacity, because it is somebody
 *   else's turn.
 * - `dropped` — no longer theirs and never touched. A genuine scope change, so
 *   it counts nowhere; the row is kept only so the change is visible rather than
 *   silent.
 */
export type Claim = "mine" | "handed-off" | "dropped";

/** What the app remembers about a ticket from an earlier read of this sprint —
 *  one `PlannedTicket` row, reduced to the fields the rule needs. */
export type Remembered = {
  ticketId: string;
  title: string;
  points: number;
  estimateHours: number;
  /** Did the app do work on this ticket: a run started, a pull request opened,
   *  a release performed. Gathered by the caller from the plan row *and* the Run
   *  table — a ticket run by hand has no plan progress but is still worked. */
  worked: boolean;
};

export type ClaimedTicket = {
  ticket: Ticket;
  claim: Claim;
  /** Who holds it now, when that is somebody else. Empty while it is still the
   *  developer's, and empty when the ticket has left the sprint entirely — in
   *  that case there is no live row to read an assignee from. */
  assigneeNow: string;
  /** True when the ticket is no longer in the sprint and this row was rebuilt
   *  from the plan. Its `status` is unknown and must not be trusted. */
  fromPlan: boolean;
};

export function claimOf(live: Ticket | undefined, identity: DevIdentity, worked: boolean): Claim {
  if (live && isMine(live, identity)) return "mine";
  return worked ? "handed-off" : "dropped";
}

/**
 * A ticket that has left the sprint but was worked still has to appear on the
 * report, and there is no provider row left to show. This rebuilds the little
 * the plan knows.
 *
 * `status` is empty on purpose rather than guessed. An empty status lands in the
 * `todo` lane, which would be a lie about a ticket that is finished — so callers
 * must not lane a `fromPlan` row, and `summarize()` does not: a `handed-off`
 * ticket never reaches the capacity arithmetic.
 */
function stubFromPlan(r: Remembered): Ticket {
  return {
    id: r.ticketId,
    title: r.title,
    type: "",
    status: "",
    assignee: "",
    project: "",
    areaPath: "",
    url: "",
    storyPoints: r.points || undefined,
    estimateHours: r.estimateHours || undefined,
  };
}

/**
 * The developer's sprint: everything the tracker says is theirs now, plus
 * everything the app remembers was theirs, each labelled with where it stands.
 *
 * `live` is the whole team's sprint, not a pre-filtered one — the rule needs to
 * see a ticket that is still in the iteration under somebody else's name in
 * order to tell "handed to QA" from "moved to the next sprint".
 */
export function claimSprint(
  live: Ticket[],
  remembered: Remembered[],
  identity: DevIdentity
): ClaimedTicket[] {
  const liveById = new Map(live.map((t) => [String(t.id), t]));
  const out: ClaimedTicket[] = [];
  const seen = new Set<string>();

  for (const r of remembered) {
    const id = String(r.ticketId);
    seen.add(id);
    const ticket = liveById.get(id);
    const claim = claimOf(ticket, identity, r.worked);
    out.push({
      ticket: ticket ?? stubFromPlan(r),
      claim,
      assigneeNow: ticket && claim !== "mine" ? ticket.assignee : "",
      fromPlan: !ticket,
    });
  }

  // Tickets assigned to the developer that the plan has never seen — work that
  // landed on them mid-sprint. Appended rather than merged: a sprint that only
  // ever shrank would be as wrong as one that only ever grew.
  for (const ticket of live) {
    if (seen.has(String(ticket.id)) || !isMine(ticket, identity)) continue;
    out.push({ ticket, claim: "mine", assigneeNow: "", fromPlan: false });
  }

  return out;
}
