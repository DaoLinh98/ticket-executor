import { NextResponse } from "next/server";
import { getRunView } from "@/lib/dagent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getRunView(id);
  if (!view) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json(view);
}
