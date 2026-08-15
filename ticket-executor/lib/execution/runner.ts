import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { prisma } from "../prisma";
import type { LogLine, RunState } from "../types";
import { admissionDenial } from "./admission";
import { cleanPath } from "./format";
import { cancel, drive, finish, resolveGate, type GateAction } from "./graph/drive";
import { clearRunArtifacts, FEEDBACK_FILE, graphById, graphForSkill, isReviewSkill, KNOWN_SKILLS, PLAN_FILE, resolveSkill } from "./graph/graphs";
import { loadKnowledge } from "./knowledgeStore";
import { REVIEW_SKILL } from "./graph/prompts";
import { latestArtifact, saveArtifact, saveRun } from "./graph/persist";
import type { LiveRun } from "./graph/types";
import { findSkill } from "../skillPack";
import { store } from "./store";
import { encryptSecret, decryptSecret } from "../crypto";
import { claudeCredentialDir, writeClaudeCredential, type ClaudeAccountSource } from "../claudeConfig";
import { isHubError } from "../hub";
import {
  mintClaudeGrant,
  resolveClaudeCredentialWithToken,
  type ResolvedClaudeCredential,
} from "../hubCredential";

export type { GateAction };

// ---- repo hygiene ----

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

// ---- the Claude credential, in hub mode ----

/**
 * The Claude account this run will execute under, when `Setting.hubEnabled` is
 * on. Returns `null` when it is off — and that is the whole guard: every hub
 * credential step downstream is reached only through a non-null value here, so
 * with the hub off the run is spawned exactly as it always was, against the
 * machine's own `claude` login.
 *
 * Resolved **before** the admission transaction, with the plain agent token, so
 * a workspace with no Claude credential is refused as a `BlockedAttempt` with no
 * `Run` row — the same shape as every other admission denial. Failing after the
 * row existed would record "no credential configured" as an agent failure and
 * count it against the success rate.
 *
 * **No fallback to the machine's own login.** With the hub on, that login is a
 * different account from the one the workspace chose — possibly a personal one
 * where the workspace picked the shared account. Spending it silently is exactly
 * the drift hub mode exists to remove (INTEGRATION.md §5: refuse, never proceed
 * on an unavailable credential).
 */
async function hubClaudeCredential(
  hubEnabled: boolean,
): Promise<
  | { ok: true; credential: ResolvedClaudeCredential | null }
  | { ok: false; error: string }
> {
  if (!hubEnabled) return { ok: true, credential: null };
  try {
    return { ok: true, credential: await resolveClaudeCredentialWithToken() };
  } catch (e) {
    // The four hub failures read differently to a person and must keep doing so
    // (INTEGRATION.md §5): "nobody has configured one" is fixed by an admin,
    // "you are signed out" by reconnecting, "the hub is down" by waiting.
    const detail = isHubError(e) ? e.message : e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error:
        `EmeHub could not provide a Claude credential for this run: ${detail} ` +
        `Attach your own credential in EmeHub › Claude Settings, or ask an admin to configure the shared account.`,
    };
  }
}

/**
 * Put the credential where the CLI will find it, and take out this run's grant.
 *
 * Runs after the `Run` row exists because the grant is minted **for a run id**:
 * the hub records it in the audit trail, which is what makes a resolved
 * credential traceable back to the run that asked for it.
 *
 * A failed mint is logged, not fatal. The credential is already in hand and the
 * run can execute on it; what is lost is the ability to hand rotated tokens and
 * spend back to the hub later, and refusing an otherwise-ready run over
 * bookkeeping would be the wrong trade. It is written to the log rather than
 * swallowed, because for a shared account a run of these adds up to a credential
 * going stale for everybody.
 */
async function materialiseHubClaude(
  live: LiveRun,
  credential: ResolvedClaudeCredential,
): Promise<void> {
  const source = credential.source as ClaudeAccountSource;
  live.claudeCredentialDir = await writeClaudeCredential(source, credential.credentials);
  live.claudeSource = source;
  live.logLines.push({
    text: `● Claude credential: EmeHub — ${source === "shared" ? "shared workspace account" : "your own account"}${credential.label ? ` (${credential.label})` : ""}, status ${credential.status}.`,
    kind: "step",
  });

  try {
    const grant = await mintClaudeGrant(live.id);
    live.claudeGrant = grant.grant;
    await prisma.run.update({
      where: { id: live.id },
      data: {
        claudeSource: source,
        claudeGrant: encryptSecret(grant.grant),
        claudeGrantExpiresAt: grant.expiresAt,
      },
    });
  } catch (e) {
    await prisma.run.update({ where: { id: live.id }, data: { claudeSource: source } });
    live.logLines.push({
      text: `⚠ EmeHub issued no credential grant for this run (${e instanceof Error ? e.message : e}) — it will execute normally, but a token the CLI rotates cannot be handed back and this run's spend will not reach the hub's ledger.`,
      kind: "err",
    });
  }
}

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

  // Hub mode only — see hubClaudeCredential(). Checked here, beside the other
  // admission rules and before the transaction, so a workspace with no Claude
  // credential is refused without a Run row.
  const claude = await hubClaudeCredential(setting?.hubEnabled ?? false);
  if (!claude.ok) {
    return { ok: false, status: 400, blocked: "claude-credential", error: claude.error };
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
      const [dup, other, runningOthers] = await Promise.all([
        tx.run.findFirst({ where: { ticketId, state: { in: ACTIVE_STATES } }, select: { id: true } }),
        tx.run.findFirst({
          where: { ticketId: { not: ticketId }, state: { in: ACTIVE_STATES } },
          select: { ticketId: true },
        }),
        tx.run.count({ where: { ticketId: { not: ticketId }, state: { in: COMPUTING_STATES } } }),
      ]);
      const denial = admissionDenial({
        ticketId,
        duplicate: !!dup,
        otherTicketId: other?.ticketId ?? "",
        runningOthers,
        isolate,
        cap: setting?.concurrentRuns ?? 2,
      });
      if (denial) throw new AdmissionError(denial.message, denial.status, denial.blocked);

      return tx.run.create({
        data: {
          ticketId,
          ticketUrl: params.ticketUrl ? cleanPath(params.ticketUrl) : "",
          provider,
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
    claudeCredentialDir: "",
    claudeGrant: "",
    claudeSource: "",
    parkedAt: null,
    humanWaitMs: 0,
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

  // Hub mode only: `claude` is null with the hub off, and the run proceeds to be
  // spawned with an untouched environment.
  if (claude.credential) await materialiseHubClaude(live, claude.credential);

  if (!existsSync(rootRepo)) {
    await finish(live, "failed", `Project folder not found: ${rootRepo}. Set the correct Root repo on the Overview tab.`);
    return { ok: true, runId: row.id };
  }

  excludeTeArtifacts(rootRepo);

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
      const wt = path.join(rootRepo, ".te-worktrees", `${project}-${row.id}`);
      execSync(`git -C "${rootRepo}" worktree add --detach "${wt}" HEAD`, { stdio: "ignore" });
      live.ctx.cwd = wt;
      live.logLines.push({ text: `● Isolated worktree ${wt}`, kind: "step" });
    } catch (e) {
      await finish(
        live,
        "failed",
        `Failed to set up isolated git worktree: ${e instanceof Error ? e.message : e}. Concurrent runs require worktree isolation to avoid commit leakage between tickets.`
      );
      return { ok: true, runId: row.id };
    }
  }

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

/**
 * Re-materialise the credential before a paused run starts computing again.
 *
 * Called on the two paths that resume execution — a gate being answered and
 * crash recovery — and deliberately **not** on every rehydrate: `liveOf()` also
 * serves read-only polling, and a hub round trip per poll would be absurd.
 *
 * It is needed at all because what is on disk proves nothing. The CLI rewrites
 * `.credentials.json` in place, blanking every token when a refresh fails, and a
 * parked run can sit for hours while the file is rotated by other runs or wiped
 * by a failed one. The hub holds the authoritative copy, so the run takes a
 * fresh one on its way back in.
 *
 * A failure here is logged and the run continues on what it has: the alternative
 * is refusing to resume an approved plan because a bookkeeping call timed out.
 * If the credential really is dead, the CLI says so on the next turn and the run
 * fails with the reason in its own log. No-op with the hub off.
 */
async function refreshHubClaude(live: LiveRun): Promise<void> {
  if (!live.claudeGrant || !live.claudeSource) return;
  try {
    const { resolveClaudeCredential } = await import("../hubCredential");
    const credential = await resolveClaudeCredential(live.claudeGrant);
    live.claudeCredentialDir = await writeClaudeCredential(
      credential.source as ClaudeAccountSource,
      credential.credentials,
    );
    live.claudeSource = credential.source;
  } catch (e) {
    live.logLines.push({
      text: `⚠ Could not re-read the Claude credential from EmeHub (${e instanceof Error ? e.message : e}) — resuming on the copy already on this machine.`,
      kind: "err",
    });
  }
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
    // Restored rather than re-resolved. Minting a grant needs a live 15-minute
    // access token, which needs the browser — after a restart there may be no
    // way to get one, so a recovered run continues on the grant it started with
    // for as long as that lives. A run started with the hub off has all three
    // empty and is respawned against the machine's own login, unchanged.
    claudeCredentialDir: row.claudeSource
      ? claudeCredentialDir(row.claudeSource as ClaudeAccountSource)
      : "",
    claudeGrant: decryptSecret(row.claudeGrant),
    claudeSource: row.claudeSource,
    parkedAt: row.parkedAt ? row.parkedAt.getTime() : null,
    humanWaitMs: row.humanWaitMs,
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

  // Hub mode only, and only for an action that actually resumes the walk —
  // `cancel` starts no turn and needs no credential.
  if (action !== "cancel") await refreshHubClaude(live);

  await resolveGate(live, graph, action);
  return { ok: true };
}

// ---- cancellation ----

export async function cancelRun(id: string): Promise<boolean> {
  const live = await liveOf(id);
  if (!live) return false;
  return cancel(live);
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
    await refreshHubClaude(live); // hub mode only; no-op otherwise
    void drive(live, graph, resumeFrom);
    recovered += 1;
  }
  return recovered;
}
