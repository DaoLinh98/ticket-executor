import type { Entry } from "./types";
import { prisma } from "../prisma";

// In-process execution state, kept across dev HMR via globalThis. Not persisted —
// restarting the server loses in-flight log/step state (final status/result lives in Postgres).
const g = globalThis as unknown as { __execStore?: Map<string, Entry> };
export const store: Map<string, Entry> = g.__execStore ?? new Map();
g.__execStore = store;

// The ticket id of a run still occupying a slot (running or parked awaiting
// plan approval) other than `exceptTicketId`, if any. Used to enforce
// single-ticket mode's one-run-at-a-time rule.
//
// Live runs are in the in-memory store. A run parked at the plan gate can also
// outlive a server restart (persisted, but dropped from the store), and it is
// still genuinely active — so parked runs are additionally looked up in the DB.
// Persisted "running" rows are NOT counted: their child process died with the
// previous server, so they are dead, not active, and would over-block.
export async function findOtherActiveTicketId(exceptTicketId: string): Promise<string | undefined> {
  for (const e of store.values()) {
    if (e.ticketId !== exceptTicketId && (e.status === "running" || e.status === "awaiting-approval")) return e.ticketId;
  }
  const parked = await prisma.execution.findFirst({
    where: { status: "awaiting-approval", adoTicketId: { not: exceptTicketId } },
    select: { adoTicketId: true },
  });
  return parked?.adoTicketId ?? undefined;
}
