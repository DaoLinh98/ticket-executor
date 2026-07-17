import { NextResponse } from "next/server";
import { readdirSync, existsSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Skills relevant to ticket work — used to rank/seed the list and as a fallback
// when the skills directory can't be read.
const CURATED = [
  "implement-ticket-v2",
  "fix-issue",
  "fix-code-review",
  "senior-code-review",
  "testing-report",
  "review-re-estimate-ado-tickets",
  "tackle-requirement",
];

function readSkillDirs(dir: string): string[] {
  if (!dir || !existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => {
        try {
          return statSync(path.join(dir, name)).isDirectory() && !name.startsWith(".");
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

export async function GET() {
  const dirs = [
    path.join(homedir(), ".claude", "skills"),
    path.join(process.cwd(), ".claude", "skills"),
    ...(process.env.CLAUDE_SKILLS_DIR ? [process.env.CLAUDE_SKILLS_DIR] : []),
  ];
  const discovered = dirs.flatMap(readSkillDirs);
  // Curated first (in order), then the rest of the discovered skills alphabetically.
  const rest = Array.from(new Set(discovered)).filter((s) => !CURATED.includes(s)).sort();
  const skills = [...CURATED.filter((c) => discovered.length === 0 || discovered.includes(c)), ...rest];
  return NextResponse.json({ skills: skills.length ? skills : CURATED });
}
