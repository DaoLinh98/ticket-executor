import { NextResponse } from "next/server";
import { normalizeProvider, searchMentionCandidates } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const provider = normalizeProvider(url.searchParams.get("provider"));
  const q = url.searchParams.get("q") ?? "";
  try {
    const people = await searchMentionCandidates(provider, q);
    return NextResponse.json({ people });
  } catch {
    return NextResponse.json({ people: [] });
  }
}
