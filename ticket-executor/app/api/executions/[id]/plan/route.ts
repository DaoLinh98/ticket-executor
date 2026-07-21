import { NextResponse } from "next/server";
import { resolvePlan, type PlanAction } from "@/lib/executionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS: PlanAction[] = ["approve", "revise", "cancel"];

// Resolve a run parked at the plan-review gate: approve it (resume the same
// Claude session to implement), request changes (resume to re-plan), or cancel.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "") as PlanAction;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: `action must be one of ${ACTIONS.join(", ")}` }, { status: 400 });
  }
  const result = await resolvePlan(id, action, {
    plan: typeof body.plan === "string" ? body.plan : undefined,
    feedback: typeof body.feedback === "string" ? body.feedback : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.code });
  return NextResponse.json({ ok: true });
}
