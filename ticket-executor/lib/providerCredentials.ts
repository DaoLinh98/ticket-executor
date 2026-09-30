// Where a provider credential comes from — the single place that decides.
//
// Every consumer — lib/ado.ts, lib/preflight.ts, the MCP builder in
// lib/execution/graph/exec.ts, the connection test — goes through
// `resolveCredential()` rather than reading `ProviderCredential` itself, so
// there is one answer to "which organization does a run authenticate as".
//
// A provider holds several connections (one per organization). Exactly one of
// them is active, and that is the one this module hands out; switching it is
// therefore the only thing the header's organization picker has to do.

import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { NO_IDENTITY, type DevIdentity } from "@/lib/identity";

export type ResolvedCredential = {
  /** Organization / base URL, the shape `parseAdoUrl()` accepts. */
  org: string;
  /** Decrypted PAT. Empty when nothing usable is configured. */
  pat: string;
  /** Who the developer is inside this organization. Empty fields mean the
   *  connection has no identity configured — not that it matches nobody. */
  identity: DevIdentity;
};

/** A connection as a page is allowed to see it — never the token itself. */
export type ConnectionView = {
  id: string;
  provider: string;
  label: string;
  org: string;
  hasPat: boolean;
  isActive: boolean;
  identityEmail: string;
  identityName: string;
  reviewers: string[];
};

const view = (c: {
  id: string; provider: string; label: string; org: string; pat: string; isActive: boolean;
  identityEmail: string; identityName: string; reviewers: string[];
}): ConnectionView => ({
  id: c.id,
  provider: c.provider,
  label: c.label,
  org: c.org,
  hasPat: c.pat.length > 0,
  isActive: c.isActive,
  identityEmail: c.identityEmail,
  identityName: c.identityName,
  reviewers: c.reviewers ?? [],
});

/** Every connection saved for `provider`, oldest first — the order the picker
 *  shows them in, so "the first one" is a stable answer. */
export async function listConnections(provider: string): Promise<ConnectionView[]> {
  const rows = await prisma.providerCredential.findMany({
    where: { provider },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(view);
}

/**
 * The connection `provider` currently runs as: the one flagged active, else the
 * first one saved. The fallback is what makes a provider whose active flag was
 * never set (or whose active row was deleted) still connected.
 */
async function activeRow(provider: string) {
  const rows = await prisma.providerCredential.findMany({
    where: { provider },
    orderBy: { createdAt: "asc" },
  });
  return rows.find((r) => r.isActive) ?? rows[0] ?? null;
}

export async function activeConnection(provider: string): Promise<ConnectionView | null> {
  const row = await activeRow(provider);
  return row ? view(row) : null;
}

/**
 * The credential `provider` should run with.
 *
 * Never throws and never returns a partial credential: a caller checks
 * `org && pat` exactly as it did when it read the table directly.
 *
 * `provider` is a plain string rather than `ProviderId`, matching `resolveMcp()`
 * next door: the value arrives from a DB column and a run context that both hold
 * strings, and an unknown one simply matches no row.
 */
export async function resolveCredential(provider: string): Promise<ResolvedCredential> {
  const row = await activeRow(provider);
  if (!row) return { org: "", pat: "", identity: NO_IDENTITY };
  return {
    org: row.org,
    pat: decryptSecret(row.pat),
    identity: { email: row.identityEmail, name: row.identityName },
  };
}

/** One specific connection's credential, for the connection test: testing the
 *  row being edited must authenticate as that row, not as whichever one happens
 *  to be active. */
export async function connectionCredential(id: string): Promise<ResolvedCredential | null> {
  const row = await prisma.providerCredential.findUnique({ where: { id } });
  if (!row) return null;
  return {
    org: row.org,
    pat: decryptSecret(row.pat),
    identity: { email: row.identityEmail, name: row.identityName },
  };
}

export async function reviewersFor(provider: string, org: string): Promise<string[]> {
  const row = await prisma.providerCredential.findUnique({
    where: { provider_org: { provider, org } },
    select: { reviewers: true },
  });
  return row?.reviewers ?? [];
}

/** Make `id` the connection this provider runs as. A no-op for an id that is
 *  not this provider's. */
export async function setActiveConnection(provider: string, id: string): Promise<boolean> {
  const target = await prisma.providerCredential.findUnique({ where: { id } });
  if (!target || target.provider !== provider) return false;
  await prisma.$transaction([
    prisma.providerCredential.updateMany({ where: { provider }, data: { isActive: false } }),
    prisma.providerCredential.update({ where: { id }, data: { isActive: true } }),
  ]);
  return true;
}

/**
 * Create or update one connection.
 *
 * The PAT is only written when a non-empty one is supplied — a page that never
 * receives the token back must not be able to erase it by saving the form. The
 * first connection a provider gets is its active one, so a fresh install is
 * connected the moment it is saved.
 */
export async function saveConnection(input: {
  id?: string;
  provider: string;
  label: string;
  org: string;
  pat: string;
  identityEmail: string;
  identityName: string;
  reviewers: string[];
}): Promise<ConnectionView> {
  const data: {
    label: string; org: string; identityEmail: string; identityName: string; reviewers: string[]; pat?: string;
  } = {
    label: input.label,
    org: input.org,
    identityEmail: input.identityEmail,
    identityName: input.identityName,
    reviewers: input.reviewers,
  };
  if (input.pat.length > 0) data.pat = encryptSecret(input.pat);

  if (input.id) {
    const row = await prisma.providerCredential.update({ where: { id: input.id }, data });
    return view(row);
  }
  const existing = await prisma.providerCredential.findUnique({
    where: { provider_org: { provider: input.provider, org: input.org } },
  });
  if (existing) {
    const row = await prisma.providerCredential.update({ where: { id: existing.id }, data });
    return view(row);
  }
  const count = await prisma.providerCredential.count({ where: { provider: input.provider } });
  const row = await prisma.providerCredential.create({
    data: { provider: input.provider, pat: "", ...data, isActive: count === 0 },
  });
  return view(row);
}

/** Remove a connection. Deleting the active one promotes the oldest survivor,
 *  so the provider never ends up with connections but no active one. */
export async function deleteConnection(id: string): Promise<boolean> {
  const row = await prisma.providerCredential.findUnique({ where: { id } });
  if (!row) return false;
  await prisma.providerCredential.delete({ where: { id } });
  if (row.isActive) {
    const next = await prisma.providerCredential.findFirst({
      where: { provider: row.provider },
      orderBy: { createdAt: "asc" },
    });
    if (next) await prisma.providerCredential.update({ where: { id: next.id }, data: { isActive: true } });
  }
  return true;
}
