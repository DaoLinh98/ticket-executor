import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadDeliveryFunnel, normalizeProvider } from "@/lib/tickets";

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

    const rows = await prisma.execution.findMany({
      where: {
        NOT: { prUrl: "" },
        ...(days ? { startedAt: { gte: new Date(Date.now() - days * 86400000) } } : {}),
        ...(providerParam ? { provider: providerParam } : {}),
        ...(project ? { projectName: project } : {}),
      },
      orderBy: { startedAt: "desc" },
      select: { prUrl: true },
    });
    // One PR can back several runs (a retry reuses it) — count each PR once.
    const prUrls = [...new Set(rows.map((r) => r.prUrl))];

    return NextResponse.json(await loadDeliveryFunnel(provider, prUrls));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
