import { NextResponse } from "next/server";
import { planRowFor } from "@/lib/executionStore";
import { getOrCreateSetting } from "@/lib/settings";
import { normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/my-sprint/plan/row?ticket=<id>&provider=<id> — the ticket's row in the active Flow Runner plan, if any.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  try {
    const provider = normalizeProvider(params.get("provider") || (await getOrCreateSetting()).provider);
    return NextResponse.json(await planRowFor(provider, params.get("ticket") ?? ""));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
