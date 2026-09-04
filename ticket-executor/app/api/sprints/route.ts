import { NextResponse } from "next/server";
import { loadSprints, normalizeProvider } from "@/lib/tickets";

export const dynamic = "force-dynamic";

// Sprint picker data: the full iteration list (newest first) plus whichever the
// provider considers "current" today.
//
// The dispatch lives in `lib/tickets.ts`, not here, so this route stays out of
// the business of choosing a provider client.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const provider = normalizeProvider(params.get("provider") ?? process.env.TICKET_PROVIDER);
  const project = params.get("project") ?? "";
  try {
    return NextResponse.json(await loadSprints(provider, project));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, sprints: [], current: "" }, { status: 500 });
  }
}
