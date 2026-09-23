import { NextResponse } from "next/server";
import { hasIdentity, isMine } from "@/lib/identity";
import { resolveCredential } from "@/lib/providerCredentials";
import { emptyDraft, type ReportDraftState } from "@/lib/report";
import { loadDraft, saveDraft } from "@/lib/reportDraft";
import { getOrCreateSetting } from "@/lib/settings";
import { deliverablesOnly } from "@/lib/sprintPlan";
import { loadMyOpenTickets, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Report page's two questions: what is assigned to the developer right now,
// and how did they leave today's report.
//
// The ticket read spans the whole organization rather than one project. A day is
// not a project: the developer routinely touches two between two stand-ups, and
// a report that can only name one of them is a report they have to finish by
// hand. `loadMyOpenTickets` answers it in one provider call, so the wider scope
// costs nothing.
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

    const loaded = await loadMyOpenTickets(provider, identity, day);
    const deliverables = deliverablesOnly(loaded.tickets, provider);
    const mine = deliverables.filter((t) => isMine(t, identity));
    const handedOff = deliverables.filter((t) => !isMine(t, identity));
    const draft = await loadDraft({ provider, org, day }, identity.name);

    return NextResponse.json({
      provider,
      configured: true,
      connected: loaded.connected,
      notice: loaded.notice ?? "",
      truncated: !!loaded.truncated,
      day,
      identity,
      // Hierarchy rows (an Epic or a Feature that happens to bear the
      // developer's name) are dropped before the identity filter, which is the
      // order every sprint read in this app uses.
      tickets: [...mine, ...handedOff],
      handedOff: handedOff.map((t) => t.id),
      draft,
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
