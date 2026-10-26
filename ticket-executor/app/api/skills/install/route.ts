import { NextResponse } from "next/server";
import { REQUIRED_SKILLS, installDir, installSkill, skillStates } from "@/lib/skillPack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/skills/install — bundled-vs-installed state for the bundled
// skills, so the UI can label each row Install / Update / Overwrite.
export async function GET() {
  return NextResponse.json({ target: installDir(), skills: skillStates() });
}

// POST /api/skills/install — copy bundled skills into ~/.claude/skills/.
// Body: { name?: string, all?: boolean, force?: boolean }.
//
// This writes outside the project, into the developer's home directory — which
// is the point (the app runs on their machine, and that folder is where the
// Claude CLI reads skills from). It is deliberately narrow: only the bundled
// allowlisted names, never a delete, and an existing folder whose content
// differs is refused until the caller passes force.
export async function POST(req: Request) {
  let body: { name?: unknown; all?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const force = body.force === true;
  const names: string[] =
    body.all === true
      ? [...REQUIRED_SKILLS]
      : typeof body.name === "string"
        ? [body.name]
        : [];

  if (!names.length) {
    return NextResponse.json({ error: "Pass { name } or { all: true }." }, { status: 400 });
  }

  const results = names.map((n) => installSkill(n, { force }));
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json(
    { target: installDir(), results, skills: skillStates() },
    // 409: nothing was written because a copy already exists and differs —
    // the UI re-sends with force after the user confirms.
    { status: failed.length && failed.every((r) => r.detail.includes("confirm to overwrite")) ? 409 : 200 },
  );
}
