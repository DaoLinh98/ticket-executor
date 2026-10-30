import { prisma } from "@/lib/prisma";
import { liveStream } from "@/lib/liveStream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fingerprint(planId: string) {
  // Parked runs too: a run parking on needs-input changes no plan row, but the row now waits on the PO.
  const [items, event, cases, parked] = await Promise.all([
    prisma.plannedTicket.aggregate({ where: { planId }, _count: true, _max: { updatedAt: true } }),
    prisma.automationEvent.findFirst({ where: { planId }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.qaCase.findMany({ where: { planId }, select: { id: true, status: true, signalAt: true, endedAt: true, postedAt: true } }),
    prisma.dagentRun.findMany({ where: { state: "waiting" }, select: { id: true } }),
  ]);
  return JSON.stringify([items._count, items._max.updatedAt, event?.id ?? "", cases.map((c) => [c.id, c.status, c.signalAt, c.endedAt, c.postedAt]), parked.map((r) => r.id)]);
}

export async function GET(req: Request) {
  const planId = new URL(req.url).searchParams.get("plan") ?? "";
  if (!planId) return new Response("plan is required", { status: 400 });
  return liveStream(req, () => fingerprint(planId));
}
