import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { BUNDLED_SKILLS, RETIRED_SKILLS } from "../skillPack";
import { ZERO_USAGE, type LogEntry, type Usage } from "./types";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const KEEP_PLUGINS = /^(1|true)$/i.test(process.env.CLAUDE_KEEP_PLUGINS ?? "");
const MANUAL_SKILLS = ["implement-ticket", "fix-code-review", "dev-team"];
export const DENIED_SKILLS = [...BUNDLED_SKILLS, ...RETIRED_SKILLS, ...MANUAL_SKILLS];

export type TurnRequest = {
  cwd: string;
  addDirs: string[];
  agent: string;
  prompt: string;
  schema: Record<string, unknown>;
  mcpConfigPath: string;
  model: string;
  effort: string;
  /** The Claude account to run as (`lib/claudeAccounts.ts`); empty = this machine's login. */
  accountEnv?: Record<string, string>;
  onLog: (e: LogEntry) => void;
  onChild: (c: ChildProcess | null) => void;
};

export type TurnResult = {
  ok: boolean;
  structured: Record<string, unknown> | null;
  error: string;
  usage: Usage;
  sessionId: string;
};

function disabledPlugins(cwd: string): string[] {
  if (KEEP_PLUGINS) return [];
  const keys = new Set<string>();
  for (const f of [
    path.join(homedir(), ".claude", "settings.json"),
    path.join(homedir(), ".claude", "settings.local.json"),
    path.join(cwd, ".claude", "settings.json"),
    path.join(cwd, ".claude", "settings.local.json"),
  ]) {
    try {
      if (!existsSync(f)) continue;
      const json = JSON.parse(readFileSync(f, "utf8")) as { enabledPlugins?: Record<string, unknown> };
      for (const [k, v] of Object.entries(json.enabledPlugins ?? {})) if (v !== false) keys.add(k);
    } catch {
      continue;
    }
  }
  if (!keys.size) return [];
  return ["--settings", JSON.stringify({ enabledPlugins: Object.fromEntries([...keys].map((k) => [k, false])) })];
}

export function turnArgs(r: Pick<TurnRequest, "agent" | "prompt" | "schema" | "mcpConfigPath" | "model" | "effort" | "cwd" | "addDirs">, sessionId: string): string[] {
  return [
    "-p",
    r.prompt,
    "--agent",
    r.agent,
    "--session-id",
    sessionId,
    "--output-format",
    "stream-json",
    "--verbose",
    "--allow-dangerously-skip-permissions",
    "--dangerously-skip-permissions",
    "--disallowedTools",
    "Agent",
    ...DENIED_SKILLS.map((s) => `Skill(${s})`),
    "--json-schema",
    JSON.stringify(r.schema),
    ...r.addDirs.flatMap((d) => ["--add-dir", d]),
    ...(r.mcpConfigPath ? ["--mcp-config", r.mcpConfigPath, "--strict-mcp-config"] : []),
    ...(r.model ? ["--model", r.model] : []),
    ...(r.effort ? ["--effort", r.effort] : []),
    ...disabledPlugins(r.cwd),
  ];
}

const first = (s: string, n = 200) => s.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, n) ?? "";

function handle(obj: Record<string, unknown>, out: TurnResult, log: (lvl: LogEntry["lvl"], text: string) => void) {
  if (obj.type === "system" && obj.subtype === "init") {
    if (typeof obj.session_id === "string") out.sessionId = obj.session_id;
    log("INFO", `session started${typeof obj.model === "string" ? ` · ${obj.model}` : ""}`);
    return;
  }
  if (obj.type === "assistant") {
    const content = (obj.message as { content?: Record<string, unknown>[] } | undefined)?.content ?? [];
    for (const b of content) {
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) log("INFO", first(b.text));
      else if (b.type === "tool_use") {
        const name = String(b.name ?? "");
        const input = (b.input ?? {}) as Record<string, unknown>;
        if (name === "StructuredOutput") log("INFO", "⇢ reporting the step's result");
        // Named, so /workflow can show which skill a step invoked (`skillUse()`).
        else if (name === "Skill" && typeof input.skill === "string") log("INFO", `✎ Skill ${input.skill}`);
        else if (typeof input.command === "string") log("INFO", `$ ${first(input.command, 160)}`);
        else if (typeof input.file_path === "string") log("INFO", `✎ ${name} ${input.file_path}`);
        else log("INFO", `✎ ${name}`);
      }
    }
    return;
  }
  if (obj.type === "user") {
    const content = (obj.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) return;
    for (const b of content as Record<string, unknown>[]) {
      if (b?.type === "tool_result" && b.is_error === true) {
        const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
        log("WARN", `↳ ${first(text)}`);
      }
    }
    return;
  }
  if (obj.type === "result") {
    const r = obj as {
      result?: string;
      structured_output?: unknown;
      is_error?: boolean;
      total_cost_usd?: number;
      num_turns?: number;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
    };
    if (r.structured_output && typeof r.structured_output === "object") out.structured = r.structured_output as Record<string, unknown>;
    out.ok = !r.is_error;
    if (r.is_error && typeof r.result === "string") out.error = r.result.trim();
    out.usage = {
      costUsd: r.total_cost_usd ?? 0,
      numTurns: r.num_turns ?? 0,
      inputTokens: r.usage?.input_tokens ?? 0,
      outputTokens: r.usage?.output_tokens ?? 0,
      cacheReadTokens: r.usage?.cache_read_input_tokens ?? 0,
    };
  }
}

export function runAgentTurn(req: TurnRequest): Promise<TurnResult> {
  const sessionId = randomUUID();
  const log = (lvl: LogEntry["lvl"], text: string) => req.onLog({ t: Date.now(), lvl, text });
  return new Promise((resolve) => {
    const out: TurnResult = { ok: false, structured: null, error: "", usage: { ...ZERO_USAGE }, sessionId };
    let child: ChildProcess;
    try {
      const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
      child = spawn(CLAUDE_BIN, turnArgs(req, sessionId), {
        cwd: req.cwd,
        env: {
          ...process.env,
          ...(asRoot ? { IS_SANDBOX: "1" } : {}),
          ...(req.addDirs.length ? { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1" } : {}),
          ...req.accountEnv,
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ ...out, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    req.onChild(child);
    let buf = "";
    child.stdout!.on("data", (b: Buffer) => {
      buf += b.toString("utf8");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handle(JSON.parse(line), out, log);
        } catch {
          continue;
        }
      }
    });
    let errTail = "";
    child.stderr!.on("data", (b: Buffer) => {
      errTail = (errTail + b.toString("utf8")).slice(-2000);
    });
    child.on("error", (e) => {
      req.onChild(null);
      resolve({ ...out, ok: false, error: e.message });
    });
    child.on("close", (code) => {
      req.onChild(null);
      if (buf.trim()) {
        try {
          handle(JSON.parse(buf), out, log);
        } catch {
          buf = "";
        }
      }
      if (code !== 0 && out.ok) out.ok = false;
      if (!out.ok && !out.error) out.error = errTail.trim().split(/\r?\n/).slice(-3).join(" ") || `claude exited with code ${code}`;
      resolve(out);
    });
  });
}
