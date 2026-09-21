import { NextResponse } from "next/server";
import { cancelAsk } from "@/lib/ask";
import { jsonNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stopped = cancelAsk(id);
  if (!stopped.ok) return NextResponse.json({ error: stopped.error }, { status: 409 });
  return jsonNoStore({ ok: true });
}
