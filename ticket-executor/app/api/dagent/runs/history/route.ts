import { NextResponse } from "next/server";
import { listRunHistory, parseHistoryFilter } from "@/lib/dagent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    return NextResponse.json(await listRunHistory(parseHistoryFilter(new URL(req.url).searchParams)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
