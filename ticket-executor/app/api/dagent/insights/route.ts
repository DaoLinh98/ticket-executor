import { NextResponse } from "next/server";
import { loadInsights, parseInsightsPeriod } from "@/lib/dagent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/dagent/insights?period=14d|sprint — run cost, failure and pace metrics for the connected organization.
export async function GET(req: Request) {
  try {
    return NextResponse.json(await loadInsights(parseInsightsPeriod(new URL(req.url).searchParams.get("period"))));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
