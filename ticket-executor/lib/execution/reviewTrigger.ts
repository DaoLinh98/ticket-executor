// Whether one scanned pull request is asking for work, as a pure function.
//
// This lives on its own rather than inline in the scheduler for the reason
// invariant 4 gives: a guard that cannot be exercised is a guard nobody can
// trust. Every input is a value the scan already holds, so the whole decision is
// checkable without a database, a provider, or a Claude turn — the same bargain
// the edges and the release calendar make.

/** What one row knows about its own review before the scan is weighed. */
export type ReviewRowState = {
  /** The newest open comment this plan has already acted on. */
  lastCommentAt: string;
  /** How many times this ticket has been round the fix loop. */
  reviewRounds: number;
};

/** What the provider said about it, from `loadReviewsSummary`. */
export type ReviewScan = {
  unresolvedCount: number;
  /** ISO timestamp of the newest open comment, or "" when there is none. */
  latestAt: string;
  /** Whether that newest open comment was written by us. */
  mine: boolean;
  /** Whether a reviewer has approved the pull request. */
  approved: boolean;
};

export type ReviewVerdict =
  /** Start a run. */
  | { act: "run"; advanceTo: string }
  /** Nothing new. `advanceTo` is set when the watermark should move anyway —
   *  which is how our own reply stops being re-read every scan. */
  | { act: "wait"; advanceTo: string; reason: string };

/**
 * Decide what to do about one scanned pull request.
 *
 * The trap this exists to avoid: `unresolvedCount > 0` looks like the trigger
 * and is not. The fix-code-review skill deliberately leaves threads open — a
 * finding it judged invalid, out of scope, or needing a human decision gets a
 * reply and keeps its status — so a *successful* run ends with open threads. A
 * scheduler triggering on the count would start again immediately, reply on top
 * of its own replies, and do it on somebody's pull request where nothing can be
 * withdrawn.
 *
 * So the trigger is a **new comment by somebody else**, in that order:
 *
 *   - nothing open at all -> nothing to do;
 *   - the ceiling is reached -> stop asking, whatever is open;
 *   - the newest open comment is not newer than the watermark -> already weighed;
 *   - the newest open comment is ours -> a reply, not a request. The watermark
 *     advances past it so it is never weighed again, and *this is the branch
 *     that closes the loop*;
 *   - otherwise a reviewer has said something new.
 */
export function reviewVerdict(row: ReviewRowState, scan: ReviewScan, maxRounds: number): ReviewVerdict {
  if (scan.unresolvedCount <= 0) return { act: "wait", advanceTo: "", reason: "nothing-open" };
  if (scan.approved) return { act: "wait", advanceTo: "", reason: "approved" };
  if (row.reviewRounds >= maxRounds) return { act: "wait", advanceTo: "", reason: "max-rounds" };
  const seen = /^\d{4}-/.test(row.lastCommentAt) ? row.lastCommentAt : "";
  if (!scan.latestAt || scan.latestAt <= seen) {
    return { act: "wait", advanceTo: "", reason: "no-new-comments" };
  }
  if (scan.mine) return { act: "wait", advanceTo: scan.latestAt, reason: "own-reply" };
  return { act: "run", advanceTo: scan.latestAt };
}
