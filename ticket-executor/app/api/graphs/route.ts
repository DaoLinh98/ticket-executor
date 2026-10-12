import { NextResponse } from "next/server";
import { KNOWN_SKILLS, outlineForSkill } from "@/lib/executionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The node list a skill's graph would walk, so the UI can draw the progress
// timeline before a run exists. It comes from the graph definition itself —
// there is no second copy of the step names in the client.
export async function GET() {
  const outlines: Record<string, { id: string; label: string; effects: string }[]> = {};
  for (const skill of KNOWN_SKILLS) outlines[skill] = outlineForSkill(skill);
  return NextResponse.json({ outlines });
}
