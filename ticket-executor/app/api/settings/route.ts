import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { clearMcpProbe } from "@/lib/mcp";
import { normalizeProvider } from "@/lib/tickets";
import { getOrCreateSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

const clean = (s: string) => s.replace(/[\r\n]+/g, "").trim();


type SettingRow = Awaited<ReturnType<typeof getOrCreateSetting>>;
type Credential = { org: string; pat: string } | null;

/**
 * What a page is allowed to know about the settings row.
 *
 * An explicit list, not `...s` minus a few fields. The row carries the EmeHub
 * session — `hubToken` (encrypted), `hubSid`, `hubTokenExpiresAt` — and spreading
 * it shipped all three to every page that reads settings, which is four of them
 * plus the reactor backdrop. None of that is a page's business: the token is a
 * credential this app holds on the operator's behalf, the sid identifies the hub
 * login, and both are already reported in the only form the UI needs by
 * `GET /api/hub` (`signedIn` + `expiresAt`).
 *
 * A whitelist rather than a blacklist because the failure modes are not
 * symmetric: a field added to the schema and forgotten here renders as a missing
 * value in the UI, whereas one forgotten from a blacklist leaks.
 */
function publicSettings(s: SettingRow, cred: Credential) {
  return {
    provider: s.provider,
    scope: s.scope,
    personalAccount: s.personalAccount,
    animatedBackground: s.animatedBackground,
    emehubTheme: s.emehubTheme,
    clickEffects: s.clickEffects,
    autoImplement: s.autoImplement,
    autoResolveCodeReview: s.autoResolveCodeReview,
    multiTicketMode: s.multiTicketMode,
    manageMcp: s.manageMcp,
    concurrentRuns: s.concurrentRuns,
    hourlyRateUsd: s.hourlyRateUsd,
    hoursPerStoryPoint: s.hoursPerStoryPoint,
    evaluateBeforePublish: s.evaluateBeforePublish,
    hubEnabled: s.hubEnabled,
    hubConnectionId: s.hubConnectionId,
    // The credential for the provider being asked about: its org, and whether a
    // token exists. Never the token itself, in either direction.
    org: cred?.org ?? "",
    pat: "",
    hasPat: !!cred && cred.pat.length > 0,
  };
}

// GET /api/settings — full settings, credentials for the currently-selected provider.
// GET /api/settings?provider=github — same non-credential fields, but credentials
// (org/hasPat) for the requested provider instead — used when the UI switches the
// provider dropdown without having saved yet.
export async function GET(req: Request) {
  const s = await getOrCreateSetting();
  const { searchParams } = new URL(req.url);
  const provider = normalizeProvider(searchParams.get("provider") ?? s.provider);
  const cred = await prisma.providerCredential.findUnique({ where: { provider } });
  return NextResponse.json({ settings: publicSettings(s, cred) });
}

export async function POST(req: Request) {
  const body = await req.json();
  const data: Record<string, string | boolean | number> = {};
  for (const k of ["provider", "scope", "personalAccount"] as const) {
    if (typeof body[k] === "string") data[k] = clean(body[k]);
  }
  if (typeof body.animatedBackground === "boolean")
    data.animatedBackground = body.animatedBackground;
  if (typeof body.emehubTheme === "boolean")
    data.emehubTheme = body.emehubTheme;
  if (typeof body.clickEffects === "boolean")
    data.clickEffects = body.clickEffects;
  if (typeof body.autoImplement === "boolean")
    data.autoImplement = body.autoImplement;
  if (typeof body.autoResolveCodeReview === "boolean")
    data.autoResolveCodeReview = body.autoResolveCodeReview;
  if (typeof body.multiTicketMode === "boolean")
    data.multiTicketMode = body.multiTicketMode;
  if (typeof body.manageMcp === "boolean") data.manageMcp = body.manageMcp;
  // A save is the one place hub mode is *decided*. Recording that is what stops
  // the deployment default in lib/settings.ts from switching it back on.
  if (typeof body.hubEnabled === "boolean") {
    data.hubEnabled = body.hubEnabled;
    data.hubModeChosen = true;
  }
  if (typeof body.hubConnectionId === "string")
    data.hubConnectionId = clean(body.hubConnectionId);
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

  // Credentials are stored per-provider, keyed by the provider being saved for.
  const provider = normalizeProvider(typeof body.provider === "string" ? body.provider : s.provider);
  const credData: { org?: string; pat?: string } = {};
  if (typeof body.org === "string") credData.org = clean(body.org);
  // Only overwrite PAT when a non-empty value is supplied; encrypt at rest.
  if (typeof body.pat === "string" && body.pat.length > 0)
    credData.pat = encryptSecret(body.pat);
  const cred = await prisma.providerCredential.upsert({
    where: { provider },
    create: { provider, org: "", pat: "", ...credData },
    update: credData,
  });

  // Anything that changes which MCP server a run would use invalidates the
  // cached deep-check verdict — a stale "MCP is fine" would gate the next run on
  // a setup that no longer exists.
  if (
    typeof body.provider === "string" ||
    typeof body.manageMcp === "boolean" ||
    typeof body.org === "string" ||
    (typeof body.pat === "string" && body.pat.length > 0) ||
    // Switching hub mode, or picking a different mirrored connection, changes
    // which credential a run authenticates as — the same class of change as
    // editing the org, so the cached verdict is just as stale.
    typeof body.hubEnabled === "boolean" ||
    typeof body.hubConnectionId === "string"
  ) {
    clearMcpProbe();
  }

  return NextResponse.json({ settings: publicSettings(s, cred) });
}
