import { NextResponse } from "next/server";
import { loadTickets, normalizeProvider } from "@/lib/tickets";
import { normalizeScope } from "@/lib/ticketScope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const provider = normalizeProvider(
    url.searchParams.get("provider") ?? process.env.TICKET_PROVIDER
  );
  const sprint = url.searchParams.get("sprint") ?? undefined;
  const project = url.searchParams.get("project") ?? undefined;
  // sprint | backlog | board. Which view of the provider's work this is — see
  // lib/ticketScope.ts. Absent means sprint, which is what every caller written
  // before the other two views existed means.
  const scope = normalizeScope(url.searchParams.get("scope"));
  try {
    const result = await loadTickets(provider, project, sprint, scope, true);
    return NextResponse.json({ provider, scope, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, provider, tickets: [], sprint: "", connected: false },
      { status: 500 }
    );
  }
}
