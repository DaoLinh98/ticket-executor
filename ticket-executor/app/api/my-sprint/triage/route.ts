import { NextResponse } from "next/server";
import { getTriage, latestTriage, startTriage } from "@/lib/executionStore";
import { hasIdentity, mineOnly } from "@/lib/identity";
import { prisma } from "@/lib/prisma";
import { resolveCredential } from "@/lib/providerCredentials";
import { getOrCreateSetting } from "@/lib/settings";
import { deliverablesOnly } from "@/lib/sprintPlan";
import { loadMySprintTickets, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/my-sprint/triage?project=…&sprint=…[&id=…]
//
// The newest triage for this sprint, or one by id while it is still running.
// A row is the handle: the turn outlives the request that started it, and a
// server restart leaves a `running` row that says what was in flight rather than
// a request that simply vanished.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = params.get("id") ?? "";
  if (id) return NextResponse.json({ triage: await getTriage(id) });

  const setting = await getOrCreateSetting();
  const provider = normalizeProvider(params.get("provider") ?? setting.provider);
  const { org, identity } = await resolveCredential(provider);
  return NextResponse.json({
    triage: await latestTriage({
      provider,
      org,
      project: params.get("project") ?? "",
      sprint: params.get("sprint") ?? "",
      identityEmail: identity.email,
    }),
  });
}

// POST /api/my-sprint/triage — read the developer's tickets in this sprint and
// judge readiness, sizing and work order. The turn writes nothing: it drafts the
// comments and the re-estimates, and the developer applies the ones they accept.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const setting = await getOrCreateSetting();
  const provider = normalizeProvider(typeof body.provider === "string" ? body.provider : setting.provider);
  const project = String(body.project ?? "");
  const sprint = String(body.sprint ?? "");

  const { org, identity } = await resolveCredential(provider);
  if (!hasIdentity(identity)) {
    return NextResponse.json(
      { error: "This organization does not know who you are yet — add your email in Settings → Connection." },
      { status: 400 }
    );
  }

  // Triage judges the same set the plan is built from, widened the same way: a
  // ticket the planner will schedule and the triage never saw would be ordered
  // with no readiness verdict at all.
  const includeWider = body.includeWider !== false;
  const loaded = await loadMySprintTickets(provider, project, sprint || undefined, identity, includeWider);
  const mine = mineOnly(deliverablesOnly(loaded.tickets, provider), identity);
  // Optional on purpose: a triage turn writes nothing, so a project the
  // developer has never run by hand is still worth reading. Without a repo the
  // turn judges from the tickets alone — see `startTriage()`.
  const mapped = await prisma.rootRepoProjectMap.findUnique({
    where: { provider_org_project: { provider, org, project } },
  });

  const started = await startTriage({
    provider,
    org,
    project,
    sprint: sprint || loaded.sprint,
    identityEmail: identity.email,
    identityName: identity.name,
    rootRepo: mapped?.rootRepo ?? "",
    tickets: mine,
  });
  if ("error" in started) return NextResponse.json({ error: started.error }, { status: 400 });
  return NextResponse.json({ id: started.id });
}
