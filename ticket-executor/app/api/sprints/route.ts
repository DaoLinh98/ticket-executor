import { NextResponse } from "next/server";
import { listIterations } from "@/lib/ado";

export const dynamic = "force-dynamic";

// Sprint picker data for the Azure DevOps provider: full iteration list (newest
// first) plus which one ADO considers "current" today. Scoped to a project's
// default team, so the `project` query param is required.
export async function GET(req: Request) {
  const project = new URL(req.url).searchParams.get("project") ?? "";
  if (!project) return NextResponse.json({ sprints: [], current: "" });
  try {
    const iterations = await listIterations(project);
    const sprints = [...iterations].sort((a, b) =>
      (b.startDate ?? "").localeCompare(a.startDate ?? "")
    );
    const current = iterations.find((i) => i.timeFrame === "current")?.name ?? "";
    return NextResponse.json({ sprints, current });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, sprints: [], current: "" }, { status: 500 });
  }
}
