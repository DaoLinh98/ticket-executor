import { NextResponse } from "next/server";
import { listRuns, startRun } from "@/lib/dagent";
import { logAutomation } from "@/lib/executionStore";
import { prisma } from "@/lib/prisma";

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
  const flow = s("flow");
  if (flow && flow !== "implement" && flow !== "review") return NextResponse.json({ error: `Flow "${flow}" cannot be started here.` }, { status: 400 });
  if (flow === "review" && !s("prUrl") && !s("restartOf")) return NextResponse.json({ error: "A review fix needs the pull request URL." }, { status: 400 });
  const findings = s("findings");
  const result = await startRun({
    ...(flow === "review" ? { flow, prUrl: s("prUrl"), restartOf: s("restartOf") || undefined } : {}),
    ticketId: s("ticketId"),
    ticketUrl: s("ticketUrl"),
    project: s("project"),
    rootRepo: s("rootRepo"),
    provider: s("provider"),
    model: s("model"),
    effort: s("effort"),
    retryOf: s("retryOf") || undefined,
    from: s("from") || undefined,
    ...(findings ? { seed: { reviewFeedback: { findings } } } : {}),
  });
  if (!result.ok) return NextResponse.json({ error: result.error, gates: result.gates }, { status: result.status });

  const ticketId = s("ticketId");
  if (ticketId) {
    const planned = await prisma.plannedTicket.findFirst({
      where: {
        ticketId,
        untracked: false,
        plan: { status: "active" },
      },
      orderBy: { plan: { updatedAt: "desc" } },
    });
    if (planned) {
      if (flow === "review") {
        await prisma.plannedTicket.update({
          where: { id: planned.id },
          data: {
            reviewState: "running",
            reviewRunId: result.runId,
            reviewError: "",
          },
        });
      } else {
        await prisma.plannedTicket.update({
          where: { id: planned.id },
          data: {
            implementState: "running",
            runId: result.runId,
          },
        });
      }
    }
    // A run a person starts leaves no other trace, so the log could not tell it from the scheduler's.
    await logAutomation({
      planId: planned?.planId,
      ticketId,
      action: flow === "review" ? "review" : "implement",
      outcome: "started",
      reason: "started-by-user",
      detail: `Started by hand from Ticket Execution (${flow === "review" ? "fix review" : "implement"}${s("retryOf") ? ", retry of an earlier run" : ""}).`,
    });
  }

  return NextResponse.json({ runId: result.runId });
}
