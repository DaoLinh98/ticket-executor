// Where a provider credential comes from — the single place that decides.
//
// Two sources exist:
//
//   local  ProviderCredential, edited on the Settings page. The original, and
//          still the only one when `Setting.hubEnabled` is off.
//   hub    `GET {hub}/connections/{id}/secret`, fetched **live**, per call
//          (emehub ADR 0010).
//
// Every consumer — lib/ado.ts, lib/preflight.ts, the MCP builder in
// lib/execution/graph/exec.ts, the connection test — goes through
// `resolveCredential()`. If a call site read `providerCredential` directly it
// would keep working with the hub switched on and quietly use the wrong
// organization, which is the one failure this indirection exists to prevent.
//
// **Nothing is mirrored any more.** There used to be a `HubConnection` table
// holding a copy of the hub's PAT, refreshed by a Sync button. It is gone: in
// hub mode the provider is reached *through* the hub (lib/hubGateway.ts), so the
// only thing still needing the credential itself is the Claude CLI's MCP server,
// which the hub does not proxy. That one need is served by fetching the secret
// at the moment it is used and holding it no longer than the run's temp MCP
// config. A stored copy could not tell a rotated PAT from a working one, and the
// hub's `updatedAt` bookkeeping existed only to paper over that.
//
// **Hub mode does not fall back to the local row.** With `hubEnabled` on and no
// connection selected — or with the hub unreachable, or the session expired —
// this reports "not configured" rather than reaching for ProviderCredential. A
// silent fallback is how a run ends up executing against an organization nobody
// chose, and preflight can only say what is wrong if the wrongness is visible.

import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { fetchHubSecret } from "@/lib/hub";

export type CredentialSource = "hub" | "local";

export type ResolvedCredential = {
  /** Organization / base URL, the shape `parseAdoUrl()` accepts. */
  org: string;
  /** Decrypted PAT. Empty when nothing usable is configured. */
  pat: string;
  source: CredentialSource;
  /** Present only for `source: "hub"` — what the Settings page labels it. */
  label: string;
  /** The hub's `config.project`, when it had one. Advisory; the run's project
   *  is still chosen per ticket. */
  project: string;
};

const NONE = (source: CredentialSource): ResolvedCredential => ({
  org: "",
  pat: "",
  source,
  label: "",
  project: "",
});

/**
 * The credential `provider` should run with, and where it came from.
 *
 * Never throws and never returns a partial credential: a caller checks
 * `org && pat` exactly as it did when it read the table directly.
 *
 * `provider` is a plain string rather than `ProviderId`, matching `resolveMcp()`
 * next door: the value arrives from a DB column and a run context that both hold
 * strings, and an unknown one simply matches no row.
 */
export async function resolveCredential(provider: string): Promise<ResolvedCredential> {
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });

  if (setting?.hubEnabled) {
    const hubId = Number(setting.hubConnectionId);
    if (!hubId) return NONE("hub");
    try {
      // Resolved through the gateway's own routing rule so the provider match
      // and the "nothing selected" case are decided in one place; it throws
      // rather than guessing, which is what we want.
      const { hubRoute } = await import("@/lib/hubGateway");
      const route = await hubRoute(provider);
      const secret = await fetchHubSecret(route.hubId);
      return {
        org: secret.orgUrl || route.orgUrl,
        pat: secret.pat,
        source: "hub",
        label: route.label,
        project: secret.project || route.project,
      };
    } catch {
      // Signed out, hub down, wrong provider selected, or the hub refused this
      // connection. All four mean the same thing to a caller of this function:
      // there is no credential. Which one it was is reported by the routes that
      // can render it (`GET /api/hub`, preflight) — a caller here only ever
      // checked `org && pat`, and inventing a partial credential to carry the
      // reason would be worse than saying nothing.
      return NONE("hub");
    }
  }

  const cred = await prisma.providerCredential.findUnique({ where: { provider } });
  if (!cred) return NONE("local");
  return {
    org: cred.org,
    pat: decryptSecret(cred.pat),
    source: "local",
    label: "",
    project: "",
  };
}
