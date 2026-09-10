import { NextResponse } from "next/server";
import { clearMcpProbe } from "@/lib/mcp";
import { ADO_CACHE_PREFIX } from "@/lib/ado";
import { invalidatePrefix } from "@/lib/redis";
import { normalizeProvider } from "@/lib/tickets";
import { deleteConnection, listConnections, saveConnection } from "@/lib/providerCredentials";
import { getOrCreateSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clean = (s: string) => s.replace(/[\r\n]+/g, "").trim();

// GET /api/connections[?provider=github] — every organization saved for the
// provider (the currently selected one when the parameter is absent), with the
// active one flagged. Never returns a token.
export async function GET(req: Request) {
  const s = await getOrCreateSetting();
  const provider = normalizeProvider(new URL(req.url).searchParams.get("provider") ?? s.provider);
  const connections = await listConnections(provider);
  return NextResponse.json({ provider, connections });
}

// POST /api/connections — create or update one organization's connection.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const provider = normalizeProvider(typeof body.provider === "string" ? body.provider : undefined);
  const org = clean(typeof body.org === "string" ? body.org : "");
  if (!org) return NextResponse.json({ error: "URL is required." }, { status: 400 });

  const conn = await saveConnection({
    id: typeof body.id === "string" && body.id ? body.id : undefined,
    provider,
    label: clean(typeof body.label === "string" ? body.label : ""),
    org,
    pat: typeof body.pat === "string" ? body.pat.trim() : "",
    identityEmail: clean(typeof body.identityEmail === "string" ? body.identityEmail : ""),
    identityName: clean(typeof body.identityName === "string" ? body.identityName : ""),
  });
  // The generated MCP config is built from this credential, so a cached "MCP is
  // fine" verdict no longer describes the setup a run would get.
  clearMcpProbe();
  // The cached provider answers describe the organization we are no longer
  // acting as — a stale project list is what would otherwise survive the switch.
  await invalidatePrefix(ADO_CACHE_PREFIX);
  return NextResponse.json({ connections: await listConnections(provider), connection: conn });
}

// DELETE /api/connections?id=… — remove one organization's connection.
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const s = await getOrCreateSetting();
  const provider = normalizeProvider(new URL(req.url).searchParams.get("provider") ?? s.provider);
  const removed = await deleteConnection(id);
  if (!removed) return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  clearMcpProbe();
  // The cached provider answers describe the organization we are no longer
  // acting as — a stale project list is what would otherwise survive the switch.
  await invalidatePrefix(ADO_CACHE_PREFIX);
  return NextResponse.json({ connections: await listConnections(provider) });
}
