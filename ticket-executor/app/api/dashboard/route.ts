import { NextResponse } from "next/server";
import { dashboardMetrics } from "@/lib/executionStore";
import { activeConnection } from "@/lib/providerCredentials";
import { getOrCreateSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only aggregate of the Execution table, optionally scoped by provider,
// project and/or a lookback window (empty string / 0 = no filter).
//
// The organization is not a query parameter: history belongs to the organization
// it was run against, so the aggregate is scoped to whichever connection the
// header is switched to, resolved here rather than trusted from the client.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") || undefined;
  const project = url.searchParams.get("project") || undefined;
  const days = Number(url.searchParams.get("days")) || 0;
  try {
    const setting = await getOrCreateSetting();
    const active = await activeConnection(setting.provider);
    const metrics = await dashboardMetrics({
      provider,
      project,
      days,
      org: active?.org ?? "",
      orgProvider: setting.provider,
    });
    return NextResponse.json(metrics);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
