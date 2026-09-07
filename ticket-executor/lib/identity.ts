// Who the developer is inside one organization, and the one rule that answers
// "is this ticket mine".
//
// Pure and Prisma-free on purpose, the same reason `admission.ts` is: the rule
// is the part worth asserting, and asserting it must not need a database. The
// identity itself is stored per connection (`ProviderCredential.identityEmail`
// / `identityName`) and handed out by `resolveCredential()`.

import type { PullRequestBrief, Ticket } from "@/lib/types";

export type DevIdentity = {
  /** The account's email inside this organization. The reliable key. */
  email: string;
  /** Display name, for work items that carry no email. */
  name: string;
};

export const NO_IDENTITY: DevIdentity = { email: "", name: "" };

/** Whether this connection knows who the developer is at all. An identity with
 *  neither field is not a filter that matches nobody — it is the absence of a
 *  filter, and every caller must treat it that way. */
export function hasIdentity(identity: DevIdentity): boolean {
  return identity.email.length > 0 || identity.name.length > 0;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Is this ticket assigned to the developer?
 *
 * Email first, because it is the only value a provider guarantees is unique.
 * The display name is a fallback, not a second opinion: Azure DevOps returns
 * `assigneeEmail` for most work items but not all, and GitHub carries a login
 * with no email at all.
 *
 * With no identity configured this returns false for every ticket — deliberately
 * *not* true. A caller that wants "everything" must not call this; conflating
 * "no filter" with "matches all" here would make an unconfigured connection
 * silently schedule the whole team's sprint.
 */
export function isMine(ticket: Ticket, identity: DevIdentity): boolean {
  if (!hasIdentity(identity)) return false;
  const email = norm(identity.email);
  if (email && ticket.assigneeEmail && norm(ticket.assigneeEmail) === email) return true;
  const name = norm(identity.name);
  return name.length > 0 && norm(ticket.assignee) === name;
}

/** The developer's tickets out of a loaded list. Returns an empty list rather
 *  than the whole list when no identity is set — see `isMine`. */
export function mineOnly(tickets: Ticket[], identity: DevIdentity): Ticket[] {
  if (!hasIdentity(identity)) return [];
  return tickets.filter((t) => isMine(t, identity));
}

/** Whether a provider-supplied address/display-name pair refers to the
 *  developer. The same email-first, display-name-as-fallback rule `isMine()`
 *  applies to a work item's assignee, reused everywhere a provider names a
 *  person — pull request authors, reviewers, comment authors. Exported so the
 *  provider clients answer it the same way rather than each rolling their own. */
export function isSamePerson(email: string, name: string, identity: DevIdentity): boolean {
  if (!hasIdentity(identity)) return false;
  return matches(email, name, identity);
}

function matches(email: string, name: string, identity: DevIdentity): boolean {
  const wantEmail = norm(identity.email);
  if (wantEmail && email && norm(email) === wantEmail) return true;
  const wantName = norm(identity.name);
  return wantName.length > 0 && norm(name) === wantName;
}

/** Did the developer open this pull request? False for every pull request when
 *  no identity is configured — see `isMine`. */
export function isMyPullRequest(pr: PullRequestBrief, identity: DevIdentity): boolean {
  if (!hasIdentity(identity)) return false;
  return matches(pr.authorEmail, pr.authorName, identity);
}

/**
 * The developer's own vote on a pull request, or `null` if they are not a
 * reviewer on it.
 *
 * `null` and `0` are different answers and callers depend on it: `0` is "you
 * are on this pull request and have not voted", which is the whole reviewer
 * inbox, while `null` is "this is not yours to vote on".
 *
 * A reviewer added only through a *team* carries no address and, unless the
 * team's display name happens to be the developer's, does not match — so this
 * under-reports rather than claiming a vote nobody cast.
 */
export function myVoteOn(pr: PullRequestBrief, identity: DevIdentity): number | null {
  if (!hasIdentity(identity)) return null;
  const mine = pr.reviewers.find((r) => matches(r.email, r.name, identity));
  return mine ? mine.vote : null;
}
