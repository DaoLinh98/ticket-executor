import { NextResponse } from "next/server";
import { loadTickPreview } from "@/lib/executionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What the next scheduler tick would do for a plan. Read-only; database reads only.
export async function GET(req: Request) {
  const planId = new URL(req.url).searchParams.get("plan") ?? "";
  if (!planId) return NextResponse.json({ error: "plan is required" }, { status: 400 });
  const preview = await loadTickPreview(planId);
  if (!preview) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  return NextResponse.json(preview);
}
