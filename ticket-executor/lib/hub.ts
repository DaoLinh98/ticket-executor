// EmeHub transport — the session, and the one function every hub call goes
// through. Server-only.
//
// **What this file is not any more.** It used to mirror the hub's connections
// and their PATs into a local table on a Sync button. That is gone. In hub mode
// the hub is the gateway, not a place to copy configuration from, so the only
// thing this app stores is one short-lived access token; everything else is read
// live. `lib/hubGateway.ts` sits on top of this and speaks the provider domain.
//
// **Why the browser mints the token.** `POST {hub}/auth/agent-token`
// authenticates with the hub's shared refresh cookie (emehub ADR 0008), which is
// HttpOnly on the hub's parent domain — server code here cannot see it and never
// will. So the browser mints, hands the token to `POST /api/hub/token`, and
// stops; every call that follows is made from this side. This app must never
// call `/auth/refresh`: it *rotates* the shared refresh token, and two apps
// sharing one rotating credential log each other out.
//
// **The 15-minute expiry is real and is not worked around.** A token past its
// expiry refuses with `HubSignedOut` rather than being sent and 401ing, because
// INTEGRATION.md §5 requires "you are signed out" to reach the user as something
// different from "the hub is down". The browser re-mints on the next page
// interaction; a background run that finds no live token stops instead of
// falling back to a local copy, which is exactly the drift hub mode removes.

import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import type { ProviderId } from "@/lib/providers";

/**
 * Where the hub lives **as a browser reaches it**. Deployment configuration, so
 * env rather than a setting.
 *
 * This value is handed to the page, which mints the hub token against it with
 * the hub's cookie attached, so it has to be an origin the user's browser can
 * resolve and that the hub's cookie is scoped to. Include the hub's `/api`
 * prefix.
 */
export function hubUrl(): string {
  return (process.env.DAGENT_HUB_URL ?? "").trim().replace(/\/+$/, "");
}

/**
 * Where the hub lives **as this process reaches it**. Every server-side call
 * goes here; nothing about it is ever sent to a page.
 *
 * These two used to be one variable, which is fine in a public deployment where
 * the hub answers on the same URL from both sides, and wrong in a container:
 * `http://localhost:5180/api` is the host's loopback to a browser and *this
 * container's own* loopback to us. So the two are split, and the internal one
 * falls back to the public one — a deployment that never needed the distinction
 * keeps working unchanged.
 */
export function internalHubUrl(): string {
  const internal = (process.env.DAGENT_HUB_URL_INTERNAL ?? "").trim().replace(/\/+$/, "");
  return internal || hubUrl();
}

/** Our audience at the hub. A token minted for anything else must be refused. */
export const HUB_AUDIENCE = "dagent";

/** The hub's `kind` vocabulary → this app's `ProviderId`. */
const KIND_TO_PROVIDER: Record<string, ProviderId> = {
  azure_devops: "azure-devops",
  github: "github",
  jira: "jira",
};

/** This app's `ProviderId` → the hub's `kind`. The inverse of the above, kept
 *  beside it so the two cannot drift into disagreeing. */
export const PROVIDER_TO_KIND: Record<string, string> = {
  "azure-devops": "azure_devops",
  github: "github",
  jira: "jira",
};

// ---------------------------------------------------------------- failures
//
// Four things can go wrong and they must not render the same screen
// (INTEGRATION.md §5): the deployment was never pointed at a hub, the hub is
// down, nobody is signed in, or the hub refused this particular request. Only
// the second is retryable by waiting, and only the third is fixed by signing in.

export class HubNotConfigured extends Error {
  constructor() {
    super("This app is not pointed at an EmeHub.");
  }
}
export class HubUnreachable extends Error {}
export class HubSignedOut extends Error {
  constructor(message = "The EmeHub session has expired.") {
    super(message);
  }
}
export class HubRejected extends Error {
  // Declared as a field rather than a constructor parameter property: the test
  // runner strips types without transforming them, and a parameter property is
  // the one TypeScript-only construct that needs a transform to survive.
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Every hub failure, as one type — what a route matches on to pick a status. */
export type HubError = HubNotConfigured | HubUnreachable | HubSignedOut | HubRejected;

export function isHubError(e: unknown): e is HubError {
  return (
    e instanceof HubNotConfigured ||
    e instanceof HubUnreachable ||
    e instanceof HubSignedOut ||
    e instanceof HubRejected
  );
}

// ---------------------------------------------------------------- the session
//
// One token, encrypted, on the single `Setting` row. Not a table: this app has
// one operator, and a second row would be a second answer to "who are we at the
// hub".

/** Treat a token this close to expiry as already gone. A call that takes two
 *  seconds must not be started with one second of validity left. */
const EXPIRY_SKEW_MS = 30_000;

export type HubSessionState = {
  signedIn: boolean;
  /** When the stored token stops being accepted. Null when there is none. */
  expiresAt: Date | null;
  /** The hub session id the token carries, for the §2 cache-key rule. */
  sid: string;
};

/**
 * Record a token the browser just minted.
 *
 * `expiresIn` is the hub's own seconds-from-now rather than a timestamp we
 * compute, so a clock skew between this machine and the hub shortens the window
 * instead of letting us believe a dead token is live.
 *
 * A token whose `sid` differs from the stored one is a different hub session.
 * §2 says to drop per-session state when that happens, so the caller is told.
 */
export async function saveHubToken(
  token: string,
  expiresIn: number,
  sid: string,
): Promise<{ sessionChanged: boolean }> {
  const previous = await prisma.setting.findUnique({ where: { id: "default" } });
  const sessionChanged = !!previous?.hubSid && !!sid && previous.hubSid !== sid;
  await prisma.setting.update({
    where: { id: "default" },
    data: {
      hubToken: encryptSecret(token),
      hubTokenExpiresAt: new Date(Date.now() + Math.max(0, expiresIn) * 1000),
      hubSid: sid,
    },
  });
  return { sessionChanged };
}

/** Forget the session. Called when the hub says we are signed out, and when hub
 *  mode is switched off — a token left behind is a credential nothing will ever
 *  use again. */
export async function clearHubToken(): Promise<void> {
  await prisma.setting.update({
    where: { id: "default" },
    data: { hubToken: "", hubTokenExpiresAt: null, hubSid: "" },
  });
}

/** What the Settings page renders. Never the token itself. */
export async function hubSessionState(): Promise<HubSessionState> {
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  const expiresAt = setting?.hubTokenExpiresAt ?? null;
  const live = !!setting?.hubToken && !!expiresAt && expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now();
  return { signedIn: live, expiresAt, sid: setting?.hubSid ?? "" };
}

/** The live token, or `HubSignedOut`. The only reader of `Setting.hubToken`. */
async function currentToken(): Promise<string> {
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  const expiresAt = setting?.hubTokenExpiresAt;
  if (!setting?.hubToken || !expiresAt) {
    throw new HubSignedOut("Not signed in to EmeHub yet.");
  }
  if (expiresAt.getTime() - EXPIRY_SKEW_MS <= Date.now()) {
    throw new HubSignedOut();
  }
  const token = decryptSecret(setting.hubToken);
  // An undecryptable token is not a live one. This happens when SETTINGS_ENC_KEY
  // changed under a stored value; saying "signed out" is both true and the thing
  // that gets fixed by signing in again.
  if (!token) throw new HubSignedOut("The stored EmeHub session could not be read.");
  return token;
}

// ---------------------------------------------------------------- transport

type HubRequest = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

/**
 * One call to the hub. Everything in `lib/hubGateway.ts` goes through here.
 *
 * A 401 is turned into `HubSignedOut` **and clears the stored token**: the hub
 * has told us it is dead, and keeping it only guarantees the next call fails the
 * same way while the UI still claims to be signed in.
 */
export async function hubFetch<T>(req: HubRequest): Promise<T> {
  const base = internalHubUrl();
  if (!base) throw new HubNotConfigured();
  const token = await currentToken();

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const url = `${base}${req.path}${qs.size ? `?${qs}` : ""}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: req.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(req.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      cache: "no-store",
    });
  } catch (e) {
    // Refused / DNS / timeout — the hub is down. Never a logout.
    throw new HubUnreachable(e instanceof Error ? e.message : String(e));
  }

  if (res.status === 401) {
    await clearHubToken().catch(() => {});
    throw new HubSignedOut();
  }
  if (!res.ok) {
    // The hub propagates a provider's own rejection verbatim in `detail`
    // (INTEGRATION.md §3) and that reason is the only actionable part, so it is
    // carried through rather than replaced with a generic message.
    const detail = await res.json().catch(() => null);
    const message =
      (detail && typeof detail === "object" && "detail" in detail
        ? String((detail as { detail: unknown }).detail)
        : "") || (await res.text().catch(() => "")) || res.statusText;
    throw new HubRejected(res.status, message.slice(0, 400));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- connections

export type HubConnectionView = {
  hubId: number;
  provider: ProviderId;
  label: string;
  orgUrl: string;
  project: string;
  capabilities: string[];
  hasPat: boolean;
};

/**
 * The connection catalogue, read live from `GET /dagent/connections`.
 *
 * What the Settings picker offers, and what the gateway resolves
 * `Setting.hubConnectionId` against. There is no `updatedAt` here any more and
 * nothing needs one: it existed to decide when a mirrored credential had to be
 * re-read, and there is no mirror to invalidate.
 */
export async function listHubConnections(): Promise<HubConnectionView[]> {
  const rows = await hubFetch<Array<Record<string, unknown>>>({ path: "/dagent/connections" });
  const out: HubConnectionView[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const provider = KIND_TO_PROVIDER[String(r.kind ?? "")];
    // A kind this app has no provider for is skipped rather than guessed at —
    // mapping it onto the wrong ProviderId would point runs at the wrong client.
    if (!provider) continue;
    out.push({
      hubId: Number(r.id),
      provider,
      label: String(r.label ?? ""),
      orgUrl: String(r.baseUrl ?? ""),
      project: String(r.project ?? ""),
      capabilities: Array.isArray(r.capabilities) ? r.capabilities.map(String) : [],
      hasPat: !!r.hasPat,
    });
  }
  return out;
}

/**
 * One connection's PAT (emehub ADR 0010).
 *
 * **Fetched per run and never persisted.** The Claude CLI talks to the provider
 * over MCP, which the hub does not proxy, so a run still needs the credential
 * itself — but wanting it at run start is not a reason to keep a copy between
 * runs. Held for the life of one run's temp MCP config and no longer.
 */
export async function fetchHubSecret(hubId: number): Promise<{ pat: string; orgUrl: string; project: string }> {
  const body = await hubFetch<Record<string, unknown>>({ path: `/connections/${hubId}/secret` });
  return {
    pat: String(body.pat ?? ""),
    orgUrl: String(body.baseUrl ?? ""),
    project: String((body.config as Record<string, unknown>)?.project ?? ""),
  };
}
