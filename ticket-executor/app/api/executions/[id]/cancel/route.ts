import { NextResponse } from "next/server";
import { cancelRun } from "@/lib/executionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await cancelRun(id);
  if (!ok) return NextResponse.json({ error: "Run is not active" }, { status: 409 });
  return NextResponse.json({ cancelled: true });
}
