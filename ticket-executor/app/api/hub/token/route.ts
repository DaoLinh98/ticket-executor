import { NextResponse } from "next/server";
import { AUTH_COOKIE, authDisabled, sessionToken } from "@/lib/auth";
import { clearMcpProbe } from "@/lib/mcp";
import { hubUrl, hubSessionState, saveHubToken, verifyHubToken, HUB_AUDIENCE } from "@/lib/hub";
import { getOrCreateSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

// GET /api/hub/token — is there a live hub session, and where would one be
// minted?
//
// The cheap half of `GET /api/hub`: two local reads, no call to the hub. That is
// what makes it usable as a **precondition** rather than a diagnostic. The token
// lasts 15 minutes, so any page opened after a pause finds it expired; before
// this existed the only thing that re-minted one was pressing Connect on the
// Settings page, so "go to Projects, see an error, go to Settings, reconnect,
// come back" was the actual recovery path for a normal 20-minute gap.
//
// Every page that reads provider data now asks this first (`app/hubSession.ts`)
// and mints in the browser when it says no — minting is the one step that cannot
// move to the server, since it authenticates with the hub's HttpOnly refresh
// cookie (emehub ADR 0008).
export async function GET() {
  const [setting, session] = await Promise.all([
    getOrCreateSetting(),
    hubSessionState(),
  ]);
  return NextResponse.json({
    enabled: setting.hubEnabled,
    hubUrl: hubUrl(),
    signedIn: session.signedIn,
    expiresAt: session.expiresAt,
  });
}

// POST /api/hub/token  { hubToken }
//
// Hand over an EmeHub access token the browser just minted. This replaces the
// old `POST /api/hub/sync`, and the difference is the point: nothing is copied
// from the hub any more. The browser gives this app a **session**, and every
// provider read and write that follows is a live call to the hub made from the
// server (`lib/hubGateway.ts`).
//
// **Why the browser mints it.** `POST {hub}/auth/agent-token` authenticates with
// the hub's shared refresh cookie (emehub ADR 0008), which is HttpOnly on the
// hub's parent domain — server-side code here cannot read it, by design. So the
// browser mints and hands over, and stops there.
//
// The token is validated for shape and audience before it is stored. An agent
// that accepts a token minted for a different `aud` is a bug, not a convenience
// (INTEGRATION.md §2) — and storing one would mean every hub call 401s with no
// hint as to why.
export async function POST(req: Request) {
  if (!hubUrl()) {
    return NextResponse.json(
      {
        error: "This app is not pointed at an EmeHub.",
        fix: "Set DAGENT_HUB_URL in .env.local and restart.",
      },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const token = typeof body.hubToken === "string" ? body.hubToken.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "No EmeHub token was supplied." }, { status: 400 });
  }

  const claims = readClaims(token);
  if (!claims) {
    return NextResponse.json({ error: "That does not look like an EmeHub token." }, { status: 400 });
  }
  if (claims.aud !== HUB_AUDIENCE) {
    return NextResponse.json(
      {
        error: `That token was minted for "${claims.aud}", not "${HUB_AUDIENCE}".`,
        fix: `Request the token with { audience: "${HUB_AUDIENCE}" }.`,
      },
      { status: 400 },
    );
  }
  if (claims.iss !== "emehub") {
    return NextResponse.json({ error: "That token was not issued by EmeHub." }, { status: 400 });
  }

  // The claims above are shape, not proof — `readClaims` never verified a
  // signature and still does not. That was harmless while a token was only ever
  // relayed to the hub; it stops being harmless below, where a token becomes a
  // session for this app. So the hub is asked whether the token is real, and
  // nothing past this point runs on an unverified one.
  let genuine: boolean;
  try {
    genuine = await verifyHubToken(token);
  } catch {
    // Unreachable, or the hub erroring on its own account. Deliberately *not*
    // reported as a rejected token: telling someone their session is invalid
    // when the truth is an outage sends them to fix the one thing that is fine.
    return NextResponse.json(
      {
        error: "EmeHub could not be reached to check that session.",
        fix: "Try again once the hub is back up.",
      },
      { status: 503 },
    );
  }
  if (!genuine) {
    return NextResponse.json(
      { error: "EmeHub did not accept that token.", fix: "Sign in at EmeHub, then try again." },
      { status: 401 },
    );
  }

  // The hub's own `expiresIn` is preferred over the `exp` claim: it is relative,
  // so a clock skew between this machine and the hub shortens the window rather
  // than letting us believe a dead token is still live.
  const expiresIn =
    typeof body.expiresIn === "number" && body.expiresIn > 0
      ? body.expiresIn
      : Math.max(0, claims.exp - Math.floor(Date.now() / 1000));

  const { sessionChanged } = await saveHubToken(token, expiresIn, claims.sid);
  // A different hub session can mean a different user, and therefore a different
  // set of connections and credentials. §2 says to drop state cached against the
  // old one; the MCP verdict is the only such cache here.
  if (sessionChanged) clearMcpProbe();

  // The hub session *is* the session (DAGENT-HANDOFF § 4). Whoever proved they
  // hold a live EmeHub identity has proved everything this app's shared password
  // ever asked for, so arriving from the hub's Launch button lands in the app
  // instead of at a password form — and the gate stays on for anyone who did not
  // come through the hub, which is what § 3 asks for and what turning
  // `APP_ACCESS_PASSWORD` off would have thrown away.
  //
  // A session cookie, not the 30-day one the password form issues: the bootstrap
  // is automatic, so re-proving hub identity next time costs the user nothing
  // and keeps this app's session from outliving their hub session by a month.
  const granted = !authDisabled();
  const res = NextResponse.json({ ok: true, expiresIn, sessionChanged, sessionGranted: granted });
  if (granted) {
    res.cookies.set({
      name: AUTH_COOKIE,
      value: await sessionToken(),
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}

type Claims = { aud: string; iss: string; sid: string; exp: number };

/**
 * The token's claims, read without verifying the signature.
 *
 * **This is not authentication and is not treated as any.** Nothing here trusts
 * the token: it is about to be sent to the hub, which verifies it properly, and
 * the only thing this app decides from the claims is whether storing it is
 * pointless — wrong audience, wrong issuer, already expired. Verifying HS256
 * here would need `EMEHUB_JWT_SECRET` distributed to this app for no gain, since
 * a forged token still fails at the hub on the very next call.
 */
function readClaims(token: string): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return {
      aud: String(json.aud ?? ""),
      iss: String(json.iss ?? ""),
      sid: String(json.sid ?? ""),
      exp: Number(json.exp ?? 0),
    };
  } catch {
    return null;
  }
}
