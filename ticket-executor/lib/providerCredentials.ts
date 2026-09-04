// Where a provider credential comes from — the single place that decides.
//
// Every consumer — lib/ado.ts, lib/preflight.ts, the MCP builder in
// lib/execution/graph/exec.ts, the connection test — goes through
// `resolveCredential()` rather than reading `ProviderCredential` itself, so
// there is one answer to "which organization does a run authenticate as".

import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";

export type ResolvedCredential = {
  /** Organization / base URL, the shape `parseAdoUrl()` accepts. */
  org: string;
  /** Decrypted PAT. Empty when nothing usable is configured. */
  pat: string;
};

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
  const cred = await prisma.providerCredential.findUnique({ where: { provider } });
  if (!cred) return { org: "", pat: "" };
  return { org: cred.org, pat: decryptSecret(cred.pat) };
}
