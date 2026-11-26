// What the next scheduler tick would do for one plan, as a dry run.
//
// Pure, like the other rules an unattended process acts on: the caller reads the rows (with the same `where` the
// scheduler uses) and this orders them the way `runTick()` does — release what is due, then one implement start
// (a transient retry before the queue). It decides nothing the scheduler does not; `startRun()` still has the last
// word on admission (a free slot, no duplicate run), which a preview cannot know.

export type PreviewDue = { ticketId: string; releaseDay: string };
export type PreviewFailed = { ticketId: string; project: string; transient: boolean; retriesUsed: number; overBudget: boolean };
export type PreviewQueued = { ticketId: string; project: string; implementOrder: number; releaseDay: string; overridden: boolean };

export type PreviewInput = {
  autoImplement: boolean;
  autoRelease: boolean;
  /** Implemented tickets whose release day has come (`dueForRelease()`), in queue order. */
  due: PreviewDue[];
  /** Tickets whose automatic release already failed `MAX_RELEASE_ATTEMPTS` times. */
  releaseExhausted: ReadonlySet<string>;
  /** Failed implement rows with no PR, in queue order. */
  failed: PreviewFailed[];
  /** Pending, unblocked, the developer's own tickets, in queue order. */
  queue: PreviewQueued[];
  /** Tickets in the queue's reach that triage holds back until the PO answers. */
  blockedWaiting: number;
  hasRootRepo: (project: string) => boolean;
  maxRetries: number;
};

export type PreviewStep = { action: "release" | "retry" | "implement"; ticketId: string; detail: string };
export type PreviewHeld = { action: "release" | "retry" | "implement"; ticketId: string; reason: string };
export type TickPreview = { steps: PreviewStep[]; held: PreviewHeld[]; notes: string[] };
/** The route's answer: the preview, whether the scheduler acts on the plan at all, and when it was read. */
export type TickPreviewResult = TickPreview & { active: boolean; at: string };

export function previewTick(i: PreviewInput): TickPreview {
  const steps: PreviewStep[] = [];
  const held: PreviewHeld[] = [];
  const notes: string[] = [];

  if (i.autoRelease) {
    for (const d of i.due) {
      if (i.releaseExhausted.has(d.ticketId)) held.push({ action: "release", ticketId: d.ticketId, reason: "Automatic release failed too many times — release it by hand" });
      else steps.push({ action: "release", ticketId: d.ticketId, detail: `Publish the draft PR, set reviewers and move the status (due ${d.releaseDay})` });
    }
  } else if (i.due.length) {
    notes.push(`Auto-release is off — ${i.due.length} ticket${i.due.length === 1 ? " is" : "s are"} due and wait for you to release.`);
  }

  if (!i.autoImplement) {
    notes.push("Auto-implement is off — turn it on in Automation to let the scheduler start tickets.");
  } else {
    // One implement start per tick: a transient retry goes first, then the queue.
    let started = false;
    for (const f of i.failed) {
      if (!f.transient) continue;
      if (f.overBudget) { held.push({ action: "retry", ticketId: f.ticketId, reason: "Over its budget — waits for you" }); continue; }
      if (f.retriesUsed >= i.maxRetries) { held.push({ action: "retry", ticketId: f.ticketId, reason: `${f.retriesUsed} automatic retries used — waits for you` }); continue; }
      if (!i.hasRootRepo(f.project)) { held.push({ action: "retry", ticketId: f.ticketId, reason: "No root repo saved for its project" }); continue; }
      steps.push({ action: "retry", ticketId: f.ticketId, detail: `Retry after a transient failure (attempt ${f.retriesUsed + 1} of ${i.maxRetries})` });
      started = true;
      break;
    }
    if (!started) {
      for (const q of i.queue) {
        if (!i.hasRootRepo(q.project)) { held.push({ action: "implement", ticketId: q.ticketId, reason: "No root repo saved for its project" }); continue; }
        steps.push({
          action: "implement",
          ticketId: q.ticketId,
          detail: `Next in the queue (position ${q.implementOrder}, release day ${q.releaseDay || "unscheduled"})${q.overridden ? " — you overrode triage's hold" : ""}`,
        });
        started = true;
        break;
      }
    }
    if (!started && !i.queue.length) notes.push("Nothing is queued to implement.");
    if (i.blockedWaiting) notes.push(`${i.blockedWaiting} ticket${i.blockedWaiting === 1 ? " is" : "s are"} held back until the PO answers.`);
  }

  return { steps, held, notes };
}
