import { prisma } from "../prisma";
import type { LiveRun } from "./graph/types";

// In-process run state, kept across dev HMR via globalThis. Not persisted — what
// survives a restart lives in the Run/Step/Artifact/Transition rows, and
// rehydrate() rebuilds this from them.
const g = globalThis as unknown as { __runStore?: Map<string, LiveRun> };
export const store: Map<string, LiveRun> = g.__runStore ?? new Map();
g.__runStore = store;

/** The ticket id of a run still occupying a slot (running, or parked waiting on a
 *  human) other than `exceptTicketId`, if any. Enforces single-ticket mode's
 *  one-run-at-a-time rule.
 *
 *  Live runs are in the in-memory store. A parked run can also outlive a restart
 *  (persisted, but dropped from the store), and it is still genuinely active — so
 *  `waiting` rows are additionally looked up in the DB. Persisted `running` rows
 *  are NOT counted here: their child process died with the previous server, so
 *  they are dead until recoverInterruptedRuns() decides what to do with them, and
 *  counting them would over-block. */
export async function findOtherActiveTicketId(exceptTicketId: string): Promise<string | undefined> {
  for (const live of store.values()) {
    if (live.ctx.ticketId !== exceptTicketId && (live.state === "running" || live.state === "waiting")) {
      return live.ctx.ticketId;
    }
  }
  const parked = await prisma.run.findFirst({
    where: { state: "waiting", ticketId: { not: exceptTicketId } },
    select: { ticketId: true },
  });
  return parked?.ticketId ?? undefined;
}
