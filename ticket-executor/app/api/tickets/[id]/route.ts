import { NextResponse } from "next/server";
import { getOrCreateSetting } from "@/lib/settings";
import { loadTicket, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One ticket by id, for a screen that has to show a ticket its current board
// does not contain — the notification bell sends the developer to released work
// and to tickets in other projects.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const setting = await getOrCreateSetting();
  const provider = normalizeProvider(new URL(req.url).searchParams.get("provider") ?? setting.provider);
  try {
    const ticket = await loadTicket(provider, id);
    return NextResponse.json({ ticket });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
