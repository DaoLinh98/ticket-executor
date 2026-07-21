import { spawn, type ChildProcess } from "child_process";
import { detectArtifacts, stripAnsi } from "./format";
import { bump, stepForTool } from "./steps";
import type { Entry, TurnState } from "./types";

// ---- optional guardrails via env ----
export const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const MCP_CONFIG = process.env.CLAUDE_MCP_CONFIG || ""; // path to MCP json; empty = inherit
const MAX_BUDGET = process.env.CLAUDE_MAX_BUDGET_USD || ""; // e.g. "5"
const EXTRA = (process.env.CLAUDE_EXTRA_ARGS ?? "").split(" ").filter(Boolean);

export function commonArgs(): string[] {
  const a = [
    "--output-format",
    "stream-json",
    "--verbose",
    "--allow-dangerously-skip-permissions",
    "--dangerously-skip-permissions",
  ];
  if (MCP_CONFIG) a.push("--mcp-config", MCP_CONFIG, "--strict-mcp-config");
  if (MAX_BUDGET) a.push("--max-budget-usd", MAX_BUDGET);
  return [...a, ...EXTRA];
}

// Parse one NDJSON line from `--output-format stream-json`, updating the entry live.
function handleEvent(entry: Entry, obj: Record<string, unknown>, ts: TurnState) {
  const type = obj.type;

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
          detectArtifacts(entry, text);
          text.split(/\r?\n/).forEach((l) => l.trim() && entry.logLines.push({ text: l, kind: "muted" }));
        }
      } else if (block.type === "tool_use") {
        const name = String(block.name ?? "");
        const input = (block.input ?? {}) as Record<string, unknown>;
        const step = stepForTool(name, input);
        bump(entry, step);
        let label = `✎ ${name}`;
        if (name.toLowerCase() === "bash" && typeof input.command === "string") {
          const cmd = input.command as string;
          detectArtifacts(entry, cmd);
          label = `$ ${cmd.split(/\r?\n/)[0].slice(0, 160)}`;
        } else if (typeof input.file_path === "string") label = `✎ ${name} ${input.file_path}`;
        entry.logLines.push({ text: label, kind: name.toLowerCase() === "bash" ? "cmd" : "file" });
      }
    }
    return;
  }
  if (type === "result") {
    const r = obj as { result?: string; is_error?: boolean };
    if (typeof r.result === "string" && r.result.trim()) {
      ts.resultText = r.result.trim();
      detectArtifacts(entry, ts.resultText);
    }
    ts.isError = !!r.is_error;
  }
}

// Run one Claude turn; resolves when the process closes.
export function runTurn(entry: Entry, args: string[]): Promise<TurnState & { exitCode: number | null }> {
  return new Promise((resolve) => {
    const ts: TurnState = { resultText: "", isError: false, errorDetail: "" };
    let child: ChildProcess;
    try {
      child = spawn(CLAUDE_BIN, args, {
        cwd: entry.cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      entry.logLines.push({ text: `✖ ${detail}`, kind: "err" });
      resolve({ ...ts, isError: true, errorDetail: detail, exitCode: -1 });
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
      resolve({ ...ts, isError: true, errorDetail: e.message, exitCode: -1 });
    });
    child.on("close", (code) => {
      entry.child = null;
      if (code !== 0 && !ts.resultText) {
        const detail = errTail.trim() || `claude exited with code ${code}`;
        entry.logLines.push({ text: detail, kind: "err" });
        ts.errorDetail = detail;
      }
      resolve({ ...ts, isError: ts.isError || code !== 0, exitCode: code });
    });
  });
}
