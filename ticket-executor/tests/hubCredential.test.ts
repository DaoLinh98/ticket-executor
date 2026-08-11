// The grant-bearing half of the EmeHub Claude-credential transport.
//
// Everything asserted here is reachable **only** with `Setting.hubEnabled` on.
// With the hub off none of this code runs and a run authenticates the way it
// always has, so there is nothing here that can regress the original flow.
//
// Two of these tests exist because of something measured rather than assumed:
// when the Claude CLI fails to refresh, it rewrites `.credentials.json` in place
// with every token blanked. Posting that back would hand the hub a wiped
// credential — for a shared account, everyone's. So the blanked shape is a
// fixture, and "we did not even call the hub" is the assertion.
import test from "node:test";
import assert from "node:assert/strict";

process.env.DAGENT_HUB_URL = "https://hub.invalid";
// Constructed, never connected: importing the transport pulls in the Prisma
// singleton, which validates a URL exists at construction time.
process.env.DATABASE_URL ||= "postgresql://u:p@127.0.0.1:1/none";

const {
  hasUsableAccessToken,
  resolveClaudeCredential,
  postRefreshedCredential,
  postClaudeUsage,
  HubGrantExpired,
} = await import("../lib/hubCredential");
const { HubUnreachable, HubRejected } = await import("../lib/hub");

// ---- fixtures ----

const GOOD = JSON.stringify({
  claudeAiOauth: {
    accessToken: "sk-ant-oat01-x",
    refreshToken: "sk-ant-ort01-x",
    expiresAt: 4102444800000,
    scopes: ["user:inference"],
    subscriptionType: "max",
  },
});

/** Exactly what the CLI left behind after a failed refresh (Phase 0 spike). */
const BLANKED = JSON.stringify({
  claudeAiOauth: { accessToken: "", refreshToken: "", expiresAt: 0, scopes: ["user:inference"] },
});

type Call = { url: string; method: string; auth: string; body: unknown };

/** Swap in a fetch that records what it was asked to do. Returns the log. */
function mockFetch(reply: { status?: number; json?: unknown; throws?: boolean }): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: Record<string, unknown>) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(url),
      method: String(init?.method ?? "GET"),
      auth: headers.Authorization ?? "",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (reply.throws) throw new Error("ECONNREFUSED");
    const status = reply.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      statusText: "",
      json: async () => reply.json ?? {},
    };
  }) as unknown as typeof fetch;
  return calls;
}

// ---- the blanked-credential guard ----

test("hasUsableAccessToken accepts the shapes the hub accepts", () => {
  assert.equal(hasUsableAccessToken(GOOD), true);
  assert.equal(hasUsableAccessToken(JSON.stringify({ accessToken: "x" })), true, "bare root");
  assert.equal(
    hasUsableAccessToken(JSON.stringify({ claude_ai_oauth: { access_token: "x" } })),
    true,
    "snake_case",
  );
});

test("hasUsableAccessToken rejects a credential the CLI blanked", () => {
  assert.equal(hasUsableAccessToken(BLANKED), false);
  assert.equal(hasUsableAccessToken("not json"), false);
  assert.equal(hasUsableAccessToken(""), false);
});

test("postRefreshedCredential never sends a blanked credential to the hub", async () => {
  const calls = mockFetch({ json: { ok: true, updated: true } });
  const updated = await postRefreshedCredential("grant-x", BLANKED);
  assert.equal(updated, false);
  assert.equal(calls.length, 0, "a wiped credential must not reach the hub at all");
});

test("postRefreshedCredential posts a real rotated credential", async () => {
  const calls = mockFetch({ json: { ok: true, updated: true } });
  const updated = await postRefreshedCredential("grant-x", GOOD);
  assert.equal(updated, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PUT");
  assert.match(calls[0].url, /\/credentials\/claude\/refreshed$/);
  assert.equal(calls[0].auth, "Bearer grant-x");
});

// ---- resolve ----

test("resolveClaudeCredential reports the hub's own choice of account", async () => {
  mockFetch({ json: { source: "shared", credentials: GOOD, label: "Team", status: "refreshable" } });
  const resolved = await resolveClaudeCredential("grant-x");
  assert.equal(resolved.source, "shared");
  assert.equal(resolved.status, "refreshable");
  assert.equal(resolved.credentials, GOOD);
});

test("resolveClaudeCredential treats an empty credential as a hub failure", async () => {
  mockFetch({ json: { source: "own", credentials: "" } });
  await assert.rejects(() => resolveClaudeCredential("grant-x"), HubRejected);
});

// ---- the three failures that must not look alike (INTEGRATION.md §5) ----

test("a 401 on a grant is grant expiry, not a logout", async () => {
  mockFetch({ status: 401 });
  await assert.rejects(() => resolveClaudeCredential("grant-x"), HubGrantExpired);
});

test("a refused connection is the hub being down", async () => {
  mockFetch({ throws: true });
  await assert.rejects(() => resolveClaudeCredential("grant-x"), HubUnreachable);
});

test("no grant at all is grant expiry, and costs no round trip", async () => {
  const calls = mockFetch({ json: {} });
  await assert.rejects(() => resolveClaudeCredential(""), HubGrantExpired);
  assert.equal(calls.length, 0);
});

test("a 404 carries the hub's own reason through", async () => {
  mockFetch({ status: 404, json: { detail: "No Claude credential is configured." } });
  await assert.rejects(
    () => resolveClaudeCredential("grant-x"),
    (e: unknown) =>
      e instanceof HubRejected && e.status === 404 && /No Claude credential/.test(e.message),
  );
});

// ---- usage ----

test("postClaudeUsage sends the figures and nothing about who spent them", async () => {
  const calls = mockFetch({ status: 201, json: { ok: true } });
  await postClaudeUsage("grant-x", {
    model: "claude-opus-5",
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 40,
    costUsd: 0.5,
    durationMs: 1200,
    action: "implement",
    externalRef: "run_1",
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/credentials\/claude\/usage$/);
  const body = calls[0].body as Record<string, unknown>;
  assert.equal(body.cacheWriteTokens, 40);
  assert.equal(body.externalRef, "run_1");
  // Attribution is the hub's, from the grant — this side must not assert it.
  assert.equal("ownerId" in body, false);
});
