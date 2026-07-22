// Minimal shared-password auth gate (POC — no user accounts).
//
// A single shared password lives in `APP_ACCESS_PASSWORD`. On login we set an
// httpOnly cookie whose value is HMAC-SHA256(password, "authenticated") in hex;
// the Proxy (middleware) recomputes the same HMAC and constant-time-compares it
// to the cookie to authenticate a request — no server-side session store needed.
//
// This file is imported by both the Proxy and Route Handlers, so it must be
// runtime-agnostic: it uses only Web Crypto (`crypto.subtle`), which is a global
// in both the Node.js and Edge runtimes. Never log or return the password itself.

export const AUTH_COOKIE = "te_session";
export const REMEMBER_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const PAYLOAD = "authenticated";

function password(): string {
  return process.env.APP_ACCESS_PASSWORD ?? "";
}

// When no password is configured, auth is disabled so local dev works without
// the env var. Documented behaviour — see issue #31 / .env.example.
export function authDisabled(): boolean {
  return password().trim().length === 0;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// The cookie value: HMAC-SHA256(APP_ACCESS_PASSWORD, "authenticated") as hex.
export async function sessionToken(): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(PAYLOAD));
  return toHex(sig);
}

// Length-safe, constant-time-ish comparison of two hex strings.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// True when the cookie value is a valid session token for the current password.
export async function isValidToken(value: string | undefined | null): Promise<boolean> {
  if (!value) return false;
  return timingSafeEqual(value, await sessionToken());
}

// Verify a submitted login password against the configured one.
export function passwordMatches(submitted: string): boolean {
  const expected = password();
  if (!expected) return false;
  return timingSafeEqual(submitted, expected);
}
