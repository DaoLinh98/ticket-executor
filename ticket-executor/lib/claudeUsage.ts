// Reads a Claude account's quota from Anthropic — the network half of `lib/claudeQuota.ts`.
//
// The account is the one the next turn would run as (`firstClaudeAccount()`): a saved credential's OAuth token,
// else the machine's own `~/.claude` login. The endpoint is the one the CLI's /usage reads; it is not a
// documented API, so every failure — no token, a token without the scope, a changed shape, a timeout — is a
// null reading, never an error: usage is information, and a run must not wait on it or fail because of it.
// The token is used for this one request and never logged, returned or stored.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { firstClaudeAccount, type ClaudeAccount } from "@/lib/claudeAccounts";
import { parseQuota, type Quota } from "@/lib/claudeQuota";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const TIMEOUT_MS = 4000;

/** The machine login's access token, from the file the CLI keeps (`CLAUDE_CONFIG_DIR` or `~/.claude`). */
async function machineToken(): Promise<string> {
  try {
    const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    const json = JSON.parse(await readFile(join(dir, ".credentials.json"), "utf8")) as { claudeAiOauth?: { accessToken?: unknown } };
    const t = json.claudeAiOauth?.accessToken;
    return typeof t === "string" ? t.trim() : "";
  } catch {
    return "";
  }
}

async function quotaOf(account: ClaudeAccount): Promise<Quota | null> {
  const token = account.env.CLAUDE_CODE_OAUTH_TOKEN || (await machineToken());
  if (!token) return null;
  try {
    const r = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return r.ok ? parseQuota(await r.json()) : null;
  } catch {
    return null;
  }
}

/** The account a turn would run as now, and its quota (null when it cannot be read). */
export async function currentQuota(): Promise<{ account: string; quota: Quota | null }> {
  const account = await firstClaudeAccount();
  return { account: account.label, quota: await quotaOf(account) };
}
