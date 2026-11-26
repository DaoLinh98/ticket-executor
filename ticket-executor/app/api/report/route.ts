import { NextResponse } from "next/server";
import { claimedSprint, type PlanKey } from "@/lib/executionStore";
import { hasIdentity } from "@/lib/identity";
import { resolveCredential } from "@/lib/providerCredentials";
import { emptyDraft, type ReportDraftState } from "@/lib/report";
import { loadDraft, loadPreviousSent, loadSent, saveDraft } from "@/lib/reportDraft";
import { getOrCreateSetting } from "@/lib/settings";
import { slackReportChannel } from "@/lib/slack";
import { deliverablesOnly } from "@/lib/sprintPlan";
import { loadMyCycle, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Report page's two questions: what is in the developer's sprint right now,
// and how did they leave today's report.
//
// The list is the same set My Sprint shows — what the developer carried through
// the current iteration (`claimedSprint`) — so the two pages never disagree and
// the report is not buried under every old open item. A ticket outside it is
// added by hand from the search box.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const setting = await getOrCreateSetting();
  const provider = normalizeProvider(params.get("provider") ?? setting.provider);
  const day = (params.get("day") || new Date().toISOString()).slice(0, 10);

  try {
    const { org, identity } = await resolveCredential(provider);
    if (!hasIdentity(identity)) {
      return NextResponse.json({
        provider,
        configured: false,
        notice:
          "This organization does not know who you are yet — add your email in Settings → Connection.",
        day,
        tickets: [],
        draft: emptyDraft(""),
      });
    }

    const { cycle, loaded, cycleNotice } = await loadMyCycle(
      provider,
      identity,
      setting.sprintAnchorProject,
      day
    );
    const key: PlanKey = { provider, org, project: "", sprint: cycle.sprint, identityEmail: identity.email };
    const claimed = (await claimedSprint(key, deliverablesOnly(loaded.tickets, provider), identity)).filter(
      (c) => c.claim !== "dropped"
    );
    const mine = claimed.filter((c) => c.claim === "mine").map((c) => c.ticket);
    const handedOff = claimed.filter((c) => c.claim === "handed-off").map((c) => c.ticket);
    const [draft, sent, previous] = await Promise.all([
      loadDraft({ provider, org, day }, identity.name, cycle.startDate),
      loadSent({ provider, org, day }),
      loadPreviousSent({ provider, org, day }),
    ]);

    return NextResponse.json({
      provider,
      configured: true,
      connected: loaded.connected,
      notice: [loaded.notice, cycleNotice].filter(Boolean).join(" "),
      truncated: !!loaded.truncated,
      day,
      identity,
      sprint: cycle.sprint,
      tickets: [...mine, ...handedOff],
      handedOff: handedOff.map((t) => t.id),
      draft,
      sent,
      previous,
      slack: !!slackReportChannel(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, provider, configured: false, day, tickets: [], draft: emptyDraft("") },
      { status: 500 }
    );
  }
}

// The draft, as the page holds it. The whole state every time: it is a handful
// of booleans per ticket, and a patch protocol would only add a way for the
// phone and the laptop to disagree about which half is current.
export async function PUT(req: Request) {
  const params = new URL(req.url).searchParams;
  const setting = await getOrCreateSetting();
  const provider = normalizeProvider(params.get("provider") ?? setting.provider);
  const day = (params.get("day") || new Date().toISOString()).slice(0, 10);

  try {
    const { org, identity } = await resolveCredential(provider);
    if (!hasIdentity(identity))
      return NextResponse.json({ error: "No identity configured for this organization." }, { status: 400 });

    const body = (await req.json()) as { draft?: ReportDraftState };
    if (!body?.draft) return NextResponse.json({ error: "No draft in body." }, { status: 400 });

    await saveDraft({ provider, org, day }, body.draft);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
