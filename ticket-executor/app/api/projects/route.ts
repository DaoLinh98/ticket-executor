import { NextResponse } from "next/server";
import { loadProjects, normalizeProvider } from "@/lib/tickets";
import { getOrCreateSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Projects available for the configured organization (Projects page + the
// ticket-execution project dropdown). Provider-aware; unwired providers return
// an empty "not connected" result rather than throwing.
//
// Without a `provider` param the stored setting decides, and the response echoes
// which one that was. That is what lets a caller that has no opinion ask once
// instead of fetching /api/settings first purely to fill in this parameter.
export async function GET(req: Request) {
  const requested = new URL(req.url).searchParams.get("provider");
  const provider = normalizeProvider(requested ?? (await getOrCreateSetting()).provider);
  try {
    const result = await loadProjects(provider);
    return NextResponse.json({ provider, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, provider, projects: [], connected: false },
      { status: 500 }
    );
  }
}
