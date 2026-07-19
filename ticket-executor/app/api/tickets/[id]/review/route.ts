import { NextResponse } from "next/server";
import { loadReview, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const provider = normalizeProvider(new URL(req.url).searchParams.get("provider"));
  try {
    const review = await loadReview(provider, id);
    return NextResponse.json({ review });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ review: { pr: null, comments: [], unresolvedCount: 0 }, error: message });
  }
}
