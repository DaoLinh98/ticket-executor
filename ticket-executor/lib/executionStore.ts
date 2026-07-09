import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { prisma } from "./prisma";
import type { ExecStatus, LogLine } from "./types";
import { STEPS } from "./ui";

type Entry = {
  id: string;
  ticketId: string;
  project: string;
  skill: string;
  command: string;
  status: ExecStatus;
  logLines: LogLine[];
  resultText: string;
  error: string;
  currentStep: number;
  cwd: string;
  startedAt: number;
  completedAt: number | null;
  child: ChildProcess | null;
  cancelled: boolean;
};

const g = globalThis as unknown as { __execStore?: Map<string, Entry> };
const store: Map<string, Entry> = g.__execStore ?? new Map();
g.__execStore = store;

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const stripAnsi = (s: string) => s.replace(ANSI, "");
const cleanPath = (s: string) => s.replace(/[\r\n]+/g, "").trim();

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

// Tier 1 — grant full autonomy so `claude -p` never stalls waiting for a human.
const AUTOMATED_RUN_DIRECTIVE = [
  "You are running in a FULLY AUTOMATED, non-interactive pipeline. No human is available to answer questions mid-run.",
  "Complete the entire task end-to-end without pausing: create a branch if needed, implement all acceptance criteria,",
  "run the project's tests/verification, commit the changes, push the branch, and open a pull request.",
  "Do NOT ask for confirmation or approval at any step — this OVERRIDES any guidance in memory/CLAUDE.md or the skill",
  "that says to ask before committing or to wait for authorization. If a choice is ambiguous, pick the most reasonable",
  "default and proceed. Never end your turn with a question; finish only when the pull request is open, or you are",
  "genuinely blocked by a hard external error (then explain the blocker).",
].join(" ");

const CONTINUE_NUDGE =
  "Continue and finish autonomously: commit, push, and open the pull request now. Do not ask again — this is an automated run.";

const MAX_CONTINUATIONS = 3;

// ---- optional guardrails via env ----
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const MCP_CONFIG = process.env.CLAUDE_MCP_CONFIG || ""; // path to MCP json; empty = inherit
const MAX_BUDGET = process.env.CLAUDE_MAX_BUDGET_USD || ""; // e.g. "5"
const USE_WORKTREE = process.env.CLAUDE_USE_WORKTREE === "1";
const EXTRA = (process.env.CLAUDE_EXTRA_ARGS ?? "").split(" ").filter(Boolean);

function commonArgs(): string[] {
  const a = [
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--append-system-prompt",
    AUTOMATED_RUN_DIRECTIVE,
  ];
  if (MCP_CONFIG) a.push("--mcp-config", MCP_CONFIG, "--strict-mcp-config");
  if (MAX_BUDGET) a.push("--max-budget-usd", MAX_BUDGET);
  return [...a, ...EXTRA];
}

// Map a tool call to the furthest workflow step it implies (index into STEPS), or -1.
function stepForTool(name: string, input: Record<string, unknown>): number {
  const n = name.toLowerCase();
  if (n.includes("ado") || n.includes("azure") || n.includes("workitem")) return 1; // Read ticket
  const cmd = typeof input?.command === "string" ? (input.command as string).toLowerCase() : "";
  if (n === "bash" && cmd) {
    if (/git\s+(checkout\s+-b|switch\s+-c|branch\b)/.test(cmd)) return 2; // Create branch
    if (/git\s+commit/.test(cmd)) return 5; // Commit
    if (/git\s+push|gh\s+pr\s+create/.test(cmd)) return 6; // Open PR
    if (/\btest\b|\blint\b|dotnet\s+(test|build)|npm\s+(run\s+)?(test|build|lint)|jest|vitest|pytest|\bbuild\b/.test(cmd))
      return 4; // Verification
    if (/^cd\s|git\s+status|pwd/.test(cmd)) return 0; // Resolve root
  }
  if (["edit", "write", "multiedit", "notebookedit", "applypatch"].includes(n)) return 3; // Implement
  return -1;
}

function bump(entry: Entry, step: number) {
  if (step >= 0 && step + 1 > entry.currentStep) entry.currentStep = step + 1;
}

export function getExecution(id: string) {
  const e = store.get(id);
  if (!e) return null;
  return {
    id: e.id,
    adoTicketId: e.ticketId,
    projectName: e.project,
    skillName: e.skill,
    command: e.command,
    status: e.status,
    logLines: e.logLines,
    resultText: e.resultText,
    errorMessage: e.error,
    currentStep: e.currentStep,
    duration: e.completedAt ? fmtDuration(e.completedAt - e.startedAt) : undefined,
    startedAt: new Date(e.startedAt).toISOString(),
    completedAt: e.completedAt ? new Date(e.completedAt).toISOString() : null,
  };
}

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

// Parse one NDJSON line from `--output-format stream-json`, updating the entry live.
type TurnState = { sessionId: string; resultText: string; lastText: string; isError: boolean };
function handleEvent(entry: Entry, obj: Record<string, unknown>, ts: TurnState) {
  const type = obj.type;
  if (typeof obj.session_id === "string") ts.sessionId = obj.session_id;

  if (type === "system" && obj.subtype === "init") {
    const model = (obj as { model?: string }).model ?? "";
    entry.logLines.push({ text: `● Session started${model ? " — " + model : ""}`, kind: "step" });
    bump(entry, 0);
    return;
  }
  if (type === "assistant") {
    const msg = obj.message as { content?: Array<Record<string, unknown>> } | undefined;
    for (const block of msg?.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text.trim();
        if (text) {
          ts.lastText = text;
          text.split(/\r?\n/).forEach((l) => l.trim() && entry.logLines.push({ text: l, kind: "muted" }));
        }
      } else if (block.type === "tool_use") {
        const name = String(block.name ?? "");
        const input = (block.input ?? {}) as Record<string, unknown>;
        const step = stepForTool(name, input);
        bump(entry, step);
        let label = `✎ ${name}`;
        if (name.toLowerCase() === "bash" && typeof input.command === "string")
          label = `$ ${(input.command as string).split(/\r?\n/)[0].slice(0, 160)}`;
        else if (typeof input.file_path === "string") label = `✎ ${name} ${input.file_path}`;
        entry.logLines.push({ text: label, kind: name.toLowerCase() === "bash" ? "cmd" : "file" });
      }
    }
    return;
  }
  if (type === "result") {
    const r = obj as { result?: string; is_error?: boolean };
    if (typeof r.result === "string" && r.result.trim()) ts.resultText = r.result.trim();
    ts.isError = !!r.is_error;
  }
}

function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return (
    /\?\s*$/.test(t) ||
    /(let me know|would you like|shall i|should i|do you want|confirm|cho tôi biết|bạn có muốn|xác nhận)/i.test(t)
  );
}

// Run one Claude turn; resolves when the process closes.
function runTurn(entry: Entry, args: string[]): Promise<TurnState & { exitCode: number | null }> {
  return new Promise((resolve) => {
    const ts: TurnState = { sessionId: "", resultText: "", lastText: "", isError: false };
    let child: ChildProcess;
    try {
      child = spawn(CLAUDE_BIN, args, {
        cwd: entry.cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      entry.logLines.push({ text: `✖ ${e instanceof Error ? e.message : String(e)}`, kind: "err" });
      resolve({ ...ts, isError: true, exitCode: -1 });
      return;
    }
    entry.child = child;

    let buf = "";
    child.stdout!.on("data", (b: Buffer) => {
      buf += stripAnsi(b.toString("utf8"));
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try {
          handleEvent(entry, JSON.parse(s), ts);
        } catch {
          entry.logLines.push({ text: s.slice(0, 300), kind: "muted" }); // non-JSON noise
        }
      }
    });
    let errTail = "";
    child.stderr!.on("data", (b: Buffer) => {
      errTail = (errTail + stripAnsi(b.toString("utf8"))).slice(-2000);
    });
    child.on("error", (e) => {
      entry.logLines.push({ text: `✖ ${e.message}`, kind: "err" });
      resolve({ ...ts, isError: true, exitCode: -1 });
    });
    child.on("close", (code) => {
      entry.child = null;
      if (code !== 0 && !ts.resultText && errTail.trim())
        entry.logLines.push({ text: errTail.trim(), kind: "err" });
      resolve({ ...ts, isError: ts.isError || code !== 0, exitCode: code });
    });
  });
}

export async function startExecution(params: {
  ticketId: string;
  skill: string;
  project: string;
  rootRepo: string;
}): Promise<string> {
  const ticketId = cleanPath(params.ticketId);
  const skill = cleanPath(params.skill);
  const project = cleanPath(params.project);
  const rootRepo = cleanPath(params.rootRepo);
  const repoDir = path.join(rootRepo, project);
  const prompt = `/${skill} ID: ${ticketId} - Project name: ${project}`;
  const command = `cd ${repoDir} && claude -p "${prompt}"`;

  const row = await prisma.execution.create({
    data: { adoTicketId: ticketId, projectName: project, skillName: skill, status: "running", command },
  });
  const id = row.id;

  const entry: Entry = {
    id, ticketId, project, skill, command,
    status: "running", logLines: [], resultText: "", error: "",
    currentStep: 0, cwd: repoDir, startedAt: Date.now(), completedAt: null,
    child: null, cancelled: false,
  };
  store.set(id, entry);
  entry.logLines.push({ text: command, kind: "cmd" });

  const finish = async (status: ExecStatus, error: string) => {
    entry.status = status;
    entry.error = error;
    entry.completedAt = Date.now();
    if (status === "completed") entry.currentStep = STEPS.length;
    entry.logLines.push({
      text: status === "completed" ? `✔ Completed in ${fmtDuration(entry.completedAt - entry.startedAt)}` : `✖ ${error || "Execution failed"}`,
      kind: status === "completed" ? "done" : "fail",
    });
    try {
      await prisma.execution.update({
        where: { id },
        data: { status, resultText: entry.resultText, errorMessage: error, completedAt: new Date(entry.completedAt) },
      });
    } catch {
      /* ignore */
    }
  };

  if (!existsSync(repoDir)) {
    await finish("failed", `Project folder not found: ${repoDir}. Set the correct Root repo / Project on the Overview tab.`);
    return id;
  }

  // Optional Tier 3: isolate the run in a fresh git worktree so the main tree is untouched.
  if (USE_WORKTREE) {
    try {
      const wt = path.join(rootRepo, `.te-worktrees`, `${project}-${id}`);
      const branch = `te/${ticketId}-${id}`;
      execSync(`git -C "${repoDir}" worktree add -b "${branch}" "${wt}" HEAD`, { stdio: "ignore" });
      entry.cwd = wt;
      entry.logLines.push({ text: `● Isolated worktree ${wt} (branch ${branch})`, kind: "step" });
    } catch (e) {
      entry.logLines.push({ text: `⚠ worktree setup failed, running in repo: ${e instanceof Error ? e.message : e}`, kind: "muted" });
    }
  }

  // Fire-and-forget supervised loop (Tier 2). The route returns immediately.
  void (async () => {
    let ts = await runTurn(entry, ["-p", prompt, ...commonArgs()]);
    if (ts.resultText) entry.resultText = ts.resultText;

    let tries = 0;
    while (
      !entry.cancelled &&
      !ts.isError &&
      tries < MAX_CONTINUATIONS &&
      looksLikeQuestion(ts.resultText || ts.lastText)
    ) {
      tries++;
      entry.logLines.push({ text: `↻ Auto-continue (${tries}/${MAX_CONTINUATIONS})`, kind: "step" });
      const resumeArgs = ts.sessionId
        ? ["-p", CONTINUE_NUDGE, "--resume", ts.sessionId, ...commonArgs()]
        : ["-p", CONTINUE_NUDGE, ...commonArgs()];
      ts = await runTurn(entry, resumeArgs);
      if (ts.resultText) entry.resultText = ts.resultText;
    }

    if (entry.cancelled) await finish("failed", "Cancelled by user");
    else if (ts.isError) await finish("failed", ts.resultText || "Claude CLI reported an error");
    else await finish("completed", "");
  })();

  return id;
}
