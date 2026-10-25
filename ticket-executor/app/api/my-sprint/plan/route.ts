import { NextResponse } from "next/server";
import {
  addTicketToPlan,
  dismissQaReply,
  findPlan,
  holdPlannedTicket,
  listQaDrafts,
  moveInQueue,
  previewRebuild,
  setReleaseDay,
  setRunOptions,
  postQaReply,
  startQaReply,
  moveToQa,
  planById,
  rebuildPlan,
  recentAutomation,
  releasePlannedTicket,
  removeTicketFromPlan,
  retryPlannedTicket,
  setPlanAutomation,
  setPlanStatus,
  setTicketUnblocked,
  startQaFix,
  startReviewRun,
  tickNow,
} from "@/lib/executionStore";
// import { latestTriage, type TriageResult } from "@/lib/executionStore";
import { hasIdentity } from "@/lib/identity";
import { prisma } from "@/lib/prisma";
import { resolveCredential, reviewersFor } from "@/lib/providerCredentials";
import { getOrCreateSetting } from "@/lib/settings";
import { DEFAULT_PLAN_CONFIG, deliverablesOnly, type PlanConfig } from "@/lib/sprintPlan";
import { loadMyCycle, loadSprintCycle, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function keyFor(provider: string, sprint: string) {
  const { org, identity } = await resolveCredential(provider);
  return { key: { provider, org, project: "", sprint, identityEmail: identity.email }, identity };
}

// GET /api/my-sprint/plan — the stored plan for the anchor project's current
// iteration, and its audit log.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const setting = await getOrCreateSetting();
  const provider = normalizeProvider(params.get("provider") ?? setting.provider);
  const cycle = await loadSprintCycle(provider, setting.sprintAnchorProject).catch(() => null);
  const { key } = await keyFor(provider, cycle?.sprint ?? "");
  const plan = await findPlan(key);
  const forTicket = params.get("events");
  if (forTicket) {
    return NextResponse.json({ events: plan ? await recentAutomation(plan.id, 50, forTicket) : [] });
  }
  const runs = plan?.items.length
    ? await prisma.run.findMany({
        where: { ticketId: { in: plan.items.map((i) => i.ticketId) }, provider, org: key.org },
        select: { ticketId: true, steps: { select: { costUsd: true } } },
      })
    : [];
  const costs: Record<string, number> = {};
  for (const r of runs) costs[r.ticketId] = (costs[r.ticketId] ?? 0) + r.steps.reduce((sum, st) => sum + st.costUsd, 0);
  return NextResponse.json({
    plan,
    events: plan ? await recentAutomation(plan.id) : [],
    drafts: plan ? await listQaDrafts(plan.id) : [],
    costs,
  });
}

// POST /api/my-sprint/plan — (re)build the plan for the current cycle from the
// developer's tickets across every project.
//
// Rebuilding mid-sprint is normal: work lands, scope moves, an estimate changes.
// What it must never do is rewrite the record of what already happened, which is
// why `savePlan()` leaves any ticket that has been run or released alone.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const setting = await getOrCreateSetting();
  const provider = normalizeProvider(typeof body.provider === "string" ? body.provider : setting.provider);
  const today = (typeof body.today === "string" && body.today ? body.today : new Date().toISOString()).slice(0, 10);

  const { identity } = await keyFor(provider, "");
  if (!hasIdentity(identity)) {
    return NextResponse.json({ error: "This organization has no identity configured." }, { status: 400 });
  }

  const { cycle, loaded } = await loadMyCycle(provider, identity, setting.sprintAnchorProject, today);
  const window = { startDate: cycle.startDate, finishDate: cycle.finishDate };
  const { key } = await keyFor(provider, cycle.sprint);

  const cfg: PlanConfig = {
    hoursPerPoint: setting.hoursPerStoryPoint || DEFAULT_PLAN_CONFIG.hoursPerPoint,
    hoursPerDay: Number(body.hoursPerDay) > 0 ? Number(body.hoursPerDay) : DEFAULT_PLAN_CONFIG.hoursPerDay,
    pointsPerDay: Number(body.pointsPerDay) > 0 ? Number(body.pointsPerDay) : DEFAULT_PLAN_CONFIG.pointsPerDay,
    maxTicketsPerDay: Number(body.maxTicketsPerDay) > 0 ? Number(body.maxTicketsPerDay) : 0,
  };

  // Triage is switched off on this page for now.
  // const triageRow = await latestTriage(key);
  // const triage =
  //   triageRow?.status === "succeeded" ? (triageRow.result as unknown as TriageResult) : null;

  if (body.dryRun === true) {
    const preview = await previewRebuild(key, deliverablesOnly(loaded.tickets, provider), identity, null, window, today, cfg);
    return NextResponse.json({ preview });
  }

  const plan = await rebuildPlan(
    key,
    deliverablesOnly(loaded.tickets, provider),
    identity,
    null,
    window,
    today,
    cfg
  );
  const reviewers = await reviewersFor(provider, key.org);
  return NextResponse.json({
    plan,
    sprint: cycle.sprint,
    warning: reviewers.length
      ? ""
      : "No reviewers set for this organization — add them in Settings → Organizations, or released pull requests go out with nobody assigned.",
  });
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
  const patch: {
    autoImplement?: boolean; autoRelease?: boolean; autoResolveReview?: boolean; autoDraftQaReply?: boolean; reviewers?: string[]; engine?: string;
  } = {};
  if (typeof body.autoImplement === "boolean") patch.autoImplement = body.autoImplement;
  if (typeof body.autoRelease === "boolean") patch.autoRelease = body.autoRelease;
  if (typeof body.autoResolveReview === "boolean") patch.autoResolveReview = body.autoResolveReview;
  if (typeof body.autoDraftQaReply === "boolean") patch.autoDraftQaReply = body.autoDraftQaReply;
  if (Array.isArray(body.reviewers)) patch.reviewers = body.reviewers.map(String).filter(Boolean);
  if (body.engine === "classic" || body.engine === "dagent") patch.engine = body.engine;
  if (Object.keys(patch).length) await setPlanAutomation(id, patch);

  return NextResponse.json({ plan: await planById(id) });
}

// PUT /api/my-sprint/plan — the manual half of the same machinery.
//
//   { release: "<plannedTicketId>" }  hand one finished ticket over now
//   { retry:   "<plannedTicketId>" }  put a stopped ticket back in the queue
//   { tick: true }                    run one scheduler pass immediately
//   { addToRelease: { ticketId, ..., status } }  add or re-track a ticket; queued only before review
//   { removeFromRelease: "<plannedTicketId>" }  stop tracking a ticket (the row stays as a record)
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
  // The manual half of the review lane. Same starter the scheduler uses, so the
  // button cannot start a run the automation would have refused.
  if (typeof body.resolveReview === "string" && body.resolveReview) {
    const outcome = await startReviewRun(body.resolveReview, {
      reason: "asked-by-user",
      detail: "Started from the Review column on Flow Runner.",
    });
    const item = await prisma.plannedTicket.findUnique({ where: { id: body.resolveReview } });
    return NextResponse.json(
      { outcome, plan: item ? await planById(item.planId) : null },
      outcome.ok ? undefined : { status: 400 }
    );
  }
  // Back into the implement queue. Deliberately not a "run it now" button: it
  // resets the row and the scheduler starts it on its next pass, so a retried
  // ticket meets the same admission rules as any other.
  if (typeof body.retry === "string" && body.retry) {
    const outcome = await retryPlannedTicket(body.retry);
    const item = await prisma.plannedTicket.findUnique({ where: { id: body.retry } });
    return NextResponse.json(
      { outcome, plan: item ? await planById(item.planId) : null },
      outcome.ok ? undefined : { status: 400 }
    );
  }
  if (typeof body.draftQaReply === "string" && body.draftQaReply) {
    const outcome = await startQaReply(body.draftQaReply);
    return NextResponse.json({ outcome }, outcome.ok ? undefined : { status: 400 });
  }
  if (typeof body.postQaReply === "string" && body.postQaReply) {
    const outcome = await postQaReply(body.postQaReply, typeof body.body === "string" ? body.body : "");
    return NextResponse.json({ outcome }, outcome.ok ? undefined : { status: 400 });
  }
  if (typeof body.dismissQaReply === "string" && body.dismissQaReply) {
    const outcome = await dismissQaReply(body.dismissQaReply);
    return NextResponse.json({ outcome }, outcome.ok ? undefined : { status: 400 });
  }
  if (typeof body.startQaFix === "string" && body.startQaFix) {
    const outcome = await startQaFix(body.startQaFix);
    const item = await prisma.plannedTicket.findUnique({ where: { id: body.startQaFix } });
    return NextResponse.json(
      { outcome, plan: item ? await planById(item.planId) : null },
      outcome.ok ? undefined : { status: 400 }
    );
  }
  if (typeof body.moveToQa === "string" && body.moveToQa) {
    const outcome = await moveToQa(body.moveToQa);
    const item = await prisma.plannedTicket.findUnique({ where: { id: body.moveToQa } });
    return NextResponse.json(
      { outcome, plan: item ? await planById(item.planId) : null },
      outcome.ok ? undefined : { status: 400 }
    );
  }
  if (body.addToRelease && typeof body.addToRelease === "object" && typeof body.addToRelease.ticketId === "string") {
    const t = body.addToRelease;
    const setting = await getOrCreateSetting();
    const provider = normalizeProvider(setting.provider);
    const cycle = await loadSprintCycle(provider, setting.sprintAnchorProject).catch(() => null);
    const { key } = await keyFor(provider, cycle?.sprint ?? "");
    const plan = await findPlan(key);
    if (!plan) return NextResponse.json({ error: "There is no plan for this sprint yet — build one on My Sprint first." }, { status: 400 });
    const number = (v: unknown) => (Number(v) > 0 ? Number(v) : 0);
    const outcome = await addTicketToPlan(
      plan,
      {
        ticketId: t.ticketId,
        title: String(t.title ?? ""),
        project: String(t.project ?? ""),
        points: number(t.points),
        estimateHours: number(t.estimateHours),
        status: String(t.status ?? ""),
      },
      new Date().toISOString().slice(0, 10)
    );
    return NextResponse.json({ outcome, plan: await planById(plan.id) }, outcome.ok ? undefined : { status: 400 });
  }
  if (typeof body.removeFromRelease === "string" && body.removeFromRelease) {
    const item = await prisma.plannedTicket.findUnique({ where: { id: body.removeFromRelease } });
    const outcome = await removeTicketFromPlan(body.removeFromRelease);
    return NextResponse.json(
      { outcome, plan: item ? await planById(item.planId) : null },
      outcome.ok ? undefined : { status: 400 }
    );
  }
  if (body.moveInQueue && typeof body.moveInQueue === "object" && typeof body.moveInQueue.id === "string") {
    const { id, move } = body.moveInQueue;
    if (!["up", "down", "top"].includes(move)) return NextResponse.json({ error: "Unknown move." }, { status: 400 });
    const outcome = await moveInQueue(id, move);
    const item = await prisma.plannedTicket.findUnique({ where: { id } });
    return NextResponse.json({ outcome, plan: item ? await planById(item.planId) : null }, outcome.ok ? undefined : { status: 400 });
  }
  if (body.setReleaseDay && typeof body.setReleaseDay === "object" && typeof body.setReleaseDay.id === "string") {
    const { id, day } = body.setReleaseDay;
    const outcome = await setReleaseDay(id, String(day ?? ""), new Date().toISOString().slice(0, 10));
    const item = await prisma.plannedTicket.findUnique({ where: { id } });
    return NextResponse.json({ outcome, plan: item ? await planById(item.planId) : null }, outcome.ok ? undefined : { status: 400 });
  }
  if (body.setRunOptions && typeof body.setRunOptions === "object" && typeof body.setRunOptions.id === "string") {
    const { id, model, effort } = body.setRunOptions;
    const outcome = await setRunOptions(id, String(model ?? ""), String(effort ?? ""));
    const item = await prisma.plannedTicket.findUnique({ where: { id } });
    return NextResponse.json({ outcome, plan: item ? await planById(item.planId) : null }, outcome.ok ? undefined : { status: 400 });
  }
  if (typeof body.hold === "string" && body.hold) {
    const outcome = await holdPlannedTicket(body.hold);
    const item = await prisma.plannedTicket.findUnique({ where: { id: body.hold } });
    return NextResponse.json({ outcome, plan: item ? await planById(item.planId) : null }, outcome.ok ? undefined : { status: 400 });
  }
  if (body.tick) return NextResponse.json({ report: await tickNow() });
  return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
}
