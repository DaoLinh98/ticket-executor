import { prisma } from "../prisma";
import { isDriving, liveLogs, reconcileOrphans } from "./engine";
import { buildView, listItem, type RunListItem, type RunView } from "./view";

export { cancelRun, resumeRun, startRun, type ResumeAction, type StartInput } from "./engine";
export type { RunListItem, RunView } from "./view";

export type Defaults = { rootRepo: string; project: string; provider: string };

export async function listRuns(): Promise<{ runs: RunListItem[]; defaults: Defaults }> {
  await reconcileOrphans();
  const [rows, setting] = await Promise.all([
    prisma.dagentRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 30,
      select: { id: true, ticketId: true, ticketTitle: true, state: true, startedAt: true, rootRepo: true, project: true, provider: true },
    }),
    prisma.setting.findUnique({ where: { id: "default" }, select: { provider: true } }),
  ]);
  const latest = rows[0];
  return {
    runs: rows.map(listItem),
    defaults: { rootRepo: latest?.rootRepo ?? "", project: latest?.project ?? "", provider: latest?.provider || setting?.provider || "azure-devops" },
  };
}

export async function getRunView(id: string): Promise<RunView | null> {
  const row = await prisma.dagentRun.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { startedAt: "asc" } },
      transitions: { orderBy: { seq: "asc" } },
      artifacts: { orderBy: { createdAt: "asc" }, select: { kind: true, body: true, createdAt: true } },
    },
  });
  if (!row) return null;
  if (row.state === "running" && !isDriving(id)) await reconcileOrphans();
  return buildView(row, row.steps, row.transitions, row.artifacts, liveLogs(id));
}

export async function runFingerprint(id: string): Promise<string> {
  const row = await prisma.dagentRun.findUnique({ where: { id }, select: { updatedAt: true, state: true } });
  const live = liveLogs(id);
  return `${row?.updatedAt.getTime() ?? 0}|${row?.state ?? ""}|${live?.stepId ?? ""}|${live?.logs.length ?? 0}`;
}

export async function listFingerprint(): Promise<string> {
  const agg = await prisma.dagentRun.aggregate({ _count: true, _max: { updatedAt: true } });
  return `${agg._count}|${agg._max.updatedAt?.getTime() ?? 0}`;
}
