import { NextResponse } from "next/server";
import { hasIdentity } from "@/lib/identity";
import { resolveCredential } from "@/lib/providerCredentials";
import type { ReportDraftState } from "@/lib/report";
import { markSent } from "@/lib/reportDraft";
import { getOrCreateSetting } from "@/lib/settings";
import { sendReportToSlack, slackReportChannel } from "@/lib/slack";
import { normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!slackReportChannel())
    return NextResponse.json({ error: "Slack is not configured — set SLACK_REPORT_CHANNEL." }, { status: 400 });

  const params = new URL(req.url).searchParams;
  const setting = await getOrCreateSetting();
  const provider = normalizeProvider(params.get("provider") ?? setting.provider);
  const day = (params.get("day") || new Date().toISOString()).slice(0, 10);

  const body = (await req.json().catch(() => null)) as { text?: unknown; draft?: ReportDraftState } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "No report text in body." }, { status: 400 });
  if (!body?.draft) return NextResponse.json({ error: "No draft in body." }, { status: 400 });

  try {
    const { org, identity } = await resolveCredential(provider);
    if (!hasIdentity(identity))
      return NextResponse.json({ error: "No identity configured for this organization." }, { status: 400 });

    await sendReportToSlack(text);
    const sent = await markSent({ provider, org, day }, body.draft, text);
    return NextResponse.json({ ok: true, sent });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
