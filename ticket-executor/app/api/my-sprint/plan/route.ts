import { NextResponse } from "next/server";
import {
  findPlan,
  latestTriage,
  planById,
  rebuildPlan,
  recentAutomation,
  releasePlannedTicket,
  setPlanAutomation,
  setPlanStatus,
  setTicketUnblocked,
  tickNow,
  type TriageResult,
} from "@/lib/executionStore";
import { hasIdentity } from "@/lib/identity";
import { prisma } from "@/lib/prisma";
import { resolveCredential } from "@/lib/providerCredentials";
import { getOrCreateSetting } from "@/lib/settings";
import { DEFAULT_PLAN_CONFIG, deliverablesOnly, type PlanConfig } from "@/lib/sprintPlan";
import { loadMySprintTickets, loadSprints, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function keyFor(provider: string, project: string, sprint: string) {
  const { org, identity } = await resolveCredential(provider);
  return { key: { provider, org, project, sprint, identityEmail: identity.email }, identity };
}

// GET /api/my-sprint/plan?project=…&sprint=… — the stored plan and its audit log.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const setting = await getOrCreateSetting();
  const provider = normalizeProvider(params.get("provider") ?? setting.provider);
  const { key } = await keyFor(provider, params.get("project") ?? "", params.get("sprint") ?? "");
  const plan = await findPlan(key);
  return NextResponse.json({
    plan,
    events: plan ? await recentAutomation(plan.id) : [],
  });
}

// POST /api/my-sprint/plan — (re)build the plan for this sprint from the current
// tickets and the newest triage.
//
// Rebuilding mid-sprint is normal: work lands, scope moves, an estimate changes.
// What it must never do is rewrite the record of what already happened, which is
// why `savePlan()` leaves any ticket that has been run or released alone.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const setting = await getOrCreateSetting();
  const provider = normalizeProvider(typeof body.provider === "string" ? body.provider : setting.provider);
  const project = String(body.project ?? "");
  const sprintParam = String(body.sprint ?? "");
  const today = (typeof body.today === "string" && body.today ? body.today : new Date().toISOString()).slice(0, 10);

  const { key: partialKey, identity } = await keyFor(provider, project, sprintParam);
  if (!hasIdentity(identity)) {
    return NextResponse.json({ error: "This organization has no identity configured." }, { status: 400 });
  }

  const includeWider = body.includeWider !== false;
  const [loaded, sprints] = await Promise.all([
    loadMySprintTickets(provider, project, sprintParam || undefined, identity, includeWider),
    loadSprints(provider, project),
  ]);
  const sprint = sprintParam || loaded.sprint || sprints.current;
  const iteration = sprints.sprints.find((s) => s.name === sprint) ?? null;
  const window = {
    startDate: (iteration?.startDate ?? "").slice(0, 10),
    finishDate: (iteration?.finishDate ?? "").slice(0, 10),
  };
  const key = { ...partialKey, sprint };

  const cfg: PlanConfig = {
    hoursPerPoint: setting.hoursPerStoryPoint || DEFAULT_PLAN_CONFIG.hoursPerPoint,
    hoursPerDay: Number(body.hoursPerDay) > 0 ? Number(body.hoursPerDay) : DEFAULT_PLAN_CONFIG.hoursPerDay,
    pointsPerDay: Number(body.pointsPerDay) > 0 ? Number(body.pointsPerDay) : DEFAULT_PLAN_CONFIG.pointsPerDay,
    maxTicketsPerDay: Number(body.maxTicketsPerDay) > 0 ? Number(body.maxTicketsPerDay) : 0,
  };

  const triageRow = await latestTriage(key);
  const triage =
    triageRow?.status === "succeeded" ? (triageRow.result as unknown as TriageResult) : null;

  const plan = await rebuildPlan(
    key,
    // The whole team's sprint, not the developer's slice: `claimSprint()` has to
    // see a ticket sitting under somebody else's name to tell "handed to QA"
    // from "moved out of the sprint". Plus the developer's own work from outside
    // the iteration, which `loadMySprintTickets()` has already folded in.
    deliverablesOnly(loaded.tickets, provider),
    identity,
    triage,
    window,
    today,
    cfg,
    {
      includeWider,
      ...(Array.isArray(body.reviewers) ? { reviewers: body.reviewers.map(String) } : {}),
    }
  );
  return NextResponse.json({ plan, usedTriage: !!triage, widened: loaded.widened });
}

// PATCH /api/my-sprint/plan — activate, park, or change what the plan automates,
// and override triage's verdict on one ticket ({ item, unblocked }).
//
// Activation is the line between a draft and something that spends money and
// writes to the tracker, so it is its own explicit action rather than a side
// effect of building a plan.
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));

  // Overriding triage on one ticket, rather than changing the plan. Handled
  // first and returned from, because it is addressed by planned-ticket id and
  // every branch below expects a plan id — running both off one `id` field
  // would make the route's contract depend on which keys happen to be present.
  if (typeof body.item === "string" && body.item && typeof body.unblocked === "boolean") {
    const updated = await setTicketUnblocked(body.item, body.unblocked);
    if (!updated) return NextResponse.json({ error: "No such planned ticket." }, { status: 404 });
    return NextResponse.json({ plan: await planById(updated.planId) });
  }

  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  if (typeof body.status === "string") {
    const status = body.status as "draft" | "active" | "archived";
    if (!["draft", "active", "archived"].includes(status)) {
      return NextResponse.json({ error: "Unknown plan status." }, { status: 400 });
    }
    await setPlanStatus(id, status);
  }
  const patch: { autoImplement?: boolean; autoRelease?: boolean; reviewers?: string[] } = {};
  if (typeof body.autoImplement === "boolean") patch.autoImplement = body.autoImplement;
  if (typeof body.autoRelease === "boolean") patch.autoRelease = body.autoRelease;
  if (Array.isArray(body.reviewers)) patch.reviewers = body.reviewers.map(String).filter(Boolean);
  if (Object.keys(patch).length) await setPlanAutomation(id, patch);

  return NextResponse.json({ plan: await planById(id) });
}

// PUT /api/my-sprint/plan — the manual half of the same machinery.
//
//   { release: "<plannedTicketId>" }  hand one finished ticket over now
//   { tick: true }                    run one scheduler pass immediately
//
// The button and the timer call exactly the same code on purpose: an automation
// nobody can trigger by hand is one nobody can check.
export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.release === "string" && body.release) {
    const outcome = await releasePlannedTicket(body.release);
    const item = await prisma.plannedTicket.findUnique({ where: { id: body.release } });
    return NextResponse.json({ outcome, plan: item ? await planById(item.planId) : null });
  }
  if (body.tick) return NextResponse.json({ report: await tickNow() });
  return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
}
