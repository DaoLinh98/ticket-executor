import { NextResponse } from "next/server";
import { startExecution } from "@/lib/executionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const skill = String(body.skillName || "implement-ticket-v2");
    const project = String(body.projectName || "");
    const rootRepo = String(body.rootRepo || process.env.CLAUDE_ROOT_REPO || "C:\\repos");
    if (!project) {
      return NextResponse.json({ error: "projectName is required" }, { status: 400 });
    }
    const executionId = await startExecution({ ticketId: id, skill, project, rootRepo });
    return NextResponse.json({ executionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
