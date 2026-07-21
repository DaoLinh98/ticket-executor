import { prisma } from "../prisma";
import type { ExecStatus, FileChange } from "../types";
import { fmtDuration, safeParseJson, safeParseLogs } from "./format";
import { store } from "./store";

// Live view of an execution still held in the in-process store.
export function getExecution(id: string) {
  const e = store.get(id);
  if (!e) return null;
  return {
    id: e.id,
    adoTicketId: e.ticketId,
    projectName: e.project,
    skillName: e.skill,
    model: e.model,
    effort: e.effort,
    command: e.command,
    status: e.status,
    logLines: e.logLines,
    resultText: e.resultText,
    errorMessage: e.error,
    prUrl: e.prUrl,
    branch: e.branch,
    currentStep: e.currentStep,
    filesChanged: e.filesChanged,
    duration: e.completedAt ? fmtDuration(e.completedAt - e.startedAt) : undefined,
    startedAt: new Date(e.startedAt).toISOString(),
    completedAt: e.completedAt ? new Date(e.completedAt).toISOString() : null,
  };
}

// Load a finished execution from the database (used after a server restart or
// for history, when it is no longer in the in-memory store).
export async function getPersistedExecution(id: string) {
  const r = await prisma.execution.findUnique({ where: { id } });
  if (!r) return null;
  return {
    id: r.id,
    adoTicketId: r.adoTicketId,
    projectName: r.projectName,
    skillName: r.skillName,
    model: r.model,
    effort: r.effort,
    command: r.command,
    status: r.status as ExecStatus,
    logLines: safeParseLogs(r.logLines),
    resultText: r.resultText,
    errorMessage: r.errorMessage,
    prUrl: r.prUrl,
    branch: r.branch,
    currentStep: r.currentStep,
    filesChanged: safeParseJson<FileChange[]>(r.filesChanged, []),
    duration: r.completedAt ? fmtDuration(r.completedAt.getTime() - r.startedAt.getTime()) : undefined,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  };
}

// Summaries of past runs for a ticket, newest first (for the history panel).
export async function listExecutions(ticketId: string) {
  const rows = await prisma.execution.findMany({
    where: { adoTicketId: ticketId },
    orderBy: { startedAt: "desc" },
    take: 20,
    select: {
      id: true, status: true, skillName: true, prUrl: true, branch: true,
      resultText: true, filesChanged: true, startedAt: true, completedAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status as ExecStatus,
    skillName: r.skillName,
    prUrl: r.prUrl,
    branch: r.branch,
    resultText: r.resultText,
    filesChanged: safeParseJson<FileChange[]>(r.filesChanged, []),
    startedAt: r.startedAt.toISOString(),
    duration: r.completedAt ? fmtDuration(r.completedAt.getTime() - r.startedAt.getTime()) : undefined,
  }));
}
