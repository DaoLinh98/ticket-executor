import { spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { stripAnsi } from "./format";
import type { LiveRun, TurnUsage } from "./graph/types";
import { ZERO_USAGE } from "./graph/types";

// ---- optional guardrails via env ----
export const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const MCP_CONFIG = process.env.CLAUDE_MCP_CONFIG || ""; // path to MCP json; empty = inherit
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

export type TurnArgs = {
  /** MCP config written for this turn (see lib/mcp.ts) — the app-generated
   *  provider server, or the user's own server pinned into a single-server file.
   *  Either way it is passed with --strict-mcp-config so the run sees *only* that
   *  server: the four skills need nothing but the provider server plus git/gh/glab
   *  on the PATH. An explicit CLAUDE_MCP_CONFIG still wins. With no config path at
   *  all the run falls back to inheriting the machine's servers. */
  mcpConfigPath: string;
  cwd: string;
  /** The node's output contract. Passed as --json-schema, which makes the CLI
   *  force a StructuredOutput tool call and report the validated object on the
   *  final `result` event. Required for agent nodes — a node with no declared
   *  output gives its edges nothing to branch on. */
  outputSchema: Record<string, unknown>;
};

export function commonArgs(a: TurnArgs): string[] {
  const args = [
    "--output-format",
    "stream-json",
    "--verbose",
    "--allow-dangerously-skip-permissions",
    "--dangerously-skip-permissions",
    "--disallowedTools",
    "Agent",
    "--json-schema",
    JSON.stringify(a.outputSchema),
  ];
  if (MCP_CONFIG) args.push("--mcp-config", MCP_CONFIG, "--strict-mcp-config");
  else if (a.mcpConfigPath) args.push("--mcp-config", a.mcpConfigPath, "--strict-mcp-config");
  return [...args, ...disablePluginArgs(a.cwd), ...EXTRA];
}

// ---- account limits ----

// The CLI reports a spent account by ending the turn with is_error and a message
// naming the reset time ("You've hit your session limit · resets 7:50pm
// (Asia/Ho_Chi_Minh)"). This reads that one message, and only that one — it is
// not a regex over the run's log, which the harness owns and must never
// re-derive state from. The message is the *only* channel the CLI gives for the
// one failure that is not the agent's fault and is not permanent, and the
// alternative is scoring a spent quota as a failed ticket.
const LIMIT_LINE = /\blimit\b/i;
const RESET_AT = /\bresets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
const RESET_ZONE = /\(([A-Za-z]+(?:\/[A-Za-z_+-]+)+)\)/;

/** The zone's offset from UTC at `at`, in milliseconds. */
function zoneOffsetMs(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const f = Object.fromEntries(parts.map((p) => [p.type, p.value])) as Record<string, string>;
  const wall = Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour % 24, +f.minute, +f.second);
  return wall - at.getTime();
}

/**
 * When the account this machine is logged in as comes back, or null when the
 * message is not a limit at all.
 *
 * The message carries a wall-clock time and a zone but no date, so "the next
 * time it is 7:50pm there" is the whole rule: a reset already past today is
 * tomorrow's. An unparseable zone falls back to this machine's own, which is the
 * zone the CLI reports in anyway.
 */
export function parseLimitReset(message: string, now = new Date()): Date | null {
  if (!message || !LIMIT_LINE.test(message)) return null;
  const m = RESET_AT.exec(message);
  if (!m) return null;

  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const meridiem = (m[3] ?? "").toLowerCase();
  if (hour > 23 || minute > 59) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  const zone = RESET_ZONE.exec(message)?.[1] ?? "";
  let offset = 0;
  try {
    offset = zone ? zoneOffsetMs(zone, now) : -now.getTimezoneOffset() * 60_000;
  } catch {
    offset = -now.getTimezoneOffset() * 60_000;
  }

  const wallNow = new Date(now.getTime() + offset);
  let at =
    Date.UTC(wallNow.getUTCFullYear(), wallNow.getUTCMonth(), wallNow.getUTCDate(), hour, minute) - offset;
  if (at <= now.getTime()) at += 24 * 60 * 60_000;
  return new Date(at);
}

/** What one Claude turn produced. `structured` is the validated object the CLI
 *  reported; null means the turn ended without honouring its contract, which the
 *  caller must treat as a failed node rather than guessing from `text`. */
export type TurnResult = {
  ok: boolean;
  structured: Record<string, unknown> | null;
  text: string;
  error: string;
  usage: TurnUsage;
  /** Set only when the turn failed because the account is out of quota: when it
   *  comes back. The node is parked until then rather than failed — see
   *  parkForLimit() in graph/drive.ts. */
  limitResetAt: Date | null;
  /** The session the CLI actually recorded this turn under. Reported rather than
   *  written straight onto the run: a `fresh` node opens its own session, which
   *  must not overwrite the run's primary one that `resume` nodes depend on. */
  sessionId: string;
};

// Parse one NDJSON line from `--output-format stream-json`, updating the live run.
function handleEvent(live: LiveRun, obj: Record<string, unknown>, out: TurnResult) {
  const type = obj.type;

  if (type === "system" && obj.subtype === "init") {
    const model = (obj as { model?: string }).model ?? "";
    const sid = (obj as { session_id?: string }).session_id ?? "";
    // Trust the CLI's own id over the one we pre-assigned — --resume must use
    // exactly what the session was actually recorded under.
    if (sid) out.sessionId = sid;
    live.logLines.push({ text: `● Session started${model ? " — " + model : ""}`, kind: "step" });
    return;
  }

  if (type === "assistant") {
    const msg = obj.message as { content?: Array<Record<string, unknown>> } | undefined;
    for (const block of msg?.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text.trim();
        if (text) text.split(/\r?\n/).forEach((l) => l.trim() && live.logLines.push({ text: l, kind: "muted" }));
      } else if (block.type === "tool_use") {
        const name = String(block.name ?? "");
        const input = (block.input ?? {}) as Record<string, unknown>;
        let label = `✎ ${name}`;
        if (name.toLowerCase() === "bash" && typeof input.command === "string") {
          label = `$ ${(input.command as string).split(/\r?\n/)[0].slice(0, 160)}`;
        } else if (typeof input.file_path === "string") {
          label = `✎ ${name} ${input.file_path}`;
        } else if (name === "StructuredOutput") {
          // Not work the agent chose to do: this is the node answering its own
          // output contract (--json-schema). Reading a bare "StructuredOutput"
          // three times in a row said nothing about what was happening.
          label = "⇢ Reporting this step's result";
        }
        // Collapse an immediate repeat rather than printing the same line twice —
        // a rejected StructuredOutput is retried, and the log filled with copies.
        const prev = live.logLines[live.logLines.length - 1];
        if (!prev || prev.text !== label) {
          live.logLines.push({ text: label, kind: name.toLowerCase() === "bash" ? "cmd" : "file" });
        }
      }
    }
    return;
  }

  if (type === "result") {
    const r = obj as {
      result?: string;
      structured_output?: unknown;
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
    if (typeof r.result === "string" && r.result.trim()) out.text = r.result.trim();
    if (r.structured_output && typeof r.structured_output === "object") {
      out.structured = r.structured_output as Record<string, unknown>;
    }
    out.ok = !r.is_error;
    const u = r.usage ?? {};
    out.usage = {
      costUsd: typeof r.total_cost_usd === "number" ? r.total_cost_usd : 0,
      numTurns: typeof r.num_turns === "number" ? r.num_turns : 0,
      durationMs: typeof r.duration_ms === "number" ? r.duration_ms : 0,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    };
  }
}

function sandboxEnv(): Record<string, string> {
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  return asRoot ? { IS_SANDBOX: "1" } : {};
}

/** Run one Claude turn; resolves when the process closes. */
export function runTurn(live: LiveRun, args: string[]): Promise<TurnResult> {
  return new Promise((resolve) => {
    const out: TurnResult = {
      ok: false, structured: null, text: "", error: "", usage: { ...ZERO_USAGE }, sessionId: "", limitResetAt: null,
    };
    // Every failure path resolves through here, so the limit is recognised
    // whichever way the CLI reported it — a clean exit carrying `is_error`, a
    // non-zero exit, or a message that only reached stderr.
    const fail = (detail: string) =>
      resolve({ ...out, ok: false, error: detail, limitResetAt: parseLimitReset(detail) });
    let child: ChildProcess;
    try {
      child = spawn(CLAUDE_BIN, args, {
        cwd: live.ctx.cwd,
        env: { ...process.env, ...sandboxEnv() },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      live.logLines.push({ text: `✖ ${detail}`, kind: "err" });
      fail(detail);
      return;
    }
    live.child = child;

    let buf = "";
    child.stdout!.on("data", (b: Buffer) => {
      buf += stripAnsi(b.toString("utf8"));
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try {
          handleEvent(live, JSON.parse(s), out);
        } catch {
          live.logLines.push({ text: s.slice(0, 300), kind: "muted" }); // non-JSON noise
        }
      }
    });
    let errTail = "";
    child.stderr!.on("data", (b: Buffer) => {
      errTail = (errTail + stripAnsi(b.toString("utf8"))).slice(-2000);
    });
    child.on("error", (e) => {
      live.child = null;
      live.logLines.push({ text: `✖ ${e.message}`, kind: "err" });
      fail(e.message);
    });
    child.on("close", (code) => {
      live.child = null;
      if (code !== 0) {
        const detail = out.text || errTail.trim() || `claude exited with code ${code}`;
        live.logLines.push({ text: detail, kind: "err" });
        fail(detail);
        return;
      }
      // A clean exit still carries `is_error` when the account ran out mid-turn.
      if (!out.ok) out.limitResetAt = parseLimitReset(out.text);
      resolve(out);
    });
  });
}
