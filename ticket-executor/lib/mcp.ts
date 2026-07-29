// MCP access — the *agent's* path to the ticket provider.
//
// This is a second, independent credential path that is easy to miss: the app
// talks to the provider over REST with the PAT in ProviderCredential
// (lib/ado.ts), while the Claude CLI a run spawns reads the ticket through an
// MCP server it resolves from *its own* config. A green Settings page therefore
// does not imply the run can read anything: the skills (implement-ticket-v*,
// fix-code-review-v*) fetch the work item and drive the PR through provider MCP
// tools, and without them a run burns tokens only to fail — or worse, guesses.
//
// Two modes, chosen by Setting.manageMcp:
//   on  (default) — the app generates a per-run MCP config from the stored org +
//                   PAT and passes it via `--mcp-config`, so a fresh install
//                   needs no manual `claude mcp add`. It *yields* to a server the
//                   user configured themselves, so an existing setup keeps
//                   working and no duplicate server is ever loaded.
//   off           — the app never touches MCP; preflight only inspects what the
//                   machine already has (and flags an org mismatch).
//
// Server-only (spawns processes, reads the user's home config) — never import
// from a client component. Provider-facing metadata lives here rather than in
// lib/providers.ts because that module is imported by client components.

import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import path from "path";
import { parseAdoUrl } from "./ado";
import { providerMeta } from "./providers";

// ---------------------------------------------------------------------------
// per-provider templates
// ---------------------------------------------------------------------------

/** One stdio MCP server, in the shape `--mcp-config` expects under mcpServers. */
export type McpServerSpec = { command: string; args: string[]; env?: Record<string, string> };

export type McpTemplate = {
  /** Key used for the server in a generated config. Deliberately the
   *  conventional name, so the `mcp__<server>__<tool>` namespace matches what
   *  the skills were written against. */
  server: string;
  /** Lowercase substrings that identify a user-configured server for this
   *  provider — matched against the server name and its command line. */
  hints: string[];
  /** Builds the server from the saved credential; null when this provider has
   *  no MCP server the app knows how to configure yet. */
  build: ((org: string, pat: string) => McpServerSpec | null) | null;
  /** CLI the skills fall back to when no MCP server is available. */
  cli?: { bin: string; statusArgs: string[]; label: string };
};

// Pinned to major 2: the `<org>` positional argument and the AZURE_DEVOPS_TOKEN
// env var are that major's contract, and a silent major bump would break every
// generated config at once.
const ADO_MCP_NAME = "@azure-devops/mcp";
const ADO_MCP_MAJOR = 2;
const ADO_MCP_PACKAGE = `${ADO_MCP_NAME}@${ADO_MCP_MAJOR}`;

const TEMPLATES: Record<string, McpTemplate> = {
  "azure-devops": {
    server: "azure-devops",
    hints: ["azure-devops", "azure_devops", "azuredevops", "ado"],
    // Two ways to start the same server. `npx -y` needs no setup, which is why
    // it is the fallback — but it re-resolves the package against the registry
    // on *every* turn (measured: ~6.9s, even fully cached), and a run spawns a
    // fresh CLI process per turn. A global install skips all of it, so it wins
    // whenever one is present with a matching major.
    build: (org, pat) => {
      const slug = parseAdoUrl(org).org;
      if (!slug || !pat) return null;
      const env = { AZURE_DEVOPS_TOKEN: pat };
      const installed = globalPackageEntry(ADO_MCP_NAME, ADO_MCP_MAJOR);
      return installed
        ? { command: process.execPath, args: [installed.entry, slug], env }
        : { command: "npx", args: ["-y", ADO_MCP_PACKAGE, slug], env };
    },
  },
  github: {
    server: "github",
    hints: ["github"],
    build: null, // the skills drive GitHub through `gh`, which is the supported path
    cli: { bin: "gh", statusArgs: ["auth", "status"], label: "GitHub CLI (`gh`)" },
  },
  gitlab: {
    server: "gitlab",
    hints: ["gitlab"],
    build: null,
    cli: { bin: "glab", statusArgs: ["auth", "status"], label: "GitLab CLI (`glab`)" },
  },
  jira: {
    server: "jira",
    hints: ["jira", "atlassian", "rovo"],
    build: null,
  },
};

export function mcpTemplate(provider: string): McpTemplate | null {
  return TEMPLATES[provider] ?? null;
}

/** The package the managed Azure DevOps server runs, for preflight to resolve. */
export const MANAGED_PACKAGES: Record<string, string> = { "azure-devops": ADO_MCP_PACKAGE };

// ---------------------------------------------------------------------------
// globally installed server (the fast path)
// ---------------------------------------------------------------------------

/** Where `npm i -g` puts packages. `npm root -g` would be authoritative but
 *  costs a process spawn, and this is consulted on every turn. */
function globalNodeModulesDirs(): string[] {
  const dirs: string[] = [];
  const prefix = process.env.npm_config_prefix || process.env.NPM_CONFIG_PREFIX || "";
  if (process.platform === "win32") {
    if (prefix) dirs.push(path.join(prefix, "node_modules"));
    if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, "npm", "node_modules"));
    dirs.push(path.join(path.dirname(process.execPath), "node_modules"));
  } else {
    if (prefix) dirs.push(path.join(prefix, "lib", "node_modules"));
    dirs.push("/usr/local/lib/node_modules", "/usr/lib/node_modules");
    dirs.push(path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules"));
  }
  return dirs;
}

/** A globally installed `name` whose major matches, or null.
 *
 *  Resolves the package's *JS entry point* rather than the shim npm generates,
 *  so the server is started as `node <entry>`: a `.cmd`/`.ps1` shim is a shell
 *  script on Windows and would drag a shell into the spawn. The major check is
 *  not optional — a globally installed v3 would take different arguments and
 *  fail every run, so a mismatch falls back to the pinned `npx` form. */
export function globalPackageEntry(name: string, major: number): { entry: string; version: string } | null {
  for (const dir of globalNodeModulesDirs()) {
    const pkgDir = path.join(dir, ...name.split("/"));
    const manifest = path.join(pkgDir, "package.json");
    try {
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
        version?: string;
        bin?: string | Record<string, string>;
        main?: string;
      };
      const version = pkg.version ?? "";
      if (parseInt(version.split(".")[0], 10) !== major) continue;
      const rel = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin ?? {})[0] || pkg.main;
      if (!rel) continue;
      const entry = path.join(pkgDir, rel);
      if (existsSync(entry)) return { entry, version };
    } catch {
      /* unreadable/malformed install — treat as absent and let npx handle it */
    }
  }
  return null;
}

/** The managed server's global install for this provider, when it has one. */
export function managedGlobalInstall(provider: string): { entry: string; version: string } | null {
  return provider === "azure-devops" ? globalPackageEntry(ADO_MCP_NAME, ADO_MCP_MAJOR) : null;
}

// ---------------------------------------------------------------------------
// process helper
// ---------------------------------------------------------------------------

type Run = { ok: boolean; out: string; err: string };

// Anything that can take seconds runs through spawn, not spawnSync: this module
// is called from request handlers, and a synchronous 30s wait would freeze the
// whole Node process (it starved the connection check's own fetch until this was
// made async).
function runAsync(cmd: string, args: string[], opts?: { cwd?: string; timeout?: number }): Promise<Run> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, {
        cwd: opts?.cwd,
        windowsHide: true,
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ ok: false, out: "", err: e instanceof Error ? e.message : String(e) });
      return;
    }
    let out = "";
    let err = "";
    let done = false;
    const finish = (r: Run) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish({ ok: false, out: out.trim(), err: err.trim() || `timed out after ${opts?.timeout ?? 30000}ms` });
    }, opts?.timeout ?? 30000);
    child.stdout?.on("data", (b: Buffer) => (out += b.toString("utf8")));
    child.stderr?.on("data", (b: Buffer) => (err += b.toString("utf8")));
    child.on("error", (e) => finish({ ok: false, out: out.trim(), err: e.message }));
    child.on("close", (code) => finish({ ok: code === 0, out: out.trim(), err: err.trim() }));
  });
}

/** Is this binary on PATH at all? (Local, no network.) */
export async function hasBinary(bin: string): Promise<boolean> {
  return (await runAsync(bin, ["--version"], { timeout: 8000 })).ok;
}

/** Can npm resolve the managed server's package? Proves `npx` will be able to
 *  fetch it on first run. Network, so deep-tier only. */
export async function packageResolvable(pkg: string): Promise<{ ok: boolean; message: string }> {
  const r = await runAsync("npm", ["view", pkg, "version"], { timeout: 25000 });
  if (r.ok) return { ok: true, message: `${pkg} resolves to ${r.out.split(/\r?\n/).pop() || "ok"}.` };
  return { ok: false, message: (r.err || `npm view ${pkg} failed`).split(/\r?\n/).slice(0, 2).join(" ") };
}

/** Provider CLI login state (`gh auth status`). Network, so deep-tier only. */
export async function cliAuthenticated(cli: NonNullable<McpTemplate["cli"]>): Promise<{ ok: boolean; message: string }> {
  const r = await runAsync(cli.bin, cli.statusArgs, { timeout: 15000 });
  // `gh auth status` prints its report on stderr even when logged in.
  const text = (r.out || r.err).split(/\r?\n/).filter(Boolean).slice(0, 2).join(" ");
  return { ok: r.ok, message: text || (r.ok ? "authenticated" : `${cli.bin} is not logged in`) };
}

// ---------------------------------------------------------------------------
// what the machine already has
// ---------------------------------------------------------------------------

/** A server found in the user's own MCP config. Env values are never carried —
 *  the ADO server keeps its PAT in `env`, and this shape reaches the browser. */
export type ConfiguredServer = {
  name: string;
  /** Which file it came from, for the "where do I fix this" message. */
  source: string;
  /** `<command> <args…>` for stdio servers, the URL for remote ones. */
  commandLine: string;
};

function readJson(file: string): Record<string, unknown> | null {
  try {
    // `--mcp-config` accepts an inline JSON string as well as a path, so
    // CLAUDE_MCP_CONFIG may hold either.
    if (file.trim().startsWith("{")) return JSON.parse(file) as Record<string, unknown>;
    if (!existsSync(file)) return null;
    if (statSync(file).size > 20_000_000) return null; // pathological config — don't stall a run
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null; // unreadable or malformed — treat as absent
  }
}

/** A scanned server plus its verbatim declaration. Server-only: `spec` still
 *  holds `env`, so this shape must never be returned to the browser — that is
 *  what `ConfiguredServer` is for. */
type RawServer = ConfiguredServer & { spec: Record<string, unknown> };

function collect(into: RawServer[], raw: unknown, source: string) {
  if (!raw || typeof raw !== "object") return;
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    const s = (v ?? {}) as { command?: unknown; args?: unknown; url?: unknown; type?: unknown };
    const commandLine =
      typeof s.url === "string"
        ? s.url
        : [typeof s.command === "string" ? s.command : "", ...(Array.isArray(s.args) ? s.args.map(String) : [])]
            .filter(Boolean)
            .join(" ");
    into.push({ name, source, commandLine, spec: (v ?? {}) as Record<string, unknown> });
  }
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Every MCP server the CLI would load, as far as static config goes. `cwd` is
 *  the run's working directory, which decides the project-scoped sources.
 *
 *  Deliberately static: it never spawns anything, so both the System Check page
 *  and every run start can afford it. `⏸ Pending approval` servers are included
 *  (they are configured, just not trusted yet) — mcpListHealth() is what tells
 *  the two apart. */
export function scanConfiguredServers(cwd?: string): ConfiguredServer[] {
  // Drop `spec` on the way out: this list is rendered by System Check, and the
  // ADO server keeps its PAT in `env`.
  return scanRawServers(cwd).map(({ name, source, commandLine }) => ({ name, source, commandLine }));
}

function scanRawServers(cwd?: string): RawServer[] {
  const found: RawServer[] = [];
  const home = homedir();

  const userSettings = path.join(home, ".claude", "settings.json");
  collect(found, readJson(userSettings)?.mcpServers, "~/.claude/settings.json");

  const legacy = readJson(path.join(home, ".claude.json"));
  collect(found, legacy?.mcpServers, "~/.claude.json");
  if (cwd && legacy?.projects && typeof legacy.projects === "object") {
    for (const [proj, v] of Object.entries(legacy.projects as Record<string, unknown>)) {
      if (norm(proj) !== norm(cwd)) continue;
      collect(found, (v as { mcpServers?: unknown })?.mcpServers, `~/.claude.json (project ${proj})`);
    }
  }

  if (cwd) {
    collect(found, readJson(path.join(cwd, ".mcp.json"))?.mcpServers, `${cwd}\\.mcp.json`);
    for (const f of ["settings.json", "settings.local.json"]) {
      collect(found, readJson(path.join(cwd, ".claude", f))?.mcpServers, `${cwd}\\.claude\\${f}`);
    }
  }

  if (process.env.CLAUDE_MCP_CONFIG) {
    collect(found, readJson(process.env.CLAUDE_MCP_CONFIG)?.mcpServers, "CLAUDE_MCP_CONFIG");
  }

  return found;
}

/** Pick this provider's server out of a scanned list. Prefers an exact name
 *  match over a fuzzy command-line one. */
export function matchProviderServer<T extends ConfiguredServer>(provider: string, servers: T[]): T | null {
  const t = mcpTemplate(provider);
  if (!t) return null;
  const fuzzy = (s: T) => {
    const hay = `${s.name} ${s.commandLine}`.toLowerCase();
    return t.hints.some((h) => hay.includes(h));
  };
  return servers.find((s) => s.name.toLowerCase() === t.server) ?? servers.find(fuzzy) ?? null;
}

/** The user's own server for this provider, if any. */
export function findProviderServer(provider: string, cwd?: string): RawServer | null {
  return matchProviderServer(provider, scanRawServers(cwd));
}

/** Only the servers declared by CLAUDE_MCP_CONFIG — the sole ones a run sees
 *  when that override is set (it comes with --strict-mcp-config). */
function envOverrideServers(): RawServer[] {
  const found: RawServer[] = [];
  collect(found, readJson(process.env.CLAUDE_MCP_CONFIG ?? "")?.mcpServers, "CLAUDE_MCP_CONFIG");
  return found;
}

/** The organization an Azure DevOps MCP server is pinned to — it is a positional
 *  argument, so a server can silently serve a different org than Settings. */
export function adoServerOrg(commandLine: string): string {
  const m = commandLine.match(/@azure-devops\/mcp(?:@[^\s]+)?\s+(\S+)/i);
  return m ? m[1] : "";
}

// ---------------------------------------------------------------------------
// live health (`claude mcp list`)
// ---------------------------------------------------------------------------

export type McpStatus = "connected" | "needs-auth" | "failed" | "pending" | "unknown";
export type McpHealth = { name: string; status: McpStatus; detail: string };

function classify(tail: string): McpStatus {
  const t = tail.toLowerCase();
  if (t.includes("connected")) return "connected";
  if (t.includes("needs authentication")) return "needs-auth";
  if (t.includes("failed")) return "failed";
  if (t.includes("pending")) return "pending";
  return "unknown";
}

/** Health-check every configured server. Spawns the CLI, which connects to each
 *  server in turn — slow (tens of seconds when a remote server times out), so
 *  this belongs in the deep tier only, never on the run path. */
export async function mcpListHealth(cwd?: string): Promise<{ ok: boolean; servers: McpHealth[]; error?: string }> {
  const bin = process.env.CLAUDE_BIN || "claude";
  const r = await runAsync(bin, ["mcp", "list"], { cwd, timeout: 120000 });
  if (!r.ok && !r.out) return { ok: false, servers: [], error: r.err || `\`${bin} mcp list\` failed` };

  const servers: McpHealth[] = [];
  for (const line of r.out.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || !s.includes(": ")) continue; // header / blank
    const name = s.slice(0, s.indexOf(": ")).trim();
    const cut = s.lastIndexOf(" - ");
    if (!name || cut < 0) continue;
    const tail = s.slice(cut + 3).trim();
    // The CLI marks status with glyphs (✔ ✘ ⏸ —) that arrive mangled through a
    // Windows pipe; we classify from the words, so drop the non-ASCII noise
    // rather than showing mojibake in the UI.
    const detail = tail.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
    servers.push({ name, status: classify(tail), detail });
  }
  return { ok: true, servers };
}

export function healthOf(servers: McpHealth[], serverName: string): McpHealth | null {
  return servers.find((s) => s.name.toLowerCase() === serverName.toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// the decision: what will this run use?
// ---------------------------------------------------------------------------

export type McpMode =
  | "managed" // the app generates the config for this run
  | "user" // a server the user configured themselves; the app stays out of it
  | "unmanaged" // toggle off and nothing configured
  | "env-override" // CLAUDE_MCP_CONFIG is set; that file wins (with --strict)
  | "unsupported"; // no server the app can build and none configured

export type McpDecision = {
  mode: McpMode;
  /** What will happen — one line for the run log and the System Check row. */
  detail: string;
  /** Set when a run should not be started at all. */
  blocker?: string;
  fix?: string;
  server?: string;
  /** The single server to write into this run's config, so the run can be given
   *  --strict-mcp-config and load nothing else. Set for mode "managed" (built
   *  from the stored credential) and for mode "user" when their own server is a
   *  stdio one we can reproduce verbatim. Left unset for a remote/OAuth server,
   *  whose credentials live in the CLI's own state rather than in the config —
   *  pinning that into a fresh file could strip its auth, so such a run keeps
   *  inheriting the machine's config instead. */
  spec?: McpServerSpec | Record<string, unknown>;
};

/** Resolve how one run gets MCP access. Cheap (static config reads only), so
 *  both preflight and the implement route can call it per request. */
export async function resolveMcp(opts: {
  provider: string;
  org: string;
  pat: string;
  manageMcp: boolean;
  /** The run's working directory — decides project-scoped config. */
  cwd?: string;
}): Promise<McpDecision> {
  const { provider, org, pat, manageMcp, cwd } = opts;
  const pm = providerMeta(provider);
  const t = mcpTemplate(provider);
  // An explicit CLAUDE_MCP_CONFIG is a deliberate override: the run gets
  // --strict-mcp-config, so only that file's servers exist for the run and
  // anything the app generated would be ignored.
  if (process.env.CLAUDE_MCP_CONFIG) {
    const inEnv = matchProviderServer(provider, envOverrideServers());
    const declared = !!inEnv;
    return {
      mode: "env-override",
      detail: declared
        ? `CLAUDE_MCP_CONFIG is set — the run uses its "${inEnv!.name}" server.`
        : `CLAUDE_MCP_CONFIG is set — the run uses only that file's servers.`,
      server: inEnv?.name,
      blocker: declared
        ? undefined
        : `CLAUDE_MCP_CONFIG is set and its file declares no ${pm.name} MCP server. The run gets --strict-mcp-config, so Claude will have no way to read the ticket.`,
      fix: declared ? undefined : "Add the provider's server to that file, or unset CLAUDE_MCP_CONFIG to let the app manage MCP.",
    };
  }

  const existing = findProviderServer(provider, cwd);
  if (existing) {
    const stdio = typeof existing.spec.command === "string" && !existing.spec.url;
    return {
      mode: "user",
      detail: stdio
        ? `Using your own "${existing.name}" server from ${existing.source}.`
        : `Using your own "${existing.name}" server from ${existing.source} — it is remote, so the run also loads this machine's other servers.`,
      server: existing.name,
      spec: stdio ? existing.spec : undefined,
    };
  }

  if (!manageMcp) {
    return {
      mode: "unmanaged",
      detail: `No ${pm.name} MCP server is configured on this machine.`,
      blocker: `Claude has no MCP access to ${pm.name}, so a run cannot read the ticket. "Manage MCP for me" is off, so the app will not configure one.`,
      fix: mcpAddHint(provider, org),
    };
  }

  const spec = t?.build ? t.build(org, pat) : null;
  if (spec) {
    return {
      mode: "managed",
      detail: `App-managed "${t!.server}" server${provider === "azure-devops" ? ` — org ${parseAdoUrl(org).org}` : ""}.`,
      server: t!.server,
      spec,
    };
  }

  // Nothing to build. For GitHub/GitLab the skills have a CLI path, so a present
  // binary downgrades this from "cannot run" to "verify the login".
  if (t?.cli && (await hasBinary(t.cli.bin))) {
    return {
      mode: "user",
      detail: `No MCP server — the skills will use ${t.cli.label}, which is installed.`,
    };
  }

  const missingCreds = !!t?.build && (!org || !pat);
  return {
    mode: "unsupported",
    detail: missingCreds
      ? `${pm.name} connection is incomplete, so no MCP server can be generated.`
      : `The app cannot configure MCP for ${pm.name} yet.`,
    blocker: missingCreds
      ? `Cannot build the ${pm.name} MCP server: ${!org ? pm.urlLabel : pm.tokenLabel} is missing in Settings.`
      : `The app has no MCP template for ${pm.name}, and nothing is configured on this machine — Claude cannot read the ticket.`,
    fix: missingCreds ? "Fill it in on the Settings page and save." : mcpAddHint(provider, org),
  };
}

/** Copy-pasteable command that fixes a missing server by hand. */
export function mcpAddHint(provider: string, org: string): string {
  if (provider === "azure-devops") {
    const slug = parseAdoUrl(org).org || "<your-org>";
    return `Run: claude mcp add azure-devops -s user -e AZURE_DEVOPS_TOKEN=<PAT> -- npx -y ${ADO_MCP_PACKAGE} ${slug}`;
  }
  const t = mcpTemplate(provider);
  if (t?.cli) return `Install and log in to ${t.cli.label} (\`${t.cli.bin} auth login\`), or add an MCP server with \`claude mcp add\`.`;
  return `Add a server for this provider with \`claude mcp add\` (see the provider's MCP docs).`;
}

// ---------------------------------------------------------------------------
// per-run generated config
// ---------------------------------------------------------------------------

// Written outside the repo on purpose: a file inside the worktree would be
// visible to the run's own `git add`, and it holds the PAT in clear text.
const RUN_CONFIG_DIR = path.join(tmpdir(), "te-mcp");
const STALE_MS = 6 * 60 * 60 * 1000;

/** Drop configs a crashed run left behind, so a plaintext token never lingers
 *  indefinitely. Cheap enough to fold into every write. */
function sweepStale() {
  try {
    for (const f of readdirSync(RUN_CONFIG_DIR)) {
      const p = path.join(RUN_CONFIG_DIR, f);
      try {
        if (Date.now() - statSync(p).mtimeMs > STALE_MS) rmSync(p, { force: true });
      } catch {
        /* someone else removed it — fine */
      }
    }
  } catch {
    /* directory doesn't exist yet */
  }
}

/** Write the run's MCP config and return its path, or "" if the decision has no
 *  pinnable server (see `McpDecision.spec`). The file is what lets the run be
 *  started with --strict-mcp-config. */
export function writeRunMcpConfig(runId: string, decision: McpDecision): string {
  if (!decision.spec || !decision.server) return "";
  try {
    mkdirSync(RUN_CONFIG_DIR, { recursive: true });
    sweepStale();
    const file = path.join(RUN_CONFIG_DIR, `${runId.replace(/[^\w-]/g, "")}.json`);
    writeFileSync(file, JSON.stringify({ mcpServers: { [decision.server]: decision.spec } }), {
      encoding: "utf8",
      mode: 0o600,
    });
    return file;
  } catch {
    return ""; // fall back to whatever the CLI resolves on its own
  }
}

export function removeRunMcpConfig(file: string | null | undefined) {
  if (!file) return;
  try {
    rmSync(file, { force: true });
  } catch {
    /* best effort — sweepStale() will get it later */
  }
}

// ---------------------------------------------------------------------------
// deep-probe cache
// ---------------------------------------------------------------------------

// The deep checks health-check every MCP server, which takes tens of seconds —
// far too slow to run at the start of every execution. The System Check page
// caches its verdict here and the implement route reads it: a cached failure
// blocks a run, a cached pass is silent, and a miss lets the run proceed with a
// warning. Never persisted: "MCP was reachable once" goes stale within minutes.
export const MCP_PROBE_TTL_MS = 5 * 60 * 1000;

type Probe = { at: number; key: string; ok: boolean; reason: string };
const g = globalThis as { __teMcpProbe?: Probe };

/** Identifies what was probed — a settings change invalidates it. */
export function mcpProbeKey(provider: string, manageMcp: boolean): string {
  return `${provider}:${manageMcp ? "managed" : "unmanaged"}`;
}

export function setMcpProbe(key: string, ok: boolean, reason: string) {
  g.__teMcpProbe = { at: Date.now(), key, ok, reason };
}

/** The probe for `key`, or null when absent, stale, or for a different key. */
export function getMcpProbe(key: string): Probe | null {
  const p = g.__teMcpProbe;
  if (!p || p.key !== key) return null;
  if (Date.now() - p.at > MCP_PROBE_TTL_MS) return null;
  return p;
}

export function clearMcpProbe() {
  g.__teMcpProbe = undefined;
}
