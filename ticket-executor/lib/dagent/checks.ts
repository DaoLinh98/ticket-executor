import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { discoverCompanionRepos } from "../preflight";
import { loadLinkedPullRequest, loadPullRequestBranch, normalizeProvider } from "../tickets";
import { PLAN_FILE } from "./prompts";
import { diffViolations, isScratch, LOCAL_INSTRUCTIONS, planIssues, plannedFiles, scopeOf, violationWarnings, type AddedLine, type ChangedFile } from "./rules";
import { ZERO_USAGE, type Ctx, type LogEntry, type NodeResult, type Refusal, type Repo } from "./types";

export type RetrySeed = { baseSha: string; branches: Record<string, string>; companionBases: Record<string, string>; planMd: string };

export type CheckEnv = { gitName: string; gitEmail: string; retry: RetrySeed | null };

type Git = { ok: boolean; out: string; err: string };

function git(cwd: string, args: string[], timeout = 30000): Git {
  try {
    const out = execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    return { ok: true, out: out.trim(), err: "" };
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: String(x.stdout ?? "").trim(), err: String(x.stderr ?? x.message ?? "").trim() };
  }
}

const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function result(data: Record<string, unknown>, log: LogEntry[]): NodeResult {
  return { ok: true, data, error: "", usage: { ...ZERO_USAGE }, log };
}

function failure(error: string, log: LogEntry[] = []): NodeResult {
  return { ok: false, data: {}, error, usage: { ...ZERO_USAGE }, log };
}

function logger() {
  const log: LogEntry[] = [];
  const add = (lvl: LogEntry["lvl"], text: string) => log.push({ t: Date.now(), lvl, text });
  return { log, info: (t: string) => add("INFO", t), warn: (t: string) => add("WARN", t), error: (t: string) => add("ERROR", t) };
}

const EXCLUDES = ["/.te/", "/.te-worktrees/", "/KNOWLEDGE.md", `/${LOCAL_INSTRUCTIONS}`];

function excludeRunFiles(repo: string) {
  const common = git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok || !common.out) return;
  const file = path.join(common.out, "info", "exclude");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const have = lines(current);
  const missing = EXCLUDES.filter((p) => !have.includes(p));
  if (!missing.length) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`, "utf8");
}

function applyIdentity(repo: string, env: CheckEnv) {
  if (env.gitName.trim()) git(repo, ["config", "user.name", env.gitName]);
  if (env.gitEmail.trim()) git(repo, ["config", "user.email", env.gitEmail]);
}

function addWorktree(repo: string, wt: string, branch: string, start: string): Git {
  return branch ? git(repo, ["worktree", "add", wt, branch]) : git(repo, ["worktree", "add", "--detach", wt, start]);
}

function startPoint(repo: string, name: string, L: ReturnType<typeof logger>): string {
  const up = upstream(repo);
  const sha = up ? git(repo, ["rev-parse", `origin/${up.name}`]).out : "";
  if (up && sha) {
    L.info(`${name}: starting from origin/${up.name} @ ${sha.slice(0, 7)}`);
    return sha;
  }
  const head = git(repo, ["rev-parse", "HEAD"]);
  if (!head.ok || !head.out) return "";
  L.warn(`${name}: origin's default branch is unreachable — starting from the local HEAD ${head.out.slice(0, 7)}`);
  return head.out;
}

export function scopedCompanions(c: Ctx): Repo[] {
  const scope = scopeOf(c).map((s) => s.toLowerCase());
  return c.companions.filter((m) => scope.includes(m.name.toLowerCase()));
}

export function companionDirs(c: Ctx): string[] {
  return scopedCompanions(c).map((m) => {
    const src = path.join(m.path, LOCAL_INSTRUCTIONS);
    const dst = path.join(m.cwd, LOCAL_INSTRUCTIONS);
    if (existsSync(src) && !existsSync(dst)) {
      try {
        copyFileSync(src, dst);
      } catch {
        return m.cwd;
      }
    }
    return m.cwd;
  });
}

export function worktreeOf(repo: string, runId: string): string {
  return path.join(repo, ".te-worktrees", `dagent-${runId}`);
}

export function removeWorktrees(c: Ctx) {
  for (const [repo, cwd] of [[c.rootRepo, c.cwd], ...c.companions.map((m) => [m.path, m.cwd])]) {
    if (!repo || !cwd || repo === cwd) continue;
    git(repo, ["worktree", "remove", "--force", cwd]);
  }
}

const rootName = (c: Ctx) => path.basename(c.rootRepo);

async function setupOnPrBranch(c: Ctx, L: ReturnType<typeof logger>): Promise<NodeResult> {
  const branch = await loadPullRequestBranch(normalizeProvider(c.provider), c.ticketId, c.prUrl).catch(() => "");
  if (!branch) return failure(`Could not read the source branch of ${c.prUrl || "the pull request"} from ${c.provider}.`, L.log);
  const fetched = git(c.rootRepo, ["fetch", "origin", branch], 90000);
  if (!fetched.ok) return failure(`Could not fetch origin/${branch}: ${fetched.err}`, L.log);
  const wt = worktreeOf(c.rootRepo, c.runId);
  const added = git(c.rootRepo, ["worktree", "add", "-B", branch, wt, `origin/${branch}`]);
  if (!added.ok) return failure(`Could not check out ${branch} in the worktree ${wt}: ${added.err}`, L.log);
  c.cwd = wt;
  c.baseSha = git(wt, ["rev-parse", "HEAD"]).out;
  L.info(`worktree ${wt} on ${branch} @ ${c.baseSha.slice(0, 7)} — the pull request's head`);
  return result({ mode: "worktree", branch, baseSha: c.baseSha, repos: [{ name: rootName(c), path: wt }] }, L.log);
}

export async function setup(c: Ctx, env: CheckEnv): Promise<NodeResult> {
  const L = logger();
  const retry = env.retry;
  excludeRunFiles(c.rootRepo);
  applyIdentity(c.rootRepo, env);
  if (c.flow === "review") return setupOnPrBranch(c, L);
  const start = retry?.baseSha || startPoint(c.rootRepo, rootName(c), L);
  if (!start) return failure(`${c.rootRepo} has no commit to start from.`, L.log);
  c.baseSha = start;
  const rootBranch = retry?.branches[rootName(c)] ?? "";
  const wt = worktreeOf(c.rootRepo, c.runId);
  const added = addWorktree(c.rootRepo, wt, rootBranch, c.baseSha);
  if (!added.ok) return failure(`Could not create the worktree ${wt}: ${added.err}`, L.log);
  c.cwd = wt;
  L.info(`worktree ${wt}${rootBranch ? ` on ${rootBranch}` : ` detached at ${c.baseSha.slice(0, 7)}`}`);
  if (retry?.planMd) {
    mkdirSync(path.join(wt, ".te"), { recursive: true });
    writeFileSync(path.join(wt, PLAN_FILE), retry.planMd, "utf8");
    L.info(`restored ${PLAN_FILE} from the previous run`);
  }

  const { repos, warnings } = discoverCompanionRepos(c.rootRepo);
  warnings.forEach((w) => L.warn(w));
  const companions: Repo[] = [];
  for (const r of repos) {
    excludeRunFiles(r.path);
    applyIdentity(r.path, env);
    const base = retry?.companionBases[r.name] || startPoint(r.path, r.name, L);
    if (!base) {
      L.warn(`${r.name} has no commit to start from — not offered to this run`);
      continue;
    }
    const cwd = worktreeOf(r.path, c.runId);
    const branch = retry?.branches[r.name] ?? "";
    const ok = addWorktree(r.path, cwd, branch, base);
    if (!ok.ok) {
      L.warn(`${r.name}: could not create a worktree (${ok.err}) — not offered to this run`);
      continue;
    }
    companions.push({ name: r.name, path: r.path, cwd, baseSha: base, note: r.note });
    L.info(`related repo ${r.name}: ${cwd} @ ${base.slice(0, 7)}${r.note ? ` — ${r.note}` : ""}`);
  }
  c.companions = companions;
  return result(
    {
      mode: "worktree",
      branch: rootBranch,
      baseSha: c.baseSha,
      repos: [{ name: rootName(c), path: wt }, ...companions.map((m) => ({ name: m.name, path: m.cwd }))],
    },
    L.log,
  );
}

type RepoRef = { name: string; cwd: string; base: string; root: boolean; setBase: (sha: string) => void };

function reposOf(c: Ctx): RepoRef[] {
  return [
    { name: rootName(c), cwd: c.cwd, base: c.baseSha, root: true, setBase: (s: string) => (c.baseSha = s) },
    ...c.companions.map((m) => ({ name: m.name, cwd: m.cwd, base: m.baseSha, root: false, setBase: (s: string) => (m.baseSha = s) })),
  ];
}

function defaultBranch(cwd: string): string {
  const ref = git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (ref.ok && ref.out) return ref.out.replace(/^origin\//, "");
  for (const name of ["main", "master"]) if (git(cwd, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`]).ok) return name;
  return "";
}

function upstream(cwd: string): { name: string; behind: number } | null {
  if (!git(cwd, ["remote", "get-url", "origin"]).ok) return null;
  const name = defaultBranch(cwd);
  if (!name || !git(cwd, ["fetch", "origin", name], 90000).ok) return null;
  const n = Number(git(cwd, ["rev-list", "--count", `HEAD..origin/${name}`]).out);
  return { name, behind: Number.isFinite(n) ? n : 0 };
}

const changedFiles = (cwd: string, base: string) => (base ? lines(git(cwd, ["diff", "--name-only", base, "HEAD"]).out) : []);

const branchOf = (cwd: string) => git(cwd, ["branch", "--show-current"]).out;

export async function syncBase(c: Ctx): Promise<NodeResult> {
  const L = logger();
  let rebased = false;
  let behindBy = 0;
  const conflicts: string[] = [];
  const warnings: Refusal[] = [];
  for (const r of reposOf(c)) {
    if (!branchOf(r.cwd)) continue;
    const up = upstream(r.cwd);
    if (!up) {
      L.warn(`${r.name}: no reachable origin default branch — not synced`);
      continue;
    }
    behindBy = Math.max(behindBy, up.behind);
    if (up.behind) {
      const rb = git(r.cwd, ["rebase", `origin/${up.name}`], 120000);
      if (!rb.ok) {
        const files = lines(git(r.cwd, ["diff", "--name-only", "--diff-filter=U"]).out);
        git(r.cwd, ["rebase", "--abort"]);
        const why = files.length ? `conflicts in ${files.join(", ")}` : `failed: ${lines(rb.err)[0] ?? "no reason given"}`;
        conflicts.push(...(files.length ? files : ["(rebase failed)"]).map((f) => `${r.name}/${f}`));
        warnings.push({ source: "syncBase", file: `${r.name}/`, issue: `Rebase onto origin/${up.name} (${up.behind} commit(s) behind) ${why}` });
        L.warn(`${r.name}: rebase ${why} — aborted, left for the reviewer`);
        continue;
      }
      rebased = true;
      L.info(`${r.name}: rebased onto origin/${up.name} (was ${up.behind} behind)`);
    } else {
      L.info(`${r.name}: up to date with origin/${up.name}`);
    }
    const mb = git(r.cwd, ["merge-base", "HEAD", `origin/${up.name}`]);
    if (mb.ok && mb.out && mb.out !== r.base) {
      r.setBase(mb.out);
      L.info(`${r.name}: base is now ${mb.out.slice(0, 7)}`);
    }
  }
  return result({ rebased, behindBy, conflicts, warnings }, L.log);
}

function addedLines(repo: string, cwd: string, base: string): AddedLine[] {
  const diff = git(cwd, ["diff", "--unified=0", "--no-color", base, "HEAD"], 60000).out;
  const out: AddedLine[] = [];
  let file = "";
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) file = line.replace(/^\+\+\+ (b\/)?/, "");
    else if (line.startsWith("+") && file && file !== "/dev/null") out.push({ repo, path: file, line: line.slice(1) });
  }
  return out;
}

export async function diffGuard(c: Ctx): Promise<NodeResult> {
  const L = logger();
  const planned = plannedFiles(c);
  const files: ChangedFile[] = [];
  const added: AddedLine[] = [];
  const changed: { repo: string; branch: string; files: number }[] = [];
  const heads: Record<string, string> = {};
  for (const r of reposOf(c)) {
    heads[r.name] = git(r.cwd, ["rev-parse", "HEAD"]).out;
    if (!r.base) continue;
    const all = changedFiles(r.cwd, r.base);
    const own = all.filter((p) => !isScratch(p));
    if (own.length) changed.push({ repo: r.name, branch: branchOf(r.cwd), files: own.length });
    files.push(...all.map((p) => ({ repo: r.name, path: p })));
    added.push(...addedLines(r.name, r.cwd, r.base).filter((a) => !isScratch(a.path)));
  }
  const violations = diffViolations(files, added, planned);
  const warnings = violationWarnings(violations);
  L.info(`${files.length} changed file(s) checked against ${planned.length} planned file(s)`);
  violations.forEach((v) => L.warn(`${v.rule}: ${v.file}`));
  return result({ violations, warnings, changed, heads }, L.log);
}

export async function planCheck(c: Ctx): Promise<NodeResult> {
  const L = logger();
  const acs = Array.isArray(c.channels.readiness?.acceptanceCriteria) ? (c.channels.readiness.acceptanceCriteria as string[]) : [];
  const names = [rootName(c), ...c.companions.map((m) => m.name)];
  const issues = planIssues(acs, c.channels.plan ?? {}, names, existsSync(path.join(c.cwd, PLAN_FILE)));
  issues.forEach((i) => L.warn(i));
  if (!issues.length) L.info("plan maps every acceptance criterion to files and a test");
  return result({ passed: !issues.length, issues }, L.log);
}

export async function prePublish(c: Ctx): Promise<NodeResult> {
  const L = logger();
  const rows = Array.isArray(c.channels.diffGuard?.changed) ? (c.channels.diffGuard.changed as { repo: string; branch: string }[]) : [];
  const heads = (c.channels.diffGuard?.heads ?? {}) as Record<string, string>;
  const issues: string[] = [];
  let baseMoved = false;
  for (const r of reposOf(c)) {
    const row = rows.find((x) => x.repo === r.name);
    if (!row) continue;
    const dirty = lines(git(r.cwd, ["status", "--porcelain"]).out)
      .map((l) => l.replace(/^\S+\s+/, ""))
      .filter((p) => !isScratch(p));
    if (dirty.length) issues.push(`${r.name}: ${dirty.length} uncommitted change(s) in the worktree`);
    if (!row.branch) issues.push(`${r.name}: the commits are not on a branch`);
    else if (branchOf(r.cwd) !== row.branch) issues.push(`${r.name}: not on branch ${row.branch}`);
    if (git(r.cwd, ["rev-parse", "HEAD"]).out !== heads[r.name]) issues.push(`${r.name}: HEAD changed after it was verified`);
    // A review fix stays on the published PR branch; catching up with the default branch would need a force-push.
    if (c.flow === "review") continue;
    const up = upstream(r.cwd);
    if (up && up.behind) {
      baseMoved = true;
      issues.push(`${r.name}: origin/${up.name} moved ${up.behind} commit(s) ahead since the sync`);
    }
  }
  if (!rows.length) issues.push("nothing to publish — no repository has a committed change against its base");
  issues.forEach((i) => L.warn(i));
  if (!issues.length) L.info("branches clean, verified HEADs unchanged, base unchanged");
  return result({ passed: !issues.length, issues, baseMoved }, L.log);
}

type Pr = { repo: string; branch: string; pushed: boolean; prUrl: string; isDraft: boolean; linked: boolean };

export async function verifyPublish(c: Ctx): Promise<NodeResult> {
  const L = logger();
  const prs = Array.isArray(c.channels.publish?.prs) ? (c.channels.publish.prs as Pr[]) : [];
  const checks: { name: string; ok: boolean }[] = [];
  const repoCwd = (name: string) => reposOf(c).find((r) => r.name === name)?.cwd ?? "";
  for (const p of prs) {
    const cwd = repoCwd(p.repo);
    const local = cwd ? git(cwd, ["rev-parse", "HEAD"]).out : "";
    const remote = cwd ? git(cwd, ["ls-remote", "--heads", "origin", p.branch], 30000).out.split(/\s+/)[0] ?? "" : "";
    checks.push({ name: `${p.repo}: ${p.branch} on origin matches the verified HEAD`, ok: !!local && remote === local });
    checks.push({ name: `${p.repo}: pull request is a draft`, ok: p.isDraft });
    checks.push({ name: `${p.repo}: ${c.ticketId} linked`, ok: p.linked });
  }
  const provider = normalizeProvider(c.provider);
  const root = prs.find((p) => p.repo === rootName(c)) ?? prs[0];
  if (root?.prUrl && provider === "azure-devops") {
    const linked = await loadLinkedPullRequest(provider, c.ticketId, root.prUrl).catch(() => null);
    checks.push({ name: `tracker: ${c.ticketId} shows a linked pull request`, ok: !!linked });
    if (linked) checks.push({ name: "tracker: pull request is a draft", ok: linked.isDraft });
  } else if (root?.prUrl) {
    L.warn(`no tracker read-back for ${provider} — the publisher's own report is trusted for linking`);
  }
  checks.forEach((x) => (x.ok ? L.info(`✓ ${x.name}`) : L.warn(`✗ ${x.name}`)));
  return result({ passed: checks.length > 0 && checks.every((x) => x.ok), checks }, L.log);
}

export function deliveryFacts(c: Ctx): { commitSha: string; filesChanged: number } {
  const repos = reposOf(c);
  const filesChanged = repos.reduce((n, r) => n + changedFiles(r.cwd, r.base).filter((f) => !isScratch(f)).length, 0);
  return { commitSha: git(c.cwd, ["rev-parse", "--short", "HEAD"]).out, filesChanged };
}

export const CHECKS: Record<string, (c: Ctx, env: CheckEnv) => Promise<NodeResult>> = {
  setup,
  syncBase,
  diffGuard,
  planCheck,
  prePublish,
  verifyPublish,
};
