import { NextResponse } from "next/server";
import { loadTicketDetail, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The description and acceptance criteria for one ticket. Split out of the list
// payload because they are large rich text that only the opened ticket renders —
// see TICKET_FIELDS in lib/ado.ts.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const provider = normalizeProvider(new URL(req.url).searchParams.get("provider"));
  try {
    const detail = await loadTicketDetail(provider, id);
    return NextResponse.json(detail ?? { description: "", criteria: "" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
