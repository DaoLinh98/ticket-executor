// Server-only. The subagents the D-Agent workflow (`lib/dagent/`) spawns ship
// inside this repo under `agents/`, and are installed onto the machine by
// copying them into ~/.claude/agents/ — the folder `claude --agent` reads.
// Same shape as lib/skillPack.ts: one file per agent instead of a folder.

import { copyFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import path from "path";
import { cmpVersion, readVersion, sameContent } from "./skillPack";

/** Every agent the D-Agent graphs run — kept equal to `allAgents()` by a test. */
export const BUNDLED_AGENTS = ["analyst", "planner", "implementer", "reviewer", "fixer", "reflector", "publisher", "review-triager", "qa-triager", "responder"] as const;

export type AgentName = (typeof BUNDLED_AGENTS)[number];

export type AgentState = {
  name: AgentName;
  /** Version shipped in this repo. */
  bundledVersion: string;
  /** Version found on the machine, or null when the agent isn't installed. */
  installedVersion: string | null;
  /** Where it was found, when installed. */
  installedPath: string | null;
  status: "missing" | "outdated" | "modified" | "ok";
};

/** Where the bundled copies live. `process.cwd()` is the app root in both
 *  `next dev` and `next start`. */
export function agentPackDir(): string {
  return path.join(process.cwd(), "agents");
}

/** The install target — the user's own agents folder, the one the CLI reads. */
export function agentInstallDir(): string {
  return path.join(homedir(), ".claude", "agents");
}

export function isBundledAgent(name: string): name is AgentName {
  return (BUNDLED_AGENTS as readonly string[]).includes(name) && existsSync(path.join(agentPackDir(), `${name}.md`));
}

function agentState(name: AgentName): AgentState {
  const src = path.join(agentPackDir(), `${name}.md`);
  const bundledVersion = existsSync(src) ? readVersion(src) : "0.0.0";
  const dest = path.join(agentInstallDir(), `${name}.md`);
  if (!existsSync(dest)) return { name, bundledVersion, installedVersion: null, installedPath: null, status: "missing" };
  const installedVersion = readVersion(dest);
  let status: AgentState["status"] = "ok";
  if (cmpVersion(bundledVersion, installedVersion) > 0) status = "outdated";
  // Same version but different bytes: someone edited their copy. Say so
  // rather than silently offering to overwrite it.
  else if (!sameContent(src, dest)) status = "modified";
  return { name, bundledVersion, installedVersion, installedPath: dest, status };
}

/** Bundled-vs-installed state for every bundled agent. Read-only. */
export function agentStates(): AgentState[] {
  return BUNDLED_AGENTS.map(agentState);
}

/** Why a bundled agent's installed copy cannot be run, or "": an installed copy
 *  older than the bundle answers an older contract, so it is refused at
 *  admission. A missing one is left to `agentProblem()`. */
export function agentVersionProblem(name: string): string {
  if (!(BUNDLED_AGENTS as readonly string[]).includes(name)) return "";
  const s = agentState(name as AgentName);
  if (s.status !== "outdated") return "";
  return `The installed ${name} agent is version ${s.installedVersion}, older than the bundled ${s.bundledVersion}.`;
}

export type AgentInstallOutcome = { name: string; ok: boolean; detail: string };

/** Copy one bundled agent into ~/.claude/agents/<name>.md.
 *
 *  Guardrails: only allowlisted bundled names are ever written, and an existing
 *  file whose content differs is refused unless `force` — a developer may have
 *  edited their copy. Nothing is ever deleted. */
export function installAgent(name: string, opts?: { force?: boolean }): AgentInstallOutcome {
  if (!isBundledAgent(name)) return { name, ok: false, detail: "Not a bundled agent." };
  const src = path.join(agentPackDir(), `${name}.md`);
  const dest = path.join(agentInstallDir(), `${name}.md`);
  if (existsSync(dest) && !opts?.force) {
    if (!sameContent(src, dest)) return { name, ok: false, detail: "Already installed with different content — confirm to overwrite." };
    return { name, ok: true, detail: "Already up to date." };
  }
  try {
    const existed = existsSync(dest);
    mkdirSync(agentInstallDir(), { recursive: true });
    copyFileSync(src, dest);
    return { name, ok: true, detail: existed ? `Updated in ${dest}` : `Installed to ${dest}` };
  } catch (e) {
    return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
