import { NextResponse } from "next/server";
import { dashboardMetrics } from "@/lib/executionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only aggregate of the Execution table, optionally scoped by provider,
// project and/or a lookback window (empty string / 0 = no filter).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") || undefined;
  const project = url.searchParams.get("project") || undefined;
  const days = Number(url.searchParams.get("days")) || 0;
  try {
    const metrics = await dashboardMetrics({ provider, project, days });
    return NextResponse.json(metrics);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
