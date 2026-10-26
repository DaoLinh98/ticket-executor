import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
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

/** Skills a role may follow: the Root repo's own, then the machine's — never a harness or hand-run skill. */
export function skillCatalog(rootRepo: string): SkillEntry[] {
  const seen = new Set<string>(DENIED_SKILLS);
  return [path.join(rootRepo, ".claude", "skills"), path.join(homedir(), ".claude", "skills")]
    .flatMap(skillsIn)
    .filter((s) => !seen.has(s.name) && !!seen.add(s.name));
}
