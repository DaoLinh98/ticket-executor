import { randomUUID } from "crypto";
import { commonArgs, runTurn } from "./claudeCli";
import { removeRunMcpConfig, resolveMcp, writeRunMcpConfig } from "../mcp";
import { prisma } from "../prisma";
import { resolveCredential } from "../providerCredentials";
import { findSkill } from "../skillPack";
import { normalizeProvider, postTicketComment } from "../tickets";
import { logAutomation } from "./planStore";
import { scratchCwd, triageLive } from "./triage";

export const QA_REPLY_SKILL = "reply-qa-v4";

export const QA_REPLY_OUTPUT = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "summary", "fixNeeded", "needsHuman"],
  properties: {
    reply: { type: "string", description: "The comment to post on the work item, as plain text. Empty when nothing should be posted." },
    summary: { type: "string" },
    fixNeeded: { type: "boolean" },
    needsHuman: { type: "boolean" },
  },
} as const;

const STALE_MS = 30 * 60_000;

export async function openQaDraft(plannedTicketId: string) {
  return prisma.qaReplyDraft.findFirst({
    where: {
      plannedTicketId,
      OR: [{ status: "ready" }, { status: "running", createdAt: { gte: new Date(Date.now() - STALE_MS) } }],
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function listQaDrafts(planId: string) {
  return prisma.qaReplyDraft.findMany({
    where: {
      planId,
      status: { in: ["running", "ready", "failed"] },
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function startQaReply(
  plannedId: string,
  opts: { since?: string; answersUpTo?: string } = {}
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const item = await prisma.plannedTicket.findUnique({ where: { id: plannedId }, include: { plan: true } });
  if (!item) return { ok: false, error: "No such planned ticket." };
  if (item.claim === "dropped") return { ok: false, error: "This ticket left your sprint before you worked on it." };
  if (!findSkill(QA_REPLY_SKILL)) {
    return { ok: false, error: `The ${QA_REPLY_SKILL} skill is not installed — install it from System Check.` };
  }
  if (await openQaDraft(item.id)) return { ok: false, error: "A reply draft for this ticket is already waiting." };

  const { org, identity } = await resolveCredential(item.plan.provider);
  if (org !== item.plan.org) return { ok: false, error: "Switch to this plan's organization first." };

  const project = item.project || item.plan.project;
  const mapped = project
    ? await prisma.rootRepoProjectMap.findUnique({
        where: { provider_org_project: { provider: item.plan.provider, org: item.plan.org, project } },
      })
    : null;

  const since =
    opts.since ??
    (await prisma.qaReplyDraft.findFirst({
      where: { plannedTicketId: item.id, status: "posted" },
      orderBy: { createdAt: "desc" },
      select: { answersUpTo: true },
    }))?.answersUpTo ??
    "";

  const draft = await prisma.qaReplyDraft.create({
    data: {
      planId: item.planId,
      plannedTicketId: item.id,
      ticketId: item.ticketId,
      status: "running",
      answersUpTo: opts.answersUpTo || item.qaCommentAt,
    },
  });
  await logAutomation({
    planId: item.planId, ticketId: item.ticketId, action: "watch", outcome: "started",
    reason: "qa-reply-draft", detail: "Drafting a reply to QC's comments. Nothing is posted until you confirm.",
  });

  const prompt =
    `/${QA_REPLY_SKILL} Provider: ${item.plan.provider} - Ticket: ${item.ticketId} - Project name: ${project} - ` +
    `Developer: ${identity.name || identity.email} <${identity.email}> - ` +
    `Since: ${since || "(not known)"}\n` +
    (mapped?.rootRepo
      ? `Repository: the current working directory (${mapped.rootRepo}) is this project's checkout — read it from there.`
      : "Repository: none is available. Answer from the work item alone, and say so when an answer needs the code.");

  void execQaReply(draft.id, item.plan.provider, mapped?.rootRepo ?? "", prompt);
  return { ok: true, id: draft.id };
}

async function execQaReply(id: string, provider: string, rootRepo: string, prompt: string) {
  const cwd = rootRepo || scratchCwd(id);
  const live = triageLive(id, cwd, provider, QA_REPLY_SKILL);
  let mcpPath = "";
  try {
    const [setting, cred] = await Promise.all([
      prisma.setting.findUnique({ where: { id: "default" } }),
      resolveCredential(provider),
    ]);
    const decision = await resolveMcp({ provider, org: cred.org, pat: cred.pat, manageMcp: setting?.manageMcp ?? true, cwd });
    mcpPath = writeRunMcpConfig(id, decision);

    const turn = await runTurn(live, [
      "-p",
      prompt,
      "--session-id",
      randomUUID(),
      ...commonArgs({ mcpConfigPath: mcpPath, cwd, outputSchema: QA_REPLY_OUTPUT as unknown as Record<string, unknown> }),
    ]);
    if (!turn.ok || !turn.structured) {
      await finishDraft(id, {
        status: "failed",
        errorMessage: turn.error || "the reply turn finished without returning its structured output",
        costUsd: turn.usage.costUsd,
      });
      return;
    }
    const d = turn.structured as { reply?: unknown; summary?: unknown; fixNeeded?: unknown; needsHuman?: unknown };
    await finishDraft(id, {
      status: "ready",
      body: typeof d.reply === "string" ? d.reply.trim() : "",
      summary: typeof d.summary === "string" ? d.summary : "",
      fixNeeded: d.fixNeeded === true,
      needsHuman: d.needsHuman === true,
      costUsd: turn.usage.costUsd,
    });
  } catch (e) {
    await finishDraft(id, { status: "failed", errorMessage: e instanceof Error ? e.message : String(e) });
  } finally {
    removeRunMcpConfig(mcpPath);
  }
}

async function finishDraft(
  id: string,
  patch: {
    status: string;
    body?: string;
    summary?: string;
    fixNeeded?: boolean;
    needsHuman?: boolean;
    errorMessage?: string;
    costUsd?: number;
  }
) {
  await prisma.qaReplyDraft
    .update({ where: { id }, data: { ...patch, endedAt: new Date() } })
    .catch(() => { /* the row was removed while the turn ran — nothing to record */ });
}

export async function postQaReply(draftId: string, body: string): Promise<{ ok: boolean; error: string }> {
  const draft = await prisma.qaReplyDraft.findUnique({ where: { id: draftId } });
  if (!draft) return { ok: false, error: "No such draft." };
  if (draft.status !== "ready") return { ok: false, error: "This draft is not waiting to be posted." };
  const text = body.trim();
  if (!text) return { ok: false, error: "The reply is empty." };

  const plan = await prisma.sprintPlan.findUnique({ where: { id: draft.planId } });
  if (!plan) return { ok: false, error: "This draft's plan no longer exists." };
  const { org } = await resolveCredential(plan.provider);
  if (org !== plan.org) return { ok: false, error: "Switch to this plan's organization before posting." };

  try {
    await postTicketComment(normalizeProvider(plan.provider), draft.ticketId, text);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await logAutomation({
      planId: plan.id, ticketId: draft.ticketId, action: "watch", outcome: "failed",
      reason: "qa-reply-post-failed", detail: error,
    });
    return { ok: false, error };
  }
  await prisma.qaReplyDraft.update({ where: { id: draftId }, data: { status: "posted", body: text, postedAt: new Date() } });
  await logAutomation({
    planId: plan.id, ticketId: draft.ticketId, action: "watch", outcome: "done",
    reason: "qa-reply-posted", detail: "Your reply to QC was posted on the work item.",
  });
  return { ok: true, error: "" };
}

export async function dismissQaReply(draftId: string): Promise<{ ok: boolean; error: string }> {
  const draft = await prisma.qaReplyDraft.findUnique({ where: { id: draftId } });
  if (!draft) return { ok: false, error: "No such draft." };
  if (draft.status === "posted") return { ok: false, error: "This reply was already posted." };
  await prisma.qaReplyDraft.update({ where: { id: draftId }, data: { status: "dismissed" } });
  return { ok: true, error: "" };
}
