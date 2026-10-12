import { NextResponse } from "next/server";
import { getOrCreateSetting } from "@/lib/settings";
import { normalizeProvider, searchTickets } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const setting = await getOrCreateSetting();
  const provider = normalizeProvider(params.get("provider") ?? setting.provider);
  try {
    const tickets = await searchTickets(provider, params.get("q") ?? "");
    return NextResponse.json({ tickets });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, tickets: [] }, { status: 500 });
  }
}
