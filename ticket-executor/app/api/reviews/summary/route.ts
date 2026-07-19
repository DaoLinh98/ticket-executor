import { NextResponse } from "next/server";
import { loadReviewsSummary, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const provider = normalizeProvider(url.searchParams.get("provider"));
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) return NextResponse.json({ reviews: [] });
  try {
    const reviews = await loadReviewsSummary(provider, ids);
    return NextResponse.json({ reviews });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ reviews: [], error: message });
  }
}
