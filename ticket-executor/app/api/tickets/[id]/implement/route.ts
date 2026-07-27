import { NextResponse } from "next/server";
import { findOtherActiveTicketId, startExecution } from "@/lib/executionStore";
import { prisma } from "@/lib/prisma";
import { validateAgentAccess, validateRootRepo } from "@/lib/preflight";

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
    const rootRepo = String(body.rootRepo || "");
    const prUrl = typeof body.prUrl === "string" ? body.prUrl : undefined;
    const provider = String(body.provider || "azure-devops");
    const model = typeof body.model === "string" && body.model ? body.model : undefined;
    const effort = typeof body.effort === "string" && body.effort ? body.effort : undefined;
    if (!project) {
      return NextResponse.json({ error: "projectName is required" }, { status: 400 });
    }
    // Reject a missing/bogus Root repo before spawning the CLI — otherwise the
    // run burns tokens only to die on its first git command.
    const repo = validateRootRepo(rootRepo);
    if (!repo.ok) {
      return NextResponse.json({ error: repo.error }, { status: 400 });
    }

    // Reject a run whose Claude CLI would have no MCP path to the provider: the
    // skills read the ticket through provider MCP tools, so without one the run
    // spends tokens and fails (or guesses). Cheap checks block; the verdict of
    // the slow health check is only read from the System Check cache.
    const access = await validateAgentAccess(provider, rootRepo);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: 400 });
    }

    const setting = await prisma.setting.findUnique({ where: { id: "default" } });
    const multiTicketMode = setting?.multiTicketMode ?? true;
    if (!multiTicketMode) {
      const busyTicketId = await findOtherActiveTicketId(id);
      if (busyTicketId) {
        return NextResponse.json(
          { error: `Ticket #${busyTicketId} is currently running. Multi-ticket mode is off — finish or cancel it first.` },
          { status: 409 }
        );
      }
    }

    const executionId = await startExecution({ ticketId: id, skill, project, rootRepo, prUrl, provider, model, effort, isolate: multiTicketMode });
    // `warnings` are advisory: the run has started, but something worth showing
    // could not be verified up front.
    return NextResponse.json(
      access.warnings.length ? { executionId, warnings: access.warnings } : { executionId }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
