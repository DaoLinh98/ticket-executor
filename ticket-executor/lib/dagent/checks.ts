import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { discoverCompanionRepos } from "../preflight";
import { loadLinkedPullRequest, loadPullRequestBranch, normalizeProvider } from "../tickets";
import { PLAN_FILE } from "./prompts";
import { basesOf, diffViolations, isScratch, LOCAL_INSTRUCTIONS, planIssues, plannedFiles, scopeOf, violationWarnings, type AddedLine, type ChangedFile } from "./rules";
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

const repoKey = (s: string) => {
  let v = s;
  try {
    v = decodeURIComponent(s);
  } catch {}
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
};

// Whether a local clone is the provider repository `repo` — by folder name or by origin's last URL segment,
// ignoring case, spaces and punctuation ("Reporting Service" is cloned as ReportingService).
function hostsRepo(repoPath: string, name: string, repo: string): boolean {
  const want = repoKey(repo);
  if (repoKey(name) === want) return true;
  const url = git(repoPath, ["remote", "get-url", "origin"]).out.replace(/\/+$/, "").replace(/\.git$/, "");
  const last = url.split(/[/:]/).pop() ?? "";
  return !!last && repoKey(last) === want;
}

// The pull request lives in a related repo: check its branch out there, and give the Root repo a plain worktree so
// the run still has a working directory that is not the developer's own checkout.
function setupOnCompanionPrBranch(c: Ctx, L: ReturnType<typeof logger>, env: CheckEnv, owner: { name: string; path: string; note: string }, branch: string): NodeResult {
  excludeRunFiles(owner.path);
  applyIdentity(owner.path, env);
  const fetched = git(owner.path, ["fetch", "origin", branch], 90000);
  if (!fetched.ok) return failure(`Could not fetch origin/${branch} in ${owner.name}: ${fetched.err}`, L.log);
  const start = startPoint(c.rootRepo, rootName(c), L);
  if (!start) return failure(`${c.rootRepo} has no commit to start from.`, L.log);
  const rootWt = worktreeOf(c.rootRepo, c.runId);
  const rootAdded = addWorktree(c.rootRepo, rootWt, "", start);
  if (!rootAdded.ok) return failure(`Could not create the worktree ${rootWt}: ${rootAdded.err}`, L.log);
  c.cwd = rootWt;
  c.baseSha = start;
  const cwd = worktreeOf(owner.path, c.runId);
  const added = git(owner.path, ["worktree", "add", "-B", branch, cwd, `origin/${branch}`]);
  if (!added.ok) return failure(`Could not check out ${branch} in the worktree ${cwd}: ${added.err}`, L.log);
  const head = git(cwd, ["rev-parse", "HEAD"]).out;
  c.companions = [{ name: owner.name, path: owner.path, cwd, baseSha: head, note: owner.note }];
  L.info(`worktree ${cwd} on ${branch} @ ${head.slice(0, 7)} — the pull request's head, in related repo ${owner.name}`);
  return result(
    {
      mode: "worktree",
      branch,
      baseSha: c.baseSha,
      prRepo: owner.name,
      scope: [owner.name],
      repos: [{ name: rootName(c), path: rootWt }, { name: owner.name, path: cwd }],
    },
    L.log,
  );
}

async function setupOnPrBranch(c: Ctx, L: ReturnType<typeof logger>, env: CheckEnv): Promise<NodeResult> {
  const { branch, repo } = await loadPullRequestBranch(normalizeProvider(c.provider), c.ticketId, c.prUrl).catch(() => ({ branch: "", repo: "" }));
  if (!branch) return failure(`Could not read the source branch of ${c.prUrl || "the pull request"} from ${c.provider}.`, L.log);
  const owner = repo && !hostsRepo(c.rootRepo, rootName(c), repo) ? discoverCompanionRepos(c.rootRepo).repos.find((m) => hostsRepo(m.path, m.name, repo)) : undefined;
  if (owner) return setupOnCompanionPrBranch(c, L, env, owner, branch);
  const fetched = git(c.rootRepo, ["fetch", "origin", branch], 90000);
  if (!fetched.ok) return failure(`Could not fetch origin/${branch}${repo ? ` (the pull request is in repository "${repo}")` : ""}: ${fetched.err}`, L.log);
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
  if (c.flow === "review") return setupOnPrBranch(c, L, env);
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

type RepoRef = { name: string; cwd: string; base: string; baseBranch: string; root: boolean; setBase: (sha: string) => void };

function reposOf(c: Ctx): RepoRef[] {
  const bases = basesOf(c);
  return [
    { name: rootName(c), cwd: c.cwd, base: c.baseSha, baseBranch: bases[rootName(c)] ?? "", root: true, setBase: (s: string) => (c.baseSha = s) },
    ...c.companions.map((m) => ({ name: m.name, cwd: m.cwd, base: m.baseSha, baseBranch: bases[m.name] ?? "", root: false, setBase: (s: string) => (m.baseSha = s) })),
  ];
}

function defaultBranch(cwd: string): string {
  const ref = git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (ref.ok && ref.out) return ref.out.replace(/^origin\//, "");
  for (const name of ["main", "master"]) if (git(cwd, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`]).ok) return name;
  return "";
}

// The branch a repo's work sits on: the one a picked skill seated it on, else origin's default. Never falls back from
// the first to the second — a work branch rebased onto the default would carry the wrong base into its pull request.
function upstream(cwd: string, baseBranch = ""): { name: string; behind: number } | null {
  if (!git(cwd, ["remote", "get-url", "origin"]).ok) return null;
  const name = baseBranch || defaultBranch(cwd);
  if (!name || !git(cwd, ["fetch", "origin", name], 90000).ok) return null;
  const n = Number(git(cwd, ["rev-list", "--count", `HEAD..origin/${name}`]).out);
  return { name, behind: Number.isFinite(n) ? n : 0 };
}

const changedFiles = (cwd: string, base: string) => (base ? lines(git(cwd, ["diff", "--name-only", base, "HEAD"]).out) : []);

const branchOf = (cwd: string) => git(cwd, ["branch", "--show-current"]).out;

/**
 * Moves every repo of the run that has `origin/<branch>` onto it, before any work is committed, because a picked
 * skill requires the work to start there. Repos without it stay on their default branch; none having it fails.
 */
export function seatBase(c: Ctx, branch: string): { error: string; bases: Record<string, string>; log: LogEntry[] } {
  const L = logger();
  const bases: Record<string, string> = {};
  if (!git(c.rootRepo, ["check-ref-format", "--branch", branch]).ok || branch.startsWith("-")) {
    return { error: `"${branch}" is not a valid branch name.`, bases, log: L.log };
  }
  for (const r of reposOf(c)) {
    if (!git(r.cwd, ["ls-remote", "--exit-code", "--heads", "origin", branch], 30000).ok) {
      L.info(`${r.name}: no origin/${branch} — stays on its default branch`);
      continue;
    }
    const fetched = git(r.cwd, ["fetch", "origin", branch], 90000);
    if (!fetched.ok) return { error: `${r.name}: could not fetch origin/${branch}: ${fetched.err}`, bases, log: L.log };
    const dirty = lines(git(r.cwd, ["status", "--porcelain"]).out).map((l) => l.replace(/^\S+\s+/, "")).filter((p) => !isScratch(p));
    if (branchOf(r.cwd) || dirty.length) return { error: `${r.name}: the worktree already carries work — cannot move it onto origin/${branch}.`, bases, log: L.log };
    const sha = git(r.cwd, ["rev-parse", `origin/${branch}`]).out;
    const moved = git(r.cwd, ["checkout", "--detach", sha]);
    if (!sha || !moved.ok) return { error: `${r.name}: could not check out origin/${branch}: ${moved.err}`, bases, log: L.log };
    r.setBase(sha);
    bases[r.name] = branch;
    L.info(`${r.name}: base is origin/${branch} @ ${sha.slice(0, 7)} — required by a picked skill`);
  }
  if (!Object.keys(bases).length) return { error: `A picked skill requires the base branch ${branch}, but no repository of this run has origin/${branch}.`, bases, log: L.log };
  return { error: "", bases, log: L.log };
}

export async function syncBase(c: Ctx): Promise<NodeResult> {
  const L = logger();
  let rebased = false;
  let behindBy = 0;
  const conflicts: string[] = [];
  const warnings: Refusal[] = [];
  for (const r of reposOf(c)) {
    if (!branchOf(r.cwd)) continue;
    const up = upstream(r.cwd, r.baseBranch);
    if (!up) {
      L.warn(`${r.name}: no reachable origin/${r.baseBranch || "<default branch>"} — not synced`);
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
    const up = upstream(r.cwd, r.baseBranch);
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

export function deliveryFacts(c: Ctx): { commitSha: string; filesChanged: number; uncommitted: number } {
  const repos = reposOf(c);
  const filesChanged = repos.reduce((n, r) => n + changedFiles(r.cwd, r.base).filter((f) => !isScratch(f)).length, 0);
  const uncommitted = repos.reduce(
    (n, r) => n + lines(git(r.cwd, ["status", "--porcelain"]).out).map((l) => l.replace(/^\S+\s+/, "")).filter((p) => !isScratch(p)).length,
    0,
  );
  return { commitSha: git(c.cwd, ["rev-parse", "--short", "HEAD"]).out, filesChanged, uncommitted };
}

export const CHECKS: Record<string, (c: Ctx, env: CheckEnv) => Promise<NodeResult>> = {
  setup,
  syncBase,
  diffGuard,
  planCheck,
  prePublish,
  verifyPublish,
};
