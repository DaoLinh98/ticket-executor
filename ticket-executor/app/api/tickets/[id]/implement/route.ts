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
    const skill = String(body.skillName || "implement-ticket-v3");
    const project = String(body.projectName || "");
    const rootRepo = String(body.rootRepo || process.env.CLAUDE_ROOT_REPO || "C:\\repos");
    const prUrl = typeof body.prUrl === "string" ? body.prUrl : undefined;
    const provider = String(body.provider || "azure-devops");
    const model = typeof body.model === "string" && body.model ? body.model : undefined;
    const effort = typeof body.effort === "string" && body.effort ? body.effort : undefined;
    if (!project) {
      return NextResponse.json({ error: "projectName is required" }, { status: 400 });
    }
    const executionId = await startExecution({ ticketId: id, skill, project, rootRepo, prUrl, provider, model, effort });
    return NextResponse.json({ executionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
