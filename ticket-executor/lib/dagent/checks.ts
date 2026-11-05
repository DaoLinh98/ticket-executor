import { execFile, execFileSync } from "child_process";
import { createHash } from "crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { promisify } from "util";
import { discoverCompanionRepos } from "../preflight";
import { loadLinkedPullRequest, loadPullRequestBranch, normalizeProvider } from "../tickets";
import { PLAN_FILE } from "./prompts";
import { acRows, basesOf, deliveryOf, diffViolations, HARD_RULES, isPlanned, isScratch, LOCAL_INSTRUCTIONS, planIssues, plannedFiles, scopeOf, violationRefusals, type AddedLine, type ChangedFile } from "./rules";
import { ZERO_USAGE, type Ctx, type LogEntry, type NodeResult, type Refusal, type Repo } from "./types";

/** `fresh`: a retry that starts over before any commit (from `plan`) — it starts from today's base, not the old one. */
export type RetrySeed = { baseSha: string; branches: Record<string, string>; companionBases: Record<string, string>; planMd: string; fresh?: boolean };

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

const execFileAsync = promisify(execFile);

// git() off the event loop, for the slow calls (fetch, worktree add): a sync call would freeze every request and live
// stream of the server for as long as the network takes.
async function gitAsync(cwd: string, args: string[], timeout = 30000): Promise<Git> {
  try {
    const p = execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout, windowsHide: true });
    p.child.stdin?.end();
    const { stdout } = await p;
    return { ok: true, out: String(stdout).trim(), err: "" };
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

async function applyIdentity(repo: string, env: CheckEnv) {
  if (env.gitName.trim()) await gitAsync(repo, ["config", "user.name", env.gitName]);
  if (env.gitEmail.trim()) await gitAsync(repo, ["config", "user.email", env.gitEmail]);
}

// Prunes first: a worktree left by a crashed run still holds its branch, and the retry that checks it out would fail.
async function addWorktree(repo: string, args: string[]): Promise<Git> {
  await gitAsync(repo, ["worktree", "prune"]);
  return gitAsync(repo, ["worktree", "add", ...args], 120000);
}

const worktreeArgs = (wt: string, branch: string, start: string) => (branch ? [wt, branch] : ["--detach", wt, start]);

type Start = { sha: string; from: string };

// Where a repo's work starts: origin's default branch, freshly fetched. When the fetch fails, the last fetched copy of
// it — stale but the right branch; never the local HEAD, which may be the developer's feature branch. Only a repo
// with no origin at all starts from its HEAD.
async function startPoint(repo: string, name: string, L: ReturnType<typeof logger>): Promise<Start> {
  if (!(await gitAsync(repo, ["remote", "get-url", "origin"])).ok) {
    const head = await gitAsync(repo, ["rev-parse", "HEAD"]);
    if (!head.ok || !head.out) return { sha: "", from: "" };
    L.warn(`${name}: has no origin remote — starting from the local HEAD ${head.out.slice(0, 7)}`);
    return { sha: head.out, from: "local HEAD" };
  }
  const up = await upstream(repo);
  const sha = up ? (await gitAsync(repo, ["rev-parse", `origin/${up.name}`])).out : "";
  if (up && sha) {
    L.info(`${name}: starting from origin/${up.name} @ ${sha.slice(0, 7)}`);
    return { sha, from: `origin/${up.name}` };
  }
  const branch = await defaultBranch(repo);
  const stale = branch ? await gitAsync(repo, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]) : null;
  if (stale?.ok && stale.out) {
    L.warn(`${name}: could not fetch origin/${branch} — starting from its last fetched copy @ ${stale.out.slice(0, 7)}, which may be behind`);
    return { sha: stale.out, from: `origin/${branch} (last fetched)` };
  }
  L.error(`${name}: origin's default branch is unreachable and was never fetched — no base to start from`);
  return { sha: "", from: "" };
}

// The setup warnings, shown on the node's output instead of only in its log.
const setupWarnings = (log: LogEntry[]) => log.filter((e) => e.lvl === "WARN").map((e) => e.text);

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
async function setupOnCompanionPrBranch(c: Ctx, L: ReturnType<typeof logger>, env: CheckEnv, owner: { name: string; path: string; note: string }, branch: string): Promise<NodeResult> {
  excludeRunFiles(owner.path);
  await applyIdentity(owner.path, env);
  const [fetched, start] = await Promise.all([gitAsync(owner.path, ["fetch", "origin", branch], 90000), startPoint(c.rootRepo, rootName(c), L)]);
  if (!fetched.ok) return failure(`Could not fetch origin/${branch} in ${owner.name}: ${fetched.err}`, L.log);
  if (!start.sha) return failure(`${rootName(c)} has no base to start from — see the log.`, L.log);
  const rootWt = worktreeOf(c.rootRepo, c.runId);
  const rootAdded = await addWorktree(c.rootRepo, worktreeArgs(rootWt, "", start.sha));
  if (!rootAdded.ok) return failure(`Could not create the worktree ${rootWt}: ${rootAdded.err}`, L.log);
  c.cwd = rootWt;
  c.baseSha = start.sha;
  const cwd = worktreeOf(owner.path, c.runId);
  const added = await addWorktree(owner.path, ["-B", branch, cwd, `origin/${branch}`]);
  if (!added.ok) return failure(`Could not check out ${branch} in the worktree ${cwd}: ${added.err}`, L.log);
  const head = git(cwd, ["rev-parse", "HEAD"]).out;
  c.companions = [{ name: owner.name, path: owner.path, cwd, baseSha: head, note: owner.note }];
  L.info(`worktree ${cwd} on ${branch} @ ${head.slice(0, 7)} — the pull request's head, in related repo ${owner.name}`);
  return result(
    {
      branch,
      baseSha: c.baseSha,
      prRepo: owner.name,
      scope: [owner.name],
      repos: [
        { name: rootName(c), path: rootWt, base: start.sha, from: start.from, branch: "" },
        { name: owner.name, path: cwd, base: head, from: "pull request head", branch },
      ],
      warnings: setupWarnings(L.log),
    },
    L.log,
  );
}

async function setupOnPrBranch(c: Ctx, L: ReturnType<typeof logger>, env: CheckEnv): Promise<NodeResult> {
  const { branch, repo } = await loadPullRequestBranch(normalizeProvider(c.provider), c.ticketId, c.prUrl).catch(() => ({ branch: "", repo: "" }));
  if (!branch) return failure(`Could not read the source branch of ${c.prUrl || "the pull request"} from ${c.provider}.`, L.log);
  const owner = repo && !hostsRepo(c.rootRepo, rootName(c), repo) ? discoverCompanionRepos(c.rootRepo).repos.find((m) => hostsRepo(m.path, m.name, repo)) : undefined;
  if (owner) return setupOnCompanionPrBranch(c, L, env, owner, branch);
  const fetched = await gitAsync(c.rootRepo, ["fetch", "origin", branch], 90000);
  if (!fetched.ok) return failure(`Could not fetch origin/${branch}${repo ? ` (the pull request is in repository "${repo}")` : ""}: ${fetched.err}`, L.log);
  const wt = worktreeOf(c.rootRepo, c.runId);
  const added = await addWorktree(c.rootRepo, ["-B", branch, wt, `origin/${branch}`]);
  if (!added.ok) return failure(`Could not check out ${branch} in the worktree ${wt}: ${added.err}`, L.log);
  c.cwd = wt;
  c.baseSha = git(wt, ["rev-parse", "HEAD"]).out;
  L.info(`worktree ${wt} on ${branch} @ ${c.baseSha.slice(0, 7)} — the pull request's head`);
  return result(
    { branch, baseSha: c.baseSha, repos: [{ name: rootName(c), path: wt, base: c.baseSha, from: "pull request head", branch }], warnings: setupWarnings(L.log) },
    L.log,
  );
}

type SetupRepo = { name: string; path: string; base: string; from: string; branch: string };

// One related repo's worktree, or null when it is not offered to the run. Its lines go to its own log so repos set up
// side by side still read in order.
async function setupCompanion(c: Ctx, env: CheckEnv, r: { name: string; path: string; note: string }, L: ReturnType<typeof logger>): Promise<{ repo: Repo; row: SetupRepo } | null> {
  excludeRunFiles(r.path);
  await applyIdentity(r.path, env);
  const seed = env.retry?.companionBases[r.name];
  const start = seed ? { sha: seed, from: "previous run's base" } : await startPoint(r.path, r.name, L);
  if (!start.sha) {
    L.warn(`${r.name} has no base to start from — not offered to this run`);
    return null;
  }
  const cwd = worktreeOf(r.path, c.runId);
  const branch = env.retry?.branches[r.name] ?? "";
  const ok = await addWorktree(r.path, worktreeArgs(cwd, branch, start.sha));
  if (!ok.ok) {
    L.warn(`${r.name}: could not create a worktree (${ok.err}) — not offered to this run`);
    return null;
  }
  L.info(`related repo ${r.name}: ${cwd} @ ${start.sha.slice(0, 7)}${r.note ? ` — ${r.note}` : ""}`);
  return { repo: { name: r.name, path: r.path, cwd, baseSha: start.sha, note: r.note }, row: { name: r.name, path: cwd, base: start.sha, from: start.from, branch } };
}

export async function setup(c: Ctx, env: CheckEnv): Promise<NodeResult> {
  const L = logger();
  const retry = env.retry;
  excludeRunFiles(c.rootRepo);
  await applyIdentity(c.rootRepo, env);
  if (c.flow === "review") return setupOnPrBranch(c, L, env);
  const start = retry?.baseSha ? { sha: retry.baseSha, from: "previous run's base" } : await startPoint(c.rootRepo, rootName(c), L);
  if (!start.sha) return failure(`${rootName(c)} has no base to start from — see the log.`, L.log);
  c.baseSha = start.sha;
  const rootBranch = retry?.branches[rootName(c)] ?? "";
  const wt = worktreeOf(c.rootRepo, c.runId);
  const added = await addWorktree(c.rootRepo, worktreeArgs(wt, rootBranch, c.baseSha));
  if (!added.ok) return failure(`Could not create the worktree ${wt}: ${added.err}`, L.log);
  c.cwd = wt;
  L.info(`worktree ${wt}${rootBranch ? ` on ${rootBranch}` : ` detached at ${c.baseSha.slice(0, 7)}`}`);
  if (retry?.planMd) {
    mkdirSync(path.join(wt, ".te"), { recursive: true });
    writeFileSync(path.join(wt, PLAN_FILE), retry.planMd, "utf8");
    L.info(`restored ${PLAN_FILE} from the previous run`);
  }

  const { repos: found, warnings } = discoverCompanionRepos(c.rootRepo);
  warnings.forEach((w) => L.warn(w));
  // A retry past the plan already knows the repos in scope (the kept plan channel): only those get a worktree.
  const scope = retry && !retry.fresh ? scopeOf(c).map((s) => s.toLowerCase()) : [];
  const repos = scope.length ? found.filter((r) => scope.includes(r.name.toLowerCase())) : found;
  if (repos.length < found.length) L.info(`${found.length - repos.length} related repo(s) outside the plan's scope — no worktree`);
  const logs = repos.map(() => logger());
  const set = await Promise.all(repos.map((r, i) => setupCompanion(c, env, r, logs[i])));
  logs.forEach((l) => L.log.push(...l.log));
  const ready = set.filter((m) => !!m);
  c.companions = ready.map((m) => m.repo);
  // A fresh retry starts from today's default branch; a skill's base the kept readiness chose is seated again on it.
  const seated = retry?.fresh ? String(c.channels.readiness?.baseBranch ?? "").trim() : "";
  if (seated) {
    const seat = await seatBase(c, seated);
    L.log.push(...seat.log);
    if (seat.error) return failure(seat.error, L.log);
    if (c.channels.readiness) c.channels.readiness.bases = seat.bases;
  }
  const rows: SetupRepo[] = [
    { name: rootName(c), path: wt, base: c.baseSha, from: seated ? `origin/${seated}` : start.from, branch: rootBranch },
    ...ready.map((m) => ({ ...m.row, base: m.repo.baseSha })),
  ];
  return result({ branch: rootBranch, baseSha: c.baseSha, repos: rows, warnings: setupWarnings(L.log) }, L.log);
}

/**
 * A recheck after the PO answered runs on a worktree set up when the run began — possibly days ago, and possibly
 * seated on a skill's base the recheck may no longer pick. Nothing is committed yet, so every repo still detached and
 * clean moves to today's origin default branch; readiness then seats a skill's base again if it picks one.
 */
export async function refreshBase(c: Ctx): Promise<LogEntry[]> {
  const L = logger();
  for (const r of reposOf(c)) {
    const dirty = lines(git(r.cwd, ["status", "--porcelain"]).out).filter((l) => !isScratch(l.replace(/^\S+\s+/, "")));
    if (branchOf(r.cwd) || dirty.length) {
      L.warn(`${r.name}: the worktree already carries work — kept on its base ${r.base.slice(0, 7)}`);
      continue;
    }
    const repoPath = r.root ? c.rootRepo : (c.companions.find((m) => m.name === r.name)?.path ?? "");
    const start = repoPath ? await startPoint(repoPath, r.name, L) : { sha: "", from: "" };
    if (!start.sha || start.sha === r.base) continue;
    const moved = await gitAsync(r.cwd, ["checkout", "--detach", start.sha]);
    if (!moved.ok) {
      L.warn(`${r.name}: could not move to ${start.from} (${moved.err}) — kept on ${r.base.slice(0, 7)}`);
      continue;
    }
    L.info(`${r.name}: base refreshed ${r.base.slice(0, 7)} → ${start.sha.slice(0, 7)} (${start.from})`);
    r.setBase(start.sha);
  }
  if (c.channels.readiness) delete c.channels.readiness.bases;
  return L.log;
}

type RepoRef = { name: string; cwd: string; base: string; baseBranch: string; root: boolean; setBase: (sha: string) => void };

function reposOf(c: Ctx): RepoRef[] {
  const bases = basesOf(c);
  return [
    { name: rootName(c), cwd: c.cwd, base: c.baseSha, baseBranch: bases[rootName(c)] ?? "", root: true, setBase: (s: string) => (c.baseSha = s) },
    ...c.companions.map((m) => ({ name: m.name, cwd: m.cwd, base: m.baseSha, baseBranch: bases[m.name] ?? "", root: false, setBase: (s: string) => (m.baseSha = s) })),
  ];
}

async function defaultBranch(cwd: string): Promise<string> {
  const ref = await gitAsync(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (ref.ok && ref.out) return ref.out.replace(/^origin\//, "");
  for (const name of ["main", "master"]) if ((await gitAsync(cwd, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`])).ok) return name;
  return "";
}

// The branch a repo's work sits on: the one a picked skill seated it on, else origin's default. Never falls back from
// the first to the second — a work branch rebased onto the default would carry the wrong base into its pull request.
async function upstream(cwd: string, baseBranch = ""): Promise<{ name: string; behind: number } | null> {
  if (!(await gitAsync(cwd, ["remote", "get-url", "origin"])).ok) return null;
  const name = baseBranch || (await defaultBranch(cwd));
  if (!name || !(await gitAsync(cwd, ["fetch", "origin", name], 90000)).ok) return null;
  const n = Number((await gitAsync(cwd, ["rev-list", "--count", `HEAD..origin/${name}`])).out);
  return { name, behind: Number.isFinite(n) ? n : 0 };
}

const changedFiles = (cwd: string, base: string) => (base ? lines(git(cwd, ["diff", "--name-only", base, "HEAD"]).out) : []);

const branchOf = (cwd: string) => git(cwd, ["branch", "--show-current"]).out;

/**
 * Moves every repo of the run that has `origin/<branch>` onto it, before any work is committed, because a picked
 * skill requires the work to start there. Repos without it stay on their default branch; none having it fails.
 */
export async function seatBase(c: Ctx, branch: string): Promise<{ error: string; bases: Record<string, string>; log: LogEntry[] }> {
  const L = logger();
  const bases: Record<string, string> = {};
  if (!git(c.rootRepo, ["check-ref-format", "--branch", branch]).ok || branch.startsWith("-")) {
    return { error: `"${branch}" is not a valid branch name.`, bases, log: L.log };
  }
  for (const r of reposOf(c)) {
    if (!(await gitAsync(r.cwd, ["ls-remote", "--exit-code", "--heads", "origin", branch], 30000)).ok) {
      L.info(`${r.name}: no origin/${branch} — stays on its default branch`);
      continue;
    }
    const fetched = await gitAsync(r.cwd, ["fetch", "origin", branch], 90000);
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

export type SyncRow = { name: string; upstream: string; behind: number; status: "up to date" | "rebased" | "conflict" | "not synced"; base: string };

export async function syncBase(c: Ctx): Promise<NodeResult> {
  const L = logger();
  let rebased = false;
  let behindBy = 0;
  const conflicts: string[] = [];
  const warnings: Refusal[] = [];
  // A conflict goes to the fixer, which can write: the reviewer can only read, so handing it one only spends a review.
  const blockers: Refusal[] = [];
  const repos: SyncRow[] = [];
  for (const r of reposOf(c)) {
    if (!branchOf(r.cwd)) continue;
    const up = await upstream(r.cwd, r.baseBranch);
    if (!up) {
      const name = `origin/${r.baseBranch || "<default branch>"}`;
      L.warn(`${r.name}: no reachable ${name} — not synced`);
      warnings.push({ source: "syncBase", file: `${r.name}/`, issue: `Not synced: ${name} could not be fetched, so this branch may be behind its base.` });
      repos.push({ name: r.name, upstream: name, behind: 0, status: "not synced", base: r.base.slice(0, 7) });
      continue;
    }
    behindBy = Math.max(behindBy, up.behind);
    let status: SyncRow["status"] = "up to date";
    if (up.behind) {
      const rb = await gitAsync(r.cwd, ["rebase", `origin/${up.name}`], 120000);
      if (!rb.ok) {
        const files = lines((await gitAsync(r.cwd, ["diff", "--name-only", "--diff-filter=U"])).out);
        await gitAsync(r.cwd, ["rebase", "--abort"]);
        const why = files.length ? `conflicts in ${files.join(", ")}` : `failed: ${lines(rb.err)[0] ?? "no reason given"}`;
        conflicts.push(...(files.length ? files : ["(rebase failed)"]).map((f) => `${r.name}/${f}`));
        blockers.push({
          source: "syncBase",
          file: `${r.name}/`,
          issue: `Rebase onto origin/${up.name} (${up.behind} commit(s) behind) ${why}.`,
          evidence: `git rebase origin/${up.name} in ${r.cwd} stopped and was aborted; the branch is unchanged.`,
          expected:
            `This branch rebased onto origin/${up.name} (rebase, not merge) with each conflict resolved to keep both the base's change and this one; ` +
            "the change still builds and its tests pass.",
        });
        L.warn(`${r.name}: rebase ${why} — aborted, handed to the fixer`);
        repos.push({ name: r.name, upstream: `origin/${up.name}`, behind: up.behind, status: "conflict", base: r.base.slice(0, 7) });
        continue;
      }
      rebased = true;
      status = "rebased";
      L.info(`${r.name}: rebased onto origin/${up.name} (was ${up.behind} behind)`);
    } else {
      L.info(`${r.name}: up to date with origin/${up.name}`);
    }
    const mb = await gitAsync(r.cwd, ["merge-base", "HEAD", `origin/${up.name}`]);
    if (mb.ok && mb.out && mb.out !== r.base) {
      r.setBase(mb.out);
      L.info(`${r.name}: base is now ${mb.out.slice(0, 7)}`);
    }
    repos.push({ name: r.name, upstream: `origin/${up.name}`, behind: up.behind, status, base: r.base.slice(0, 7) });
  }
  return result({ rebased, behindBy, conflicts, warnings, blockers, repos }, L.log);
}

// Every line the branch's own commits added, commit by commit — not just the net diff, because a later commit that
// deletes a secret still pushes the commit that added it.
async function addedLines(repo: string, cwd: string, base: string): Promise<AddedLine[]> {
  const log = (await gitAsync(cwd, ["log", "--format=", "-p", "--unified=0", "--no-color", `${base}..HEAD`], 60000)).out;
  const out: AddedLine[] = [];
  let file = "";
  for (const line of log.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) file = line.replace(/^\+\+\+ (b\/)?/, "");
    else if (line.startsWith("+") && file && file !== "/dev/null") out.push({ repo, path: file, line: line.slice(1) });
  }
  return out;
}

// Every file any of the branch's own commits touched, for the same reason.
const committedFiles = async (cwd: string, base: string) => lines((await gitAsync(cwd, ["log", "--format=", "--name-only", `${base}..HEAD`])).out);

export async function diffGuard(c: Ctx): Promise<NodeResult> {
  const L = logger();
  const planned = plannedFiles(c);
  const files: ChangedFile[] = [];
  const added: AddedLine[] = [];
  const changed: { repo: string; branch: string; files: number }[] = [];
  const unplanned: string[] = [];
  const heads: Record<string, string> = {};
  // A hash of each repo's own change (the net diff against its base): equal to what a passing review judged means a
  // re-sync moved only the base, and that review still holds.
  const diffHashes: Record<string, string> = {};
  for (const r of reposOf(c)) {
    heads[r.name] = git(r.cwd, ["rev-parse", "HEAD"]).out;
    if (!r.base) continue;
    const patch = (await gitAsync(r.cwd, ["diff", "--no-color", r.base, "HEAD", "--", ".", ":(exclude).te"], 60000)).out;
    if (patch) diffHashes[r.name] = createHash("sha1").update(patch).digest("hex");
    const net = changedFiles(r.cwd, r.base);
    const own = net.filter((p) => !isScratch(p));
    if (own.length) changed.push({ repo: r.name, branch: branchOf(r.cwd), files: own.length });
    unplanned.push(...own.filter((p) => !isPlanned({ repo: r.name, path: p }, planned)).map((p) => `${r.name}/${p}`));
    const all = [...new Set([...net, ...(await committedFiles(r.cwd, r.base))])];
    files.push(...all.map((p) => ({ repo: r.name, path: p })));
    added.push(...(await addedLines(r.name, r.cwd, r.base)).filter((a) => !isScratch(a.path)));
  }
  const violations = diffViolations(files, added, planned);
  const { blockers, warnings } = violationRefusals(violations);
  L.info(`${files.length} committed file(s) checked against ${planned.length} planned file(s)`);
  violations.forEach((v) => (HARD_RULES.has(v.rule) ? L.warn(`${v.rule}: ${v.file} — blocks, handed to the fixer`) : L.warn(`${v.rule}: ${v.file}`)));
  const summary = { changed: changed.reduce((n, x) => n + x.files, 0), planned: new Set(planned).size, unplanned };
  return result({ violations, warnings, blockers, changed, heads, summary, diffHashes }, L.log);
}

export async function planCheck(c: Ctx): Promise<NodeResult> {
  const L = logger();
  const acs = Array.isArray(c.channels.readiness?.acceptanceCriteria) ? (c.channels.readiness.acceptanceCriteria as string[]) : [];
  const names = [rootName(c), ...c.companions.map((m) => m.name)];
  const delivered = deliveryOf(c).evidence.map((e) => e.ac);
  const issues = planIssues(acs, c.channels.plan ?? {}, names, delivered);
  issues.forEach((i) => L.warn(i));
  if (!issues.length) L.info("plan maps every acceptance criterion to files and a test");
  // What was checked, so a pass reads as more than "OK".
  const rows = acRows(c.channels.plan);
  const checked = {
    criteria: acs.length,
    mapped: new Set(rows.map((a) => a.n)).size,
    code: rows.filter((a) => a.change !== "none").length,
    none: rows.filter((a) => a.change === "none").length,
    files: new Set(plannedFiles(c)).size,
    repos: Array.isArray(c.channels.plan?.repos) ? (c.channels.plan.repos as string[]) : [],
  };
  return result({ passed: !issues.length, issues, checked }, L.log);
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
    const up = await upstream(r.cwd, r.baseBranch);
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
    // A skill's base, else the default branch: a PR into the wrong branch is a mismatch, not a success.
    const expected = basesOf(c)[rootName(c)] || (await defaultBranch(c.cwd));
    const target = (linked?.targetRefName ?? "").replace(/^refs\/heads\//, "");
    if (linked && expected && target) checks.push({ name: `tracker: pull request targets ${expected}`, ok: target === expected });
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
