import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { prisma } from "../prisma";
import type { ExecPhase, ExecStatus, PlanStatus } from "../types";
import { PLAN_GATE_STEP, STEPS } from "../ui";
import { commonArgs, runTurn } from "./claudeCli";
import { cleanPath, fmtDuration } from "./format";
import { collectFileChanges } from "./git";
import { store } from "./store";
import type { Entry, TurnState } from "./types";

// Skills that run in two phases with a human plan-review gate in between.
// Everything else (implement-ticket-v2, fix-code-review-v2, …) keeps the old
// single-turn behaviour.
const TWO_PHASE_SKILLS = new Set(["implement-ticket-v3", "fix-code-review-v3"]);
export const isTwoPhaseSkill = (skill: string) => TWO_PHASE_SKILLS.has(skill);

// Where the plan phase leaves its deliverable, relative to the run's worktree.
const PLAN_FILE = path.join(".te", "plan.md");
const FEEDBACK_FILE = path.join(".te", "feedback.md");

export function cancelExecution(id: string): boolean {
  const e = store.get(id);
  if (!e || e.status !== "running") return false;
  e.cancelled = true;
  const pid = e.child?.pid;
  try {
    if (pid && process.platform === "win32") execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    else e.child?.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  return true;
}

// A run can span several turns (plan → implement, or replans in between), each
// ending with its own `result` event; accumulate their usage so the persisted
// totals reflect the whole run's spend.
function accumulateUsage(entry: Entry, ts: TurnState) {
  entry.costUsd += ts.costUsd;
  entry.inputTokens += ts.inputTokens;
  entry.outputTokens += ts.outputTokens;
  entry.cacheReadTokens += ts.cacheReadTokens;
  entry.cacheCreationTokens += ts.cacheCreationTokens;
  entry.numTurns += ts.numTurns;
  entry.durationMs += ts.durationMs;
}

// ---- shared persistence ----

async function persist(entry: Entry) {
  try {
    await prisma.execution.update({
      where: { id: entry.id },
      data: {
        status: entry.status,
        resultText: entry.resultText,
        errorMessage: entry.error,
        logLines: JSON.stringify(entry.logLines),
        currentStep: entry.currentStep,
        prUrl: entry.prUrl,
        branch: entry.branch,
        filesChanged: JSON.stringify(entry.filesChanged),
        sessionId: entry.sessionId,
        worktreePath: entry.cwd,
        rootRepo: entry.rootRepo,
        phase: entry.phase,
        planStatus: entry.planStatus,
        planMarkdown: entry.planMarkdown,
        costUsd: entry.costUsd,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cacheReadTokens: entry.cacheReadTokens,
        cacheCreationTokens: entry.cacheCreationTokens,
        numTurns: entry.numTurns,
        durationMs: entry.durationMs,
        completedAt: entry.completedAt ? new Date(entry.completedAt) : null,
      },
    });
  } catch {
    /* ignore — the in-memory entry stays authoritative for live views */
  }
}

async function finish(entry: Entry, status: ExecStatus, error: string) {
  entry.status = status;
  entry.error = error;
  entry.completedAt = Date.now();
  if (status === "completed") entry.currentStep = STEPS.length;
  if (status === "completed" && entry.baseSha) entry.filesChanged = collectFileChanges(entry.cwd, entry.baseSha);
  entry.logLines.push({
    text: status === "completed" ? `✔ Completed in ${fmtDuration(entry.completedAt - entry.startedAt)}` : `✖ ${error || "Execution failed"}`,
    kind: status === "completed" ? "done" : "fail",
  });
  await persist(entry);
  removeWorktree(entry);
}

// A finished (completed/failed) isolated run no longer needs its worktree: the
// Result/Commits tabs read the persisted filesChanged, and the branch/commits
// it created live in the real repo (removing the worktree does not touch them).
// Best-effort — a lingering file lock on Windows can block removal; leaving the
// folder is harmless. Never touches rootRepo (single-ticket mode ran there).
function removeWorktree(entry: Entry) {
  if (!entry.cwd || entry.cwd === entry.rootRepo || !entry.rootRepo) return;
  try {
    execSync(`git -C "${entry.rootRepo}" worktree remove --force "${entry.cwd}"`, { stdio: "ignore" });
  } catch {
    /* leave the worktree if git can't remove it right now */
  }
}

// Park the run at the plan gate: no child process is alive, and the entry waits
// for POST /api/executions/:id/plan to resume or discard it.
async function park(entry: Entry, planMarkdown: string) {
  entry.status = "awaiting-approval";
  entry.phase = "plan";
  entry.planStatus = "pending";
  entry.planMarkdown = planMarkdown;
  entry.currentStep = PLAN_GATE_STEP;
  entry.logLines.push({ text: "⏸ Plan ready — waiting for your review", kind: "step" });
  await persist(entry);
}

function readPlan(cwd: string): string {
  try {
    return readFileSync(path.join(cwd, PLAN_FILE), "utf8").trim();
  } catch {
    return "";
  }
}

function writePlan(cwd: string, markdown: string) {
  mkdirSync(path.join(cwd, ".te"), { recursive: true });
  writeFileSync(path.join(cwd, PLAN_FILE), markdown, "utf8");
}

// ---- prompts ----

function basePrompt(entry: Entry, prUrl: string, mode: string) {
  const target = prUrl ? `PR: ${prUrl} - Ticket ID: ${entry.ticketId}` : `ID: ${entry.ticketId}`;
  return `/${entry.skill} Provider: ${entry.provider} - ${target} - Project name: ${entry.project}${mode ? ` - Mode: ${mode}` : ""}`;
}

// The plan file on disk may have been edited by the reviewer, so the resume
// prompt has to say plainly that the file — not what the session already
// "remembers" proposing — is what gets built.
const IMPLEMENT_PROMPT =
  "The plan has been reviewed and approved. Re-read .te/plan.md from disk now — the reviewer may have edited it, " +
  "and where that file differs from the plan you proposed earlier, the file wins. Then run the implement phase " +
  "end-to-end: create the branch, implement the approved plan, verify, commit, push, and open the PR. Do not ask for confirmation.";

const REPLAN_PROMPT =
  "The plan was rejected. Read .te/feedback.md for the reviewer's reason, then rewrite .te/plan.md to address it. " +
  "Stay in plan mode: no source edits, no branch, no commit.";

// ---- lifecycle ----

export async function startExecution(params: {
  ticketId: string;
  skill: string;
  project: string;
  rootRepo: string;
  prUrl?: string;
  provider?: string;
  model?: string;
  effort?: string;
  // true (default) → isolate the run in its own git worktree, so it can run
  // concurrently with other tickets. false (single-ticket mode) → run
  // directly in rootRepo; the caller guarantees no other run is in flight.
  isolate?: boolean;
}): Promise<string> {
  const ticketId = cleanPath(params.ticketId);
  const skill = cleanPath(params.skill);
  const project = cleanPath(params.project);
  const rootRepo = cleanPath(params.rootRepo);
  const prUrl = params.prUrl ? cleanPath(params.prUrl) : "";
  const provider = cleanPath(params.provider || "azure-devops");
  const model = params.model ? cleanPath(params.model) : "";
  const effort = params.effort ? cleanPath(params.effort) : "";
  const isolate = params.isolate ?? true;

  const twoPhase = isTwoPhaseSkill(skill);
  const sessionId = randomUUID();
  const modelArgs = [...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : [])];

  const entry: Entry = {
    id: "", ticketId, project, skill, model, effort, command: "",
    status: "running", logLines: [], resultText: "", error: "", prUrl: "", branch: "",
    currentStep: 0, cwd: rootRepo, baseSha: "", filesChanged: [], startedAt: Date.now(), completedAt: null,
    child: null, cancelled: false,
    sessionId, phase: twoPhase ? "plan" : "implement", planStatus: "none", planMarkdown: "",
    rootRepo, provider,
    costUsd: 0, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheCreationTokens: 0, numTurns: 0, durationMs: 0,
  };
  const prompt = basePrompt(entry, prUrl, twoPhase ? "plan" : "");
  const command = `cd ${rootRepo} && claude -p "${prompt}"${model ? ` --model ${model}` : ""}${effort ? ` --effort ${effort}` : ""}`;
  entry.command = command;

  const row = await prisma.execution.create({
    data: {
      adoTicketId: ticketId, projectName: project, skillName: skill, model, effort,
      status: "running", command, sessionId, phase: entry.phase,
      planStatus: twoPhase ? "pending" : "none", provider,
    },
  });
  entry.id = row.id;
  const id = row.id;
  store.set(id, entry);
  entry.logLines.push({ text: command, kind: "cmd" });

  if (!existsSync(rootRepo)) {
    await finish(entry, "failed", `Project folder not found: ${rootRepo}. Set the correct Root repo / Project on the Overview tab.`);
    return id;
  }

  if (isolate) {
    // Isolate the run in a fresh git worktree so concurrent executions against the same
    // rootRepo/project never share one working tree, git index, or HEAD (which would otherwise let
    // one execution's uncommitted changes leak into another's commit). Checked out detached (no
    // branch of its own) — the skill's own "create a branch" step creates the one real branch, from
    // inside this worktree.
    try {
      const wt = path.join(rootRepo, `.te-worktrees`, `${project}-${id}`);
      entry.baseSha = execSync(`git -C "${rootRepo}" rev-parse HEAD`).toString().trim();
      execSync(`git -C "${rootRepo}" worktree add --detach "${wt}" HEAD`, { stdio: "ignore" });
      entry.cwd = wt;
      entry.logLines.push({ text: `● Isolated worktree ${wt}`, kind: "step" });
    } catch (e) {
      await finish(entry, "failed", `Failed to set up isolated git worktree: ${e instanceof Error ? e.message : e}. Concurrent executions require worktree isolation to avoid commit leakage between tickets.`);
      return id;
    }
  } else {
    // Single-ticket mode: no other run is in flight (enforced by the caller), so
    // run directly in rootRepo — skip the worktree entirely.
    try {
      entry.baseSha = execSync(`git -C "${rootRepo}" rev-parse HEAD`).toString().trim();
    } catch {
      /* not a git repo, or no commits yet — diffs for the Result tab will just be empty */
    }
  }

  // Fire-and-forget. The route returns immediately; the turn either finishes the
  // whole ticket (single-phase skills) or parks at the plan gate (two-phase).
  void (async () => {
    const ts = await runTurn(entry, ["-p", prompt, "--session-id", sessionId, ...modelArgs, ...commonArgs()]);
    if (ts.resultText) entry.resultText = ts.resultText;
    accumulateUsage(entry, ts);

    if (entry.cancelled) {
      await finish(entry, "failed", "Cancelled by user");
      return;
    }
    if (ts.isError) {
      await finish(entry, "failed", ts.resultText || ts.errorDetail || "Claude CLI reported an error");
      return;
    }
    if (!twoPhase) {
      await finish(entry, "completed", "");
      return;
    }
    const plan = readPlan(entry.cwd);
    if (!plan) {
      await finish(entry, "failed", "The plan phase finished without writing .te/plan.md — nothing to review.");
      return;
    }
    await park(entry, plan);
  })();

  return id;
}

// Rebuild a usable Entry from the persisted row. Needed because the in-memory
// store is process-local and not persisted: a run parked at the plan gate can
// outlive a dev-server restart, and its approval still has to work.
async function rehydrate(id: string): Promise<Entry | null> {
  const r = await prisma.execution.findUnique({ where: { id } });
  if (!r || !r.sessionId || !r.worktreePath) return null;
  let logLines: Entry["logLines"] = [];
  try {
    const parsed = JSON.parse(r.logLines);
    if (Array.isArray(parsed)) logLines = parsed;
  } catch {
    /* start with an empty log rather than failing the resume */
  }
  const entry: Entry = {
    id: r.id, ticketId: r.adoTicketId, project: r.projectName, skill: r.skillName,
    model: r.model, effort: r.effort, command: r.command,
    status: r.status as ExecStatus, logLines, resultText: r.resultText, error: r.errorMessage,
    prUrl: r.prUrl, branch: r.branch, currentStep: r.currentStep, cwd: r.worktreePath,
    baseSha: "", filesChanged: [], startedAt: r.startedAt.getTime(),
    completedAt: r.completedAt ? r.completedAt.getTime() : null,
    child: null, cancelled: false,
    sessionId: r.sessionId, phase: r.phase as ExecPhase, planStatus: r.planStatus as PlanStatus,
    planMarkdown: r.planMarkdown,
    // Rows from before the rootRepo column existed isolated every run, so the
    // worktree's repo is two levels up from it; fall back to that derivation only then.
    rootRepo: r.rootRepo || path.dirname(path.dirname(r.worktreePath)),
    provider: r.provider,
    costUsd: r.costUsd, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens, cacheCreationTokens: r.cacheCreationTokens,
    numTurns: r.numTurns, durationMs: r.durationMs,
  };
  try {
    entry.baseSha = execSync(`git -C "${entry.cwd}" rev-parse HEAD`).toString().trim();
  } catch {
    /* diffs for the Result tab will just be empty */
  }
  store.set(id, entry);
  return entry;
}

export type PlanAction = "approve" | "revise" | "cancel";

// Resolve a run parked at the plan gate. `plan` carries the reviewer's (possibly
// edited) markdown, which is written back to .te/plan.md before resuming so the
// file on disk is always the authoritative version.
export async function resolvePlan(
  id: string,
  action: PlanAction,
  opts?: { plan?: string; feedback?: string }
): Promise<{ ok: true } | { ok: false; error: string; code: number }> {
  const entry = store.get(id) ?? (await rehydrate(id));
  if (!entry) return { ok: false, error: "Execution not found", code: 404 };
  if (entry.status !== "awaiting-approval")
    return { ok: false, error: `Execution is not awaiting approval (status: ${entry.status})`, code: 409 };
  if (!entry.sessionId)
    return { ok: false, error: "This run has no Claude session to resume", code: 409 };

  const editedPlan = (opts?.plan ?? "").trim();
  if (editedPlan && editedPlan !== entry.planMarkdown) {
    try {
      writePlan(entry.cwd, editedPlan);
      entry.planMarkdown = editedPlan;
      entry.logLines.push({ text: "✎ Plan edited by reviewer", kind: "file" });
    } catch (e) {
      return { ok: false, error: `Failed to write the edited plan: ${e instanceof Error ? e.message : e}`, code: 500 };
    }
  }

  if (action === "cancel") {
    entry.planStatus = "rejected";
    await finish(entry, "failed", "Plan rejected — run cancelled by reviewer.");
    return { ok: true };
  }

  const modelArgs = [
    ...(entry.model ? ["--model", entry.model] : []),
    ...(entry.effort ? ["--effort", entry.effort] : []),
  ];
  const approving = action === "approve";

  if (approving) {
    entry.planStatus = "approved";
    entry.phase = "implement";
    entry.currentStep = PLAN_GATE_STEP + 1;
    entry.logLines.push({ text: "▸ Plan approved — resuming to implement", kind: "step" });
  } else {
    const feedback = (opts?.feedback ?? "").trim();
    if (!feedback) return { ok: false, error: "Feedback is required to request changes", code: 400 };
    try {
      mkdirSync(path.join(entry.cwd, ".te"), { recursive: true });
      writeFileSync(path.join(entry.cwd, FEEDBACK_FILE), feedback, "utf8");
    } catch (e) {
      return { ok: false, error: `Failed to write feedback: ${e instanceof Error ? e.message : e}`, code: 500 };
    }
    entry.planStatus = "rejected";
    entry.phase = "plan";
    entry.currentStep = 3; // back to "Draft plan"
    entry.logLines.push({ text: "↻ Changes requested — re-planning", kind: "step" });
  }

  entry.status = "running";
  entry.completedAt = null;
  entry.cancelled = false;
  await persist(entry);

  const prompt = approving ? IMPLEMENT_PROMPT : REPLAN_PROMPT;
  void (async () => {
    const ts = await runTurn(entry, [
      "-p", prompt, "--resume", entry.sessionId, ...modelArgs, ...commonArgs(),
    ]);
    if (ts.resultText) entry.resultText = ts.resultText;
    accumulateUsage(entry, ts);

    if (entry.cancelled) {
      await finish(entry, "failed", "Cancelled by user");
      return;
    }
    if (ts.isError) {
      await finish(entry, "failed", ts.resultText || ts.errorDetail || "Claude CLI reported an error");
      return;
    }
    if (approving) {
      await finish(entry, "completed", "");
      return;
    }
    const plan = readPlan(entry.cwd);
    if (!plan) {
      await finish(entry, "failed", "The re-plan finished without updating .te/plan.md — nothing to review.");
      return;
    }
    await park(entry, plan);
  })();

  return { ok: true };
}
