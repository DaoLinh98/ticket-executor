import { NextResponse } from "next/server";
import { listExecutions } from "@/lib/executionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const executions = await listExecutions(id);
    return NextResponse.json({ executions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, executions: [] }, { status: 500 });
  }
}
