import { NextResponse } from "next/server";
import { resumeRun, type ResumeAction } from "@/lib/dagent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS: ResumeAction[] = ["recheck-readiness", "accept"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = ACTIONS.find((a) => a === body.action);
  if (!action) return NextResponse.json({ error: `action must be one of ${ACTIONS.join(", ")}` }, { status: 400 });
  const r = await resumeRun(id, action);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ resumed: true });
}
