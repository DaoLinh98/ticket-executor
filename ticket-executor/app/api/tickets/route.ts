import { NextResponse } from "next/server";
import { loadTickets, normalizeProvider } from "@/lib/tickets";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const provider = normalizeProvider(
    url.searchParams.get("provider") ?? process.env.TICKET_PROVIDER
  );
  const sprint = url.searchParams.get("sprint") ?? undefined;
  try {
    const setting = await prisma.setting.findUnique({ where: { id: "default" } });
    const personalFilter =
      setting && setting.scope === "personal"
        ? { scope: "personal" as const, account: setting.personalAccount }
        : undefined;
    const result = await loadTickets(provider, sprint, personalFilter);
    return NextResponse.json({ provider, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, provider, tickets: [], sprint: "", connected: false },
      { status: 500 }
    );
  }
}
