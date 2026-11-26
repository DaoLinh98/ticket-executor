import { NextResponse } from "next/server";
import { currentQuota } from "@/lib/claudeUsage";
import { DB_CACHE_PREFIX, cached } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/claude/usage — the session (5h) and weekly usage of the Claude account the next turn would run as.
// Short-cached: the header polls it. A failed read is never cached, and answers `quota: null`, not an error.
export async function GET() {
  try {
    const r = await cached(`${DB_CACHE_PREFIX}claude-usage`, 30, async () => {
      const read = await currentQuota();
      if (!read.quota) throw new Error("usage unavailable");
      return read;
    });
    return NextResponse.json(r);
  } catch {
    return NextResponse.json({ account: "", quota: null });
  }
}
