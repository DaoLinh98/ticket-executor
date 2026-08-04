import { NextResponse } from "next/server";
import { outlineForSkill } from "@/lib/executionStore";

export const runtime = "nodejs";

// The node list a skill's graph would walk, so the UI can draw the progress
// timeline before a run exists. It comes from the graph definition itself —
// there is no second copy of the step names in the client.
const SKILLS = ["implement-ticket-v2", "implement-ticket-v3", "fix-code-review-v2", "fix-code-review-v3"];

export async function GET() {
  const outlines: Record<string, { id: string; label: string; effects: string }[]> = {};
  for (const skill of SKILLS) outlines[skill] = outlineForSkill(skill);
  return NextResponse.json({ outlines });
}
