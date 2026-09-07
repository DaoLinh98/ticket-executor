import { NextResponse } from "next/server";
import { claimedSprint, latestTriage, planInputs, type TriageResult } from "@/lib/executionStore";
import { hasIdentity } from "@/lib/identity";
import { resolveCredential } from "@/lib/providerCredentials";
import { getOrCreateSetting } from "@/lib/settings";
import {
  buildPlan,
  DEFAULT_PLAN_CONFIG,
  deliverablesOnly,
  type PlanConfig,
  type PlanInput,
} from "@/lib/sprintPlan";
import { loadMySprintTickets, loadSprints, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/my-sprint?project=…&sprint=…
//
// The developer's own slice of one iteration, already costed and already laid
// onto a release calendar. Everything here is derived from data the app was
// fetching anyway — the ticket list and the iteration list — so this route adds
// no provider round-trip beyond the two the Ticket Execution screen already
// makes.
//
// The whole computation lives in `lib/sprintPlan.ts` and is pure; this route
// only gathers its inputs. That split is deliberate: the same function will be
// called by the scheduler, with no request in sight.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const setting = await getOrCreateSetting();
  const provider = normalizeProvider(params.get("provider") ?? setting.provider);
  const project = params.get("project") ?? "";
  const sprintOverride = params.get("sprint") ?? undefined;
  const today = (params.get("today") || new Date().toISOString()).slice(0, 10);
  // Widened by default. An assigned ticket the current iteration does not
  // contain is the common case, not the exception, and a page that hides it is
  // the bug this parameter exists to switch off — not the behaviour to opt in to.
  const includeWider = params.get("wider") !== "0";

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
        sprint: "",
        window: { startDate: "", finishDate: "" },
        plan: null,
        config: cfg,
      });
    }

    // Sprint tickets and the iteration calendar. Independent reads, so they go
    // together rather than one after the other.
    const [loaded, sprints] = await Promise.all([
      loadMySprintTickets(provider, project, sprintOverride, identity, includeWider),
      loadSprints(provider, project),
    ]);

    const iteration =
      sprints.sprints.find((s) => s.name === (loaded.sprint || sprints.current)) ?? null;
    const window = {
      startDate: (iteration?.startDate ?? "").slice(0, 10),
      finishDate: (iteration?.finishDate ?? "").slice(0, 10),
    };

    const deliverables = deliverablesOnly(loaded.tickets, provider);
    // The iteration on its own, so "N of the team's M" keeps meaning the
    // iteration — widening the search must not inflate the denominator.
    const sprintDeliverables = deliverablesOnly(loaded.sprintTickets, provider);
    const sprint = loaded.sprint || sprints.current;

    // The developer's sprint is what they carried, not what still bears their
    // name: a ticket finished and handed to QA leaves `System.AssignedTo` and
    // would otherwise take its points off this page on the day it succeeded.
    // `claimedSprint()` merges the live list with what the plan remembers, so
    // the numbers only ever grow through a sprint.
    const key = { provider, org, project, sprint, identityEmail: identity.email };
    const claimed = await claimedSprint(key, deliverables, identity);

    // The same triage the stored plan folds in, so the preview and the plan
    // agree about points and order instead of disagreeing by a rebuild.
    const triageRow = await latestTriage(key);
    const triage =
      triageRow?.status === "succeeded" ? (triageRow.result as unknown as TriageResult) : null;

    const inputs: PlanInput[] = planInputs(claimed, triage);
    const plan = buildPlan(inputs, window, today, cfg);
    const mine = claimed.filter((c) => c.claim === "mine").map((c) => c.ticket);

    return NextResponse.json({
      provider,
      identity,
      configured: true,
      connected: loaded.connected,
      notice: loaded.notice ?? "",
      sprint,
      window,
      today,
      // The full sprint alongside the developer's slice, because "5 of the
      // team's 34 tickets" is the number that says whether the filter is right.
      // Counted after `deliverablesOnly` so both halves of that sentence mean
      // the same thing by "ticket".
      teamTicketCount: sprintDeliverables.length,
      includeWider,
      widened: loaded.widened,
      truncated: !!loaded.truncated,
      // How many of the developer's tickets came from outside the iteration —
      // the number that explains a plan larger than the sprint board.
      outsideCount: deliverablesOnly(loaded.outside, provider).length,
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
