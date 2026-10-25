import { readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { agentVersionProblem } from "../agentPack";

export type AgentDef = {
  name: string;
  tools: string[] | null;
  disallowedTools: string[];
  body: string;
};

const list = (v: string) =>
  v
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

export function parseAgent(text: string): AgentDef | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  if (!fields.name) return null;
  return {
    name: fields.name,
    tools: fields.tools ? list(fields.tools) : null,
    disallowedTools: fields.disallowedTools ? list(fields.disallowedTools) : [],
    body: m[2].trim(),
  };
}

export function agentProblem(name: string, installed: AgentDef | null): string {
  if (!installed) return `Agent ${name} is not installed in ~/.claude/agents.`;
  if (installed.name !== name) return `~/.claude/agents/${name}.md declares name "${installed.name}".`;
  if (installed.tools && !installed.tools.includes("StructuredOutput")) {
    return `Agent ${name} lists \`tools\` without StructuredOutput — its structured output would silently be empty.`;
  }
  if (installed.disallowedTools.includes("StructuredOutput")) return `Agent ${name} disallows StructuredOutput.`;
  if (!installed.body) return `Agent ${name} has an empty system prompt.`;
  return "";
}

export const installedDir = () => path.join(homedir(), ".claude", "agents");

function read(file: string): AgentDef | null {
  try {
    return parseAgent(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function checkAgents(names: string[]): { problems: string[] } {
  const problems = names
    .map((name) => agentProblem(name, read(path.join(installedDir(), `${name}.md`))) || agentVersionProblem(name))
    .filter(Boolean);
  return { problems };
}
