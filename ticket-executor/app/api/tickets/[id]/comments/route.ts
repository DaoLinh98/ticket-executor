import { NextResponse } from "next/server";
import { loadTicketComments, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const provider = normalizeProvider(url.searchParams.get("provider"));
  const project = url.searchParams.get("project") ?? undefined;
  try {
    const comments = await loadTicketComments(provider, id, project);
    return NextResponse.json({ comments });
  } catch {
    // Degrade gracefully — the section just stays hidden.
    return NextResponse.json({ comments: [] });
  }
}
