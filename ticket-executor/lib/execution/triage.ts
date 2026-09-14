// Sprint triage: one Claude turn that reads a developer's tickets in one sprint
// and answers, as structured data, which are ready, which need an answer from a
// business analyst, which are mis-estimated, and what order to work them in.
//
// **Why this is not a graph.** Every graph in `lib/execution/graph/` drives a
// *run*: one ticket, a branch, a worktree, admission control, and a leaf node
// that pushes. Triage has none of those. It writes nothing — not a file, not a
// comment, not a story point — so there is no worktree to isolate, no branch to
// race over, and nothing an admission rule protects. Forcing it through
// `startRun()` would mean inventing a ticket id for a sprint and creating a
// worktree for a turn that only reads, which is more machinery than the work.
//
// What it does keep from the engine is the part that matters: a declared JSON
// Schema, so the answer is data the planner can act on rather than a table a
// human retypes. A turn that ends without honouring the contract is a failure,
// exactly as it is for an agent node.
//
// The result is persisted (`SprintTriage`) rather than held in memory because
// the plan built from it is acted on for a fortnight, and "why is #123 marked
// blocked" has to be answerable long after the turn's log has gone.

import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { commonArgs, runTurn } from "./claudeCli";
import { removeRunMcpConfig, resolveMcp, writeRunMcpConfig } from "../mcp";
import { prisma } from "../prisma";
import { resolveCredential } from "../providerCredentials";
import { findSkill } from "../skillPack";
import type { LiveRun } from "./graph/types";
import type { Ticket } from "../types";

export const TRIAGE_SKILL = "triage-sprint-v1";

// ---- the contract ----

/** What one triaged ticket answers. Every field is required: an optional field
 *  is one the planner has to guess about, and guessing is what this whole turn
 *  exists to remove. */
export const TRIAGE_OUTPUT = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "finalNotes", "tickets"],
  properties: {
    summary: { type: "string" },
    finalNotes: { type: "array", items: { type: "string" } },
    tickets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "readiness",
          "needsClarification",
          "currentPoints",
          "suggestedPoints",
          "estimateVerdict",
          "estimateReason",
          "risk",
          "workOrder",
          "dependsOn",
          "reason",
          "blockers",
          "actions",
          "questions",
          "evidence",
          "clientCommentDraft",
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          readiness: {
            type: "string",
            enum: ["ready", "ready-with-notes", "needs-clarification", "blocked"],
          },
          needsClarification: { type: "boolean" },
          currentPoints: { type: "number" },
          suggestedPoints: { type: "number" },
          estimateVerdict: {
            type: "string",
            enum: ["reasonable", "increase", "high", "cannot-evaluate"],
          },
          estimateReason: { type: "string" },
          risk: { type: "string", enum: ["low", "medium", "high"] },
          workOrder: { type: "integer" },
          dependsOn: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
          blockers: { type: "array", items: { type: "string" } },
          actions: { type: "array", items: { type: "string" } },
          questions: { type: "array", items: { type: "string" } },
          evidence: { type: "array", items: { type: "string" } },
          clientCommentDraft: { type: "string" },
        },
      },
    },
  },
} as const;

export type TriagedTicket = {
  id: string;
  title: string;
  readiness: "ready" | "ready-with-notes" | "needs-clarification" | "blocked";
  needsClarification: boolean;
  currentPoints: number;
  suggestedPoints: number;
  estimateVerdict: "reasonable" | "increase" | "high" | "cannot-evaluate";
  estimateReason: string;
  risk: "low" | "medium" | "high";
  workOrder: number;
  dependsOn: string[];
  reason: string;
  /** What is actually missing before this ticket can be called ready. Empty for
   *  a ready ticket — that emptiness is the answer to "what else does it need?" */
  blockers: string[];
  /** What the developer does next, in order. Never empty: a blocked ticket's
   *  first action is chasing the answer that unblocks it. */
  actions: string[];
  questions: string[];
  /** Files, modules or conventions in the checkout the verdict actually rests
   *  on. Empty when no repository was available. */
  evidence: string[];
  clientCommentDraft: string;
};

export type TriageResult = { summary: string; finalNotes: string[]; tickets: TriagedTicket[] };

/** Normalize the validated object into the shape the rest of the app reads.
 *  The CLI already enforced the schema; this only narrows types and drops rows
 *  for tickets that were never asked about — an id the agent invented has no
 *  ticket to attach to. */
export function normalizeTriage(
  data: Record<string, unknown>,
  askedIds: string[]
): TriageResult {
  const allowed = new Set(askedIds.map(String));
  const rows = Array.isArray(data.tickets) ? (data.tickets as TriagedTicket[]) : [];
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter((x) => x.trim().length > 0) : [];
  return {
    summary: typeof data.summary === "string" ? data.summary : "",
    finalNotes: list(data.finalNotes),
    tickets: rows.filter((t) => allowed.has(String(t.id))).map((t) => ({
      ...t,
      id: String(t.id),
      dependsOn: list(t.dependsOn),
      blockers: list(t.blockers),
      actions: list(t.actions),
      questions: list(t.questions),
      evidence: list(t.evidence),
    })),
  };
}

// ---- prompt ----

export type TriageInput = {
  provider: string;
  org: string;
  project: string;
  sprint: string;
  identityEmail: string;
  identityName: string;
  /** Where the project's real working copy is. The turn reads the repository's
   *  own conventions from here — it is a cwd, never a tree to write in.
   *
   *  Empty is legitimate. Ticket content comes from the provider's MCP server,
   *  not from the checkout, so a project nobody has run by hand yet can still be
   *  triaged; what is lost is the ability to say "the codebase already answers
   *  this", which the prompt then tells the turn about explicitly. */
  rootRepo: string;
  tickets: Ticket[];
};

export function triagePrompt(input: TriageInput): string {
  // Area path and url travel with each row because they are what identify a
  // ticket when a sprint spans several projects: the url says which project a
  // ticket belongs to without a lookup, and the area path is the only signal in
  // the data for whether the checkout on screen is even the right one for it.
  const list = input.tickets
    .map(
      (t) =>
        `  - #${t.id} [${t.type}] ${t.status} · ${t.storyPoints ?? 0}pt · ${t.title}` +
        `${t.areaPath ? ` · area: ${t.areaPath}` : ""}${t.url ? ` · ${t.url}` : ""}`
    )
    .join("\n");
  // Whether the turn has a checkout is part of its instructions, not something
  // it should infer from an empty directory: the skill leans on the repository
  // to tell a genuine ambiguity from one the codebase already answers, and a
  // turn that cannot do that must be told to stop short of calling it unclear.
  const repo = input.rootRepo
    ? `Repository: the current working directory (${input.rootRepo}) is this project's root repo — read it from there.`
    : "Repository: none is available for this project. Judge from the work items alone, and never "
      + "mark a ticket unclear merely because you could not read the code.";
  return (
    `/${TRIAGE_SKILL} Provider: ${input.provider} - Organization: ${input.org} - ` +
    `Project name: ${input.project} - Sprint: ${input.sprint} - ` +
    `Developer: ${input.identityName || input.identityEmail} <${input.identityEmail}>\n` +
    `${repo}\n` +
    `Review exactly these ${input.tickets.length} work items and no others:\n${list}`
  );
}

// ---- execution ----

/** The minimal live-run shape `runTurn` reads: a cwd, a log to append to, and a
 *  slot to hold the child process. Triage has no Run row, so this is built here
 *  rather than rehydrated. */
function triageLive(id: string, cwd: string, provider: string): LiveRun {
  return {
    id,
    graphId: "triage",
    ctx: {
      runId: id, ticketId: "", ticketUrl: "", provider, project: "", prUrl: "",
      skill: TRIAGE_SKILL, rootRepo: cwd, cwd, baseSha: "", knowledge: "",
      channels: {}, visits: {},
    },
    state: "running",
    currentNodeId: "triage",
    sessionId: "",
    model: "",
    effort: "",
    isolate: false,
    child: null,
    cancelled: false,
    logLines: [],
    mcpConfigPath: "",
    parkedAt: null,
    humanWaitMs: 0,
    resumeAt: null,
    limitWaitMs: 0,
    limitParks: 0,
    resumeSession: false,
    startedAt: Date.now(),
    endedAt: null,
    seq: 0,
    hops: 0,
    resumedAfterRestart: false,
    errorMessage: "",
    endReason: "",
    prUrl: "",
    branch: "",
    resultText: "",
  };
}

/**
 * Start a triage. Returns as soon as the row exists; the turn itself runs on.
 *
 * Deliberately not awaited by the caller: a sprint of ten work items is minutes
 * of reading, which is longer than a request should be held open. The row is the
 * handle — the page polls it, and a server restart leaves a `running` row that
 * says what was in flight rather than a request that vanished.
 */
export async function startTriage(input: TriageInput): Promise<{ id: string } | { error: string }> {
  if (!input.tickets.length) return { error: "There are no tickets to triage." };
  // The same refusal an unknown skill gets in admission, and for the same
  // reason: fail before the spawn, never after.
  if (!findSkill(TRIAGE_SKILL)) {
    return { error: `The ${TRIAGE_SKILL} skill is not installed — install it from System Check.` };
  }

  const row = await prisma.sprintTriage.create({
    data: {
      provider: input.provider,
      org: input.org,
      project: input.project,
      sprint: input.sprint,
      identityEmail: input.identityEmail,
      ticketIds: input.tickets.map((t) => t.id),
      status: "running",
    },
  });

  void execTriage(row.id, input);
  return { id: row.id };
}

/** The cwd for a triage with no root repo: an empty directory the app owns.
 *  The turn runs with permissions skipped, so it must never fall back to the
 *  server process's own working directory — a read-only turn still has no
 *  business sitting in the application's source tree. */
function scratchCwd(id: string): string {
  const dir = path.join(tmpdir(), "te-triage", id.replace(/[^\w-]/g, ""));
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function execTriage(id: string, input: TriageInput) {
  const cwd = input.rootRepo || scratchCwd(id);
  const live = triageLive(id, cwd, input.provider);
  let mcpPath = "";
  try {
    const [setting, cred] = await Promise.all([
      prisma.setting.findUnique({ where: { id: "default" } }),
      resolveCredential(input.provider),
    ]);
    const decision = await resolveMcp({
      provider: input.provider,
      org: cred.org,
      pat: cred.pat,
      manageMcp: setting?.manageMcp ?? true,
      cwd,
    });
    mcpPath = writeRunMcpConfig(id, decision);

    const turn = await runTurn(live, [
      "-p",
      triagePrompt(input),
      "--session-id",
      randomUUID(),
      ...commonArgs({
        mcpConfigPath: mcpPath,
        cwd,
        outputSchema: TRIAGE_OUTPUT as unknown as Record<string, unknown>,
      }),
    ]);

    if (!turn.ok || !turn.structured) {
      await finish(id, {
        status: "failed",
        error:
          turn.error ||
          (turn.structured
            ? "the triage turn failed"
            : "the triage turn finished without returning its structured output"),
        costUsd: turn.usage.costUsd,
      });
      return;
    }
    await finish(id, {
      status: "succeeded",
      result: normalizeTriage(turn.structured, input.tickets.map((t) => t.id)),
      costUsd: turn.usage.costUsd,
    });
  } catch (e) {
    await finish(id, { status: "failed", error: e instanceof Error ? e.message : String(e) });
  } finally {
    // The config holds the PAT in clear text — remove it the moment the turn is
    // over, exactly as a run's node does.
    removeRunMcpConfig(mcpPath);
  }
}

async function finish(
  id: string,
  patch: { status: string; result?: TriageResult; error?: string; costUsd?: number }
) {
  await prisma.sprintTriage.update({
    where: { id },
    data: {
      status: patch.status,
      result: (patch.result ?? {}) as object,
      errorMessage: patch.error ?? "",
      costUsd: patch.costUsd ?? 0,
      endedAt: new Date(),
    },
  }).catch(() => { /* the row was deleted while the turn ran — nothing to record */ });
}

/** The newest triage for one sprint, whatever its state. What the page shows. */
export async function latestTriage(where: {
  provider: string;
  org: string;
  project: string;
  sprint: string;
  identityEmail: string;
}) {
  return prisma.sprintTriage.findFirst({ where, orderBy: { createdAt: "desc" } });
}

export async function getTriage(id: string) {
  return prisma.sprintTriage.findUnique({ where: { id } });
}
