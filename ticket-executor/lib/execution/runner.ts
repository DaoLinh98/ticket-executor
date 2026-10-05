import { execSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { prisma } from "../prisma";
import { resolveCredential } from "../providerCredentials";
import type { LogLine, RunState } from "../types";
import { admissionDenial } from "./admission";
import { cleanPath } from "./format";
import { bankParkedTime, cancel, drive, finish, resolveGate, type GateAction } from "./graph/drive";
import { clearRunArtifacts, FEEDBACK_FILE, graphById, graphForSkill, isReviewSkill, KNOWN_SKILLS, PLAN_FILE, QA_FIX_SKILL, resolveSkill } from "./graph/graphs";
import { loadKnowledge } from "./knowledgeStore";
import { REVIEW_SKILL } from "./graph/prompts";
import { latestArtifact, saveArtifact, saveRun } from "./graph/persist";
import type { LiveRun } from "./graph/types";
import { findSkill } from "../skillPack";
import { store } from "./store";

export type { GateAction };

// ---- repo hygiene ----

/** Instruction files a run reads but git will not carry into a worktree.
 *
 *  `git worktree add` materialises tracked files only. A repo that keeps its
 *  CLAUDE.md / KNOWLEDGE.md untracked or gitignored — which is the normal case for
 *  a client repo nobody wants agent files committed into — hands an isolated run
 *  an empty tree of guidance, and the agent rediscovers the layout from scratch
 *  every time. Copying is best-effort and never overwrites: a file the worktree
 *  already has is the tracked one, which wins.
 *
 *  Only isolated runs need this. A single-ticket run executes in rootRepo itself
 *  and already sees every one of these files.
 */
const CONTEXT_FILES = ["CLAUDE.md", "AGENTS.md", "KNOWLEDGE.md", path.join(".claude", "CLAUDE.md")];

function carryRepoContext(rootRepo: string, worktree: string): string[] {
  const copied: string[] = [];
  for (const rel of CONTEXT_FILES) {
    try {
      const src = path.join(rootRepo, rel);
      const dst = path.join(worktree, rel);
      if (!existsSync(src) || existsSync(dst)) continue;
      mkdirSync(path.dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      copied.push(rel);
    } catch {
      /* one unreadable file costs the run some tokens, it does not stop it */
    }
  }
  return copied;
}


/** The branch a new ticket's work should start from.
 *
 *  `origin/HEAD` is the remote's own answer and the only one that is right for a
 *  repo whose default is not called `main`. The local fallbacks are for a clone
 *  that never had the symbolic ref set. */
function defaultBranchOf(rootRepo: string): string {
  try {
    const ref = execSync(`git -C "${rootRepo}" symbolic-ref --short refs/remotes/origin/HEAD`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const name = ref.replace(/^origin\//, "");
    if (name) return name;
  } catch {
    /* no origin/HEAD — fall through to the local names below */
  }
  for (const name of ["main", "master"]) {
    try {
      execSync(`git -C "${rootRepo}" rev-parse --verify --quiet "refs/heads/${name}"`, { stdio: "ignore" });
      return name;
    } catch {
      /* not this one */
    }
  }
  return "";
}

/**
 * Put rootRepo back on its default branch before a single-ticket run starts.
 *
 * Without this the tree is still on the *previous* ticket's branch when the next
 * run begins, so the new branch is cut from that tip and its pull request
 * carries the earlier ticket's commits. Worktree mode never had the problem —
 * every run gets a tree detached at HEAD of its own — which is exactly why the
 * gap only shows up when multi-ticket mode is off.
 *
 * Nothing here is forced. No `-f`, no stash, no reset: a checkout that would
 * overwrite the developer's own uncommitted work is refused by git, and that
 * refusal is reported as a failed run rather than worked around. Untracked and
 * ignored files — which is what CLAUDE.md / KNOWLEDGE.md / .claude are in a
 * client repo — are untouched by a checkout, so the run keeps its guidance.
 *
 * The fast-forward pull is best-effort: a stale base costs a rebase later, a
 * network failure must not cost the run.
 */
function returnToDefaultBranch(rootRepo: string): { ok: boolean; detail: string } {
  const branch = defaultBranchOf(rootRepo);
  if (!branch) return { ok: true, detail: "No default branch could be identified — left the tree as it was." };

  let current = "";
  try {
    current = execSync(`git -C "${rootRepo}" rev-parse --abbrev-ref HEAD`).toString().trim();
  } catch {
    return { ok: true, detail: "Not a git repository — nothing to reset." };
  }

  if (current !== branch) {
    try {
      execSync(`git -C "${rootRepo}" checkout "${branch}"`, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        detail:
          `Could not switch ${rootRepo} from "${current}" to "${branch}": ${msg}\n` +
          `Your uncommitted changes would have been overwritten, so nothing was touched. ` +
          `Commit, stash or revert them and start the run again.`,
      };
    }
  }

  let pulled = "";
  try {
    execSync(`git -C "${rootRepo}" pull --ff-only`, { stdio: ["ignore", "ignore", "pipe"] });
    pulled = ", up to date with origin";
  } catch {
    pulled = ", could not fast-forward from origin — using the local tip";
  }
  return { ok: true, detail: `Base branch "${branch}"${pulled}` };
}

// The run writes two things into the developer's repo that must never reach a
// commit: the plan-gate contract (`.te/`) and the isolated worktrees
// (`.te-worktrees/`). Ignoring them is done here rather than left to the skill:
// an agent that forgets commits the plan, and a stale worktree left by a crashed
// run would otherwise show up as untracked noise in every later diff.
// `.git/info/exclude` (not `.gitignore`) because that file is the project's own
// tracked file — the app has no business editing it.
const TE_EXCLUDES = ["/.te/", "/.te-worktrees/"];

function excludeTeArtifacts(rootRepo: string) {
  try {
    const common = execSync(`git -C "${rootRepo}" rev-parse --path-format=absolute --git-common-dir`)
      .toString()
      .trim();
    if (!common) return;
    const file = path.join(common, "info", "exclude");
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    const lines = current.split(/\r?\n/).map((l) => l.trim());
    const missing = TE_EXCLUDES.filter((p) => !lines.includes(p));
    if (!missing.length) return;
    mkdirSync(path.dirname(file), { recursive: true });
    const prefix = current && !current.endsWith("\n") ? "\n" : "";
    writeFileSync(file, `${current}${prefix}# Ticket Executor run artifacts\n${missing.join("\n")}\n`, "utf8");
  } catch {
    /* not a git repo, or read-only .git — the skill's own exclude rule still applies */
  }
}

/**
 * Stamp the configured git author onto this checkout.
 *
 * Needed because the app executes inside a container, where there is no
 * developer's `~/.gitconfig` to inherit: without an author, `git commit` fails
 * outright at the first implementing node — after the plan has been written and
 * paid for. Failing there is the worst possible place for a two-line
 * configuration problem to surface.
 *
 * Written as **local** config on the checkout rather than globally, so a
 * container serving more than one account never has one run's author leak into
 * another's commit. Empty settings write nothing at all, which is the right
 * answer when the app is running on a developer's own machine: their git
 * identity is already correct and overwriting it would be worse than useless.
 *
 * Best effort. A run whose author cannot be set is a run that may still succeed
 * (the repo may already carry one), and refusing to start on that would block
 * the machine-local case this deliberately leaves alone.
 */
function applyGitIdentity(rootRepo: string, name: string, email: string) {
  for (const [k, v] of [["user.name", name], ["user.email", email]] as const) {
    if (!v.trim()) continue;
    try {
      execSync(`git -C "${rootRepo}" config ${k} "${v.replace(/"/g, '\\"')}"`, { stdio: "ignore" });
    } catch {
      /* read-only .git, or not a repo — validateRootRepo already ruled on that */
    }
  }
}

function writeWorktreeFile(cwd: string, rel: string, body: string) {
  mkdirSync(path.join(cwd, path.dirname(rel)), { recursive: true });
  writeFileSync(path.join(cwd, rel), body, "utf8");
}

// ---- start ----

/** A run may not start. Thrown inside the admission transaction so the whole
 *  check-and-create is rolled back as one, and mapped to an HTTP status by the
 *  route. `blocked` is the BlockedAttempt reason it is recorded under. */
class AdmissionError extends Error {
  constructor(message: string, readonly status: number, readonly blocked: string) {
    super(message);
  }
}

/** A run occupying a slot: computing, or parked waiting on a human. Both are
 *  "in flight" — a parked run still owns its worktree and its branch. */
const ACTIVE_STATES = ["running", "waiting"];

/** A run actually computing: it holds a child process and is spending money.
 *  This — not ACTIVE_STATES — is what the concurrency cap counts, because the cap
 *  bounds machine load. A run parked at a gate costs nothing while it waits, and
 *  counting it would let two unanswered plan reviews block the whole queue. */
const COMPUTING_STATES = ["running"];

export type StartRunInput = {
  ticketId: string;
  ticketUrl?: string;
  /** What the caller asked for. The *engine* decides the skill actually run —
   *  see resolveSkill(); the caller only picks the family. */
  requestedSkill: string;
  /** True only when this ticket carries a hand-picked skill on its Overview tab.
   *  A quick-action button choosing a skill is not "explicit": that choice is
   *  itself derived from the settings, and re-pinning it here would let the
   *  client smuggle a graph shape past resolveSkill(). */
  skillExplicit?: boolean;
  project: string;
  rootRepo: string;
  prUrl?: string;
  provider?: string;
  model?: string;
  effort?: string;
  /** The provider's own hour estimate for the ticket, if it has one. */
  estimateHours?: number;
  /** Fallback sizing, converted with Setting.hoursPerStoryPoint. */
  storyPoints?: number;
};

export type StartRunResult =
  | { ok: true; runId: string }
  | { ok: false; error: string; status: number; blocked: string };

/**
 * Admission control for a run. This lives here, not in the API route, on
 * purpose: the shape of a run (which graph, isolated or not) and whether a run
 * may start at all are engine decisions. A route that re-implemented them would
 * be a second place to keep in sync, and the one that got it wrong would be the
 * one that let two runs write to the same working tree.
 */
export async function startRun(params: StartRunInput): Promise<StartRunResult> {
  const ticketId = cleanPath(params.ticketId);
  const project = cleanPath(params.project);
  const rootRepo = cleanPath(params.rootRepo);
  const provider = cleanPath(params.provider || "azure-devops");

  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  // The organization this run authenticates against, snapshotted onto the row:
  // switching the active connection later must not re-attribute past runs.
  const { org } = await resolveCredential(provider);

  const skill = resolveSkill(cleanPath(params.requestedSkill), !!params.skillExplicit, {
    autoImplement: setting?.autoImplement ?? true,
    autoResolveCodeReview: setting?.autoResolveCodeReview ?? true,
  });
  if (!skill) {
    return {
      ok: false,
      status: 400,
      blocked: "unknown-skill",
      error: `Unknown skill "${params.requestedSkill}". Known skills: ${KNOWN_SKILLS.join(", ")}.`,
    };
  }

  // true → isolate in a private git worktree so runs can overlap. false
  // (single-ticket mode) → execute directly in rootRepo, which is only safe
  // because the admission check below guarantees nothing else is in flight.
  const isolate = setting?.multiTicketMode ?? true;
  // The evaluator changes the graph's shape, so it is resolved here (server-side,
  // from the stored setting) and baked into graphId — a run parked at the gate
  // must finish on the shape it started on even if the switch is flipped while it
  // waits.
  const evaluate = setting?.evaluateBeforePublish ?? false;
  const graph = graphForSkill(skill, { evaluate });

  // The evaluate node invokes a skill, so it can only run if that skill is on the
  // machine. Refuse here rather than letting the run reach the node and hand the
  // CLI an unknown slash command — by then the plan has been written, a human has
  // approved it and the code is committed, which is an expensive place to
  // discover a missing file.
  if (skill === QA_FIX_SKILL && !findSkill(QA_FIX_SKILL)) {
    return {
      ok: false,
      status: 400,
      blocked: "missing-skill",
      error: `The ${QA_FIX_SKILL} skill is not installed. Install it from the Guide or the System Check page.`,
    };
  }
  if (skill === QA_FIX_SKILL && !findSkill(REVIEW_SKILL)) {
    return {
      ok: false,
      status: 400,
      blocked: "missing-skill",
      error: `The QA fix run reviews its change with ${REVIEW_SKILL}, which is not installed. Install it from the Guide or the System Check page.`,
    };
  }
  if (evaluate && !findSkill(REVIEW_SKILL)) {
    return {
      ok: false,
      status: 400,
      blocked: "missing-skill",
      error:
        `"Review before publishing" is on, but the ${REVIEW_SKILL} skill is not installed. ` +
        `Install it from the Guide or the System Check page, or turn the setting off.`,
    };
  }

  // Prefer the provider's own hours; fall back to converting story points.
  // Snapshotted onto the run so a later re-estimate cannot rewrite history.
  const rawHours = Number(params.estimateHours);
  const rawPoints = Number(params.storyPoints);
  const estimateHours =
    Number.isFinite(rawHours) && rawHours > 0
      ? rawHours
      : Number.isFinite(rawPoints) && rawPoints > 0
        ? rawPoints * (setting?.hoursPerStoryPoint ?? 6)
        : 0;

  let row;
  try {
    row = await prisma.$transaction(async (tx) => {
      // Serialise every admission decision. Without this the check below and the
      // insert under it are two statements with a gap in between, and two POSTs
      // arriving together both read "nothing active" and both start — in
      // single-ticket mode that means two agents committing into the same
      // working tree, which is the exact failure worktree isolation exists to
      // prevent. Starting a run is a rare, human-triggered action, so
      // serialising costs nothing measurable.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ticket-executor:admission'))`;

      // Read the facts, then let the pure rule judge them (see admissionDenial).
      // The pause is re-read here rather than taken from the `setting` above: it
      // is the one admission fact another *run* writes, at the moment its quota
      // ran out, and the row read before the lock can already be stale.
      const [dup, other, runningOthers, paused] = await Promise.all([
        tx.run.findFirst({ where: { ticketId, state: { in: ACTIVE_STATES } }, select: { id: true } }),
        tx.run.findFirst({
          where: { ticketId: { not: ticketId }, state: { in: ACTIVE_STATES } },
          select: { ticketId: true },
        }),
        tx.run.count({ where: { ticketId: { not: ticketId }, state: { in: COMPUTING_STATES } } }),
        tx.setting.findUnique({ where: { id: "default" }, select: { agentPausedUntil: true } }),
      ]);
      const denial = admissionDenial({
        ticketId,
        duplicate: !!dup,
        otherTicketId: other?.ticketId ?? "",
        runningOthers,
        isolate,
        cap: setting?.concurrentRuns ?? 2,
        pausedUntil: paused?.agentPausedUntil ?? null,
        now: new Date(),
      });
      if (denial) throw new AdmissionError(denial.message, denial.status, denial.blocked);

      return tx.run.create({
        data: {
          ticketId,
          ticketUrl: params.ticketUrl ? cleanPath(params.ticketUrl) : "",
          provider,
          org,
          project,
          rootRepo,
          worktreePath: rootRepo,
          graphId: graph.id,
          skill,
          state: "running",
          currentNodeId: graph.entry,
          model: params.model ? cleanPath(params.model) : "",
          effort: params.effort ? cleanPath(params.effort) : "",
          estimateHours,
        },
      });
    });
  } catch (e) {
    if (e instanceof AdmissionError) {
      return { ok: false, error: e.message, status: e.status, blocked: e.blocked };
    }
    throw e;
  }

  // Remember which Root Repo this project last ran with, so the next ticket
  // opened under the same project prefills it (see RootRepoProjectMap). Written
  // here rather than from the Overview tab: a run started by POSTing this route
  // directly never touches the client, and a mapping the UI alone maintains goes
  // stale the moment it is bypassed. Best-effort — a prefill hint is not worth
  // failing an admitted run over.
  try {
    await prisma.rootRepoProjectMap.upsert({
      where: { provider_org_project: { provider, org, project } },
      create: { provider, org, project, rootRepo },
      update: { rootRepo },
    });
  } catch {
    /* the next run gets another chance to record it */
  }

  const live: LiveRun = {
    id: row.id,
    graphId: graph.id,
    ctx: {
      runId: row.id,
      ticketId,
      ticketUrl: row.ticketUrl,
      provider,
      project,
      prUrl: params.prUrl ? cleanPath(params.prUrl) : "",
      skill,
      rootRepo,
      cwd: rootRepo,
      baseSha: "",
      knowledge: "", // resolved below, once the worktree exists
      channels: {},
      visits: {},
    },
    state: "running",
    currentNodeId: graph.entry,
    sessionId: "",
    model: row.model,
    effort: row.effort,
    isolate,
    child: null,
    cancelled: false,
    logLines: [],
    mcpConfigPath: "",
    parkedAt: null,
    humanWaitMs: 0,
    resumeAt: null,
    limitWaitMs: 0,
    limitParks: 0,
    resumeSession: false,
    startedAt: row.startedAt.getTime(),
    endedAt: null,
    seq: 0,
    hops: 0,
    resumedAfterRestart: false,
    errorMessage: "",
    endReason: "",
    prUrl: "",
    branch: "",
    resultText: "",
  };
  store.set(row.id, live);

  if (!existsSync(rootRepo)) {
    await finish(live, "failed", `Project folder not found: ${rootRepo}. Set the correct Root repo on the Overview tab.`);
    return { ok: true, runId: row.id };
  }

  excludeTeArtifacts(rootRepo);
  applyGitIdentity(rootRepo, setting?.gitUserName ?? "", setting?.gitUserEmail ?? "");

  // Single-ticket mode branches from whatever rootRepo is currently on, so the
  // tree has to be back on the default branch *before* baseSha is read — the
  // previous ticket left it on its own feature branch. Worktree mode does not
  // need this and must not have it: an isolated run may legitimately start from
  // a tree the developer has parked somewhere.
  if (!isolate) {
    const reset = returnToDefaultBranch(rootRepo);
    if (!reset.ok) {
      await finish(live, "failed", reset.detail);
      return { ok: true, runId: row.id };
    }
    live.logLines.push({ text: `● ${reset.detail}`, kind: "step" });
  }

  try {
    live.ctx.baseSha = execSync(`git -C "${rootRepo}" rev-parse HEAD`).toString().trim();
  } catch {
    /* not a git repo, or no commits yet — the run's diff will just be empty */
  }

  if (isolate) {
    // Isolate the run in a fresh git worktree so concurrent runs against the same
    // rootRepo never share one working tree, git index or HEAD (which would let
    // one run's uncommitted changes leak into another's commit). Checked out
    // detached — the skill's own "create a branch" step creates the one real
    // branch, from inside this worktree.
    try {
      console.log(`Setting up isolated worktree for run ${row.id}`);
      const wt = path.join(rootRepo, ".te-worktrees", `${project}-${row.id}`);
      execSync(`git -C "${rootRepo}" worktree add --detach "${wt}" HEAD`, { stdio: "ignore" });
      live.ctx.cwd = wt;
      live.logLines.push({ text: `● Isolated worktree ${wt}`, kind: "step" });
      const carried = carryRepoContext(rootRepo, wt);
      if (carried.length) {
        live.logLines.push({ text: `● Carried repo context into the worktree: ${carried.join(", ")}`, kind: "step" });
      }
    } catch (e) {
      await finish(
        live,
        "failed",
        `Failed to set up isolated git worktree: ${e instanceof Error ? e.message : e}. Concurrent runs require worktree isolation to avoid commit leakage between tickets.`
      );
      return { ok: true, runId: row.id };
    }
  }
  console.log(`Using working directory: ${live.ctx.cwd}`);

  // Start from a clean scratch directory. A previous run in this same tree (or a
  // crash that skipped the cleanup at the end) can leave `.te/plan.md` behind, and
  // the plan phase reads that file — an earlier ticket's plan is a confusing,
  // token-costing thing for the agent to have to recognise and discard.
  clearRunArtifacts(live.ctx.cwd);

  // What earlier runs learned about this repo, resolved once here so the prompt
  // builders stay pure and synchronous. Best-effort: a run that cannot read its
  // knowledge is a run that costs a few more tokens, not a run that must not
  // start.
  try {
    live.ctx.knowledge = await loadKnowledge(rootRepo, isReviewSkill(skill) ? "review" : "implement");
    if (live.ctx.knowledge) {
      live.logLines.push({ text: `● Applying what earlier runs learned about ${rootRepo}`, kind: "step" });
    }
  } catch {
    /* no knowledge this run */
  }

  await saveRun(live);
  // Fire-and-forget: the route returns immediately and the walk continues in the
  // background until it ends or parks at a gate.
  void drive(live, graph, graph.entry);
  return { ok: true, runId: row.id };
}

// ---- rehydration ----

/** Rebuild a usable LiveRun from its rows. The in-process map is process-local:
 *  a run parked at a gate can outlive a dev-server restart, and its approval
 *  still has to work. */
export async function rehydrate(id: string): Promise<LiveRun | null> {
  const row = await prisma.run.findUnique({
    where: { id },
    include: { steps: { orderBy: { startedAt: "asc" } } },
  });
  if (!row) return null;

  const logLines: LogLine[] = [];
  for (const s of row.steps) {
    const ls = Array.isArray(s.logLines) ? (s.logLines as unknown as LogLine[]) : [];
    logLines.push(...ls);
  }
  const seq = await prisma.transition.count({ where: { runId: id } });

  const live: LiveRun = {
    id: row.id,
    graphId: row.graphId,
    ctx: {
      runId: row.id,
      ticketId: row.ticketId,
      ticketUrl: row.ticketUrl,
      provider: row.provider,
      project: row.project,
      // Only the first turn addresses the PR by URL; a rehydrated run only ever
      // resumes with a Mode: prompt, so it is not needed again.
      prUrl: "",
      skill: row.skill || skillOfGraph(row.graphId),
      rootRepo: row.rootRepo,
      cwd: row.worktreePath || row.rootRepo,
      baseSha: row.baseSha,
      // Not restored, and not re-read: only the run's *first* turn carries the
      // knowledge block, and a rehydrated run has already taken that turn. Every
      // node it can still reach either resumes a session that already holds the
      // block or is publishing work that is final.
      knowledge: "",
      channels: (row.channels as Record<string, Record<string, unknown>>) ?? {},
      // Restored, not reset: the hop and cycle counters belong to the run. A
      // recovered run that started its counters over would be allowed to loop
      // once more for every crash it survived.
      visits: (row.visits as Record<string, number>) ?? {},
    },
    state: row.state as RunState,
    currentNodeId: row.currentNodeId,
    sessionId: row.sessionId,
    model: row.model,
    effort: row.effort,
    isolate: row.worktreePath !== row.rootRepo,
    child: null,
    cancelled: false,
    logLines,
    mcpConfigPath: "",
    parkedAt: row.parkedAt ? row.parkedAt.getTime() : null,
    humanWaitMs: row.humanWaitMs,
    resumeAt: row.resumeAt ? row.resumeAt.getTime() : null,
    limitWaitMs: row.limitWaitMs,
    // Restored for the same reason as hops and visits: the ceiling belongs to
    // the run, and a rebuild that reset it would grant one more park per restart.
    limitParks: row.limitParks,
    resumeSession: false,
    startedAt: row.startedAt.getTime(),
    endedAt: row.endedAt ? row.endedAt.getTime() : null,
    seq,
    hops: row.hops,
    // This rebuild IS the recovery — the in-process entry was gone.
    resumedAfterRestart: true,
    errorMessage: row.errorMessage,
    endReason: row.endReason as LiveRun["endReason"],
    prUrl: row.prUrl,
    branch: row.branch,
    resultText: row.resultText,
  };
  store.set(id, live);
  return live;
}

/** The skill a graph id came from. The graph is what actually drives the run;
 *  the skill name only reappears in the prompt, and every graph maps to exactly
 *  one skill. */
function skillOfGraph(graphId: string): string {
  switch (graphId) {
    case "implement-v3":
      return "implement-ticket-v3";
    case "fix-review-v3":
      return "fix-code-review-v3";
    case "fix-review-v2":
      return "fix-code-review-v2";
    default:
      return "implement-ticket-v2";
  }
}

async function liveOf(id: string): Promise<LiveRun | null> {
  return store.get(id) ?? (await rehydrate(id));
}

// ---- gate resolution ----

/** Resolve a run parked at the plan gate. `plan` carries the reviewer's (possibly
 *  edited) markdown, which is written back to .te/plan.md *and* stored as a new
 *  human-authored Artifact version before the walk resumes — so what the agent
 *  proposed and what the human approved both survive. */
export async function resolvePlan(
  id: string,
  action: GateAction,
  opts?: { plan?: string; feedback?: string }
): Promise<{ ok: true } | { ok: false; error: string; code: number }> {
  const live = await liveOf(id);
  if (!live) return { ok: false, error: "Run not found", code: 404 };
  if (live.state !== "waiting") return { ok: false, error: `Run is not awaiting review (state: ${live.state})`, code: 409 };

  const graph = graphById(live.graphId, live.ctx.skill);
  const node = graph.nodes[live.currentNodeId];
  if (!node || node.kind !== "gate") {
    return { ok: false, error: `Run is parked on "${live.currentNodeId}", which is not a gate`, code: 409 };
  }
  if (action !== "cancel" && !live.sessionId) {
    return { ok: false, error: "This run has no Claude session to resume", code: 409 };
  }

  const edited = (opts?.plan ?? "").trim();
  if (edited) {
    const current = await latestArtifact(id, "plan");
    if (!current || current.body !== edited) {
      try {
        writeWorktreeFile(live.ctx.cwd, PLAN_FILE, edited);
      } catch (e) {
        return { ok: false, error: `Failed to write the edited plan: ${e instanceof Error ? e.message : e}`, code: 500 };
      }
      await saveArtifact(id, "plan", edited, "human");
      live.logLines.push({ text: "✎ Plan edited by reviewer", kind: "file" });
    }
  }

  if (action === "revise") {
    const feedback = (opts?.feedback ?? "").trim();
    if (!feedback) return { ok: false, error: "Feedback is required to request changes", code: 400 };
    try {
      writeWorktreeFile(live.ctx.cwd, FEEDBACK_FILE, feedback);
    } catch (e) {
      return { ok: false, error: `Failed to write feedback: ${e instanceof Error ? e.message : e}`, code: 500 };
    }
    await saveArtifact(id, "feedback", feedback, "human");
  }

  await resolveGate(live, graph, action);
  return { ok: true };
}

// ---- cancellation ----

export async function cancelRun(id: string): Promise<boolean> {
  const live = await liveOf(id);
  if (!live) return false;
  return cancel(live);
}

// ---- account-limit recovery ----

/**
 * Continue every run the Claude account's usage limit parked, now that it has
 * reset (see parkForLimit() in graph/drive.ts).
 *
 * The node is re-entered rather than the run restarted, and it re-enters the
 * session it was cut off in — which is the entire reason the run was parked
 * instead of failed. That session holds the ticket, the plan, the files already
 * read and the edits already made; a fresh one would pay for all of it again and
 * still not know what the interrupted turn had done.
 *
 * Driven from the scheduler's tick rather than a timer of its own: the tick
 * already runs every two minutes under an advisory lock, and a second timer
 * would be a second thing able to re-enter the same run.
 */
export async function resumeRateLimitedRuns(now = new Date()): Promise<number> {
  const due = await prisma.run.findMany({
    where: { state: "waiting", endReason: "rate-limited", resumeAt: { not: null, lte: now } },
    select: { id: true },
  });
  let resumed = 0;

  for (const { id } of due) {
    const live = await liveOf(id);
    // Another tick, or the run's own driver, got there first.
    if (!live || live.state !== "waiting") continue;

    bankParkedTime(live);
    // Consumed by the next agent turn: it continues the cut-off session whatever
    // that node's declared `context` is.
    live.resumeSession = true;
    live.state = "running";
    live.errorMessage = "";
    live.endReason = "";
    live.logLines.push({ text: "↻ Usage limit reset — continuing where the run stopped", kind: "step" });
    await saveRun(live);

    const graph = graphById(live.graphId, live.ctx.skill);
    void drive(live, graph, live.currentNodeId || graph.entry);
    resumed += 1;
  }
  return resumed;
}

// ---- crash recovery ----

// Steps left `running` when the process died. What may be done with one is
// decided purely by its effect class, which is why that class is copied onto the
// Step row rather than resolved from the graph here:
//   pure     — nothing escaped; just re-run it.
//   local    — the worktree may be half-written, but nothing left the machine.
//              Resuming the same session is safe and cheap.
//   external — we cannot know whether the push or the PR landed before the crash.
//              Guessing is how duplicate PRs happen, so the run stops and waits
//              for a human.
let sweepDone = false;

export async function recoverInterruptedRuns(): Promise<number> {
  if (sweepDone) return 0;
  sweepDone = true;

  const stale = await prisma.run.findMany({
    where: { state: "running" },
    include: { steps: { where: { status: "running" }, orderBy: { startedAt: "desc" } } },
  });
  let recovered = 0;

  for (const row of stale) {
    if (store.has(row.id)) continue; // this process owns it — not stale
    const open = row.steps[0];
    const live = await rehydrate(row.id);
    if (!live) continue;

    if (open) {
      await prisma.step.update({
        where: { id: open.id },
        data: { status: "abandoned", claimedAt: null, endedAt: new Date(), errorMessage: "Interrupted by a server restart" },
      });
    }

    if (open?.effects === "external") {
      live.state = "waiting";
      live.endReason = "needs-review";
      live.errorMessage =
        `The server restarted while "${open.label}" was publishing. It may or may not have pushed or opened the PR — ` +
        `check the branch and the tracker, then retry or discard this run.`;
      live.logLines.push({ text: `⏸ ${live.errorMessage}`, kind: "err" });
      await saveRun(live);
      continue;
    }

    const graph = graphById(live.graphId, live.ctx.skill);
    const resumeFrom = open?.nodeId || live.currentNodeId || graph.entry;
    live.logLines.push({ text: `↻ Resuming "${resumeFrom}" after a server restart`, kind: "step" });
    void drive(live, graph, resumeFrom);
    recovered += 1;
  }
  return recovered;
}
