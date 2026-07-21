import { NextResponse } from "next/server";
import { loadCommitFileChanges, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; sha: string }> }
) {
  const { id, sha } = await params;
  const provider = normalizeProvider(new URL(req.url).searchParams.get("provider"));
  try {
    const files = await loadCommitFileChanges(provider, id, sha);
    return NextResponse.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ files: [], error: message });
  }
}
