import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCredential } from "@/lib/providerCredentials";
import { getOrCreateSetting } from "@/lib/settings";
import { normalizeProvider } from "@/lib/tickets";

export const dynamic = "force-dynamic";

const clean = (s: string) => s.replace(/[\r\n]+/g, "").trim();

// Which connection this mapping belongs to. Resolved server-side from the active
// connection rather than taken from the client: the browser has no business
// knowing the organization URL, and every caller here is already asking about
// the connection it is currently looking at.
async function scope(provider?: string) {
  const setting = await getOrCreateSetting();
  const p = normalizeProvider(provider || setting.provider);
  const { org } = await resolveCredential(p);
  return { provider: p, org };
}

// GET /api/options/mapping?project=foo[&provider=…] -> { rootRepo: string | null }
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const project = clean(params.get("project") ?? "");
  if (!project) return NextResponse.json({ rootRepo: null });
  const { provider, org } = await scope(params.get("provider") ?? "");
  const row = await prisma.rootRepoProjectMap.findUnique({
    where: { provider_org_project: { provider, org, project } },
  });
  return NextResponse.json({ rootRepo: row?.rootRepo ?? null });
}

// POST { project, rootRepo } -> remembers which root repo this project last ran with.
export async function POST(req: Request) {
  const body = await req.json();
  const project = typeof body.project === "string" ? clean(body.project) : "";
  const rootRepo = typeof body.rootRepo === "string" ? clean(body.rootRepo) : "";
  if (!project || !rootRepo) {
    return NextResponse.json({ error: "project and rootRepo are required" }, { status: 400 });
  }
  const { provider, org } = await scope(typeof body.provider === "string" ? body.provider : "");
  await prisma.rootRepoProjectMap.upsert({
    where: { provider_org_project: { provider, org, project } },
    create: { provider, org, project, rootRepo },
    update: { rootRepo },
  });
  return NextResponse.json({ ok: true });
}
