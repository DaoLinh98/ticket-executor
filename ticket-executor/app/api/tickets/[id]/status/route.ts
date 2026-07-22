import { NextResponse } from "next/server";
import { getStatusOptions, updateTicketStatus, resolveStatusForUpdate, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Real per-ticket status options (see lib/tickets.ts#getStatusOptions) — replaces the
// old hard-coded STATUS_ALL list, which didn't reflect any provider's actual workflow.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const provider = normalizeProvider(url.searchParams.get("provider"));
  const ticketType = url.searchParams.get("type") ?? "";
  try {
    const options = await getStatusOptions(provider, id, ticketType);
    return NextResponse.json({ options });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ options: [], error: message }, { status: 500 });
  }
}

// Writes the new status back to the provider — a real sync, not a local-only override.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const provider = normalizeProvider(body.provider);
    const status = String(body.status || "");
    if (!status) return NextResponse.json({ error: "status is required" }, { status: 400 });
    const resolved = await resolveStatusForUpdate(provider, id, status);
    if (!resolved) {
      return NextResponse.json(
        { error: `No workflow state on this ticket matches "${status}" — update it manually` },
        { status: 422 }
      );
    }
    await updateTicketStatus(provider, id, resolved);
    return NextResponse.json({ ok: true, status: resolved });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
