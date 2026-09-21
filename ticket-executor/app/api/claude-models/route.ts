import { NextResponse } from "next/server";
import { listClaudeModels } from "@/lib/claudeModels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ models: await listClaudeModels() });
}
