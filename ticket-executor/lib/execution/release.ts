// Release: handing one finished ticket to a reviewer.
//
// **Why this is not a node.** A graph's `external` node is a leaf that runs once,
// at the end of the walk. Release happens hours or days *after* the walk ended —
// the run has already succeeded, the graph has already reached END. Modelling it
// as a node would mean keeping a run alive for three days waiting for a calendar,
// holding a worktree and a concurrency slot for work that is finished.
//
// It is also the only outward-facing action in the app that is genuinely safe to
// retry, and that is precisely because it is not a node: each of the three writes
// reads the provider's current state first, so a half-finished release can be
// finished later without a second pull request, a second notification, or a
// second state change. An `external` node cannot make that promise, which is why
// the invariant forbids re-entering one.
//
// This is also where the status advance now lives. It used to run in the browser
// (`app/TicketExecutor.tsx`, after a run reported success), which meant a closed
// tab left the ticket sitting in "In Progress" forever with a finished pull
// request attached to it.

import { addPullRequestReviewers, publishPullRequest } from "../ado";
import { prisma } from "../prisma";
import { reviewersFor } from "../providerCredentials";
import { resolveStatusForUpdate, updateTicketStatus } from "../tickets";
import type { ProviderId } from "../providers";
import { pendingActionFor, stageOf, type PendingAction, type Stage } from "../ticketLifecycle";
import { logAutomation } from "./planStore";

/** The state a released ticket moves to. One constant rather than the old
 *  `nextStatusAfter(skill)` mapping in lib/ui.ts: release is not a property of
 *  the skill that ran, it is the point of the exercise. */
export const RELEASE_STATUS = "Code Review";

const INTERMEDIATE_STATUS = "In Progress";

async function moveStatus(provider: ProviderId, ticketId: string, state: string): Promise<string> {
  try {
    return await updateTicketStatus(provider, ticketId, state);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/not in the list of supported values/i.test(msg)) throw e;
    const step = await resolveStatusForUpdate(provider, ticketId, INTERMEDIATE_STATUS);
    if (!step) throw e;
    await updateTicketStatus(provider, ticketId, step);
    return updateTicketStatus(provider, ticketId, state);
  }
}

export type ReleaseOutcome = {
  ok: boolean;
  prPublished: boolean;
  reviewersSet: boolean;
  statusMoved: boolean;
  /** What actually happened, one line per write. Shown to the developer and kept
   *  on the planned ticket, because "released" with no detail is unfalsifiable. */
  detail: string;
  error: string;
};

/**
 * Release one planned ticket.
 *
 * The three writes are attempted independently and every one of them is
 * recorded, because they fail independently: publishing a draft needs Code
 * (Write), resolving a reviewer needs Identity (Read), and moving the state
 * needs Work Items (Write). A token missing one of those must not make the other
 * two invisible.
 *
 * The ordering is deliberate — publish, then reviewers, then status. Publishing
 * is what makes the work visible; if it fails there is nothing to review and the
 * ticket must not claim to be in review.
 */
export async function releasePlannedTicket(plannedId: string): Promise<ReleaseOutcome> {
  const item = await prisma.plannedTicket.findUnique({
    where: { id: plannedId },
    include: { plan: true },
  });
  if (!item) {
    return { ok: false, prPublished: false, reviewersSet: false, statusMoved: false, detail: "", error: "No such planned ticket." };
  }
  const provider = item.plan.provider as ProviderId;
  const lines: string[] = [];
  let prPublished = item.prPublished;
  let reviewersSet = item.reviewersSet;
  let statusMoved = item.statusMoved;
  let error = "";
  let moved: { stage: string; pendingAction: string; pendingSince: Date | null } | null = null;

  // Azure DevOps is the only provider whose pull-request writes are wired. The
  // others degrade to the status move alone rather than throwing — the same
  // contract every other provider-touching path in this app keeps.
  const prWrites = provider === "azure-devops";
  const prUrls = [item.prUrl, ...item.companionPrUrls];

  if (!item.prUrl) {
    // Nothing to hand over. This is the normal state of a ticket the agent has
    // not finished yet, and it is a skip rather than a failure.
    await logAutomation({
      planId: item.planId, ticketId: item.ticketId, action: "release",
      outcome: "skipped", reason: "no-pr", detail: "The ticket has no pull request yet.",
    });
    return { ok: false, prPublished, reviewersSet, statusMoved, detail: "", error: "This ticket has no pull request yet." };
  }

  if (!prPublished) {
    if (!prWrites) {
      lines.push("Draft publishing is not wired for this provider — publish the pull request by hand.");
    } else {
      prPublished = true;
      for (const url of prUrls) {
        try {
          const r = await publishPullRequest(url);
          lines.push(r.detail);
          if (!r.ok) {
            prPublished = false;
            if (!error) error = r.detail;
          }
        } catch (e) {
          prPublished = false;
          const msg = e instanceof Error ? e.message : String(e);
          lines.push("Could not publish the draft: " + msg);
          if (!error) error = msg;
        }
      }
    }
  }

  // Reviewers only once the work is actually visible: assigning somebody to a
  // draft notifies them of something they cannot review.
  const orgReviewers = await reviewersFor(item.plan.provider, item.plan.org);
  const reviewers = orgReviewers.length ? orgReviewers : item.plan.reviewers;
  if (prPublished && !reviewersSet && reviewers.length > 0) {
    if (!prWrites) {
      lines.push("Reviewer assignment is not wired for this provider.");
    } else {
      reviewersSet = true;
      for (const url of prUrls) {
        try {
          const r = await addPullRequestReviewers(url, reviewers);
          lines.push(r.detail);
          if (!r.ok) {
            reviewersSet = false;
            if (!error) error = r.detail;
          }
        } catch (e) {
          reviewersSet = false;
          const msg = e instanceof Error ? e.message : String(e);
          lines.push("Could not add reviewers: " + msg);
          if (!error) error = msg;
        }
      }
    }
  } else if (prPublished && reviewers.length === 0) {
    reviewersSet = true;
    lines.push("No reviewers configured for this organization.");
  }

  if (prPublished && !statusMoved) {
    try {
      const resolved = await resolveStatusForUpdate(provider, item.ticketId, RELEASE_STATUS);
      if (!resolved) {
        lines.push(`This work item's workflow has no state matching "${RELEASE_STATUS}" — move it by hand.`);
        if (!error) error = "No matching review state in this work item's workflow.";
      } else {
        const applied = await moveStatus(provider, item.ticketId, resolved);
        statusMoved = true;
        const stage = stageOf(applied);
        const current = item.pendingAction as PendingAction;
        const next = pendingActionFor({ stage, prevStage: (item.stage || "") as Stage | "", prMerged: item.prMerged, current });
        moved = { stage, pendingAction: next, pendingSince: next === current ? item.pendingSince : next ? new Date() : null };
        lines.push(`Status set to "${applied}".`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lines.push("Could not move the status: " + msg);
      if (!error) error = msg;
    }
  }

  const ok = prPublished && statusMoved;
  await prisma.plannedTicket.update({
    where: { id: item.id },
    data: {
      prPublished,
      reviewersSet,
      statusMoved,
      releaseError: error,
      ...(moved ?? {}),
      // Stamped only on a complete release, so a partial one keeps being retried
      // instead of looking finished.
      ...(ok ? { releasedAt: new Date() } : {}),
    },
  });

  await logAutomation({
    planId: item.planId,
    ticketId: item.ticketId,
    action: "release",
    outcome: ok ? "done" : "failed",
    reason: ok ? "" : "provider-error",
    detail: lines.join(" "),
  });

  return { ok, prPublished, reviewersSet, statusMoved, detail: lines.join(" "), error };
}

/** Everything due to be released on `day` for one plan, in queue order. A
 *  ticket is due when the agent has finished it, it carries a pull request, and
 *  its release day has arrived — an overdue one from a previous day still counts,
 *  because a day the machine was off must not silently swallow a release. */
// Deliberately not filtered by `claim`, unlike the implement queue. A pull
// request this app opened has to be published and assigned even if the work item
// has since changed hands: leaving it as a draft nobody was told about is the
// one outcome worse than releasing it. Only the status move can fail, and
// `resolveWorkItemState()` already declines quietly when somebody else has moved
// the item on.
export async function dueForRelease(planId: string, day: string) {
  return prisma.plannedTicket.findMany({
    where: {
      planId,
      untracked: false,
      releasedAt: null,
      implementState: "implemented",
      prUrl: { not: "" },
      releaseDay: { not: "", lte: day },
    },
    orderBy: { implementOrder: "asc" },
  });
}
