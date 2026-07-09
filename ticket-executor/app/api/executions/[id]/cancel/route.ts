import { NextResponse } from "next/server";
import { cancelExecution } from "@/lib/executionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok = cancelExecution(id);
  if (!ok) return NextResponse.json({ error: "Execution not running" }, { status: 409 });
  return NextResponse.json({ cancelled: true });
}
