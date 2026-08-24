"use client";

// Keeping this app signed in to EmeHub, from the browser.
//
// **Why any of this is client-side.** `POST {hub}/auth/agent-token`
// authenticates with the hub's shared refresh cookie, which is HttpOnly on the
// hub's parent domain — server code here cannot read it and never will (emehub
// ADR 0008). So the one step that mints a token has to happen in a page, and
// everything after it happens on the server, which is where a credential
// belongs.
//
// **Why it is shared rather than living on the Settings page.** A hub token
// lasts 15 minutes. Any page opened after a coffee break finds it expired, and
// the recovery used to be manual: the read failed, and the user went to
// Settings, pressed Connect, and came back. That is a page knowing something the
// app could have fixed silently. `ensureHubSession()` is that fix — every page
// that is about to read provider data calls it first, and it re-mints only when
// there is nothing live.
//
// It is deliberately **not** a fetch wrapper. A silent retry-on-401 would hide
// the difference between "your session lapsed" and "the hub is down", which
// INTEGRATION.md §5 requires to stay visible; this only ever runs *before* the
// call, and when it cannot mint it says so and lets the real call fail with the
// real reason.

/** What `GET /api/hub/token` reports — two local reads, no hub round-trip. */
type SessionState = {
  enabled: boolean;
  hubUrl: string;
  signedIn: boolean;
  expiresAt: string | null;
};

export type MintFailure = { error: string; reason: string };

/**
 * Mint an EmeHub agent token in the browser.
 *
 * Never call the hub's `/auth/refresh` from here: it *rotates* the shared
 * refresh token, so two apps holding the same cookie would log each other out
 * (emehub ADR 0008). `/auth/agent-token` does not rotate, which is the whole
 * reason it exists.
 */
export async function mintHubToken(
  hubUrl: string,
): Promise<{ token: string; expiresIn: number } | MintFailure> {
  const csrf = document.cookie.split("; ").find((c) => c.startsWith("emehub_csrf="))?.split("=")[1] ?? "";
  let res: Response;
  try {
    res = await fetch(`${hubUrl}/auth/agent-token`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf) },
      body: JSON.stringify({ audience: "dagent" }),
    });
  } catch {
    // Refused / DNS / CORS — the hub is down or does not allow this origin.
    // Explicitly NOT "you are signed out": those must not read the same.
    return { error: "EmeHub is unreachable — we can't sign in right now.", reason: "unreachable" };
  }
  if (res.status === 401)
    return { error: "You are not signed in at EmeHub. Sign in there, then connect again.", reason: "signed-out" };
  if (res.status === 403)
    return { error: "EmeHub rejected the request (stale session). Reload EmeHub and sign in again.", reason: "csrf" };
  if (res.status === 400)
    return { error: "EmeHub has not registered this app. Set EMEHUB_AGENT_DAGENT_URL on the hub.", reason: "unregistered" };
  if (!res.ok) return { error: `EmeHub returned ${res.status}.`, reason: "rejected" };
  const body = await res.json().catch(() => ({}));
  const token = typeof body.accessToken === "string" ? body.accessToken : "";
  // The hub's own relative lifetime is carried through rather than derived from
  // the token's `exp`: a clock skew between this machine and the hub then
  // shortens our window instead of letting us treat a dead token as live.
  const expiresIn = typeof body.expiresIn === "number" ? body.expiresIn : 0;
  return token ? { token, expiresIn } : { error: "EmeHub returned no token.", reason: "rejected" };
}

/** Hand a freshly-minted token to our own API, which stores it encrypted. The
 *  PAT-bearing calls all happen on that side; a token is the only hub material a
 *  page ever touches. */
async function handOver(token: string, expiresIn: number): Promise<MintFailure | null> {
  const r = await fetch("/api/hub/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hubToken: token, expiresIn }),
  });
  if (r.ok) return null;
  const data = await r.json().catch(() => ({}));
  return {
    error: [data.error, data.fix].filter(Boolean).join(" ") || "EmeHub sign-in could not be stored.",
    reason: "rejected",
  };
}

export type EnsureResult =
  /**
   * Nothing for the caller to act on: the deployment is not pointed at a hub,
   * or hub mode is off. With hub mode off a session may still have been minted
   * — see `ensureHubSession` — but that is this module's business, not the
   * page's, so it is reported the same either way.
   */
  | { status: "not-applicable" }
  /** A live session exists (it may have just been minted). */
  | { status: "signed-in"; minted: boolean }
  /** There is no session and one could not be minted. `error` is renderable. */
  | { status: "failed"; error: string; reason: string };

// One in-flight ensure at a time. A page mounting three loaders would otherwise
// mint three tokens, and each `saveHubToken` overwrites the last — harmless but
// wasteful, and the hub sees three sign-ins for one page view.
let inFlight: Promise<EnsureResult> | null = null;

// An opportunistic mint (hub mode off) that failed is not tried again. Nobody
// asked for it, so retrying it on every navigation would be a burst of doomed
// requests at a hub the user may not even be signed in to. Hub mode *on* is
// unaffected: there the mint was asked for, and it retries as it always did.
let opportunisticFailed = false;

/**
 * Make sure this app holds a live EmeHub session, minting one if it does not.
 *
 * Call it before reading provider data.
 *
 * **It also mints with hub mode off**, which reads as odd until you follow a
 * first run: the user presses Launch at the hub, lands here, and Settings says
 * SIGNED OUT — so before they can switch hub mode on they have to find and press
 * Connect, a step that exists only because nothing had minted yet. A hub token
 * is a 15-minute session and nothing more; holding one changes no behaviour on
 * its own, since every credential path still gates on `Setting.hubEnabled`.
 *
 * What it must not do is *report* that mint. Two call sites render `failed` to
 * the user, and a deployment that is pointed at a hub nobody is signed in to is
 * a normal state, not an error — so with hub mode off the answer stays
 * `not-applicable` whatever the mint did.
 */
export function ensureHubSession(): Promise<EnsureResult> {
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<EnsureResult> {
  let state: SessionState;
  try {
    const r = await fetch("/api/hub/token", { cache: "no-store" });
    if (!r.ok) return { status: "not-applicable" };
    state = await r.json();
  } catch {
    // Our own API is unreachable, which is not something signing in fixes.
    return { status: "not-applicable" };
  }

  // Not pointed at a hub — there is no such thing as a session to ensure.
  if (!state.hubUrl) return { status: "not-applicable" };

  // Everything below is silent when hub mode is off: the mint still happens, so
  // Settings opens SIGNED IN and the toggle is the only thing left to do, but
  // nothing about it reaches the user.
  const quiet = !state.enabled;
  const answer = (result: EnsureResult): EnsureResult =>
    quiet ? { status: "not-applicable" } : result;

  if (state.signedIn) return answer({ status: "signed-in", minted: false });
  if (quiet && opportunisticFailed) return { status: "not-applicable" };

  const minted = await mintHubToken(state.hubUrl);
  if ("error" in minted) {
    if (quiet) opportunisticFailed = true;
    return answer({ status: "failed", ...minted });
  }
  const stored = await handOver(minted.token, minted.expiresIn);
  if (stored) {
    if (quiet) opportunisticFailed = true;
    return answer({ status: "failed", ...stored });
  }
  return answer({ status: "signed-in", minted: true });
}
