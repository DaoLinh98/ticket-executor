import { NextResponse } from "next/server";
import { cancelRun } from "@/lib/dagent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await cancelRun(id))) return NextResponse.json({ error: "Run is not active" }, { status: 409 });
  return NextResponse.json({ cancelled: true });
}
