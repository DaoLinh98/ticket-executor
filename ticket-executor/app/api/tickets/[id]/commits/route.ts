import { NextResponse } from "next/server";
import { loadPullRequestCommits, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const provider = normalizeProvider(new URL(req.url).searchParams.get("provider"));
  try {
    const commits = await loadPullRequestCommits(provider, id);
    return NextResponse.json({ commits });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ commits: [], error: message });
  }
}
