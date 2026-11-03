import { NextResponse } from "next/server";
import { getAsk, resetAsk, startAsk } from "@/lib/ask";
import { jsonNoStore } from "@/lib/http";
import { CLAUDE_EFFORTS } from "@/lib/claudeOptions";
import { validateRootRepo } from "@/lib/preflight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY = { rootRepo: "", state: "idle", logLines: [], error: "", seq: 0, resuming: false };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return jsonNoStore(getAsk(id) ?? EMPTY);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const rootRepo = String(body.rootRepo || "");
  const prompt = String(body.prompt || "");
  const model = String(body.model || "");
  const effort = String(body.effort || "");
  if (model && !/^[A-Za-z0-9][\w.\[\]-]*$/.test(model)) return NextResponse.json({ error: "Unknown model." }, { status: 400 });
  if (effort && !(CLAUDE_EFFORTS as readonly string[]).includes(effort)) return NextResponse.json({ error: "Unknown effort." }, { status: 400 });

  // Same gate the implement route uses, for the same reason: a bad path would
  // otherwise spend tokens only to die on the first command.
  const repo = validateRootRepo(rootRepo);
  if (!repo.ok) return NextResponse.json({ error: repo.error }, { status: 400 });

  // Returns as soon as the CLI is spawned; the answer arrives over the stream.
  const started = await startAsk({ ticketId: id, rootRepo, prompt, model, effort });
  if (!started.ok) return NextResponse.json({ error: started.error }, { status: 409 });

  return jsonNoStore({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const done = resetAsk(id);
  if (!done.ok) return NextResponse.json({ error: done.error }, { status: 409 });
  return jsonNoStore({ ok: true });
}
