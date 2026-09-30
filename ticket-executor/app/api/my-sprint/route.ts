import { NextResponse } from "next/server";
import { claimedSprint, planInputs, type PlanKey } from "@/lib/executionStore";
// import { latestTriage, type TriageResult } from "@/lib/executionStore";
import { hasIdentity } from "@/lib/identity";
import { resolveCredential } from "@/lib/providerCredentials";
import { getOrCreateSetting } from "@/lib/settings";
import {
  buildPlan,
  DEFAULT_PLAN_CONFIG,
  deliverablesOnly,
  type PlanConfig,
} from "@/lib/sprintPlan";
import { loadMyCycle, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/my-sprint
//
// The developer's work across every project they are assigned in, laid onto the
// calendar of one anchor project's current iteration (`Setting.sprintAnchorProject`).
//
// The whole computation lives in `lib/sprintPlan.ts` and is pure; this route
// only gathers its inputs. That split is deliberate: the same function will be
// called by the scheduler, with no request in sight.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const setting = await getOrCreateSetting();
  const provider = normalizeProvider(params.get("provider") ?? setting.provider);
  const today = (params.get("today") || new Date().toISOString()).slice(0, 10);
  const anchorProject = setting.sprintAnchorProject;

  const cfg: PlanConfig = {
    ...DEFAULT_PLAN_CONFIG,
    hoursPerPoint: setting.hoursPerStoryPoint || DEFAULT_PLAN_CONFIG.hoursPerPoint,
  };

  try {
    const { org, identity } = await resolveCredential(provider);
    if (!hasIdentity(identity)) {
      // Not an error: the connection simply has not been told who the developer
      // is. Reported as a state the page can explain, with a link to fix it,
      // rather than as an empty sprint that looks like a quiet week.
      return NextResponse.json({
        provider,
        identity,
        configured: false,
        notice:
          "This organization does not know who you are yet — add your email in Settings → Connection.",
        anchorProject,
        sprint: "",
        window: { startDate: "", finishDate: "" },
        plan: null,
        config: cfg,
      });
    }

    const { cycle, loaded, cycleNotice } = await loadMyCycle(provider, identity, anchorProject, today);
    const window = { startDate: cycle.startDate, finishDate: cycle.finishDate };
    const deliverables = deliverablesOnly(loaded.tickets, provider);

    // The developer's sprint is what they carried, not what still bears their
    // name: a ticket finished and handed to QA leaves `System.AssignedTo` and
    // would otherwise take its points off this page on the day it succeeded.
    // `claimedSprint()` merges the live list with what the plan remembers, so
    // the numbers only ever grow through a sprint.
    const key: PlanKey = { provider, org, project: "", sprint: cycle.sprint, identityEmail: identity.email };
    const claimed = await claimedSprint(key, deliverables, identity);

    // Triage is switched off on this page for now.
    // const triageRow = await latestTriage(key);
    // const triage =
    //   triageRow?.status === "succeeded" ? (triageRow.result as unknown as TriageResult) : null;

    const plan = buildPlan(planInputs(claimed, null), window, today, cfg);
    const mine = claimed.filter((c) => c.claim === "mine").map((c) => c.ticket);

    return NextResponse.json({
      provider,
      identity,
      configured: true,
      connected: loaded.connected,
      notice: [loaded.notice, cycleNotice].filter(Boolean).join(" "),
      anchorProject,
      sprint: cycle.sprint,
      window,
      today,
      truncated: !!loaded.truncated,
      tickets: mine,
      // Everything the sprint holds, each row carrying where its claim stands.
      // The page needs all three groups: `mine` is what is left to do,
      // `handed-off` is what would otherwise have vanished, and `dropped` is the
      // scope change that explains the difference.
      claimed,
      plan,
      config: cfg,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, provider, configured: false, plan: null, tickets: [], config: cfg },
      { status: 500 }
    );
  }
}
