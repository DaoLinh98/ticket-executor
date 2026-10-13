import { prisma } from "@/lib/prisma";
import { liveStream } from "@/lib/liveStream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fingerprint() {
  const [active, edges] = await Promise.all([
    prisma.run.findMany({ where: { state: { in: ["running", "waiting"] } }, select: { id: true, state: true } }),
    prisma.run.aggregate({ _count: true, _max: { startedAt: true, endedAt: true } }),
  ]);
  return JSON.stringify([active.map((r) => [r.id, r.state]), edges._count, edges._max.startedAt, edges._max.endedAt]);
}

export async function GET(req: Request) {
  return liveStream(req, fingerprint);
}
