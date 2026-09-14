import { randomUUID } from "crypto";
import { resolveCredential } from "../../providerCredentials";
import { removeRunMcpConfig, resolveMcp, writeRunMcpConfig } from "../../mcp";
import { prisma } from "../../prisma";
import { commonArgs, runTurn } from "../claudeCli";
import { LIMIT_RESUME_PROMPT } from "./prompts";
import type { AgentNode, CheckNode, LiveRun, Node, NodeResult, TurnUsage } from "./types";
import { ZERO_USAGE } from "./types";

// ---- MCP access for one turn ----

// Resolved per turn rather than once per run: a run parked at a gate can resume
// after a restart (when the previous turn's config file is long gone), and
// Settings may have changed in between. Never fails the node — the implement
// route is what blocks on a missing provider server; here a bad decision is only
// logged, so the run's own log explains what Claude was given.
async function prepareMcp(live: LiveRun) {
  try {
    const [setting, cred] = await Promise.all([
      prisma.setting.findUnique({ where: { id: "default" } }),
      resolveCredential(live.ctx.provider),
    ]);
    const decision = await resolveMcp({
      provider: live.ctx.provider,
      org: cred.org,
      pat: cred.pat,
      manageMcp: setting?.manageMcp ?? true,
      cwd: live.ctx.cwd,
    });
    live.mcpConfigPath = writeRunMcpConfig(live.id, decision);
    live.logLines.push({
      // Which credential a turn ran with is not recoverable afterwards — the
      // config file is deleted with the run — so the run's own log is the only
      // place it can be answered. A run against the wrong organization is the
      // failure this line exists to make obvious.
      text: `● MCP: ${decision.detail}${live.mcpConfigPath ? " Only this server is loaded (--strict-mcp-config)." : ""}`,
      kind: "step",
    });
    if (decision.blocker) live.logLines.push({ text: `⚠ ${decision.blocker}`, kind: "err" });
  } catch (e) {
    live.mcpConfigPath = "";
    live.logLines.push({
      text: `⚠ Could not prepare MCP access (${e instanceof Error ? e.message : e}) — the turn falls back to this machine's own MCP config.`,
      kind: "err",
    });
  }
}

/** Delete the generated config as soon as the turn that needed it is over — it
 *  holds the PAT in clear text. */
export function releaseMcp(live: LiveRun) {
  removeRunMcpConfig(live.mcpConfigPath);
  live.mcpConfigPath = "";
}

// ---- node execution ----

async function execAgent(live: LiveRun, node: AgentNode): Promise<NodeResult> {
  // A node woken after an account limit continues the session it was cut off in,
  // whatever its declared `context` is, and is told to continue rather than
  // re-briefed. Consumed here so it applies to exactly the one turn the sweep
  // woke: if that turn parks again, the sweep sets it again.
  const waking = live.resumeSession && !!live.sessionId;
  live.resumeSession = false;

  const prompt = waking ? LIMIT_RESUME_PROMPT : node.prompt(live.ctx);
  const modelArgs = [
    ...(live.model ? ["--model", live.model] : []),
    ...(live.effort ? ["--effort", live.effort] : []),
  ];

  // `resume` continues the run's primary session so the node inherits what
  // earlier nodes read. `fresh` opens its own — the point of a fresh node is that
  // it has *not* seen the reasoning it is about to act on, so its session id is
  // deliberately not written back over the run's.
  const resuming = waking || (node.context === "resume" && !!live.sessionId);
  const ownSessionId = resuming ? "" : randomUUID();
  const sessionArgs = resuming ? ["--resume", live.sessionId] : ["--session-id", ownSessionId];

  // A node that asked to resume but has no session to resume into silently ran
  // as `fresh` — same output shape, quietly different behaviour and a quietly
  // different bill (a fresh system prompt, and a node re-reading what it was
  // told it would already know). Say so, so the run's own log explains why the
  // turn cost what it did.
  if (node.context === "resume" && !live.sessionId) {
    live.logLines.push({
      text: `⚠ ${node.label} declares context "resume" but this run has no session yet — it starts a fresh one and re-reads from scratch.`,
      kind: "err",
    });
  }

  if (waking) {
    live.logLines.push({
      text: `↻ ${node.label} continues in the session the usage limit cut off — it is not restarted.`,
      kind: "step",
    });
  }

  await prepareMcp(live);
  live.logLines.push({ text: `▸ ${node.label} — ${prompt.slice(0, 200)}`, kind: "cmd" });

  const turn = await runTurn(live, [
    "-p",
    prompt,
    ...sessionArgs,
    ...modelArgs,
    ...commonArgs({
      mcpConfigPath: live.mcpConfigPath,
      cwd: live.ctx.cwd,
      outputSchema: node.output,
    }),
  ]);
  releaseMcp(live);

  // The first session the run opens becomes its primary one, so every later
  // `resume` node has something to attach to.
  if (!resuming && turn.sessionId && !live.sessionId) live.sessionId = turn.sessionId;

  if (!turn.ok) {
    return {
      ok: false,
      data: {},
      error: turn.error || turn.text || "Claude CLI reported an error",
      usage: turn.usage,
      limitResetAt: turn.limitResetAt,
    };
  }
  // A turn that ended without honouring its contract is a failed node. There is
  // deliberately no fallback to parsing `turn.text`: guessing here is exactly
  // what the contract exists to remove.
  if (!turn.structured) {
    return {
      ok: false,
      data: {},
      error: `${node.label} finished without returning its structured output — the run cannot route on a free-text answer.`,
      usage: turn.usage,
    };
  }
  return { ok: true, data: turn.structured, error: "", usage: turn.usage };
}

async function execCheck(live: LiveRun, node: CheckNode): Promise<NodeResult> {
  try {
    return await node.run(live.ctx);
  } catch (e) {
    return { ok: false, data: {}, error: e instanceof Error ? e.message : String(e), usage: { ...ZERO_USAGE } };
  }
}

/** Run one node. Gates never reach here — drive() parks on them instead. */
export async function execNode(live: LiveRun, node: Node): Promise<NodeResult> {
  if (node.kind === "agent") return execAgent(live, node);
  if (node.kind === "check") return execCheck(live, node);
  throw new Error(`execNode called on a ${node.kind} node (${node.id})`);
}
