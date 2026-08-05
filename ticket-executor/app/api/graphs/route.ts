import { NextResponse } from "next/server";
import { outlineForSkill } from "@/lib/executionStore";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The node list a skill's graph would walk, so the UI can draw the progress
// timeline before a run exists. It comes from the graph definition itself —
// there is no second copy of the step names in the client.
const SKILLS = ["implement-ticket-v2", "implement-ticket-v3", "fix-code-review-v2", "fix-code-review-v3"];

export async function GET() {
  // Built from the same setting startRun() reads: the evaluator adds two nodes,
  // so resolving the outline without it would have the UI promise a run shape the
  // engine is not going to walk.
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  const opts = { evaluate: setting?.evaluateBeforePublish ?? false };
  const outlines: Record<string, { id: string; label: string; effects: string }[]> = {};
  for (const skill of SKILLS) outlines[skill] = outlineForSkill(skill, opts);
  return NextResponse.json({ outlines });
}
