import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import type { Ctx, LogEntry, NodeResult, Refusal } from "./types";

export type RunPatch = {
  state?: string;
  waitReason?: string;
  currentNodeId?: string;
  errorMessage?: string;
  hops?: number;
  branch?: string;
  prUrl?: string;
  ticketTitle?: string;
  worktreePath?: string;
  endedAt?: Date | null;
};

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function saveRun(id: string, ctx: Ctx, patch: RunPatch = {}) {
  await prisma.dagentRun.update({
    where: { id },
    data: {
      ...patch,
      channels: json(ctx.channels),
      visits: json(ctx.visits),
      baseSha: ctx.baseSha,
      companions: json(ctx.companions),
      ...(ctx.cwd !== ctx.rootRepo ? { worktreePath: ctx.cwd } : {}),
    },
  });
}

export async function openStep(runId: string, nodeId: string, label: string, agent: string, input: Refusal[] | null) {
  const attempt = (await prisma.dagentStep.count({ where: { runId, nodeId } })) + 1;
  return prisma.dagentStep.create({
    data: { runId, nodeId, label, agent, attempt, status: "running", ...(input ? { input: json(input) } : {}) },
  });
}

export async function closeStep(id: string, status: string, r: NodeResult, logs: LogEntry[]) {
  await prisma.dagentStep.update({
    where: { id },
    data: {
      status,
      output: json(r.data),
      errorMessage: r.error,
      logLines: json(logs),
      costUsd: r.usage.costUsd,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      cacheReadTokens: r.usage.cacheReadTokens,
      numTurns: r.usage.numTurns,
      endedAt: new Date(),
    },
  });
}

export async function saveTransition(runId: string, seq: number, fromNode: string, toNode: string, reason: string) {
  await prisma.dagentTransition.create({ data: { runId, seq, fromNode, toNode, reason } });
}

export async function saveArtifact(runId: string, kind: string, body: string) {
  await prisma.dagentArtifact.create({ data: { runId, kind, body } });
}

export async function nextSeq(runId: string): Promise<number> {
  const last = await prisma.dagentTransition.findFirst({ where: { runId }, orderBy: { seq: "desc" }, select: { seq: true } });
  return (last?.seq ?? 0) + 1;
}
