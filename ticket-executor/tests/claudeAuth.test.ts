import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, credentialEnv, credentialStatus, LIMIT_FALLBACK_MS, parseCredentialInput, usableInOrder } from "../lib/claudeAuth";
import { CLAUDE_EXPIRY_WARNING_MS, fromClaudeCredentials } from "../lib/notifications";

const now = new Date("2026-11-02T10:00:00Z");
const row = (o: Partial<Parameters<typeof credentialStatus>[0]> & { id: string }) => ({
  enabled: true, priority: 0, createdAt: new Date("2026-01-01"), expiresAt: null, limitedUntil: null, invalidAt: null, ...o,
});

test("a bare setup-token is kept as is, with no known expiry", () => {
  assert.deepEqual(parseCredentialInput("  sk-ant-oat01-abc  "), { token: "sk-ant-oat01-abc", expiresAt: null });
});

test("a pasted .credentials.json keeps only the access token and its expiry", () => {
  const json = JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-x", refreshToken: "sk-ant-ort01-y", expiresAt: 1793000000000 } });
  assert.deepEqual(parseCredentialInput(json), { token: "sk-ant-oat01-x", expiresAt: new Date(1793000000000) });
});

test("unusable input is refused with a reason", () => {
  assert.ok("error" in parseCredentialInput(""));
  assert.ok("error" in parseCredentialInput("{ not json"));
  assert.ok("error" in parseCredentialInput(JSON.stringify({ claudeAiOauth: {} })));
  assert.ok("error" in parseCredentialInput("two words"));
});

test("only ready credentials are tried, by priority then age", () => {
  const rows = [
    row({ id: "b", priority: 1 }),
    row({ id: "a", priority: 0 }),
    row({ id: "off", priority: 0, enabled: false }),
    row({ id: "rejected", priority: 0, invalidAt: now }),
    row({ id: "expired", priority: 0, expiresAt: new Date(now.getTime() - 1) }),
    row({ id: "limited", priority: 0, limitedUntil: new Date(now.getTime() + 60_000) }),
    row({ id: "limit-over", priority: 2, limitedUntil: new Date(now.getTime() - 60_000) }),
  ];
  assert.deepEqual(usableInOrder(rows, now).map((r) => r.id), ["a", "b", "limit-over"]);
});

test("a limit message with a reset time is a limit until then", () => {
  const f = classifyFailure("You've hit your session limit · resets 7:50pm (Asia/Ho_Chi_Minh)", now);
  assert.equal(f.kind, "limit");
  assert.ok(f.kind === "limit" && f.until.getTime() > now.getTime());
});

test("a limit message without a time falls back to an hour", () => {
  const f = classifyFailure("Claude AI usage limit reached", now);
  assert.deepEqual(f, { kind: "limit", until: new Date(now.getTime() + LIMIT_FALLBACK_MS) });
});

test("a rejected token is an auth failure; anything else is the turn's own", () => {
  assert.equal(classifyFailure("OAuth token has expired. Please obtain a new token or refresh your existing token.", now).kind, "auth");
  assert.equal(classifyFailure('API Error: 401 {"type":"error","error":{"type":"authentication_error"}}', now).kind, "auth");
  assert.equal(classifyFailure("npm test failed with 3 errors", now).kind, "other");
  assert.equal(classifyFailure("", now).kind, "other");
});

test("the child env carries the token and blanks an API key that would outrank it", () => {
  assert.deepEqual(credentialEnv("t"), { CLAUDE_CODE_OAUTH_TOKEN: "t", ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" });
});

test("the bell asks for a new token when one is rejected, expired or expiring soon", () => {
  const soon = new Date(now.getTime() + CLAUDE_EXPIRY_WARNING_MS - 1).toISOString();
  const later = new Date(now.getTime() + CLAUDE_EXPIRY_WARNING_MS + 60_000).toISOString();
  const list = fromClaudeCredentials([
    { id: "r", label: "R", expiresAt: null, invalidAt: now.toISOString() },
    { id: "e", label: "E", expiresAt: new Date(now.getTime() - 1).toISOString(), invalidAt: null },
    { id: "s", label: "S", expiresAt: soon, invalidAt: null },
    { id: "ok", label: "OK", expiresAt: later, invalidAt: null },
    { id: "never", label: "N", expiresAt: null, invalidAt: null },
  ], now);
  assert.deepEqual(list.map((n) => [n.refId, n.kind, n.severity]), [
    ["r", "claude.credential-rejected", "action"],
    ["e", "claude.credential-expired", "action"],
    ["s", "claude.credential-expiring", "action"],
  ]);
  assert.ok(list.every((n) => n.href === "/settings?tab=claude" && n.ticketId === ""));
});
