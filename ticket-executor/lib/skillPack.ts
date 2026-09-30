// Server-only. The skills the app can start a run with ship inside this repo
// under `skills/`, and are installed onto the machine by copying them into
// ~/.claude/skills/ — the same folder the Claude CLI reads. The app runs
// locally on each developer's machine, so "the server" and "the developer's
// home directory" are the same box; there is no upload/download step.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";

/** The skills every install needs: all four are reachable from the Settings
 *  toggles, so a missing one is a blocker. Lives here rather than in preflight.ts
 *  so preflight can depend on this module without a cycle. */
export const REQUIRED_SKILLS = [
  "implement-ticket-v2",
  "implement-ticket-v3",
  "fix-code-review-v2",
  "fix-code-review-v3",
] as const;

/** Bundled and installable exactly like the required four, but only reached when
 *  a setting switches its node on — so a missing copy is a *warning* in System
 *  Check, not a blocker on every run. What makes it a hard requirement is the
 *  setting being on, and that is enforced where it belongs: in startRun()'s
 *  admission check, which refuses the run rather than letting it fail on an
 *  unknown slash command a turn later. */
export const OPTIONAL_SKILLS = [
  "review-changes-v1", // the `evaluate` node — Setting.evaluateBeforePublish
  "triage-sprint-v1", // Flow Runner's triage turn — invoked by hand, never by a run
  "fix-qa-v1", // Flow Runner's QA fix run — started from the row after QA fails
  "reply-qa-v1", // Flow Runner's drafted reply to QC — a turn that writes nothing
] as const;

/** Every skill this repo ships a copy of. */
export const BUNDLED_SKILLS = [...REQUIRED_SKILLS, ...OPTIONAL_SKILLS] as const;

export type SkillName = (typeof BUNDLED_SKILLS)[number];

export function isRequiredSkill(name: string): boolean {
  return (REQUIRED_SKILLS as readonly string[]).includes(name);
}

/** The same directories `GET /api/skills` scans, in the same order. */
export function skillDirs(): string[] {
  return [
    path.join(homedir(), ".claude", "skills"),
    path.join(process.cwd(), ".claude", "skills"),
    ...(process.env.CLAUDE_SKILLS_DIR ? [process.env.CLAUDE_SKILLS_DIR] : []),
  ];
}

export function findSkill(name: string): string | null {
  for (const dir of skillDirs()) {
    const p = path.join(dir, name);
    try {
      if (existsSync(p) && statSync(p).isDirectory()) return p;
    } catch {
      /* unreadable dir — treat as absent */
    }
  }
  return null;
}

export type SkillState = {
  name: SkillName;
  /** false = only needed when the setting that switches its node on is enabled. */
  required: boolean;
  /** Version shipped in this repo. */
  bundledVersion: string;
  /** Version found on the machine, or null when the skill isn't installed. */
  installedVersion: string | null;
  /** Where it was found, when installed. */
  installedPath: string | null;
  status: "missing" | "outdated" | "modified" | "ok";
};

/** Where the bundled copies live. `process.cwd()` is the app root in both
 *  `next dev` and `next start`. */
export function packDir(): string {
  return path.join(process.cwd(), "skills");
}

/** The install target — always the user's own skills folder, never a scanned
 *  directory that happens to be read-only or shared. */
export function installDir(): string {
  return path.join(homedir(), ".claude", "skills");
}

function readVersion(file: string): string {
  try {
    // Frontmatter only: stop at the closing --- so a `version:` line in the
    // body can't be mistaken for the skill's version.
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    if (lines[0]?.trim() !== "---") return "0.0.0";
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") break;
      const m = /^version:\s*(.+)$/.exec(lines[i]);
      if (m) return m[1].trim();
    }
  } catch {
    /* unreadable — treat as unversioned */
  }
  return "0.0.0";
}

/** Every file in a bundled skill folder, relative to that folder. */
function filesOf(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesOf(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

function sameContent(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

/** Compare dotted numeric versions. Returns >0 when a is newer than b. */
function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** True when this skill is shipped in the repo and can therefore be installed. */
export function isBundled(name: string): name is SkillName {
  return (BUNDLED_SKILLS as readonly string[]).includes(name) && existsSync(path.join(packDir(), name));
}

/** Bundled-vs-installed state for every required skill. Read-only. */
export function skillStates(): SkillState[] {
  return BUNDLED_SKILLS.map((name) => {
    const src = path.join(packDir(), name, "SKILL.md");
    const bundledVersion = existsSync(src) ? readVersion(src) : "0.0.0";
    const installedPath = findSkill(name);
    if (!installedPath) {
      return {
        name, required: isRequiredSkill(name),
        bundledVersion, installedVersion: null, installedPath: null, status: "missing" as const,
      };
    }
    const installedVersion = readVersion(path.join(installedPath, "SKILL.md"));
    let status: SkillState["status"] = "ok";
    if (cmpVersion(bundledVersion, installedVersion) > 0) status = "outdated";
    // Same version but different bytes: someone edited their copy. Say so
    // rather than silently offering to overwrite it.
    else if (!sameContent(src, path.join(installedPath, "SKILL.md"))) status = "modified";
    return { name, required: isRequiredSkill(name), bundledVersion, installedVersion, installedPath, status };
  });
}

export type InstallOutcome = {
  name: string;
  ok: boolean;
  /** What happened, for the toast / row message. */
  detail: string;
};

/** Copy one bundled skill into ~/.claude/skills/<name>/.
 *
 *  Guardrails: only allowlisted bundled names are ever written, the target is
 *  always inside the install dir, and an existing folder whose contents differ
 *  is refused unless `force` — a developer may have edited their copy. Nothing
 *  is ever deleted; files not present in the bundle are left alone. */
export function installSkill(name: string, opts?: { force?: boolean }): InstallOutcome {
  if (!isBundled(name)) {
    return { name, ok: false, detail: "Not a bundled skill." };
  }
  const src = path.join(packDir(), name);
  const dest = path.join(installDir(), name);

  // Defence in depth: the name came off an allowlist, but never let a resolved
  // path escape the install directory.
  if (path.relative(installDir(), dest).startsWith("..")) {
    return { name, ok: false, detail: "Refused: target escapes the skills directory." };
  }

  const existing = findSkill(name);
  if (existing && !opts?.force) {
    const differs = filesOf(src).some((rel) => !sameContent(path.join(src, rel), path.join(existing, rel)));
    if (differs) {
      return { name, ok: false, detail: "Already installed with different content — confirm to overwrite." };
    }
    return { name, ok: true, detail: "Already up to date." };
  }

  try {
    for (const rel of filesOf(src)) {
      const to = path.join(dest, rel);
      mkdirSync(path.dirname(to), { recursive: true });
      copyFileSync(path.join(src, rel), to);
    }
    return { name, ok: true, detail: existing ? `Updated in ${dest}` : `Installed to ${dest}` };
  } catch (e) {
    return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
