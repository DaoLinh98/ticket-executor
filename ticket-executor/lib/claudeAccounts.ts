// Which Claude account a CLI turn runs as — the single place that decides.
//
// Saved credentials (table `ClaudeCredential`) are tried in priority order; the
// machine's own `~/.claude` login is always the last resort, so an install with
// none saved behaves exactly as before. A turn that fails because its account
// is out of quota, or because its token was rejected, is re-run at once on the
// next account; the spent/rejected credential is marked so later turns skip it.
// The rules themselves live in `lib/claudeAuth.ts`.

import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  classifyFailure, credentialEnv, credentialStatus, parseCredentialInput, usableInOrder, type CredentialStatus,
} from "@/lib/claudeAuth";

export type ClaudeAccount = {
  /** null = this machine's own login. */
  id: string | null;
  label: string;
  env: Record<string, string>;
};

export const LOCAL_ACCOUNT: ClaudeAccount = { id: null, label: "this machine's login", env: {} };

const nameOf = (c: { label: string; priority: number }) => c.label || `credential #${c.priority + 1}`;

/** The accounts to try, in order, ending with the machine login. Never throws:
 *  a table that cannot be read leaves the machine login, as before this existed. */
export async function claudeAccounts(): Promise<ClaudeAccount[]> {
  try {
    const rows = usableInOrder(await prisma.claudeCredential.findMany());
    const saved = rows.flatMap((r) => {
      const token = decryptSecret(r.token);
      return token ? [{ id: r.id, label: nameOf(r), env: credentialEnv(token) }] : [];
    });
    return [...saved, LOCAL_ACCOUNT];
  } catch (e) {
    console.error("[claude-accounts] could not read saved credentials", e);
    return [LOCAL_ACCOUNT];
  }
}

/** The account an interactive session (Ask) starts on: the first usable one. */
export async function firstClaudeAccount(): Promise<ClaudeAccount> {
  return (await claudeAccounts())[0];
}

type Attempt = { ok: boolean; error: string; text?: string };

/**
 * Run one turn, moving to the next account when this one is out of quota or its
 * token is rejected. Any other failure is the turn's own and is returned as is;
 * so is whatever the machine login produces, since there is nothing after it.
 * `combine` folds the abandoned attempts into the final result (e.g. summing cost).
 */
export async function runWithClaudeAccounts<R extends Attempt>(
  attempt: (account: ClaudeAccount) => Promise<R>,
  log: (text: string, warn: boolean) => void,
  combine: (abandoned: R[], last: R) => R = (_a, last) => last,
): Promise<R> {
  const accounts = await claudeAccounts();
  const abandoned: R[] = [];
  for (const account of accounts) {
    if (accounts.length > 1) log(`Claude account: ${account.label}`, false);
    const r = await attempt(account);
    if (!account.id) return combine(abandoned, r);
    if (r.ok) {
      await prisma.claudeCredential.update({ where: { id: account.id }, data: { lastUsedAt: new Date() } }).catch(() => null);
      return combine(abandoned, r);
    }
    const message = r.error || r.text || "";
    const failure = classifyFailure(message);
    if (failure.kind === "other") return combine(abandoned, r);
    abandoned.push(r);
    const lastError = message.slice(0, 500);
    if (failure.kind === "limit") {
      log(`${account.label} is out of quota until ${failure.until.toLocaleString()} — switching account and re-running the turn`, true);
      await prisma.claudeCredential.update({ where: { id: account.id }, data: { limitedUntil: failure.until, lastError } }).catch(() => null);
    } else {
      log(`${account.label} was rejected (token expired or invalid) — update it in Settings → Claude; switching account and re-running the turn`, true);
      await prisma.claudeCredential.update({ where: { id: account.id }, data: { invalidAt: new Date(), lastError } }).catch(() => null);
    }
  }
  // Unreachable: the machine login always ends the list and always returns.
  throw new Error("no Claude account left to run the turn");
}

// ---- management (Settings → Claude) ----

/** A credential as a page may see it — never the token. */
export type ClaudeCredentialView = {
  id: string;
  label: string;
  priority: number;
  enabled: boolean;
  status: CredentialStatus;
  expiresAt: string | null;
  limitedUntil: string | null;
  invalidAt: string | null;
  lastError: string;
  lastUsedAt: string | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function listClaudeCredentials(): Promise<ClaudeCredentialView[]> {
  const rows = await prisma.claudeCredential.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    priority: r.priority,
    enabled: r.enabled,
    status: credentialStatus(r, now),
    expiresAt: iso(r.expiresAt),
    limitedUntil: iso(r.limitedUntil),
    invalidAt: iso(r.invalidAt),
    lastError: r.lastError,
    lastUsedAt: iso(r.lastUsedAt),
  }));
}

/**
 * Create one credential, or update its name / enabled flag / token. A token is
 * written only when one is supplied (the page never gets it back), and a new
 * token clears every mark the old one earned.
 */
export async function saveClaudeCredential(input: {
  id?: string; label: string; token: string; enabled?: boolean;
}): Promise<{ error: string } | { error: "" }> {
  const data: {
    label: string; enabled?: boolean; token?: string; expiresAt?: Date | null;
    invalidAt?: null; limitedUntil?: null; lastError?: string;
  } = { label: input.label };
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.token.trim()) {
    const parsed = parseCredentialInput(input.token);
    if ("error" in parsed) return parsed;
    Object.assign(data, { token: encryptSecret(parsed.token), expiresAt: parsed.expiresAt, invalidAt: null, limitedUntil: null, lastError: "" });
  }
  if (input.id) {
    const found = await prisma.claudeCredential.findUnique({ where: { id: input.id } });
    if (!found) return { error: "Credential not found." };
    await prisma.claudeCredential.update({ where: { id: input.id }, data });
    return { error: "" };
  }
  if (!data.token) return { error: "A token is required." };
  const last = await prisma.claudeCredential.findFirst({ orderBy: { priority: "desc" } });
  await prisma.claudeCredential.create({ data: { ...data, token: data.token, priority: (last?.priority ?? -1) + 1 } });
  return { error: "" };
}

export async function deleteClaudeCredential(id: string): Promise<boolean> {
  const found = await prisma.claudeCredential.findUnique({ where: { id } });
  if (!found) return false;
  await prisma.claudeCredential.delete({ where: { id } });
  return true;
}

/** Move one credential up or down the order. Priorities are rewritten 0..n so gaps never matter. */
export async function moveClaudeCredential(id: string, dir: -1 | 1): Promise<boolean> {
  const rows = await prisma.claudeCredential.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return false;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  await prisma.$transaction(rows.map((r, n) => prisma.claudeCredential.update({ where: { id: r.id }, data: { priority: n } })));
  return true;
}

/** What the bell needs: name, expiry and rejection. Flat in cost — one small table. */
export async function claudeCredentialSources(): Promise<{ id: string; label: string; expiresAt: string | null; invalidAt: string | null }[]> {
  try {
    const rows = await prisma.claudeCredential.findMany({ where: { enabled: true } });
    return rows.map((r) => ({ id: r.id, label: nameOf(r), expiresAt: iso(r.expiresAt), invalidAt: iso(r.invalidAt) }));
  } catch {
    return [];
  }
}
