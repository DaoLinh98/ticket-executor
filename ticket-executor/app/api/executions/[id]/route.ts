import { NextResponse } from "next/server";
import { getRun } from "@/lib/executionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // getRun prefers the live in-process run and falls back to the persisted rows
  // (history, or after a restart), so callers get one shape either way.
  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ run });
}
