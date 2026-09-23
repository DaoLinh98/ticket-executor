import { NextResponse } from "next/server";
import { setTicketCommentReaction, normalizeProvider } from "@/lib/tickets";
import { REACTION_KINDS, type ReactionKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One reaction, one comment: the body says which kind and whether the connected
// identity is engaging or disengaging. The response carries the reaction's new
// count from the provider, which is what the page renders.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const { id, commentId } = await params;
  const body = await req.json().catch(() => ({}));
  const provider = normalizeProvider(body.provider);
  const kind = REACTION_KINDS.find((k) => k === body.kind) as ReactionKind | undefined;
  if (!kind) return NextResponse.json({ error: "kind must be one of " + REACTION_KINDS.join(", ") }, { status: 400 });
  try {
    const reaction = await setTicketCommentReaction(provider, id, commentId, kind, !!body.on);
    return NextResponse.json({ reaction });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
