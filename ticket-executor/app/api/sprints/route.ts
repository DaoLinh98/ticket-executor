import { NextResponse } from "next/server";
import { listIterations } from "@/lib/ado";

export const dynamic = "force-dynamic";

// Sprint picker data for the Azure DevOps provider: full iteration list (newest
// first) plus which one ADO considers "current" today.
export async function GET() {
  try {
    const iterations = await listIterations();
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
