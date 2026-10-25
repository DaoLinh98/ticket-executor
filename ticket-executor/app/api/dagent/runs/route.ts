import { NextResponse } from "next/server";
import { listRuns, startRun } from "@/lib/dagent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listRuns());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  const result = await startRun({
    ticketId: s("ticketId"),
    ticketUrl: s("ticketUrl"),
    project: s("project"),
    rootRepo: s("rootRepo"),
    provider: s("provider"),
    model: s("model"),
    effort: s("effort"),
    retryOf: s("retryOf") || undefined,
    from: s("from") || undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error, gates: result.gates }, { status: result.status });
  return NextResponse.json({ runId: result.runId });
}
