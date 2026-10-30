// Pure rules of the PO clarification loop (`lib/execution/clarify.ts`): no Prisma, no provider.

export const QUESTIONS_POSTED = "questions-posted";
export const PO_ANSWERED = "po-answered";

type LoopEvent = { reason: string; outcome: string; detail: string; createdAt: Date };

/** When the run's current questions were posted, from its events oldest first. A recheck that parked the run again
 *  drafted new questions, so only a post after the last resume counts; a resume that failed changes nothing. */
export function postedAtOf(events: LoopEvent[], runId: string): string | null {
  let postedAt: string | null = null;
  for (const e of events) {
    if (!e.detail.startsWith(runId)) continue;
    if (e.reason === QUESTIONS_POSTED) postedAt = e.createdAt.toISOString();
    else if (e.reason === PO_ANSWERED && e.outcome === "started") postedAt = null;
  }
  return postedAt;
}
