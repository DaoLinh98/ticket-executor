import { NextResponse } from "next/server";
import { validateRootRepo } from "@/lib/preflight";
import { openTerminalAt } from "@/lib/terminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Opens a terminal on the machine running this app — not on the device looking
// at the page. From a phone the Ask tab is the equivalent; this is for sitting
// at the machine itself.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const rootRepo = String(body.rootRepo || "");

  const repo = validateRootRepo(rootRepo);
  if (!repo.ok) return NextResponse.json({ error: repo.error }, { status: 400 });

  const opened = await openTerminalAt(rootRepo);
  if (!opened.ok) return NextResponse.json({ error: opened.error }, { status: 500 });

  return NextResponse.json({ ok: true });
}
