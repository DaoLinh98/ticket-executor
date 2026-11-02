import { execSync, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { Prisma } from "@prisma/client";
import { removeRunMcpConfig, resolveMcp, writeRunMcpConfig } from "../mcp";
import { validateAgentAccess, validateRootRepo } from "../preflight";
import { prisma } from "../prisma";
import { resolveCredential } from "../providerCredentials";
import { checkAgents } from "./agents";
import { runAgentTurn } from "./cli";
import { CHECKS, companionDirs, deliveryFacts, removeWorktrees, seatBase, type CheckEnv, type RetrySeed } from "./checks";
import { agentsOf, flowOf, graphById, GRAPHS, MAX_HOPS } from "./graph";
import { PLAN_FILE } from "./prompts";
import { deliveryOf, knowledgeDiff } from "./rules";
import { skillCatalog } from "./skills";
import { closeStep, nextSeq, openStep, saveArtifact, saveRun, saveTransition } from "./store";
import { BRIEF_PREFIX, END, FAIL, NEEDS_INPUT, NEEDS_REVIEW, ZERO_USAGE, type AgentNode, type Ctx, type Flow, type GateResult, type Graph, type LogEntry, type Node, type NodeResult, type Repo } from "./types";

type Live = {
  id: string;
  graph: Graph;
  ctx: Ctx;
  env: CheckEnv;
  model: string;
  effort: string;
  entry: string;
  child: ChildProcess | null;
  cancelled: boolean;
  logs: LogEntry[];
  stepId: string;
  hops: number;
  knowledgeAtStart: string | null;
};

const g = globalThis as unknown as { __dagentLive?: Map<string, Live>; __dagentEnded?: Set<(runId: string) => void> };
const LIVE: Map<string, Live> = (g.__dagentLive ??= new Map());
const ENDED: Set<(runId: string) => void> = (g.__dagentEnded ??= new Set());

/** Called once a run reaches a terminal state, so Flow Runner can settle its row without waiting for the next tick. */
export function onRunEnded(fn: (runId: string) => void) {
  ENDED.add(fn);
}

const ACTIVE = ["running", "waiting"];
const CANCELLED = "CANCELLED";

export function liveLogs(runId: string): { stepId: string; logs: LogEntry[] } | null {
  const l = LIVE.get(runId);
  return l ? { stepId: l.stepId, logs: l.logs } : null;
}

export function isDriving(runId: string): boolean {
  return LIVE.has(runId);
}

const knowledgePath = (rootRepo: string) => path.join(rootRepo, "KNOWLEDGE.md");

function readKnowledge(rootRepo: string): string {
  try {
    return readFileSync(knowledgePath(rootRepo), "utf8");
  } catch {
    return "";
  }
}

const clock = () => new Date().toTimeString().slice(0, 5);

function stepStatus(node: Node, r: NodeResult): string {
  if (!r.ok) return "failed";
  const d = r.data;
  const refusals = Array.isArray(d.refusals) ? d.refusals.length : 0;
  if (d.passed === false || refusals || d.verdict === "changes-required" || (node.id === "readiness" && d.ready === false)) return "refused";
  return "succeeded";
}

async function execAgent(live: Live, node: AgentNode): Promise<NodeResult> {
  let mcpConfigPath = "";
  try {
    const [setting, cred] = await Promise.all([prisma.setting.findUnique({ where: { id: "default" } }), resolveCredential(live.ctx.provider)]);
    const decision = await resolveMcp({ provider: live.ctx.provider, org: cred.org, pat: cred.pat, manageMcp: setting?.manageMcp ?? true, cwd: live.ctx.cwd });
    mcpConfigPath = writeRunMcpConfig(`dagent-${live.id}`, decision);
    live.logs.push({ t: Date.now(), lvl: decision.blocker ? "WARN" : "INFO", text: `MCP: ${decision.blocker || decision.detail}` });
  } catch (e) {
    live.logs.push({ t: Date.now(), lvl: "WARN", text: `could not prepare MCP access (${e instanceof Error ? e.message : e}) — the turn inherits this machine's MCP config` });
  }
  const addDirs = companionDirs(live.ctx);
  live.logs.push({ t: Date.now(), lvl: "INFO", text: `▶ agent ${node.agent} · context fresh${addDirs.length ? ` · +${addDirs.length} related repo(s)` : ""}` });
  const prompt = node.prompt(live.ctx);
  // The brief is the only context a fresh turn gets — kept per step so /workflow shows what each agent was told.
  await saveArtifact(live.id, `${BRIEF_PREFIX}${live.stepId}`, prompt).catch(() => null);
  const turn = await runAgentTurn({
    cwd: live.ctx.cwd,
    addDirs,
    agent: node.agent,
    prompt,
    schema: node.output,
    mcpConfigPath,
    model: live.model,
    effort: live.effort,
    onLog: (e) => live.logs.push(e),
    onChild: (c) => (live.child = c),
  });
  removeRunMcpConfig(mcpConfigPath);
  if (!turn.ok) return { ok: false, data: {}, error: turn.error || "the agent's turn failed", usage: turn.usage };
  if (!turn.structured) {
    return { ok: false, data: {}, error: `${node.agent} finished without its structured output — the run cannot route on free text.`, usage: turn.usage };
  }
  const data = node.id === "implement" || node.id === "fix" ? { ...turn.structured, ...deliveryFacts(live.ctx) } : turn.structured;
  const error = PICKS_SKILLS.includes(node.id) ? applySkills(live, data) : "";
  return error ? { ok: false, data, error, usage: turn.usage } : { ok: true, data, error: "", usage: turn.usage };
}

const PICKS_SKILLS = ["readiness", "qaTriage", "reviewTriage"];

// The first judging role picks the skills that fit the ticket; the harness resolves each to its SKILL.md (every later
// brief names it) and, when one requires another base branch, moves the worktrees there before any work is planned.
function applySkills(live: Live, data: Record<string, unknown>): string {
  const catalog = skillCatalog(live.ctx.rootRepo);
  const picked = Array.isArray(data.skills) ? (data.skills as { name?: string; reason?: string }[]) : [];
  data.skills = picked.flatMap((p) => {
    const s = catalog.find((x) => x.name === p.name);
    live.logs.push({ t: Date.now(), lvl: s ? "INFO" : "WARN", text: s ? `skill ${s.name}: ${p.reason ?? ""}` : `skill "${p.name}" is not installed — ignored` });
    return s ? [{ name: s.name, file: s.file, reason: p.reason ?? "" }] : [];
  });
  const branch = String(data.baseBranch ?? "").trim();
  if (!branch || live.ctx.flow === "review") return "";
  if (!(data.skills as unknown[]).length) {
    live.logs.push({ t: Date.now(), lvl: "WARN", text: `base branch ${branch} ignored — no installed skill was picked to require it` });
    return "";
  }
  const seat = seatBase(live.ctx, branch);
  live.logs.push(...seat.log);
  if (!seat.error) data.bases = seat.bases;
  return seat.error;
}

async function execNode(live: Live, node: Node): Promise<NodeResult> {
  if (node.kind === "agent") return execAgent(live, node);
  const check = CHECKS[node.id];
  if (!check) return { ok: false, data: {}, error: `no implementation for check "${node.id}"`, usage: { ...ZERO_USAGE } };
  try {
    const r = await check(live.ctx, live.env);
    live.logs.push(...(r.log ?? []));
    return r;
  } catch (e) {
    return { ok: false, data: {}, error: e instanceof Error ? e.message : String(e), usage: { ...ZERO_USAGE } };
  }
}

function killChild(live: Live) {
  const pid = live.child?.pid;
  try {
    if (pid && process.platform === "win32") execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    else live.child?.kill("SIGTERM");
  } catch {
    live.child = null;
  }
}

async function transition(live: Live, from: string, to: string, reason: string) {
  await saveTransition(live.id, await nextSeq(live.id), from, to, reason);
}

async function finish(live: Live, state: "succeeded" | "failed" | "cancelled", error: string) {
  if (live.knowledgeAtStart !== null) {
    const diff = knowledgeDiff(live.knowledgeAtStart, readKnowledge(live.ctx.rootRepo));
    if (diff) await saveArtifact(live.id, "knowledge", JSON.stringify(diff)).catch(() => null);
  }
  await saveRun(live.id, live.ctx, { state, waitReason: "", errorMessage: error, hops: live.hops, endedAt: new Date() });
  removeWorktrees(live.ctx);
  LIVE.delete(live.id);
  ENDED.forEach((fn) => fn(live.id));
}

async function park(live: Live, waitReason: string, reason: string) {
  await saveRun(live.id, live.ctx, { state: "waiting", waitReason, errorMessage: reason, hops: live.hops });
  LIVE.delete(live.id);
}

function promote(live: Live, node: Node, data: Record<string, unknown>): Record<string, string> {
  const patch: Record<string, string> = {};
  if ((node.id === "readiness" || node.id === "qaTriage") && typeof data.title === "string") patch.ticketTitle = data.title;
  if ((node.id === "implement" || node.id === "fix") && typeof data.branch === "string" && data.branch) patch.branch = data.branch;
  if (node.id === "publish" && Array.isArray(data.prs)) {
    const root = path.basename(live.ctx.rootRepo);
    const prs = data.prs as { repo?: string; prUrl?: string }[];
    const url = (prs.find((p) => p.repo === root) ?? prs[0])?.prUrl;
    if (url) patch.prUrl = url;
  }
  return patch;
}

function capturePlan(live: Live, data: Record<string, unknown>): Promise<void> {
  const file = path.join(live.ctx.cwd, PLAN_FILE);
  const md = typeof data.planMd === "string" ? data.planMd.trim() : "";
  if (md) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${md}\n`, "utf8");
  }
  if (!existsSync(file)) return Promise.resolve();
  return saveArtifact(live.id, "plan", readFileSync(file, "utf8"));
}

async function drive(live: Live, from: string) {
  let target = from;
  try {
    while (true) {
      if (target === END) return await finish(live, "succeeded", "");
      if (target === NEEDS_INPUT) return await park(live, "needs-input", "The ticket is not ready — questions are drafted for the PO.");
      // Needs-review is a verdict, not a wait: the harness decided (nothing to change, or a read-back mismatch) and the
      // run ends on it. The NEEDS_REVIEW transition carries the reason; Flow Runner flags the row for a look.
      if (target === NEEDS_REVIEW) return await finish(live, "succeeded", "");
      if (target === FAIL) return;
      if (++live.hops > MAX_HOPS) return await finish(live, "failed", `Graph exceeded ${MAX_HOPS} transitions — it is looping.`);
      const node = live.graph.nodes[target];
      if (!node) return await finish(live, "failed", `Graph ${live.graph.id} has no node "${target}"`);
      if (live.cancelled) return await abort(live, node.id);

      live.ctx.visits[node.id] = (live.ctx.visits[node.id] ?? 0) + 1;
      await saveRun(live.id, live.ctx, { state: "running", waitReason: "", currentNodeId: node.id, hops: live.hops });
      const input = node.kind === "agent" && node.input ? node.input(live.ctx) : null;
      const step = await openStep(live.id, node.id, node.label, node.kind === "agent" ? node.agent : "", input);
      live.stepId = step.id;
      live.logs = [{ t: Date.now(), lvl: "INFO", text: `▶ start #${step.attempt}${node.kind === "agent" ? "" : " · 0 tokens"}` }];

      const r = await execNode(live, node);
      if (!r.ok) live.logs.push({ t: Date.now(), lvl: "ERROR", text: r.error });
      await closeStep(step.id, live.cancelled ? "abandoned" : stepStatus(node, r), r, live.logs);
      if (live.cancelled) return await abort(live, node.id);

      if (r.ok && typeof r.data.planMd === "string" && r.data.planMd.trim()) await capturePlan(live, r.data);
      live.ctx.channels[node.id] = input ? { ...r.data, input } : r.data;

      let next = live.graph.edges[node.id](live.ctx, r);
      if (node.id === "setup" && next.to !== FAIL && live.graph.retryEntries.includes(live.entry)) next = { to: live.entry, reason: `retry from ${live.entry}` };
      const allowed = node.next.includes(next.to) || (node.id === "setup" && live.graph.retryEntries.includes(next.to));
      if (!allowed) next = { to: FAIL, reason: `routed "${node.id}" to undeclared "${next.to}"` };
      if (node.id === "readiness" && next.to === END) await saveArtifact(live.id, "delivery", JSON.stringify(deliveryOf(live.ctx)));
      await transition(live, node.id, next.to, next.reason);
      await saveRun(live.id, live.ctx, { hops: live.hops, ...promote(live, node, r.data) });
      if (next.to === FAIL) return await finish(live, "failed", next.reason);
      target = next.to;
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await finish(live, "failed", `Harness error: ${detail}`).catch(() => LIVE.delete(live.id));
  }
}

async function abort(live: Live, nodeId: string) {
  await transition(live, nodeId, CANCELLED, "cancelled by user").catch(() => null);
  await finish(live, "cancelled", "Cancelled by user");
}

export type StartInput = {
  flow?: Flow;
  prUrl?: string;
  ticketId: string;
  ticketUrl?: string;
  project: string;
  rootRepo: string;
  provider?: string;
  model?: string;
  effort?: string;
  retryOf?: string;
  from?: string;
  /** Channels the run starts with — how a caller hands a flow its input (Flow Runner's QA follow-up window and decision). */
  seed?: Record<string, Record<string, unknown>>;
};

export type StartResult = { ok: true; runId: string } | { ok: false; error: string; status: number; gates: GateResult[] };

class Refused extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function retrySeed(graph: Graph, retryOf: string, from: string): Promise<{ seed: RetrySeed; channels: Record<string, Record<string, unknown>> }> {
  const prev = await prisma.dagentRun.findUnique({ where: { id: retryOf } });
  if (!prev) throw new Refused(`Run ${retryOf} does not exist.`, 404);
  if (!["failed", "cancelled"].includes(prev.state)) throw new Refused(`Only a failed or cancelled run can be retried (this one is ${prev.state}).`, 409);
  const sameFlow = flowOf(prev.graphId) === flowOf(graph.id);
  if (!sameFlow || !graph.retryEntries.includes(from)) {
    throw new Refused(graph.retryEntries.length && sameFlow ? `A run can only be retried from ${graph.retryEntries.join(", ")}.` : "This run cannot be retried from a node — start it again.", 400);
  }
  const old = (prev.channels ?? {}) as Record<string, Record<string, unknown>>;
  const branches: Record<string, string> = {};
  const changed = old.diffGuard?.changed ?? old.testGate?.results;
  const rows = Array.isArray(changed) ? (changed as { repo: string; branch: string }[]) : [];
  rows.forEach((r) => r.branch && (branches[r.repo] = r.branch));
  if (prev.branch) branches[path.basename(prev.rootRepo)] ??= prev.branch;
  const companionBases: Record<string, string> = {};
  (Array.isArray(prev.companions) ? (prev.companions as Repo[]) : []).forEach((m) => (companionBases[m.name] = m.baseSha));
  const plan = from === "plan" ? null : await prisma.dagentArtifact.findFirst({ where: { runId: retryOf, kind: "plan" }, orderBy: { createdAt: "desc" } });
  const keep = from === "plan" ? ["readiness"] : from === "implement" ? ["readiness", "plan", "planCheck"] : ["readiness", "plan", "planCheck", "implement", "fix"];
  const channels = Object.fromEntries(keep.filter((k) => old[k]).map((k) => [k, old[k]]));
  return { seed: { baseSha: prev.baseSha, branches, companionBases, planMd: plan?.body ?? "" }, channels };
}

export async function startRun(input: StartInput): Promise<StartResult> {
  const ticketId = input.ticketId.trim();
  const rootRepo = input.rootRepo.trim();
  const provider = (input.provider || "azure-devops").trim();
  const flow = input.flow ?? "implement";
  const graph = GRAPHS[flow];
  const prUrl = (input.prUrl ?? "").trim();
  const from = input.retryOf ? (input.from || "syncBase") : graph.nodes.setup.next[0];
  const gates: GateResult[] = [];

  const problems: string[] = [];
  const repo = validateRootRepo(rootRepo);
  if (!repo.ok) problems.push(repo.error ?? "Root repo is not valid.");
  if (repo.ok) {
    const access = await validateAgentAccess(provider, rootRepo);
    if (!access.ok) problems.push(access.error ?? "The agent cannot reach the provider.");
  }
  const agents = checkAgents(agentsOf(graph));
  problems.push(...agents.problems);
  if (!ticketId) problems.push("Ticket id is required.");
  if (flow === "review" && !prUrl) problems.push("A review fix needs the pull request URL.");
  gates.push({
    gate: "preflight",
    status: problems.length ? "refused" : "passed",
    reason: problems.length ? problems.join(" ") : `Root repo ok · agent access ok · ${agentsOf(graph).length} agents found in ~/.claude/agents`,
    at: clock(),
    howTo: problems.length ? "Fix the items above, then start the run again." : undefined,
  });
  if (problems.length) return { ok: false, error: problems.join(" "), status: 400, gates };

  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  const { org } = await resolveCredential(provider);
  let seeded: Awaited<ReturnType<typeof retrySeed>> | null = null;
  let row;
  try {
    if (input.retryOf) seeded = await retrySeed(graph, input.retryOf, from);
    row = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ticket-executor:dagent-admission'))`;
      const [dup, running] = await Promise.all([
        tx.dagentRun.findFirst({ where: { ticketId, state: { in: ACTIVE } }, select: { id: true } }),
        tx.dagentRun.count({ where: { state: "running" } }),
      ]);
      const cap = setting?.concurrentRuns ?? 2;
      if (dup) throw new Refused(`${ticketId} already has a D-Agent run in flight.`, 409);
      if (running >= cap) throw new Refused(`No concurrency slot: ${running} of ${cap} D-Agent runs are running.`, 429);
      // Flows without readiness/qaTriage never learn the title, so carry it over from the ticket's last titled run.
      const titled = await tx.dagentRun.findFirst({ where: { ticketId, ticketTitle: { not: "" } }, orderBy: { startedAt: "desc" }, select: { ticketTitle: true } });
      return tx.dagentRun.create({
        data: {
          ticketId,
          ticketTitle: titled?.ticketTitle ?? "",
          ticketUrl: (input.ticketUrl ?? "").trim(),
          provider,
          org,
          project: input.project.trim(),
          rootRepo,
          graphId: graph.id,
          prUrl,
          state: "running",
          currentNodeId: graph.entry,
          model: (input.model ?? "").trim(),
          effort: (input.effort ?? "").trim(),
          retryOfId: input.retryOf ?? "",
          entryNode: from,
          knowledgeAtStart: readKnowledge(rootRepo),
          channels: (seeded?.channels ?? input.seed ?? {}) as Prisma.InputJsonValue,
        },
      });
    });
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    gates.push({ gate: "admission", status: "refused", reason: e.message, at: clock(), howTo: "Wait for the run in flight to end, or raise Settings → Concurrent runs." });
    return { ok: false, error: e.message, status: e.status, gates };
  }
  gates.push({ gate: "admission", status: "passed", reason: `Not a duplicate · slot free${input.retryOf ? ` · retry of ${input.retryOf} from ${from}` : ""}`, at: clock() });
  await prisma.dagentRun.update({ where: { id: row.id }, data: { gates: gates as unknown as Prisma.InputJsonValue } });

  const live: Live = {
    id: row.id,
    graph,
    ctx: {
      runId: row.id,
      flow,
      prUrl,
      ticketId,
      ticketUrl: row.ticketUrl,
      provider,
      project: row.project,
      rootRepo,
      cwd: rootRepo,
      baseSha: "",
      companions: [],
      knowledgeFile: knowledgePath(rootRepo),
      channels: seeded?.channels ?? input.seed ?? {},
      visits: {},
    },
    env: { gitName: setting?.gitUserName ?? "", gitEmail: setting?.gitUserEmail ?? "", retry: seeded?.seed ?? null },
    model: row.model,
    effort: row.effort,
    entry: from,
    child: null,
    cancelled: false,
    logs: [],
    stepId: "",
    hops: 0,
    knowledgeAtStart: row.knowledgeAtStart,
  };
  LIVE.set(row.id, live);
  void drive(live, graph.entry);
  return { ok: true, runId: row.id };
}

async function rehydrate(id: string): Promise<Live | null> {
  const row = await prisma.dagentRun.findUnique({ where: { id } });
  const graph = row ? graphById(row.graphId) : null;
  if (!row || !graph) return null;
  const setting = await prisma.setting.findUnique({ where: { id: "default" } });
  return {
    id,
    graph,
    ctx: {
      runId: id,
      flow: flowOf(graph.id),
      prUrl: row.prUrl,
      ticketId: row.ticketId,
      ticketUrl: row.ticketUrl,
      provider: row.provider,
      project: row.project,
      rootRepo: row.rootRepo,
      cwd: row.worktreePath || row.rootRepo,
      baseSha: row.baseSha,
      companions: Array.isArray(row.companions) ? (row.companions as Repo[]) : [],
      knowledgeFile: knowledgePath(row.rootRepo),
      channels: (row.channels ?? {}) as Record<string, Record<string, unknown>>,
      visits: (row.visits ?? {}) as Record<string, number>,
    },
    env: { gitName: setting?.gitUserName ?? "", gitEmail: setting?.gitUserEmail ?? "", retry: null },
    model: row.model,
    effort: row.effort,
    entry: row.entryNode || "readiness",
    child: null,
    cancelled: false,
    logs: [],
    stepId: "",
    hops: row.hops,
    knowledgeAtStart: row.knowledgeAtStart,
  };
}

export async function cancelRun(id: string): Promise<boolean> {
  const live = LIVE.get(id);
  if (live) {
    live.cancelled = true;
    killChild(live);
    return true;
  }
  const row = await prisma.dagentRun.findUnique({ where: { id }, select: { state: true, currentNodeId: true } });
  if (row?.state !== "waiting") return false;
  const parked = await rehydrate(id);
  if (!parked) return false;
  await abort(parked, row.currentNodeId);
  return true;
}

// `accept` only settles a run parked on needs-review before such runs began ending on it.
export type ResumeAction = "recheck-readiness" | "accept";

export async function resumeRun(id: string, action: ResumeAction): Promise<{ ok: boolean; error?: string }> {
  if (LIVE.has(id)) return { ok: false, error: "The run is already being driven." };
  const row = await prisma.dagentRun.findUnique({ where: { id }, select: { state: true, waitReason: true, currentNodeId: true } });
  if (row?.state !== "waiting") return { ok: false, error: "The run is not parked." };
  const live = await rehydrate(id);
  if (!live) return { ok: false, error: "The run could not be rebuilt." };
  if (action === "accept" && row.waitReason === "needs-review") {
    const noChange = row.currentNodeId === "implement";
    await transition(live, row.currentNodeId, END, noChange ? "accepted by a person — no code change needed" : "accepted by a person after the read-back mismatch");
    await finish(live, "succeeded", "");
    return { ok: true };
  }
  if (action === "recheck-readiness" && row.waitReason === "needs-input") {
    LIVE.set(id, live);
    void drive(live, "readiness");
    return { ok: true };
  }
  return { ok: false, error: `"${action}" does not apply to a run waiting on ${row.waitReason}.` };
}

export async function reconcileOrphans(): Promise<void> {
  const rows = await prisma.dagentRun.findMany({ where: { state: "running" }, select: { id: true } });
  for (const r of rows) {
    if (LIVE.has(r.id)) continue;
    const orphan = await rehydrate(r.id);
    if (orphan) removeWorktrees(orphan.ctx);
    await prisma.dagentStep.updateMany({ where: { runId: r.id, status: "running" }, data: { status: "abandoned", endedAt: new Date() } });
    await prisma.dagentRun.update({
      where: { id: r.id },
      data: { state: "failed", errorMessage: "Interrupted by a server restart — retry it from a node.", endedAt: new Date() },
    });
  }
}
