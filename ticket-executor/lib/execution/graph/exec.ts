import { randomUUID } from "crypto";
import { decryptSecret } from "../../crypto";
import { removeRunMcpConfig, resolveMcp, writeRunMcpConfig } from "../../mcp";
import { prisma } from "../../prisma";
import { commonArgs, runTurn } from "../claudeCli";
import type { AgentNode, CheckNode, LiveRun, Node, NodeResult } from "./types";
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
      prisma.providerCredential.findUnique({ where: { provider: live.ctx.provider } }),
    ]);
    const decision = await resolveMcp({
      provider: live.ctx.provider,
      org: cred?.org ?? "",
      pat: decryptSecret(cred?.pat),
      manageMcp: setting?.manageMcp ?? true,
      cwd: live.ctx.cwd,
    });
    live.mcpConfigPath = writeRunMcpConfig(live.id, decision);
    live.logLines.push({
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
  const prompt = node.prompt(live.ctx);
  const modelArgs = [
    ...(live.model ? ["--model", live.model] : []),
    ...(live.effort ? ["--effort", live.effort] : []),
  ];

  // `resume` continues the run's primary session so the node inherits what
  // earlier nodes read. `fresh` opens its own — the point of a fresh node is that
  // it has *not* seen the reasoning it is about to act on, so its session id is
  // deliberately not written back over the run's.
  const resuming = node.context === "resume" && !!live.sessionId;
  const ownSessionId = resuming ? "" : randomUUID();
  const sessionArgs = resuming ? ["--resume", live.sessionId] : ["--session-id", ownSessionId];

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
      budgetUsd: node.budgetUsd,
    }),
  ]);
  releaseMcp(live);

  // The first session the run opens becomes its primary one, so every later
  // `resume` node has something to attach to.
  if (!resuming && turn.sessionId && !live.sessionId) live.sessionId = turn.sessionId;

  if (!turn.ok) {
    return { ok: false, data: {}, error: turn.error || turn.text || "Claude CLI reported an error", usage: turn.usage };
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
