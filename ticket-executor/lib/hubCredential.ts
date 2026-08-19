// The Claude credential, fetched from EmeHub. Server-only.
//
// **This file is reached only when `Setting.hubEnabled` is on.** With the hub
// off, a run authenticates exactly as it always has — the machine's own
// `claude` login — and nothing here is called. That is not a fallback path; it
// is the original path, unchanged.
//
// ## Why a grant and not the access token
//
// A run is a background process that outlives the 15-minute agent token, and an
// agent may not refresh one (`/auth/refresh` rotates a cookie two apps share —
// emehub ADR 0008). So `startRun()` exchanges the live access token, once, for a
// **run-scoped credential grant** (emehub ADR 0009): a token whose audience
// (`emehub:grant`) is never registerable and which therefore reaches exactly
// three endpoints — resolve, refreshed, usage — and 401s everywhere else. It
// carries the same hub session id, so revoking the session kills it at once.
//
// Two transports live here because they carry different bearers and fail
// differently:
//
//   `mintClaudeGrant`   uses the access token, via `hubFetch` — a 401 means the
//                       hub session is gone, which is `HubSignedOut`.
//   the other three     use the grant, via `grantFetch` — a 401 means *this
//                       run's* authorisation ran out, which is
//                       `HubGrantExpired`. INTEGRATION.md §5 lists that as its
//                       own row precisely because it is neither "the hub is
//                       down" nor "you are signed out": the fix is to mint a new
//                       grant, not to sign in and not to wait.

import { hubFetch, internalHubUrl, HubNotConfigured, HubUnreachable, HubRejected } from "@/lib/hub";

/** This run's authorisation to resolve a credential ran out. Distinct from
 *  `HubSignedOut` (the whole session died) and `HubUnreachable` (the hub is
 *  down) — see the module note. */
export class HubGrantExpired extends Error {
  constructor(message = "This run's credential grant is no longer valid.") {
    super(message);
  }
}

// ---------------------------------------------------------------- minting

export type ClaudeGrant = {
  grant: string;
  /** Computed from the hub's own `expiresIn`, so clock skew shortens our window
   *  rather than letting us believe a dead grant is live. */
  expiresAt: Date;
};

/**
 * Exchange the live agent access token for a run-scoped credential grant.
 *
 * Called **once, at run start**, while the access token is still fresh — that
 * is the whole point of the endpoint. `runId` is opaque to the hub: it lands in
 * the grant's claims and in the hub's audit trail, which is what makes a
 * resolved credential traceable back to the run that asked for it.
 */
export async function mintClaudeGrant(runId: string): Promise<ClaudeGrant> {
  const body = await hubFetch<{ grant?: unknown; expiresIn?: unknown }>({
    method: "POST",
    path: "/auth/agent-grant",
    body: { runId },
  });
  const grant = String(body.grant ?? "");
  if (!grant) throw new HubRejected(502, "The hub returned no credential grant.");
  const expiresIn = Number(body.expiresIn ?? 0);
  return { grant, expiresAt: new Date(Date.now() + Math.max(0, expiresIn) * 1000) };
}

// ---------------------------------------------------------------- transport

type GrantRequest = {
  method?: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
};

/** One call bearing a grant. Deliberately not `hubFetch`: that reads the stored
 *  access token and clears it on a 401, and a spent grant must not log the app
 *  out of the hub. */
async function grantFetch<T>(grant: string, req: GrantRequest): Promise<T> {
  const base = internalHubUrl();
  if (!base) throw new HubNotConfigured();
  if (!grant) throw new HubGrantExpired("This run has no credential grant.");

  let res: Response;
  try {
    res = await fetch(`${base}${req.path}`, {
      method: req.method ?? "GET",
      headers: {
        Authorization: `Bearer ${grant}`,
        ...(req.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      cache: "no-store",
    });
  } catch (e) {
    throw new HubUnreachable(e instanceof Error ? e.message : String(e));
  }

  if (res.status === 401) throw new HubGrantExpired();
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    const message =
      (detail && typeof detail === "object" && "detail" in detail
        ? String((detail as { detail: unknown }).detail)
        : "") || res.statusText;
    throw new HubRejected(res.status, message.slice(0, 400));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- resolve

export type ResolvedClaudeCredential = {
  /** The raw `.credentials.json` text, to be written to a `CLAUDE_CONFIG_DIR`
   *  and nowhere else (INTEGRATION.md §4). Never logged, never persisted. */
  credentials: string;
  /** Which account the hub picked. The hub owns the own → shared → none
   *  precedence *and* the user's `prefer_shared` choice; this app only records
   *  what it was told, because deciding here would be a second answer to a
   *  question the hub already answers. */
  source: "own" | "shared";
  label: string;
  /** `active` | `expiring` | `refreshable` | `expired`. `refreshable` is normal
   *  and healthy: a Claude access token lives hours and the CLI renews it. */
  status: string;
};

const RESOLVE_PATH = "/credentials/claude/resolve";

function shapeResolved(body: Record<string, unknown>): ResolvedClaudeCredential {
  const credentials = String(body.credentials ?? "");
  if (!credentials) throw new HubRejected(502, "The hub returned an empty Claude credential.");
  return {
    credentials,
    source: body.source === "shared" ? "shared" : "own",
    label: String(body.label ?? ""),
    status: String(body.status ?? "active"),
  };
}

/** The credential this run should execute with. 404 from the hub means nobody
 *  has configured one — for a shared-account workspace that is an admin's job,
 *  which is why the message is left to the caller that knows the source. */
export async function resolveClaudeCredential(grant: string): Promise<ResolvedClaudeCredential> {
  return shapeResolved(await grantFetch<Record<string, unknown>>(grant, { path: RESOLVE_PATH }));
}

/**
 * The same credential, resolved with the plain agent access token.
 *
 * `/resolve` accepts either bearer (the router's posture is `GRANTED`, which is
 * "an agent token *or* a grant"), and admission needs an answer **before** a Run
 * row exists — a grant is minted for a run id, and there is no run id yet. That
 * ordering is the point: a workspace with no Claude credential must be refused
 * the way every other admission rule refuses, as a `BlockedAttempt` with no Run
 * row, or a missing credential would be recorded as an agent failure and would
 * drag down the success rate on the dashboard.
 */
export async function resolveClaudeCredentialWithToken(): Promise<ResolvedClaudeCredential> {
  return shapeResolved(await hubFetch<Record<string, unknown>>({ path: RESOLVE_PATH }));
}

// ---------------------------------------------------------------- write-back

/**
 * Whether `raw` still holds a usable access token.
 *
 * Measured, not assumed: when the CLI fails to refresh, it rewrites
 * `.credentials.json` **in place** with every token blanked
 * (`accessToken: ""`, `refreshToken: ""`, `expiresAt: 0`). Posting that back
 * would be handing the hub a wiped credential — and for a shared account, one
 * belonging to everybody. The hub refuses it too, but the guard belongs here as
 * well: the side that read the wiped file is the side that knows it is wiped.
 */
export function hasUsableAccessToken(raw: string): boolean {
  try {
    const root = JSON.parse(raw) as Record<string, unknown>;
    if (!root || typeof root !== "object") return false;
    const src = (root.claudeAiOauth ?? root.claude_ai_oauth ?? root) as Record<string, unknown>;
    const token = src?.accessToken ?? src?.access_token;
    return typeof token === "string" && token.length > 0;
  } catch {
    return false;
  }
}

/**
 * What the credential material itself says about whether a run can authenticate.
 *
 * Separate from the hub's `status` field on purpose: that field describes the
 * row in the hub's database, and a row can read `refreshable` while the tokens
 * it hands out are dead — which is exactly how a run reached the CLI and died
 * with `OAuth session expired and could not be refreshed` after System Check had
 * reported the account fine. The only honest reading is of the tokens that will
 * actually be written to disk.
 *
 * What this cannot prove is that a refresh will *succeed*: only Anthropic can
 * say whether a refresh token was revoked, and asking costs a real token
 * exchange that would rotate the shared account's credential from a diagnostics
 * page. So `refresh-needed` is reported as what it is — unproven — rather than
 * as a pass.
 */
export type ClaudeCredentialHealth = {
  state: "usable" | "refresh-needed" | "no-refresh" | "blanked" | "unreadable";
  /** Access-token expiry, when the file carried a readable one. */
  expiresAt: Date | null;
};

export function claudeCredentialHealth(raw: string): ClaudeCredentialHealth {
  let src: Record<string, unknown>;
  try {
    const root = JSON.parse(raw) as Record<string, unknown>;
    if (!root || typeof root !== "object") return { state: "unreadable", expiresAt: null };
    src = (root.claudeAiOauth ?? root.claude_ai_oauth ?? root) as Record<string, unknown>;
  } catch {
    return { state: "unreadable", expiresAt: null };
  }

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const access = str(src?.accessToken) || str(src?.access_token);
  const refresh = str(src?.refreshToken) || str(src?.refresh_token);
  const rawExpiry = src?.expiresAt ?? src?.expires_at;
  const expiryMs = typeof rawExpiry === "number" ? rawExpiry : Number(rawExpiry) || 0;
  const expiresAt = expiryMs > 0 ? new Date(expiryMs) : null;

  // The CLI blanks every token in place when a refresh fails, so "no access
  // token" is not a malformed file — it is the recorded corpse of a dead session.
  if (!access) return { state: "blanked", expiresAt };
  if (expiresAt && expiresAt.getTime() > Date.now()) return { state: "usable", expiresAt };
  return { state: refresh ? "refresh-needed" : "no-refresh", expiresAt };
}

/**
 * Hand back a token the CLI rotated on this machine, so the hub stays
 * authoritative (INTEGRATION.md §4).
 *
 * Not optional bookkeeping: the CLI renews the access token in place, and the
 * config dir here is not the hub's copy. Without this the stored refresh token
 * goes stale and the credential eventually dies — for a shared account, for
 * everyone at once. Returns whether the hub actually took it; the hub ignores
 * anything not strictly newer, so calling this after every turn is cheap and
 * safe.
 */
export async function postRefreshedCredential(grant: string, raw: string): Promise<boolean> {
  if (!hasUsableAccessToken(raw)) return false;
  const body = await grantFetch<{ updated?: unknown }>(grant, {
    method: "PUT",
    path: "/credentials/claude/refreshed",
    body: { credentials: raw },
  });
  return !!body?.updated;
}

// ---------------------------------------------------------------- usage

export type ClaudeUsageReport = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  durationMs: number;
  /** What the spend was for — this app sends the node id. */
  action: string;
  /** The run it belongs to, so the hub's ledger points back at something. */
  externalRef: string;
};

/**
 * Append one turn's spend to the hub's ledger.
 *
 * Attribution is the hub's, not ours: it stamps `owner_id` from the grant and
 * `credential_source` from whichever row it resolved, so a run under the shared
 * account still records *who* spent it. All this side supplies is the figures.
 */
export async function postClaudeUsage(grant: string, usage: ClaudeUsageReport): Promise<void> {
  await grantFetch<unknown>(grant, {
    method: "POST",
    path: "/credentials/claude/usage",
    body: usage,
  });
}
