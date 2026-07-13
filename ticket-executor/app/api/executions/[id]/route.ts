import { NextResponse } from "next/server";
import { getExecution, getPersistedExecution } from "@/lib/executionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // Prefer the live in-memory run; fall back to the persisted row (history / after restart).
  const execution = getExecution(id) ?? (await getPersistedExecution(id));
  if (!execution) {
    return NextResponse.json({ error: "Execution not found" }, { status: 404 });
  }
  return NextResponse.json({ execution });
}
