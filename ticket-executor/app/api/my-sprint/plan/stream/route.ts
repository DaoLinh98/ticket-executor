import { prisma } from "@/lib/prisma";
import { liveStream } from "@/lib/liveStream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fingerprint(planId: string) {
  const [items, event, drafts] = await Promise.all([
    prisma.plannedTicket.aggregate({ where: { planId }, _count: true, _max: { updatedAt: true } }),
    prisma.automationEvent.findFirst({ where: { planId }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.qaReplyDraft.findMany({ where: { planId }, select: { id: true, status: true, postedAt: true } }),
  ]);
  return JSON.stringify([items._count, items._max.updatedAt, event?.id ?? "", drafts.map((d) => [d.id, d.status, d.postedAt])]);
}

export async function GET(req: Request) {
  const planId = new URL(req.url).searchParams.get("plan") ?? "";
  if (!planId) return new Response("plan is required", { status: 400 });
  return liveStream(req, () => fingerprint(planId));
}
