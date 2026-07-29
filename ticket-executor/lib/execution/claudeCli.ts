import { spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { detectArtifacts, stripAnsi } from "./format";
import { bump, stepForTool } from "./steps";
import type { Entry, TurnState } from "./types";

// ---- optional guardrails via env ----
export const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const MCP_CONFIG = process.env.CLAUDE_MCP_CONFIG || ""; // path to MCP json; empty = inherit
const MAX_BUDGET = process.env.CLAUDE_MAX_BUDGET_USD || ""; // e.g. "5"
const EXTRA = (process.env.CLAUDE_EXTRA_ARGS ?? "").split(" ").filter(Boolean);
// Escape hatch: keep the machine's plugins loaded for runs (see disablePluginArgs).
const KEEP_PLUGINS = /^(1|true)$/i.test(process.env.CLAUDE_KEEP_PLUGINS ?? "");

// A run's system prompt is paid for on every turn, and on a developer machine
// most of it is context the four skills never use. Measured on this machine with
// a one-word prompt (cache_creation_input_tokens):
//   inherit everything ........ 26,832
//   + --strict-mcp-config ..... 11,308   (-15,524: every other MCP server's tools)
//   + plugins disabled .........  5,964   (-5,344: plugin skills/commands/hooks)
// Both cuts are applied below. Skills installed in ~/.claude/skills — which is
// where this app installs its four — are *not* plugin-provided and still load.

/** Every plugin key the CLI would enable for a run in `cwd`, across the settings
 *  files it merges. Keys look like `<plugin>@<marketplace>`; a value of `false`
 *  already means disabled, so those are skipped. */
function enabledPluginKeys(cwd: string): string[] {
  const files = [
    path.join(homedir(), ".claude", "settings.json"),
    path.join(homedir(), ".claude", "settings.local.json"),
    path.join(cwd, ".claude", "settings.json"),
    path.join(cwd, ".claude", "settings.local.json"),
  ];
  const keys = new Set<string>();
  for (const f of files) {
    try {
      if (!existsSync(f)) continue;
      const json = JSON.parse(readFileSync(f, "utf8")) as { enabledPlugins?: Record<string, unknown> };
      for (const [k, v] of Object.entries(json.enabledPlugins ?? {})) {
        if (v !== false) keys.add(k);
      }
    } catch {
      /* unreadable or malformed settings — nothing to turn off from it */
    }
  }
  return [...keys];
}

/** `--settings` with every plugin explicitly switched off. It is an *overlay*:
 *  only `enabledPlugins` is overridden, so the user's other settings still
 *  apply. Runs are non-interactive and drive one known skill, so a plugin's
 *  extra skills, slash commands, MCP servers and hooks are pure overhead here —
 *  but a developer who deliberately relies on one can set CLAUDE_KEEP_PLUGINS=1. */
function disablePluginArgs(cwd: string): string[] {
  if (KEEP_PLUGINS) return [];
  const keys = enabledPluginKeys(cwd);
  if (!keys.length) return [];
  const enabledPlugins = Object.fromEntries(keys.map((k) => [k, false]));
  return ["--settings", JSON.stringify({ enabledPlugins })];
}

/** `mcpConfigPath` is the MCP config written for this turn (see lib/mcp.ts) —
 *  the app-generated provider server, or the user's own server pinned into a
 *  single-server file. Either way it is passed with --strict-mcp-config so the
 *  run sees *only* that server: the four skills need nothing but the provider
 *  server plus git/gh/glab on the PATH. An explicit CLAUDE_MCP_CONFIG still
 *  wins — a deliberate override, also strict. With no config path at all
 *  (nothing pinnable, e.g. a remote server the CLI authenticates itself) the run
 *  falls back to inheriting the machine's servers. */
export function commonArgs(mcpConfigPath: string | undefined, cwd: string): string[] {
  const a = [
    "--output-format",
    "stream-json",
    "--verbose",
    "--allow-dangerously-skip-permissions",
    "--dangerously-skip-permissions",
  ];
  if (MCP_CONFIG) a.push("--mcp-config", MCP_CONFIG, "--strict-mcp-config");
  else if (mcpConfigPath) a.push("--mcp-config", mcpConfigPath, "--strict-mcp-config");
  if (MAX_BUDGET) a.push("--max-budget-usd", MAX_BUDGET);
  return [...a, ...disablePluginArgs(cwd), ...EXTRA];
}

// Parse one NDJSON line from `--output-format stream-json`, updating the entry live.
function handleEvent(entry: Entry, obj: Record<string, unknown>, ts: TurnState) {
  const type = obj.type;

  if (type === "system" && obj.subtype === "init") {
    const model = (obj as { model?: string }).model ?? "";
    const sid = (obj as { session_id?: string }).session_id ?? "";
    // Trust the CLI's own id over the one we pre-assigned — --resume must use
    // exactly what the session was actually recorded under.
    if (sid) entry.sessionId = sid;
    entry.logLines.push({ text: `● Session started${model ? " — " + model : ""}`, kind: "step" });
    if (entry.phase === "plan") bump(entry, 0);
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
        const step = stepForTool(name, input, entry.phase);
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
    const r = obj as {
      result?: string;
      is_error?: boolean;
      total_cost_usd?: number;
      num_turns?: number;
      duration_ms?: number;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    };
    if (typeof r.result === "string" && r.result.trim()) {
      ts.resultText = r.result.trim();
      detectArtifacts(entry, ts.resultText);
    }
    ts.isError = !!r.is_error;
    // Token & cost usage reported once on the final result event of the turn.
    const u = r.usage ?? {};
    ts.costUsd = typeof r.total_cost_usd === "number" ? r.total_cost_usd : 0;
    ts.numTurns = typeof r.num_turns === "number" ? r.num_turns : 0;
    ts.durationMs = typeof r.duration_ms === "number" ? r.duration_ms : 0;
    ts.inputTokens = u.input_tokens ?? 0;
    ts.outputTokens = u.output_tokens ?? 0;
    ts.cacheReadTokens = u.cache_read_input_tokens ?? 0;
    ts.cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
  }
}

// Run one Claude turn; resolves when the process closes.
export function runTurn(entry: Entry, args: string[]): Promise<TurnState & { exitCode: number | null }> {
  return new Promise((resolve) => {
    const ts: TurnState = {
      resultText: "", isError: false, errorDetail: "",
      costUsd: 0, inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheCreationTokens: 0, numTurns: 0, durationMs: 0,
    };
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
