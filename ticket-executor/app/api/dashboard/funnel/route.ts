import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadDeliveryFunnel, normalizeProvider } from "@/lib/tickets";
import { activeConnection } from "@/lib/providerCredentials";
import { cached, DB_CACHE_PREFIX } from "@/lib/redis";

const FUNNEL_TTL = 60;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Split out of GET /api/dashboard on purpose: resolving PR outcomes costs one or
// two provider round-trips per PR, so the main metrics stay instant and the
// funnel fills in behind them. Same provider/project/days scoping as the parent.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const project = url.searchParams.get("project") || undefined;
  const days = Number(url.searchParams.get("days")) || 0;
  const providerParam = url.searchParams.get("provider");

  try {
    // With no provider filter the funnel has to pick one to query — fall back to
    // the configured provider, since a PR URL can only be resolved by its own.
    const setting = providerParam
      ? null
      : await prisma.setting.findUnique({ where: { id: "default" }, select: { provider: true } });
    const provider = normalizeProvider(providerParam ?? setting?.provider);
    // Only this organization's pull requests can be resolved with the credential
    // the query will run under, and only its runs are the history on screen.
    const active = await activeConnection(provider);

    const key = `${DB_CACHE_PREFIX}funnelPrs:${JSON.stringify([
      providerParam ?? "", active?.org ?? "", project ?? "", days,
    ])}`;
    const prUrls = await cached(key, FUNNEL_TTL, async () => {
      const rows = await prisma.run.findMany({
        where: {
          NOT: { prUrl: "" },
          ...(days ? { startedAt: { gte: new Date(Date.now() - days * 86400000) } } : {}),
          ...(providerParam ? { provider: providerParam } : {}),
          ...(active?.org ? { org: active.org } : {}),
          ...(project ? { project } : {}),
        },
        orderBy: { startedAt: "desc" },
        select: { prUrl: true },
      });
      // One PR can back several runs (a retry reuses it) — count each PR once.
      return [...new Set(rows.map((r) => r.prUrl))];
    });

    return NextResponse.json(await loadDeliveryFunnel(provider, prUrls));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
