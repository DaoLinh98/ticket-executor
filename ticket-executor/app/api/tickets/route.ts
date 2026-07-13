import { NextResponse } from "next/server";
import { loadTickets, normalizeProvider } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const provider = normalizeProvider(
    url.searchParams.get("provider") ?? process.env.TICKET_PROVIDER
  );
  const sprint = url.searchParams.get("sprint") ?? undefined;
  try {
    const result = await loadTickets(provider, sprint);
    return NextResponse.json({ provider, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, provider, tickets: [], sprint: "", connected: false },
      { status: 500 }
    );
  }
}
