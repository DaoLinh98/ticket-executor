// Work-tracking providers the app can connect to. The app is provider-agnostic;
// Azure DevOps is fully wired, the others are scaffolded (see lib/ado.ts + tickets API).
//
// Client components import this module, so it stays free of server-only code.
// The per-provider MCP metadata a run needs (server name, recognition hints,
// generated-config builder, CLI fallback) therefore lives in lib/mcp.ts —
// adding a provider means touching both.
export type ProviderId = "azure-devops" | "github" | "jira" | "gitlab";

export type ProviderMeta = {
  id: ProviderId;
  name: string; // human label, e.g. "Azure DevOps"
  short: string; // header subtitle token, e.g. "AZURE DEVOPS"
  urlLabel: string; // Settings URL field label
  urlPlaceholder: string;
  tokenLabel: string; // Settings token field label
};

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "azure-devops",
    name: "Azure DevOps",
    short: "AZURE DEVOPS",
    urlLabel: "ORGANIZATION URL",
    urlPlaceholder: "https://dev.azure.com/your-org",
    tokenLabel: "PERSONAL ACCESS TOKEN",
  },
  {
    id: "github",
    name: "GitHub",
    short: "GITHUB",
    urlLabel: "REPOSITORY / OWNER URL",
    urlPlaceholder: "https://github.com/owner/repo",
    tokenLabel: "ACCESS TOKEN",
  },
  {
    id: "jira",
    name: "Jira",
    short: "JIRA",
    urlLabel: "JIRA BASE URL",
    urlPlaceholder: "https://your-org.atlassian.net",
    tokenLabel: "API TOKEN",
  },
  {
    id: "gitlab",
    name: "GitLab",
    short: "GITLAB",
    urlLabel: "GITLAB URL",
    urlPlaceholder: "https://gitlab.com/group/project",
    tokenLabel: "ACCESS TOKEN",
  },
];

export const DEFAULT_PROVIDER: ProviderId = "azure-devops";

export function providerMeta(id: string | undefined): ProviderMeta {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

/** What a connection is called in the picker: the operator's own name when they
 *  gave one, otherwise the organization the URL names ("dev.azure.com/acme" →
 *  "acme", "github.com/owner/repo" → "owner/repo"). */
export function connectionLabel(conn: { label?: string; org?: string }): string {
  const label = (conn.label ?? "").trim();
  if (label) return label;
  const org = (conn.org ?? "").trim().replace(/\/+$/, "");
  if (!org) return "Not configured";
  try {
    const u = new URL(org);
    const path = u.pathname.replace(/^\/+|\/+$/g, "");
    return path || u.hostname;
  } catch {
    return org;
  }
}
