import { prisma } from "@/lib/prisma";
import { clearMcpProbe } from "@/lib/mcp";
import { normalizeProvider } from "@/lib/tickets";
import { activeConnection, type ConnectionView } from "@/lib/providerCredentials";
import { getOrCreateSetting, invalidateSetting } from "@/lib/settings";
import { jsonNoStore } from "@/lib/http";

export const dynamic = "force-dynamic";

const clean = (s: string) => s.replace(/[\r\n]+/g, "").trim();


type SettingRow = Awaited<ReturnType<typeof getOrCreateSetting>>;

/**
 * What a page is allowed to know about the settings row.
 *
 * An explicit list, not `...s` minus a few fields. A whitelist rather than a
 * blacklist because the failure modes are not symmetric: a field added to the
 * schema and forgotten here renders as a missing value in the UI, whereas one
 * forgotten from a blacklist leaks.
 */
function publicSettings(s: SettingRow, cred: ConnectionView | null) {
  return {
    provider: s.provider,
    scope: s.scope,
    personalAccount: s.personalAccount,
    animatedBackground: s.animatedBackground,
    clickEffects: s.clickEffects,
    ringAnimation: s.ringAnimation,
    autoImplement: s.autoImplement,
    autoResolveCodeReview: s.autoResolveCodeReview,
    multiTicketMode: s.multiTicketMode,
    manageMcp: s.manageMcp,
    concurrentRuns: s.concurrentRuns,
    hourlyRateUsd: s.hourlyRateUsd,
    hoursPerStoryPoint: s.hoursPerStoryPoint,
    evaluateBeforePublish: s.evaluateBeforePublish,
    gitUserName: s.gitUserName,
    gitUserEmail: s.gitUserEmail,
    // The organization this provider currently runs as, and whether it has a
    // token. Read-only here — connections are written through /api/connections.
    // Never the token itself, in either direction.
    org: cred?.org ?? "",
    pat: "",
    hasPat: !!cred?.hasPat,
  };
}

// GET /api/settings — full settings, plus the active organization of the
// currently-selected provider.
// GET /api/settings?provider=github — same non-credential fields, but the active
// organization of the requested provider instead — used when the UI switches the
// provider dropdown without having saved yet.
export async function GET(req: Request) {
  const s = await getOrCreateSetting();
  const { searchParams } = new URL(req.url);
  const provider = normalizeProvider(searchParams.get("provider") ?? s.provider);
  return jsonNoStore({ settings: publicSettings(s, await activeConnection(provider)) });
}

export async function POST(req: Request) {
  const body = await req.json();
  const data: Record<string, string | boolean | number> = {};
  for (const k of ["provider", "scope", "personalAccount", "gitUserName", "gitUserEmail"] as const) {
    if (typeof body[k] === "string") data[k] = clean(body[k]);
  }
  if (typeof body.animatedBackground === "boolean")
    data.animatedBackground = body.animatedBackground;
  if (typeof body.clickEffects === "boolean")
    data.clickEffects = body.clickEffects;
  if (typeof body.ringAnimation === "boolean")
    data.ringAnimation = body.ringAnimation;
  if (typeof body.autoImplement === "boolean")
    data.autoImplement = body.autoImplement;
  if (typeof body.autoResolveCodeReview === "boolean")
    data.autoResolveCodeReview = body.autoResolveCodeReview;
  if (typeof body.multiTicketMode === "boolean")
    data.multiTicketMode = body.multiTicketMode;
  if (typeof body.manageMcp === "boolean") data.manageMcp = body.manageMcp;
  if (typeof body.evaluateBeforePublish === "boolean")
    data.evaluateBeforePublish = body.evaluateBeforePublish;
  if (
    typeof body.concurrentRuns === "number" &&
    Number.isFinite(body.concurrentRuns)
  ) {
    data.concurrentRuns = Math.max(
      1,
      Math.min(20, Math.round(body.concurrentRuns)),
    );
  }
  // Dashboard ROI inputs. 0 is a valid rate (it hides the ROI tile), so these
  // are clamped rather than treated as unset.
  if (typeof body.hourlyRateUsd === "number" && Number.isFinite(body.hourlyRateUsd))
    data.hourlyRateUsd = Math.max(0, body.hourlyRateUsd);
  if (typeof body.hoursPerStoryPoint === "number" && Number.isFinite(body.hoursPerStoryPoint))
    data.hoursPerStoryPoint = Math.max(0, body.hoursPerStoryPoint);

  const s = await prisma.setting.upsert({
    where: { id: "default" },
    create: { id: "default", ...data },
    update: data,
  });
  // The only writer of this row, so this is the only place the cached copy can
  // go stale — every reader in the app (routes, runner, scheduler) resolves it
  // through `getOrCreateSetting()`.
  await invalidateSetting();

  // Credentials are not written here: an organization is a row of its own now,
  // created and switched through /api/connections. This route only ever reports
  // which one the saved provider currently runs as.
  const provider = normalizeProvider(typeof body.provider === "string" ? body.provider : s.provider);

  // Switching provider changes which MCP server a run would use, which
  // invalidates the cached deep-check verdict — a stale "MCP is fine" would gate
  // the next run on a setup that no longer exists.
  if (typeof body.provider === "string" || typeof body.manageMcp === "boolean") clearMcpProbe();

  return jsonNoStore({ settings: publicSettings(s, await activeConnection(provider)) });
}
