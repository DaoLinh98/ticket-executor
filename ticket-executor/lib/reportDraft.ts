// Where one day's report draft is kept.
//
// The rules about what a report *is* live in `lib/report.ts`, which has no
// database; this file is only the row it is stored in.

import { prisma } from "@/lib/prisma";
import { REPORT_TASKS, emptyDraft, emptyTasks, type ReportDraftState } from "@/lib/report";

export type DraftKey = {
  provider: string;
  org: string;
  /** `YYYY-MM-DD`. */
  day: string;
};

/** A report covers a day and a person, not a project — the developer's day spans
 *  whatever projects they touched, so the project is deliberately not in the key. */
function rowKey(k: DraftKey): string {
  return [k.provider, k.org, k.day].join("::");
}

/**
 * Whatever the page last left for this day, or an empty draft seeded with the
 * developer's name.
 *
 * A missing row is not an error and not a distinguishable state: the page opens
 * on a fresh day exactly as often as it reopens one, and both are "here is the
 * draft".
 */
export async function loadDraft(k: DraftKey, name: string): Promise<ReportDraftState> {
  const row = await prisma.reportDraft.findUnique({ where: { key: rowKey(k) } });
  if (!row) return emptyDraft(name);
  return normalize(row.state, name);
}

export async function saveDraft(k: DraftKey, state: ReportDraftState): Promise<void> {
  const key = rowKey(k);
  const value = normalize(state, state.name);
  await prisma.reportDraft.upsert({
    where: { key },
    create: { key, reportDay: k.day, state: value },
    update: { state: value },
  });
}

export type SentReport = {
  day: string;
  text: string;
  sentAt: string;
};

export async function markSent(k: DraftKey, state: ReportDraftState, text: string): Promise<SentReport> {
  const key = rowKey(k);
  const value = normalize(state, state.name);
  const sentAt = new Date();
  await prisma.reportDraft.upsert({
    where: { key },
    create: { key, reportDay: k.day, state: value, sentText: text, sentAt },
    update: { state: value, sentText: text, sentAt },
  });
  return { day: k.day, text, sentAt: sentAt.toISOString() };
}

export async function loadSent(k: DraftKey): Promise<SentReport | null> {
  const row = await prisma.reportDraft.findUnique({
    where: { key: rowKey(k) },
    select: { reportDay: true, sentText: true, sentAt: true },
  });
  return toSent(row);
}

export async function loadPreviousSent(k: DraftKey): Promise<SentReport | null> {
  const row = await prisma.reportDraft.findFirst({
    where: {
      key: { startsWith: [k.provider, k.org, ""].join("::") },
      reportDay: { lt: k.day },
      sentAt: { not: null },
    },
    orderBy: { reportDay: "desc" },
    select: { reportDay: true, sentText: true, sentAt: true },
  });
  return toSent(row);
}

function toSent(row: { reportDay: string; sentText: string | null; sentAt: Date | null } | null): SentReport | null {
  if (!row?.sentText || !row.sentAt) return null;
  return { day: row.reportDay, text: row.sentText, sentAt: row.sentAt.toISOString() };
}

/**
 * A stored draft is JSON the database does not type, and it was written by a
 * page that may since have changed shape — so every field is re-established
 * here rather than trusted. `name` is the fallback only: a name the developer
 * typed over the identity's own is part of the draft.
 */
function normalize(raw: unknown, name: string): ReportDraftState {
  const d = (raw ?? {}) as Partial<ReportDraftState> & {
    sprintPlanning?: { today?: boolean; tomorrow?: boolean };
  };
  const storedTasks: Partial<Record<string, { today?: boolean; tomorrow?: boolean }>> = {
    sprintPlanning: d.sprintPlanning,
    ...d.tasks,
  };
  const tasks = emptyTasks();
  for (const { id } of REPORT_TASKS) {
    tasks[id] = { today: !!storedTasks[id]?.today, tomorrow: !!storedTasks[id]?.tomorrow };
  }
  const entries: ReportDraftState["entries"] = {};
  for (const [id, e] of Object.entries(d.entries ?? {})) {
    entries[id] = {
      today: !!e?.today,
      tomorrow: !!e?.tomorrow,
      progress: typeof e?.progress === "string" ? e.progress : "",
      comment: !!e?.comment,
      block: !!e?.block,
    };
  }
  return {
    name: typeof d.name === "string" && d.name ? d.name : name,
    tasks,
    entries,
  };
}
