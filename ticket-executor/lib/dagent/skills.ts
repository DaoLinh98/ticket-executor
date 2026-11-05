import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { prisma } from "../prisma";
import { DENIED_SKILLS } from "./cli";
import { skillFrontMatter } from "./rules";

export type SkillEntry = { name: string; description: string; file: string };

const MAX_DESCRIPTION = 400;

function skillsIn(dir: string): SkillEntry[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const file = path.join(dir, n, "SKILL.md");
    if (!existsSync(file)) return [];
    try {
      const fm = skillFrontMatter(readFileSync(file, "utf8"));
      const name = fm.name || n;
      return fm.description ? [{ name, description: fm.description.slice(0, MAX_DESCRIPTION), file }] : [];
    } catch {
      return [];
    }
  });
}

/** Skills a role may follow: the Root repo's own, then the machine's — never a harness or hand-run skill, nor one
 *  switched off in Settings (`off`). */
export function skillCatalog(rootRepo: string, off: string[] = []): SkillEntry[] {
  const seen = new Set<string>([...DENIED_SKILLS, ...off]);
  return [path.join(rootRepo, ".claude", "skills"), path.join(homedir(), ".claude", "skills")]
    .flatMap(skillsIn)
    .filter((s) => !seen.has(s.name) && !!seen.add(s.name));
}

/** The machine's skills a run could be offered — what Settings lists to switch on or off. */
export function machineSkills(): SkillEntry[] {
  const denied = new Set<string>(DENIED_SKILLS);
  return skillsIn(path.join(homedir(), ".claude", "skills"))
    .filter((s) => !denied.has(s.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Stored as the switched-off names, so a newly installed skill is offered until someone turns it off.
export const SKILL_OFF_KIND = "dagent-skill-off";

/** Skills switched off in Settings. A failed read offers every skill rather than stopping the run. */
export async function skillsOff(): Promise<string[]> {
  try {
    const rows = await prisma.savedOption.findMany({ where: { kind: SKILL_OFF_KIND }, select: { value: true } });
    return rows.map((r) => r.value);
  } catch {
    return [];
  }
}
