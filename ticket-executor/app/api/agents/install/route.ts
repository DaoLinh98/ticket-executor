import { NextResponse } from "next/server";
import { BUNDLED_AGENTS, agentInstallDir, agentStates, installAgent } from "@/lib/agentPack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/agents/install — bundled-vs-installed state for the D-Agent
// subagents, so the UI can label each row Install / Update / Overwrite.
export async function GET() {
  return NextResponse.json({ target: agentInstallDir(), agents: agentStates() });
}

// POST /api/agents/install — copy bundled agents into ~/.claude/agents/.
// Body: { name?: string, all?: boolean, force?: boolean }.
//
// Same guardrails as /api/skills/install: only allowlisted names, never a
// delete, and an existing file whose content differs is refused until the
// caller passes force.
export async function POST(req: Request) {
  let body: { name?: unknown; all?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const force = body.force === true;
  const names: string[] = body.all === true ? [...BUNDLED_AGENTS] : typeof body.name === "string" ? [body.name] : [];

  if (!names.length) {
    return NextResponse.json({ error: "Pass { name } or { all: true }." }, { status: 400 });
  }

  const results = names.map((n) => installAgent(n, { force }));
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json(
    { target: agentInstallDir(), results, agents: agentStates() },
    // 409: nothing was written because a copy already exists and differs —
    // the UI re-sends with force after the user confirms.
    { status: failed.length && failed.every((r) => r.detail.includes("confirm to overwrite")) ? 409 : 200 },
  );
}
