import { NextResponse } from "next/server";
import { sendReportToSlack, slackReportChannel } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!slackReportChannel())
    return NextResponse.json({ error: "Slack is not configured — set SLACK_REPORT_CHANNEL." }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "No report text in body." }, { status: 400 });

  try {
    await sendReportToSlack(text);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
