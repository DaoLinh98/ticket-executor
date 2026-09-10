import { NextResponse } from "next/server";
import { clearMcpProbe } from "@/lib/mcp";
import { ADO_CACHE_PREFIX } from "@/lib/ado";
import { invalidatePrefix } from "@/lib/redis";
import { normalizeProvider } from "@/lib/tickets";
import { activeConnection, listConnections, setActiveConnection } from "@/lib/providerCredentials";
import { getOrCreateSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/connections/active — the organization every consumer currently runs
// as. What the header badge reads.
export async function GET(req: Request) {
  const s = await getOrCreateSetting();
  const provider = normalizeProvider(new URL(req.url).searchParams.get("provider") ?? s.provider);
  return NextResponse.json({ provider, connection: await activeConnection(provider) });
}

// POST /api/connections/active — switch the organization. Everything that reads
// a credential (tickets, projects, sprints, reviews, preflight, MCP) resolves it
// through `resolveCredential()`, so this one write re-points all of them.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const s = await getOrCreateSetting();
  const provider = normalizeProvider(typeof body.provider === "string" ? body.provider : s.provider);
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const ok = await setActiveConnection(provider, id);
  if (!ok) return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  clearMcpProbe();
  // The cached provider answers describe the organization we are no longer
  // acting as — a stale project list is what would otherwise survive the switch.
  await invalidatePrefix(ADO_CACHE_PREFIX);
  return NextResponse.json({
    provider,
    connection: await activeConnection(provider),
    connections: await listConnections(provider),
  });
}
