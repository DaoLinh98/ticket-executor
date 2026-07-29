import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { decryptSecret } from "../crypto";
import { removeRunMcpConfig, resolveMcp, writeRunMcpConfig } from "../mcp";
import { prisma } from "../prisma";
import type { ExecPhase, ExecStatus, PlanStatus } from "../types";
import { isTwoPhaseSkill, PLAN_GATE_STEP, STEPS } from "../ui";
import { commonArgs, runTurn } from "./claudeCli";
import { cleanPath, fmtDuration } from "./format";
import { collectFileChanges, summarizeChanges } from "./git";
import { store } from "./store";
import type { Entry, TurnState } from "./types";

export { isTwoPhaseSkill };

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
        ...summarizeChanges(entry.filesChanged),
        endReason: entry.endReason,
        parkedAt: entry.parkedAt ? new Date(entry.parkedAt) : null,
        humanWaitMs: entry.humanWaitMs,
        planRevisions: entry.planRevisions,
        resumedAfterRestart: entry.resumedAfterRestart,
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

async function finish(entry: Entry, status: ExecStatus, error: string, endReason = "") {
  entry.status = status;
  entry.error = error;
  entry.endReason = endReason;
  entry.completedAt = Date.now();
  // A run killed while parked never resumes, so fold its outstanding wait in here
  // rather than losing it.
  if (entry.parkedAt) {
    entry.humanWaitMs += Math.max(0, Date.now() - entry.parkedAt);
    entry.parkedAt = null;
  }
  if (status === "completed") entry.currentStep = STEPS.length;
  if (status === "completed" && entry.baseSha) entry.filesChanged = collectFileChanges(entry.cwd, entry.baseSha);
  entry.logLines.push({
    text: status === "completed" ? `✔ Completed in ${fmtDuration(entry.completedAt - entry.startedAt)}` : `✖ ${error || "Execution failed"}`,
    kind: status === "completed" ? "done" : "fail",
  });
  await persist(entry);
  removeWorktree(entry);
  releaseMcp(entry);
}

// ---- MCP access for one turn ----

// Resolved per turn rather than once per run: a plan parked at the gate can
// resume after a dev-server restart (when the previous turn's file is long gone),
// and Settings may have changed in between. Never fails the run — the implement
// route is what blocks on a missing provider server; here a bad decision is only
// logged, so the run's own log explains what Claude was given.
async function prepareMcp(entry: Entry) {
  try {
    const [setting, cred] = await Promise.all([
      prisma.setting.findUnique({ where: { id: "default" } }),
      prisma.providerCredential.findUnique({ where: { provider: entry.provider } }),
    ]);
    const decision = await resolveMcp({
      provider: entry.provider,
      org: cred?.org ?? "",
      pat: decryptSecret(cred?.pat),
      manageMcp: setting?.manageMcp ?? true,
      cwd: entry.cwd,
    });
    entry.mcpConfigPath = writeRunMcpConfig(entry.id, decision);
    entry.logLines.push({
      text: `● MCP: ${decision.detail}${entry.mcpConfigPath ? " Only this server is loaded (--strict-mcp-config)." : ""}`,
      kind: "step",
    });
    if (decision.blocker) entry.logLines.push({ text: `⚠ ${decision.blocker}`, kind: "err" });
  } catch (e) {
    entry.mcpConfigPath = "";
    entry.logLines.push({
      text: `⚠ Could not prepare MCP access (${e instanceof Error ? e.message : e}) — the run falls back to this machine's own MCP config.`,
      kind: "err",
    });
  }
}

/** Delete the generated config as soon as the turn that needed it is over — it
 *  holds the PAT in clear text. */
function releaseMcp(entry: Entry) {
  removeRunMcpConfig(entry.mcpConfigPath);
  entry.mcpConfigPath = "";
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
  entry.parkedAt = Date.now();
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

// The run writes two things into the developer's repo that must never reach a
// commit: the plan-gate contract (`.te/`) and the isolated worktrees
// (`.te-worktrees/`). Ignoring them is done here rather than left to the skill:
// an agent that forgets commits the plan, and a stale worktree left by a
// crashed run would otherwise show up as untracked noise in every later diff.
// `.git/info/exclude` (not `.gitignore`) because that file is the project's own
// tracked file — the app has no business editing it. `--git-common-dir`
// resolves to the main repo even when called from inside a worktree, and
// info/exclude is shared by every worktree of the repo.
const TE_EXCLUDES = ["/.te/", "/.te-worktrees/"];

function excludeTeArtifacts(rootRepo: string) {
  try {
    const common = execSync(`git -C "${rootRepo}" rev-parse --path-format=absolute --git-common-dir`)
      .toString()
      .trim();
    if (!common) return;
    const file = path.join(common, "info", "exclude");
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    const lines = current.split(/\r?\n/).map((l) => l.trim());
    const missing = TE_EXCLUDES.filter((p) => !lines.includes(p));
    if (!missing.length) return;
    mkdirSync(path.dirname(file), { recursive: true });
    const prefix = current && !current.endsWith("\n") ? "\n" : "";
    writeFileSync(file, `${current}${prefix}# Ticket Executor run artifacts\n${missing.join("\n")}\n`, "utf8");
  } catch {
    /* not a git repo, or read-only .git — the skill's own exclude rule still applies */
  }
}

function writePlan(cwd: string, markdown: string) {
  mkdirSync(path.join(cwd, ".te"), { recursive: true });
  writeFileSync(path.join(cwd, PLAN_FILE), markdown, "utf8");
}

// ---- prompts ----

// The ticket is addressed by its provider URL when we know it: a URL names the
// org/project/work item unambiguously, so the skill can open it directly instead
// of searching the tracker for an id that several projects may share. Falls back
// to the raw id when the caller passed no URL.
function basePrompt(entry: Entry, prUrl: string, mode: string) {
  const ticket = `Ticket: ${entry.ticketUrl || entry.ticketId}`;
  const target = prUrl ? `PR: ${prUrl} - ${ticket}` : ticket;
  return `/${entry.skill} Provider: ${entry.provider} - ${target} - Project name: ${entry.project}${mode ? ` - Mode: ${mode}` : ""}`;
}

// The plan file on disk may have been edited by the reviewer, so the resume
// prompt has to say plainly that the file — not what the session already
// "remembers" proposing — is what gets built.
// Both resume prompts open with the same `Mode:` token the first turn used: the
// skill's mode table treats an absent Mode as "plan then implement in one go",
// so leaving it out would contradict the prose that follows.
const IMPLEMENT_PROMPT =
  "Mode: implement. The plan has been reviewed and approved. Re-read .te/plan.md from disk now — the reviewer may have edited it, " +
  "and where that file differs from the plan you proposed earlier, the file wins. Then run the implement phase " +
  "end-to-end: create the branch, implement the approved plan, verify, commit, push, and open the PR. Do not ask for confirmation. " +
  "You already explored this codebase in the plan phase — do not re-read files you have already read this session.";

const REPLAN_PROMPT =
  "Mode: replan. The plan was rejected. Read .te/feedback.md for the reviewer's reason, then rewrite .te/plan.md to address it. " +
  "Stay in plan mode: no source edits, no branch, no commit. Re-read only the code the feedback actually questions.";

// ---- lifecycle ----

export async function startExecution(params: {
  ticketId: string;
  /** Provider deep link to the ticket; the prompt prefers it over the raw id. */
  ticketUrl?: string;
  skill: string;
  project: string;
  rootRepo: string;
  prUrl?: string;
  provider?: string;
  model?: string;
  effort?: string;
  /** The team's estimate for this ticket in hours (0 = never sized). */
  estimateHours?: number;
  // true (default) → isolate the run in its own git worktree, so it can run
  // concurrently with other tickets. false (single-ticket mode) → run
  // directly in rootRepo; the caller guarantees no other run is in flight.
  isolate?: boolean;
}): Promise<string> {
  const ticketId = cleanPath(params.ticketId);
  const ticketUrl = params.ticketUrl ? cleanPath(params.ticketUrl) : "";
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
    id: "", ticketId, ticketUrl, project, skill, model, effort, command: "",
    status: "running", logLines: [], resultText: "", error: "", prUrl: "", branch: "",
    currentStep: 0, cwd: rootRepo, baseSha: "", filesChanged: [], startedAt: Date.now(), completedAt: null,
    child: null, cancelled: false, endReason: "",
    sessionId, phase: twoPhase ? "plan" : "implement", planStatus: "none", planMarkdown: "",
    parkedAt: null, humanWaitMs: 0, planRevisions: 0, resumedAfterRestart: false,
    rootRepo, provider, mcpConfigPath: "",
    costUsd: 0, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheCreationTokens: 0, numTurns: 0, durationMs: 0,
  };
  const prompt = basePrompt(entry, prUrl, twoPhase ? "plan" : "");
  const command = `cd ${rootRepo} && claude -p "${prompt}"${model ? ` --model ${model}` : ""}${effort ? ` --effort ${effort}` : ""}`;
  entry.command = command;

  const row = await prisma.execution.create({
    data: {
      adoTicketId: ticketId, projectName: project, skillName: skill, model, effort,
      estimateHours: Number.isFinite(params.estimateHours) ? Math.max(0, params.estimateHours!) : 0,
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

  excludeTeArtifacts(rootRepo);

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
    await prepareMcp(entry);
    const ts = await runTurn(entry, [
      "-p", prompt, "--session-id", sessionId, ...modelArgs, ...commonArgs(entry.mcpConfigPath, entry.cwd),
    ]);
    releaseMcp(entry);
    if (ts.resultText) entry.resultText = ts.resultText;
    accumulateUsage(entry, ts);

    if (entry.cancelled) {
      await finish(entry, "failed", "Cancelled by user", "cancelled");
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
    // ticketUrl is not persisted: only the first turn addresses the ticket, and a
    // rehydrated run only ever resumes with the Mode: implement/replan prompts.
    id: r.id, ticketId: r.adoTicketId, ticketUrl: "", project: r.projectName, skill: r.skillName,
    model: r.model, effort: r.effort, command: r.command,
    status: r.status as ExecStatus, logLines, resultText: r.resultText, error: r.errorMessage,
    prUrl: r.prUrl, branch: r.branch, currentStep: r.currentStep, cwd: r.worktreePath,
    baseSha: "", filesChanged: [], startedAt: r.startedAt.getTime(),
    completedAt: r.completedAt ? r.completedAt.getTime() : null,
    child: null, cancelled: false, endReason: r.endReason,
    sessionId: r.sessionId, phase: r.phase as ExecPhase, planStatus: r.planStatus as PlanStatus,
    planMarkdown: r.planMarkdown,
    parkedAt: r.parkedAt ? r.parkedAt.getTime() : null,
    humanWaitMs: r.humanWaitMs, planRevisions: r.planRevisions,
    // This rebuild IS the recovery — the in-process entry was gone.
    resumedAfterRestart: true,
    // Rows from before the rootRepo column existed isolated every run, so the
    // worktree's repo is two levels up from it; fall back to that derivation only then.
    rootRepo: r.rootRepo || path.dirname(path.dirname(r.worktreePath)),
    provider: r.provider, mcpConfigPath: "",
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
    await finish(entry, "failed", "Plan rejected — run cancelled by reviewer.", "plan-rejected");
    return { ok: true };
  }

  const modelArgs = [
    ...(entry.model ? ["--model", entry.model] : []),
    ...(entry.effort ? ["--effort", entry.effort] : []),
  ];
  const approving = action === "approve";

  // The run is leaving the gate either way — bank the time it spent waiting on
  // this reviewer before it starts computing again.
  if (entry.parkedAt) {
    entry.humanWaitMs += Math.max(0, Date.now() - entry.parkedAt);
    entry.parkedAt = null;
  }

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
    entry.planRevisions += 1;
    entry.currentStep = 3; // back to "Draft plan"
    entry.logLines.push({ text: "↻ Changes requested — re-planning", kind: "step" });
  }

  entry.status = "running";
  entry.completedAt = null;
  entry.cancelled = false;
  await persist(entry);

  const prompt = approving ? IMPLEMENT_PROMPT : REPLAN_PROMPT;
  void (async () => {
    await prepareMcp(entry);
    const ts = await runTurn(entry, [
      "-p", prompt, "--resume", entry.sessionId, ...modelArgs, ...commonArgs(entry.mcpConfigPath, entry.cwd),
    ]);
    releaseMcp(entry);
    if (ts.resultText) entry.resultText = ts.resultText;
    accumulateUsage(entry, ts);

    if (entry.cancelled) {
      await finish(entry, "failed", "Cancelled by user", "cancelled");
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
