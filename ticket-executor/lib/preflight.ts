// Preflight checks — everything that must be true BEFORE a run is worth
// starting. All checks are cheap (no Claude tokens, no writes) and read-only.
//
// One source of truth, two consumers: the System Check page (via
// GET /api/preflight) renders every check, and the implement route re-runs the
// blocker subset just before spawning the CLI. Nothing is cached or persisted:
// a "passed" flag would go stale the moment a repo gets dirty or a PAT expires.
//
// Server-only (spawns processes, touches the DB) — never import from a client
// component.

import { spawnSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";
import { prisma } from "./prisma";
import { parseAdoUrl } from "./ado";
import { resolveCredential } from "./providerCredentials";
import {
  MANAGED_PACKAGES,
  adoServerOrg,
  cliAuthenticated,
  findProviderServer,
  getMcpProbe,
  hasBinary,
  healthOf,
  mcpAddHint,
  managedGlobalInstall,
  mcpListHealth,
  mcpProbeKey,
  mcpTemplate,
  packageResolvable,
  resolveMcp,
  setMcpProbe,
} from "./mcp";
import { normalizeProvider } from "./tickets";
import { providerMeta } from "./providers";

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckGroup = "environment" | "skills" | "connection" | "agent-access" | "repo";

export type Check = {
  id: string;
  group: CheckGroup;
  label: string;
  /** Severity when this check does not pass: a blocker makes a run pointless. */
  level: "blocker" | "warning";
  status: CheckStatus;
  /** What was actually found. */
  message: string;
  /** How to fix it, when it didn't pass. */
  fix?: string;
};

export type PreflightResult = {
  checks: Check[];
  summary: { blockers: number; warnings: number; ready: boolean };
  /** The Root repo the checks were run against. */
  rootRepo: string;
  /** True when the network-touching checks were included. */
  deep: boolean;
};

// REQUIRED_SKILLS / skillDirs() / findSkill() now live in lib/skillPack.ts
// (which also owns install + version state) and are re-exported here so the
// existing import sites keep working.
export { REQUIRED_SKILLS, findSkill, skillDirs } from "./skillPack";
import { REQUIRED_SKILLS, findSkill, skillDirs, skillStates } from "./skillPack";

// There is deliberately no app-wide default Root repo: one connection serves many
// projects, so the repo a run executes in is chosen per ticket (Overview tab) and
// remembered per project in RootRepoProjectMap.

// ---------------------------------------------------------------------------
// process helpers
// ---------------------------------------------------------------------------

type Run = { ok: boolean; out: string; err: string };

function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv }
): Run {
  try {
    const r = spawnSync(cmd, args, {
      cwd: opts?.cwd,
      env: opts?.env,
      timeout: opts?.timeout ?? 5000,
      encoding: "utf8",
      windowsHide: true,
      shell: process.platform === "win32", // .cmd shims (claude, npm) need a shell on Windows
    });
    const out = (r.stdout ?? "").trim();
    const err = (r.stderr ?? "").trim();
    if (r.error) return { ok: false, out, err: err || r.error.message };
    return { ok: r.status === 0, out, err };
  } catch (e) {
    return { ok: false, out: "", err: e instanceof Error ? e.message : String(e) };
  }
}

const git = (args: string[], opts?: { cwd?: string; timeout?: number }) => run("git", args, opts);

// ---------------------------------------------------------------------------
// skills
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// check groups
// ---------------------------------------------------------------------------

async function environmentChecks(deep: boolean): Promise<Check[]> {
  const checks: Check[] = [];

  // --- database ---
  let dbUp = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
    checks.push({
      id: "db-connect", group: "environment", label: "Database reachable", level: "blocker",
      status: "pass", message: "Connected via DATABASE_URL.",
    });
  } catch (e) {
    checks.push({
      id: "db-connect", group: "environment", label: "Database reachable", level: "blocker",
      status: "fail", message: e instanceof Error ? e.message : String(e),
      fix: "Start Postgres and check DATABASE_URL in .env (see .env.example).",
    });
  }

  // --- migrations applied ---
  if (dbUp) {
    try {
      const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
        SELECT migration_name, finished_at FROM "_prisma_migrations"
      `;
      const applied = rows.filter((r) => r.finished_at !== null).length;
      const unfinished = rows.filter((r) => r.finished_at === null).map((r) => r.migration_name);
      let onDisk = 0;
      try {
        onDisk = readdirSync(path.join(process.cwd(), "prisma", "migrations"))
          .filter((n) => !n.startsWith(".") && n !== "migration_lock.toml").length;
      } catch {
        /* can't read the folder — fall back to comparing nothing */
      }
      if (unfinished.length) {
        checks.push({
          id: "db-migrations", group: "environment", label: "Migrations applied", level: "blocker",
          status: "fail", message: `Unfinished migration(s): ${unfinished.join(", ")}.`,
          fix: "Resolve with `npx prisma migrate resolve`, then `npx prisma migrate dev`.",
        });
      } else if (onDisk && applied < onDisk) {
        checks.push({
          id: "db-migrations", group: "environment", label: "Migrations applied", level: "blocker",
          status: "fail", message: `${applied} of ${onDisk} migrations applied.`,
          fix: "Run `npx prisma migrate dev`.",
        });
      } else {
        checks.push({
          id: "db-migrations", group: "environment", label: "Migrations applied", level: "blocker",
          status: "pass", message: `${applied} migration${applied === 1 ? "" : "s"} applied.`,
        });
      }
    } catch {
      checks.push({
        id: "db-migrations", group: "environment", label: "Migrations applied", level: "blocker",
        status: "fail", message: "No migration history table found.",
        fix: "Run `npx prisma migrate dev` to create the schema.",
      });
    }
  }

  // --- claude CLI ---
  const claudeBin = process.env.CLAUDE_BIN || "claude";
  const cli = run(claudeBin, ["--version"], { timeout: 15000 });
  checks.push(
    cli.ok
      ? {
          id: "claude-cli", group: "environment", label: "Claude Code CLI", level: "blocker",
          status: "pass", message: `${claudeBin} — ${cli.out.split(/\r?\n/)[0] || "ok"}`,
        }
      : {
          id: "claude-cli", group: "environment", label: "Claude Code CLI", level: "blocker",
          status: "fail", message: cli.err || `\`${claudeBin} --version\` failed.`,
          fix: "Install the Claude Code CLI and log in. If it isn't on PATH, set CLAUDE_BIN to its full path.",
        }
  );

  // --- git ---
  const g = git(["--version"]);
  checks.push(
    g.ok
      ? {
          id: "git-cli", group: "environment", label: "Git available", level: "blocker",
          status: "pass", message: g.out,
        }
      : {
          id: "git-cli", group: "environment", label: "Git available", level: "blocker",
          status: "fail", message: g.err || "`git --version` failed.",
          fix: "Install Git and make sure it is on PATH — every run branches, commits and pushes.",
        }
  );

  // --- optional env guardrails ---
  checks.push(
    process.env.SETTINGS_ENC_KEY
      ? {
          id: "enc-key", group: "environment", label: "Token encryption key", level: "warning",
          status: "pass", message: "SETTINGS_ENC_KEY is set explicitly.",
        }
      : {
          id: "enc-key", group: "environment", label: "Token encryption key", level: "warning",
          status: "warn", message: "SETTINGS_ENC_KEY is unset — the key is derived from DATABASE_URL.",
          fix: "Set SETTINGS_ENC_KEY in .env. Otherwise changing DATABASE_URL later makes the stored PAT undecryptable.",
        }
  );

  return checks;
}

function skillChecks(): Check[] {
  return skillStates().map((s) => {
    const base = { id: `skill-${s.name}`, group: "skills" as const, label: s.name };
    // An optional skill (one reached only when a setting switches its node on) is
    // not missing-and-fatal — it is missing-and-unused until that setting is on,
    // and startRun() refuses the run if it ever isn't. Reporting it as a blocker
    // here would tell every install it is broken over a feature it never enabled.
    if (s.status === "missing") {
      return {
        ...base,
        level: s.required ? ("blocker" as const) : ("warning" as const),
        status: s.required ? ("fail" as const) : ("warn" as const),
        message: s.required
          ? `Not found in ${skillDirs().length} skill folder(s).`
          : `Not installed. Only needed while the setting that uses it is on — a run would be refused up front, not left to fail.`,
        fix: "Install it from the Guide or with the Install button here — this repo ships a copy.",
      };
    }
    if (s.status === "outdated") {
      // A major-version gap is not "slightly behind": the 2.x contract is what
      // makes a skill answer with StructuredOutput and stop before publishing.
      // A 1.x copy returns prose the runner cannot route on, so every node fails
      // — block rather than warn, since the log would never explain why.
      const majorGap = parseInt(s.bundledVersion, 10) > parseInt(s.installedVersion ?? "0", 10);
      return {
        ...base,
        level: majorGap ? ("blocker" as const) : ("warning" as const),
        status: majorGap ? ("fail" as const) : ("warn" as const),
        message: majorGap
          ? `Installed ${s.installedVersion}, this repo ships ${s.bundledVersion} — incompatible contract.`
          : `Installed ${s.installedVersion}, this repo ships ${s.bundledVersion}.`,
        fix: majorGap
          ? "Update it: a 1.x skill answers in prose, but the runner now routes on the structured output only 2.x returns, so every run would fail at its first node."
          : "Update it to pick up the newer instructions — an old skill fails in ways the log won't explain.",
      };
    }
    if (s.status === "modified") {
      return {
        ...base, level: "warning" as const, status: "warn" as const,
        message: `Version ${s.installedVersion}, but the file differs from the bundled copy.`,
        fix: "Yours was edited locally. Leave it if that was deliberate; otherwise overwrite it with the bundled copy.",
      };
    }
    return {
      ...base, level: "blocker" as const, status: "pass" as const,
      message: `${s.installedVersion} — ${s.installedPath}`,
    };
  });
}

async function connectionChecks(deep: boolean): Promise<Check[]> {
  const checks: Check[] = [];
  let provider = "azure-devops";
  let org = "";
  let pat = "";

  try {
    const setting = await prisma.setting.findUnique({ where: { id: "default" } });
    provider = normalizeProvider(setting?.provider ?? process.env.TICKET_PROVIDER);
    const cred = await resolveCredential(provider);
    org = cred.org.trim();
    pat = cred.pat;
  } catch {
    checks.push({
      id: "conn-stored", group: "connection", label: "Provider connection saved", level: "blocker",
      status: "fail", message: "Could not read the stored connection (database unavailable).",
      fix: "Fix the database check above first.",
    });
    return checks;
  }

  const pm = providerMeta(provider);
  const missing: string[] = [];
  if (!org) missing.push(pm.urlLabel);
  if (!pat) missing.push(pm.tokenLabel);

  checks.push(
    missing.length === 0
      ? {
          id: "conn-stored", group: "connection", label: "Provider connection saved", level: "blocker",
          status: "pass", message: `${pm.name} — ${org}`,
        }
      : {
          id: "conn-stored", group: "connection", label: "Provider connection saved", level: "blocker",
          status: "fail", message: `${pm.name}: missing ${missing.join(" and ")}.`,
          fix: "Fill it in on the Settings page and save.",
        }
  );

  if (provider !== "azure-devops") {
    checks.push({
      id: "conn-provider", group: "connection", label: "Provider is wired up", level: "warning",
      status: "warn", message: `${pm.name} is scaffolded only — ticket loading returns an empty "not connected" result.`,
      fix: "Switch the provider to Azure DevOps on the Settings page.",
    });
  }

  if (deep && missing.length === 0) {
    const live = await testConnectionLive(provider, org, pat);
    checks.push({
      id: "conn-live", group: "connection", label: "Token accepted by provider", level: "blocker",
      status: live.ok ? "pass" : "fail", message: live.message,
      fix: live.ok ? undefined : "Re-issue the PAT with Work Items (R/W), Code (R/W) and Pull Request scopes, then re-save it in Settings.",
    });
  }

  return checks;
}

// Live token check. Mirrors POST /api/settings/test for the wired providers;
// kept here so preflight has no HTTP hop back into itself.
//
// Same two guards as that route, and for the same reason: a provider that
// rejects a credential may answer with a redirect to its sign-in page rather
// than a 401, and following it lands on a 200 carrying HTML. `redirect:
// "manual"` plus a check that the body really is the JSON the endpoint promises
// is what separates "the token works" from "we were shown a login form".
async function testConnectionLive(provider: string, org: string, pat: string): Promise<{ ok: boolean; message: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  const bounced = (r: Response) => r.status === 0 || (r.status >= 300 && r.status < 400);
  const asJson = async (r: Response): Promise<Record<string, unknown> | null> => {
    if (!(r.headers.get("content-type") ?? "").toLowerCase().includes("json")) return null;
    const body = await r.json().catch(() => null);
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  };
  const rejected = (name: string) => ({ ok: false, message: `${name} rejected the token — expired or missing scopes.` });
  try {
    if (provider === "azure-devops") {
      const slug = org.replace(/^https?:\/\/(dev\.azure\.com\/)?/, "").replace(/\/+$/, "").split("/")[0];
      if (!slug) return { ok: false, message: "Could not read the organization from the saved URL." };
      const r = await fetch(`https://dev.azure.com/${slug}/_apis/projects?api-version=7.0`, {
        headers: { Authorization: "Basic " + Buffer.from(":" + pat).toString("base64"), Accept: "application/json" },
        signal: ctrl.signal,
        cache: "no-store",
        redirect: "manual",
      });
      if (bounced(r)) return rejected("Azure DevOps");
      if (r.ok) {
        const data = await asJson(r);
        if (!data || !Array.isArray(data.value)) return rejected("Azure DevOps");
        const n = typeof data.count === "number" ? data.count : data.value.length;
        return { ok: true, message: `Azure DevOps accepted the token — ${slug} (${n} project${n === 1 ? "" : "s"}).` };
      }
      if (r.status === 401 || r.status === 203 || r.status === 403) return rejected("Azure DevOps");
      if (r.status === 404) return { ok: false, message: `Organization "${slug}" not found.` };
      return { ok: false, message: `Azure DevOps returned ${r.status} ${r.statusText}.` };
    }
    if (provider === "github") {
      const r = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
        signal: ctrl.signal, cache: "no-store", redirect: "manual",
      });
      if (bounced(r)) return rejected("GitHub");
      if (!r.ok) return { ok: false, message: `GitHub returned ${r.status} ${r.statusText}.` };
      const u = await asJson(r);
      return typeof u?.login === "string"
        ? { ok: true, message: "GitHub accepted the token." }
        : rejected("GitHub");
    }
    return { ok: true, message: "No automated token check for this provider — verify by loading tickets." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// agent access — can the *Claude CLI* reach the provider?
// ---------------------------------------------------------------------------

// Separate from the `connection` group on purpose: that one proves the *app's*
// REST credential works, this one proves the run's MCP path does. They are
// independent, and only this one decides whether a skill can read the ticket.
async function agentAccessChecks(deep: boolean): Promise<{ checks: Check[]; probe: { key: string; ok: boolean; reason: string } }> {
  const checks: Check[] = [];
  let provider = "azure-devops";
  let manageMcp = true;
  let org = "";
  let pat = "";
  try {
    const setting = await prisma.setting.findUnique({ where: { id: "default" } });
    provider = normalizeProvider(setting?.provider ?? process.env.TICKET_PROVIDER);
    manageMcp = setting?.manageMcp ?? true;
    const cred = await resolveCredential(provider);
    org = cred.org.trim();
    pat = cred.pat;
  } catch {
    return {
      checks: [{
        id: "mcp-access", group: "agent-access", label: "Claude can reach the provider", level: "blocker",
        status: "fail", message: "Could not read the settings (database unavailable).",
        fix: "Fix the database check above first.",
      }],
      probe: { key: mcpProbeKey(provider, manageMcp), ok: false, reason: "Settings unreadable." },
    };
  }

  const pm = providerMeta(provider);
  const t = mcpTemplate(provider);
  // No Root repo here: the System Check page checks the machine, and a run's
  // project-scoped .mcp.json is resolved per run inside the engine.
  const decision = await resolveMcp({ provider, org, pat, manageMcp });

  const modeLabel: Record<string, string> = {
    managed: "app-managed",
    user: "your own config",
    unmanaged: "not configured",
    "env-override": "CLAUDE_MCP_CONFIG",
    unsupported: "unavailable",
  };
  checks.push(
    decision.blocker
      ? {
          id: "mcp-access", group: "agent-access", label: "Claude can reach the provider", level: "blocker",
          status: "fail", message: decision.blocker, fix: decision.fix,
        }
      : {
          id: "mcp-access", group: "agent-access", label: "Claude can reach the provider", level: "blocker",
          status: "pass", message: `${decision.detail} (${modeLabel[decision.mode]})`,
        }
  );

  // The app-generated server runs through npx, so Node has to be there.
  if (decision.mode === "managed") {
    const npx = await hasBinary("npx");
    checks.push(
      npx
        ? {
            id: "mcp-npx", group: "agent-access", label: "Node/npx available", level: "blocker",
            status: "pass", message: "npx can launch the MCP server.",
          }
        : {
            id: "mcp-npx", group: "agent-access", label: "Node/npx available", level: "blocker",
            status: "fail", message: "`npx --version` failed.",
            fix: "Install Node.js — the app-managed MCP server is started with npx.",
          }
    );
  }

  // An Azure DevOps server takes its organization as a positional argument, so a
  // server configured for another org reads the wrong work items without erroring.
  if (provider === "azure-devops" && (decision.mode === "user" || decision.mode === "env-override")) {
    const existing = findProviderServer(provider);
    const serverOrg = existing ? adoServerOrg(existing.commandLine) : "";
    const settingsOrg = parseAdoUrl(org).org;
    if (!serverOrg) {
      checks.push({
        id: "mcp-org", group: "agent-access", label: "MCP organization matches Settings", level: "warning",
        status: "warn", message: `Could not read an organization from your MCP server (${existing?.commandLine ?? "unknown command"}).`,
        fix: `Confirm by hand that it serves ${settingsOrg || "the org configured in Settings"} — a server pointed elsewhere reads different work items without failing.`,
      });
    } else if (settingsOrg && serverOrg.toLowerCase() !== settingsOrg.toLowerCase()) {
      checks.push({
        id: "mcp-org", group: "agent-access", label: "MCP organization matches Settings", level: "blocker",
        status: "fail", message: `Your MCP server serves "${serverOrg}" but Settings is connected to "${settingsOrg}".`,
        fix: `Claude would read the ticket from the wrong organization. Fix with: claude mcp remove ${existing!.name} -s user, then ${mcpAddHint(provider, org)}`,
      });
    } else {
      checks.push({
        id: "mcp-org", group: "agent-access", label: "MCP organization matches Settings", level: "blocker",
        status: "pass", message: `Both point at ${serverOrg}.`,
      });
    }
  }

  if (deep) {
    if (decision.mode === "managed") {
      const pkg = MANAGED_PACKAGES[provider];
      const installed = managedGlobalInstall(provider);
      if (installed) {
        // Nothing to resolve: the run starts the installed entry point directly,
        // which is also what keeps ~7s of npx resolution out of every turn.
        checks.push({
          id: "mcp-package", group: "agent-access", label: "MCP server package resolves", level: "blocker",
          status: "pass",
          message: `Installed globally (v${installed.version}) — started directly, no npx resolution per turn.`,
        });
      } else if (pkg) {
        // The generated server is invisible to `claude mcp list`, so what is worth
        // proving is that npx will be able to fetch its package.
        const r = await packageResolvable(pkg);
        checks.push(
          r.ok
            ? {
                id: "mcp-package", group: "agent-access", label: "MCP server package resolves", level: "blocker",
                status: "pass",
                message: `${r.message} Started via npx, which re-resolves it every turn (~7s); \`npm i -g ${pkg}\` removes that.`,
              }
            : {
                id: "mcp-package", group: "agent-access", label: "MCP server package resolves", level: "blocker",
                status: "fail", message: r.message,
                fix: `npx must be able to download ${pkg} on the first run. Check network/proxy access to the npm registry.`,
              }
        );
      }
    }

    const health = await mcpListHealth();
    if (!health.ok) {
      checks.push({
        id: "mcp-live", group: "agent-access", label: "MCP servers healthy", level: "warning",
        status: "warn", message: health.error ?? "`claude mcp list` failed.",
        fix: "Run `claude mcp list` yourself to see what the CLI reports.",
      });
    } else if (decision.mode === "user" || decision.mode === "env-override") {
      const name = decision.server ?? t?.server ?? "";
      const h = name ? healthOf(health.servers, name) : null;
      if (!h) {
        checks.push({
          id: "mcp-live", group: "agent-access", label: "Provider MCP server connects", level: "warning",
          status: "warn", message: `"${name}" is configured but \`claude mcp list\` did not report it.`,
          fix: "Run `claude mcp list` to see which scope the CLI actually loads.",
        });
      } else {
        const fixFor: Record<string, string> = {
          "needs-auth": "Run `claude` in a terminal and use /mcp to log in — a non-interactive run cannot complete an OAuth flow.",
          pending: "Approve the project's .mcp.json once in an interactive `claude` session; unapproved servers are never connected to.",
          failed: "Fix the server so it starts (see the error above), then re-run this check.",
          unknown: "Run `claude mcp list` to see what the CLI reports.",
        };
        checks.push(
          h.status === "connected"
            ? {
                id: "mcp-live", group: "agent-access", label: "Provider MCP server connects", level: "blocker",
                status: "pass", message: `${h.name} — ${h.detail}`,
              }
            : {
                id: "mcp-live", group: "agent-access", label: "Provider MCP server connects", level: "blocker",
                status: "fail", message: `${h.name} — ${h.detail}`, fix: fixFor[h.status],
              }
        );
      }
    } else if (decision.mode === "managed") {
      // Anything the static scan missed (a claude.ai connector, an enterprise
      // managed config) would load *alongside* the generated server.
      const dupe = health.servers.find((s) => {
        const hay = s.name.toLowerCase();
        return (t?.hints ?? []).some((hint) => hay.includes(hint));
      });
      if (dupe) {
        checks.push({
          id: "mcp-duplicate", group: "agent-access", label: "No duplicate provider server", level: "warning",
          status: "warn", message: `"${dupe.name}" is also configured somewhere the app cannot read.`,
          fix: `Turn "Manage MCP for me" off in Settings so only your own server is used, or remove that one — otherwise two ${pm.name} servers load and the skill may pick either.`,
        });
      }
    }

    // GitHub/GitLab skills drive the provider through its CLI, so its login state
    // matters as much as MCP does.
    if (t?.cli && (await hasBinary(t.cli.bin))) {
      const auth = await cliAuthenticated(t.cli);
      checks.push({
        id: "mcp-cli", group: "agent-access", label: `${t.cli.label} logged in`, level: "warning",
        status: auth.ok ? "pass" : "warn", message: auth.message,
        fix: auth.ok ? undefined : `Run \`${t.cli.bin} auth login\` — the skills use it to read the ticket and open the PR.`,
      });
    }
  }

  const blockers = checks.filter((c) => c.level === "blocker" && c.status !== "pass");
  return {
    checks,
    probe: {
      key: mcpProbeKey(provider, manageMcp),
      ok: blockers.length === 0,
      reason: blockers[0]?.message ?? "",
    },
  };
}

/** The must-be-true-before-spawning-the-CLI subset for one run's Root repo.
 *  Cheap (fs + one git call) and shared by the System Check page and the
 *  implement route, so a bad path costs nothing instead of a failed run. */
export function validateRootRepo(rootRepo: string | undefined | null): { ok: boolean; error?: string } {
  const p = (rootRepo ?? "").trim();
  if (!p)
    return { ok: false, error: "Root repo is required. Set it on the ticket's Overview tab — the git clone this run should execute in." };
  if (!existsSync(p))
    return { ok: false, error: `Root repo not found: ${p}. Check the path on the Overview tab.` };
  if (!git(["-C", p, "rev-parse", "--git-dir"]).ok)
    return { ok: false, error: `${p} is not a git repository. Root repo is used verbatim as the run's working directory — point it at the clone itself, not a parent folder.` };
  return { ok: true };
}

/** The MCP half of the same gate, for one run. Cheap: static config reads only.
 *
 *  The expensive half (health-checking every server, tens of seconds) can't run
 *  per execution, so this reads the verdict the System Check page cached:
 *    cached failure → block, cache miss/stale → allow with a warning,
 *    cached pass → silent.
 *  A missing provider server *is* detectable cheaply, and that is the failure
 *  that would otherwise cost tokens for nothing. */
export async function validateAgentAccess(
  provider: string,
  rootRepo: string
): Promise<{ ok: boolean; error?: string; warnings: string[] }> {
  let manageMcp = true;
  let org = "";
  let pat = "";
  try {
    const setting = await prisma.setting.findUnique({ where: { id: "default" } });
    manageMcp = setting?.manageMcp ?? true;
    const cred = await resolveCredential(provider);
    org = cred.org.trim();
    pat = cred.pat;
  } catch {
    // The DB is down; startExecution would fail on its own row insert anyway.
    return { ok: true, warnings: [] };
  }

  const decision = await resolveMcp({ provider, org, pat, manageMcp, cwd: rootRepo });
  if (decision.blocker) {
    return { ok: false, error: [decision.blocker, decision.fix].filter(Boolean).join(" "), warnings: [] };
  }

  const probe = getMcpProbe(mcpProbeKey(provider, manageMcp));
  if (probe && !probe.ok) {
    return {
      ok: false,
      error: `${probe.reason} (reported by the last deep System Check — re-run it after fixing.)`,
      warnings: [],
    };
  }
  if (!probe) {
    return {
      ok: true,
      warnings: [
        "MCP connectivity has not been verified recently. If this run fails while reading the ticket, open System Check and run the deep checks.",
      ],
    };
  }
  return { ok: true, warnings: [] };
}

function repoChecks(rootRepo: string, deep: boolean): Check[] {
  const checks: Check[] = [];
  const p = rootRepo.trim();

  // Root repo is a per-ticket value with no app-wide default, so with no path
  // given there is simply nothing to check here — the implement route enforces
  // it per run via validateRootRepo().
  if (!p) return [];
  if (!existsSync(p)) {
    return [{
      id: "repo-exists", group: "repo", label: "Root repo folder exists", level: "blocker",
      status: "fail", message: `Not found: ${p}`,
      fix: "Clone the repo there, or correct the path.",
    }];
  }
  checks.push({
    id: "repo-exists", group: "repo", label: "Root repo folder exists", level: "blocker",
    status: "pass", message: p,
  });

  const isRepo = git(["-C", p, "rev-parse", "--git-dir"]);
  if (!isRepo.ok) {
    checks.push({
      id: "repo-is-git", group: "repo", label: "Is a git repository", level: "blocker",
      status: "fail", message: `${p} is not a git work tree.`,
      fix: "Root repo is used verbatim as the run's working directory — point it at the clone itself, not a parent folder.",
    });
    return checks;
  }
  const branch = git(["-C", p, "rev-parse", "--abbrev-ref", "HEAD"]);
  checks.push({
    id: "repo-is-git", group: "repo", label: "Is a git repository", level: "blocker",
    status: "pass", message: `On branch ${branch.out || "(unknown)"}.`,
  });

  const dirty = git(["-C", p, "status", "--porcelain"]);
  const dirtyLines = dirty.out ? dirty.out.split(/\r?\n/).filter(Boolean) : [];
  checks.push(
    dirtyLines.length === 0
      ? {
          id: "repo-clean", group: "repo", label: "Working tree clean", level: "warning",
          status: "pass", message: "No uncommitted changes.",
        }
      : {
          id: "repo-clean", group: "repo", label: "Working tree clean", level: "warning",
          status: "warn", message: `${dirtyLines.length} uncommitted change(s).`,
          fix: "Commit or stash them — a run branches from HEAD and may sweep unrelated edits into its commit.",
        }
  );

  const origin = git(["-C", p, "remote", "get-url", "origin"]);
  if (!origin.ok) {
    checks.push({
      id: "repo-push", group: "repo", label: "Can push to origin", level: "warning",
      status: "warn", message: "No `origin` remote configured.",
      fix: "Add the remote — a run pushes its branch and opens a PR.",
    });
    return checks;
  }

  if (deep) {
    // --dry-run contacts the remote and authenticates but sends nothing, so the
    // ref in the refspec is never created.
    const push = git(["-C", p, "push", "--dry-run", "origin", "HEAD:refs/heads/te-preflight-dry-run"], { timeout: 20000 });
    checks.push(
      push.ok
        ? {
            id: "repo-push", group: "repo", label: "Can push to origin", level: "warning",
            status: "pass", message: "Credentials accepted (dry run — nothing was pushed).",
          }
        : {
            id: "repo-push", group: "repo", label: "Can push to origin", level: "warning",
            status: "warn", message: (push.err || "push --dry-run failed").split(/\r?\n/).slice(0, 3).join(" "),
            fix: "A run cannot answer a credential prompt. Cache credentials (Git Credential Manager or a PAT in the remote URL) and retry.",
          }
    );
  }

  return checks;
}

// ---------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------

function summarize(checks: Check[], rootRepo: string, deep: boolean): PreflightResult {
  const blockers = checks.filter((c) => c.level === "blocker" && c.status !== "pass").length;
  const warnings = checks.filter((c) => c.level === "warning" && c.status !== "pass").length;
  return { checks, summary: { blockers, warnings, ready: blockers === 0 }, rootRepo, deep };
}

/** Every check, for the System Check page. `deep` adds the network-touching
 *  ones (live token test, push dry-run). */
export async function runPreflight(opts?: { rootRepo?: string; deep?: boolean }): Promise<PreflightResult> {
  const rootRepo = (opts?.rootRepo ?? "").trim();
  const deep = !!opts?.deep;
  const [env, conn, agent] = await Promise.all([
    environmentChecks(deep),
    connectionChecks(deep),
    agentAccessChecks(deep),
  ]);
  // Only the deep pass health-checks MCP, and it is far too slow to repeat at the
  // start of every run — cache its verdict for the implement route to read.
  if (deep) setMcpProbe(agent.probe.key, agent.probe.ok, agent.probe.reason);
  return summarize(
    [...env, ...skillChecks(), ...conn, ...agent.checks, ...repoChecks(rootRepo, deep)],
    rootRepo,
    deep
  );
}
