import { NextResponse } from "next/server";
import { loadTicketComments, postTicketComment, normalizeProvider } from "@/lib/tickets";
import type { MentionCandidate } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const provider = normalizeProvider(url.searchParams.get("provider"));
  try {
    const comments = await loadTicketComments(provider, id);
    return NextResponse.json({ comments });
  } catch {
    // Degrade gracefully — the section just stays hidden.
    return NextResponse.json({ comments: [] });
  }
}

// Posting writes straight through to the provider and answers with the created
// comment, so the page renders what actually landed rather than its own draft.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const provider = normalizeProvider(body.provider);
  const text = String(body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  const mentions: MentionCandidate[] = (Array.isArray(body.mentions) ? body.mentions : [])
    .map((m: { id?: unknown; name?: unknown }) => ({ id: String(m?.id ?? ""), name: String(m?.name ?? ""), email: "" }))
    .filter((m: MentionCandidate) => m.id && m.name && text.includes(`@${m.name}`));
  try {
    const comment = await postTicketComment(provider, id, text, mentions);
    return NextResponse.json({ comment });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
