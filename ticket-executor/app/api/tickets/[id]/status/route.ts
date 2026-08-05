import { NextResponse } from "next/server";
import { getStatusOptions, updateTicketStatus, resolveStatusForUpdate, readTicketStatus, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Real per-ticket status options (see lib/tickets.ts#getStatusOptions) — replaces the
// old hard-coded STATUS_ALL list, which didn't reflect any provider's actual workflow.
// `current` is the ticket's live status at the provider, so a caller that suspects its
// own copy has drifted can re-sync from one request instead of reloading every ticket.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const provider = normalizeProvider(url.searchParams.get("provider"));
  const ticketType = url.searchParams.get("type") ?? "";
  const project = url.searchParams.get("project") ?? undefined;
  try {
    const [options, current] = await Promise.all([
      getStatusOptions(provider, id, ticketType, project),
      readTicketStatus(provider, id).catch(() => ""),
    ]);
    return NextResponse.json({ options, current });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ options: [], current: "", error: message }, { status: 500 });
  }
}

// Writes the new status back to the provider — a real sync, not a local-only override.
// Every response carries where the ticket actually is (`status` on success, `current`
// on failure), because the app must never keep displaying a status the provider
// rejected — that divergence is invisible until someone opens the tracker.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const provider = normalizeProvider(body.provider);
  try {
    const status = String(body.status || "");
    if (!status) return NextResponse.json({ error: "status is required" }, { status: 400 });
    const resolved = await resolveStatusForUpdate(provider, id, status);
    if (!resolved) {
      const current = await readTicketStatus(provider, id).catch(() => "");
      return NextResponse.json(
        { error: `This ticket's workflow has no state matching "${status}" — set it manually.`, current },
        { status: 422 }
      );
    }
    const applied = await updateTicketStatus(provider, id, resolved);
    return NextResponse.json({ ok: true, status: applied });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const current = await readTicketStatus(provider, id).catch(() => "");
    return NextResponse.json({ error: message, current }, { status: 500 });
  }
}
