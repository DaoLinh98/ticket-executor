import { NextResponse } from "next/server";
import { loadProjects, normalizeProvider } from "@/lib/tickets";

export const dynamic = "force-dynamic";

// Projects available for the configured organization (Projects page + the
// ticket-execution project dropdown). Provider-aware; unwired providers return
// an empty "not connected" result rather than throwing.
export async function GET(req: Request) {
  const provider = normalizeProvider(
    new URL(req.url).searchParams.get("provider") ?? process.env.TICKET_PROVIDER
  );
  try {
    const result = await loadProjects(provider);
    return NextResponse.json({ provider, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, provider, projects: [], connected: false },
      { status: 500 }
    );
  }
}
