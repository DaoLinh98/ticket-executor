// Which Claude account a CLI turn runs as — the pure half.
//
// The app can hold Claude credentials of its own (Settings → Claude) on top of
// the machine's `~/.claude` login. They are tried in priority order and the
// machine login is always the last resort. No Prisma here: what is worth
// asserting is the rules — what a pasted credential is, which ones are usable
// now, and whether a failed turn means "out of quota" or "token rejected".

import { parseLimitReset } from "./execution/claudeCli";

export type ParsedCredential = { token: string; expiresAt: Date | null };

/**
 * A token as the developer pastes it: either the bare OAuth token printed by
 * `claude setup-token`, or the whole `.credentials.json` of a logged-in machine,
 * whose `claudeAiOauth.accessToken` (and `expiresAt`, in ms) is what we keep.
 * The refresh token is deliberately not kept: using it here would rotate it and
 * log the original machine out.
 */
export function parseCredentialInput(raw: string): ParsedCredential | { error: string } {
  const text = raw.trim();
  if (!text) return { error: "Paste a token or the contents of .credentials.json." };
  if (text.startsWith("{")) {
    let json: { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown } };
    try {
      json = JSON.parse(text);
    } catch {
      return { error: "That is not valid JSON." };
    }
    const oauth = json.claudeAiOauth;
    const token = typeof oauth?.accessToken === "string" ? oauth.accessToken.trim() : "";
    if (!token) return { error: "No claudeAiOauth.accessToken in that JSON." };
    const ms = typeof oauth?.expiresAt === "number" ? oauth.expiresAt : Number(oauth?.expiresAt);
    return { token, expiresAt: Number.isFinite(ms) && ms > 0 ? new Date(ms) : null };
  }
  if (/\s/.test(text)) return { error: "A token is a single line with no spaces." };
  return { token: text, expiresAt: null };
}

export type CredentialState = {
  enabled: boolean;
  priority: number;
  createdAt: Date;
  expiresAt: Date | null;
  limitedUntil: Date | null;
  invalidAt: Date | null;
};

export type CredentialStatus = "ready" | "disabled" | "invalid" | "expired" | "limited";

export function credentialStatus(c: CredentialState, now = new Date()): CredentialStatus {
  if (!c.enabled) return "disabled";
  if (c.invalidAt) return "invalid";
  if (c.expiresAt && c.expiresAt.getTime() <= now.getTime()) return "expired";
  if (c.limitedUntil && c.limitedUntil.getTime() > now.getTime()) return "limited";
  return "ready";
}

/** The credentials a turn may use right now, in the order to try them. */
export function usableInOrder<T extends CredentialState>(rows: T[], now = new Date()): T[] {
  return rows
    .filter((c) => credentialStatus(c, now) === "ready")
    .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());
}

const LIMIT_TEXT = /\b(usage|session|weekly|rate)[ _-]?limit|out of (extra )?usage|quota/i;
const AUTH_TEXT =
  /oauth token (has )?expired|token (has )?(expired|been revoked)|invalid (x-)?api[ -]?key|invalid bearer token|authentication_error|please run \/login|not logged in|\b401\b/i;

/** Fallback when the CLI says "limit" but names no reset time. */
export const LIMIT_FALLBACK_MS = 60 * 60_000;

export type TurnFailure = { kind: "limit"; until: Date } | { kind: "auth" } | { kind: "other" };

/** Why a failed turn failed, as far as account switching cares. */
export function classifyFailure(message: string, now = new Date()): TurnFailure {
  if (!message) return { kind: "other" };
  const reset = parseLimitReset(message, now);
  if (reset) return { kind: "limit", until: reset };
  if (LIMIT_TEXT.test(message)) return { kind: "limit", until: new Date(now.getTime() + LIMIT_FALLBACK_MS) };
  if (AUTH_TEXT.test(message)) return { kind: "auth" };
  return { kind: "other" };
}

/** The env a spawned CLI needs to run as `token`. An API key in the server's
 *  own env would outrank the OAuth token, so it is blanked for that child. */
export function credentialEnv(token: string): Record<string, string> {
  return { CLAUDE_CODE_OAUTH_TOKEN: token, ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" };
}
