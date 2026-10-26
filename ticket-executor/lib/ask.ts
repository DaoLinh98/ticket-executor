import { spawn, type ChildProcess } from "child_process";
import { stripAnsi } from "./execution/format";

/** Ad-hoc Claude sessions — "open a terminal and ask something", reachable from
 *  a phone.
 *
 *  This is **not** a run engine and must never grow into one. There is no
 *  graph, no node, no output contract, no worktree, no branch, no pull request
 *  and no `DagentRun` row, which is exactly why it does not live under
 *  `lib/dagent/`: the engine's invariants (a declared JSON Schema per agent
 *  node, edges routing only on validated output) describe a machine that decides
 *  things unattended, and a free-form question decides nothing. Reusing
 *  `runTurn()` would have meant inventing a schema for a conversation.
 *
 *  It runs the CLI the way the developer would themselves: the ticket's Root
 *  repo as cwd, the machine's own MCP servers and plugins inherited, full
 *  permissions. The transcript lives in this process only — a restart loses it,
 *  which is the same deal a terminal window gives.
 *
 *  The one rule it does enforce: one live session per Root repo. Unlike a run,
 *  this executes in the checkout itself rather than a worktree, so two Claude
 *  processes in one tree would be two agents editing the same files.
 */

export type AskLine = { text: string; kind: string };
export type AskState = "idle" | "running" | "failed";

export type AskView = {
  rootRepo: string;
  state: AskState;
  logLines: AskLine[];
  error: string;
  /** Bumped on every change, so the SSE route can tell "nothing happened" from
   *  "the same text arrived twice" without diffing the whole transcript. */
  seq: number;
  /** True once a Claude session exists, i.e. the next prompt continues this one. */
  resuming: boolean;
};

type AskSession = {
  rootRepo: string;
  sessionId: string;
  state: AskState;
  logLines: AskLine[];
  error: string;
  seq: number;
  child: ChildProcess | null;
};

const sessions = new Map<string, AskSession>();

const MAX_LINES = 4000;

function push(s: AskSession, text: string, kind: string) {
  s.logLines.push({ text, kind });
  if (s.logLines.length > MAX_LINES) s.logLines.splice(0, s.logLines.length - MAX_LINES);
  s.seq++;
}

function view(s: AskSession): AskView {
  return {
    rootRepo: s.rootRepo,
    state: s.state,
    logLines: s.logLines,
    error: s.error,
    seq: s.seq,
    resuming: !!s.sessionId,
  };
}

function sandboxEnv(): Record<string, string> {
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  return asRoot ? { IS_SANDBOX: "1" } : {};
}

// The same NDJSON stream the engine reads, minus everything that only means
// something to a graph. Tool calls are shown because "what did it just do to my
// repo" is the whole reason to watch an unattended session.
function handleEvent(s: AskSession, obj: Record<string, unknown>) {
  const type = obj.type;

  if (type === "system" && obj.subtype === "init") {
    const sid = (obj as { session_id?: string }).session_id ?? "";
    if (sid) s.sessionId = sid;
    return;
  }

  if (type === "assistant") {
    const msg = obj.message as { content?: Array<Record<string, unknown>> } | undefined;
    for (const block of msg?.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") {
        block.text.split(/\r?\n/).forEach((l) => l.trim() && push(s, l, "step"));
      } else if (block.type === "tool_use") {
        const name = String(block.name ?? "");
        const input = (block.input ?? {}) as Record<string, unknown>;
        if (name.toLowerCase() === "bash" && typeof input.command === "string") {
          push(s, `$ ${input.command.split(/\r?\n/)[0].slice(0, 160)}`, "diff");
        } else if (typeof input.file_path === "string") {
          push(s, `✎ ${name} ${input.file_path}`, "file");
        } else {
          push(s, `✎ ${name}`, "muted");
        }
      }
    }
    return;
  }

  if (type === "result" && (obj as { is_error?: boolean }).is_error) {
    s.error = (typeof obj.result === "string" && obj.result) || "The turn ended with an error.";
    push(s, s.error, "err");
  }
}

function claudeArgs(prompt: string, resumeId: string, model: string, effort: string): string[] {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--allow-dangerously-skip-permissions",
    "--dangerously-skip-permissions",
  ];
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (resumeId) args.push("--resume", resumeId);
  return args;
}

export function getAsk(ticketId: string): AskView | null {
  const s = sessions.get(ticketId);
  return s ? view(s) : null;
}

/** Drop the transcript and the Claude session id, so the next prompt starts
 *  fresh. Refused mid-turn — a killed session id is not the same as a finished
 *  one. */
export function resetAsk(ticketId: string): { ok: boolean; error?: string } {
  const s = sessions.get(ticketId);
  if (s?.state === "running") return { ok: false, error: "A prompt is still running. Stop it first." };
  sessions.delete(ticketId);
  return { ok: true };
}

export function cancelAsk(ticketId: string): { ok: boolean; error?: string } {
  const s = sessions.get(ticketId);
  if (!s || s.state !== "running" || !s.child) return { ok: false, error: "Nothing is running." };
  const pid = s.child.pid;
  try {
    if (pid && process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    else s.child.kill("SIGTERM");
  } catch {
    /* already gone; the close handler settles the state either way */
  }
  return { ok: true };
}

export function startAsk(input: { ticketId: string; rootRepo: string; prompt: string; model?: string; effort?: string }): { ok: boolean; error?: string } {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, error: "Type a prompt first." };

  for (const [id, other] of sessions) {
    if (id !== input.ticketId && other.state === "running" && other.rootRepo === input.rootRepo)
      return {
        ok: false,
        error: `Another ticket is already asking Claude in ${input.rootRepo}. Wait for it to finish — two sessions in one checkout would edit the same files.`,
      };
  }

  let s = sessions.get(input.ticketId);
  // A different Root repo is a different conversation: the old session id points
  // at a transcript recorded somewhere else.
  if (s && s.rootRepo !== input.rootRepo) {
    sessions.delete(input.ticketId);
    s = undefined;
  }
  if (!s) {
    s = { rootRepo: input.rootRepo, sessionId: "", state: "idle", logLines: [], error: "", seq: 0, child: null };
    sessions.set(input.ticketId, s);
  }
  if (s.state === "running") return { ok: false, error: "This ticket is already waiting on Claude." };

  const session = s;
  session.state = "running";
  session.error = "";
  push(session, `> ${prompt}`, "cmd");

  let child: ChildProcess;
  try {
    child = spawn("claude", claudeArgs(prompt, session.sessionId, input.model ?? "", input.effort ?? ""), {
      cwd: session.rootRepo,
      env: { ...process.env, ...sandboxEnv() },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    session.state = "failed";
    session.error = e instanceof Error ? e.message : String(e);
    push(session, `✖ ${session.error}`, "err");
    return { ok: true };
  }
  session.child = child;

  let buf = "";
  child.stdout!.on("data", (b: Buffer) => {
    buf += stripAnsi(b.toString("utf8"));
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        handleEvent(session, JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        push(session, trimmed.slice(0, 300), "muted");
      }
    }
  });

  let errTail = "";
  child.stderr!.on("data", (b: Buffer) => {
    errTail = (errTail + stripAnsi(b.toString("utf8"))).slice(-2000);
  });

  child.on("error", (e) => {
    session.child = null;
    session.state = "failed";
    session.error = e.message;
    push(session, `✖ ${e.message}`, "err");
  });

  child.on("close", (code) => {
    session.child = null;
    if (code === 0) {
      session.state = "idle";
      session.seq++;
      return;
    }
    session.state = "failed";
    if (!session.error) session.error = errTail.trim() || `claude exited with code ${code}`;
    push(session, session.error, "err");
  });

  return { ok: true };
}
