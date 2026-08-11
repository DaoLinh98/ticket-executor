import { randomUUID } from "crypto";
import { resolveCredential } from "../../providerCredentials";
import { removeRunMcpConfig, resolveMcp, writeRunMcpConfig } from "../../mcp";
import { prisma } from "../../prisma";
import { commonArgs, runTurn } from "../claudeCli";
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
      text: `● MCP: ${decision.detail} Credential: ${cred.source === "hub" ? `EmeHub — ${cred.label || "unnamed connection"}` : "configured locally"}.${live.mcpConfigPath ? " Only this server is loaded (--strict-mcp-config)." : ""}`,
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

// ---- reporting one turn back to EmeHub ----

/**
 * Hand the hub what it is owed after a turn: any token the CLI rotated, and what
 * the turn cost. **Hub mode only** — with the hub off there is no grant and this
 * returns immediately, leaving the turn exactly as it was.
 *
 * Both calls matter for a different reason:
 *
 *   the rotated token — the CLI renews its OAuth access token in place, and the
 *     config dir here is not the hub's copy. Without this the hub's stored
 *     refresh token goes stale and the credential eventually dies; under a
 *     shared account, for everyone at once.
 *   the spend — attribution is the hub's, from the grant. This side sends only
 *     the figures, which is what makes a run under the shared account still show
 *     up against the person who started it.
 *
 * Never throws and never fails the node. A turn that did real work — edited
 * files, made a commit — must not be reported as failed because a bookkeeping
 * call did. What is lost is visible instead: it goes in the run's own log.
 */
async function reportTurnToHub(live: LiveRun, node: AgentNode, usage: TurnUsage): Promise<void> {
  if (!live.claudeGrant || !live.claudeCredentialDir) return;
  const { postRefreshedCredential, postClaudeUsage } = await import("../../hubCredential");
  const { readClaudeCredential } = await import("../../claudeConfig");

  try {
    const raw = await readClaudeCredential(live.claudeCredentialDir);
    // `postRefreshedCredential` refuses a blanked file on its own, and the hub
    // ignores anything not strictly newer — so this is safe to call every turn.
    if (raw) await postRefreshedCredential(live.claudeGrant, raw);
  } catch (e) {
    live.logLines.push({
      text: `⚠ Could not return a rotated Claude token to EmeHub (${e instanceof Error ? e.message : e}).`,
      kind: "err",
    });
  }

  try {
    await postClaudeUsage(live.claudeGrant, {
      model: live.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheCreationTokens,
      costUsd: usage.costUsd,
      durationMs: usage.durationMs,
      action: node.id,
      externalRef: live.id,
    });
  } catch (e) {
    live.logLines.push({
      text: `⚠ This turn's spend did not reach EmeHub's ledger (${e instanceof Error ? e.message : e}).`,
      kind: "err",
    });
  }
}

// ---- the hub-mode credential assertion ----

/**
 * Refuse to spawn a turn that would silently authenticate as the wrong account.
 *
 * `startRun()` already refuses a hub run with no Claude credential, but that check
 * happens **once, at admission**, and a node is reached by three other routes: a
 * gate being answered, a crash recovery, and a cycle. Each of those rebuilds the
 * `LiveRun` — `rehydrate()` derives `claudeCredentialDir` from `Run.claudeSource`,
 * so a row whose source never got persisted comes back empty. `runTurn()` then
 * falls through to `process.env` untouched and the CLI reads the **machine's own**
 * `~/.claude` login: a different account from the one the workspace chose, billed
 * to a person who never agreed to it, with nothing in the log to say so.
 *
 * That is the one fallback INTEGRATION.md §5 forbids, so the invariant is asserted
 * where it actually matters — at the spawn — and not only where it was decided.
 *
 * **Hub off is unaffected.** `hubEnabled` false returns `""` immediately and the
 * turn runs against the machine's login exactly as it always has; that is the
 * intended configuration there, not a fallback.
 */
async function hubCredentialMissing(live: LiveRun): Promise<string> {
  if (live.claudeCredentialDir) return "";
  const setting = await prisma.setting.findUnique({ where: { id: "default" } }).catch(() => null);
  if (!setting?.hubEnabled) return "";
  return (
    "EmeHub mode is on but this run holds no Claude credential, so it would have run " +
    "against this machine's own Claude login instead of the account EmeHub resolved. " +
    "Refusing rather than spending the wrong account. Reconnect to EmeHub on the Settings " +
    "page and start the run again."
  );
}

// ---- node execution ----

async function execAgent(live: LiveRun, node: AgentNode): Promise<NodeResult> {
  const credentialError = await hubCredentialMissing(live);
  if (credentialError) {
    live.logLines.push({ text: `✖ ${credentialError}`, kind: "err" });
    return { ok: false, data: {}, error: credentialError, usage: { ...ZERO_USAGE } };
  }

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
  // Before the contract check below: a turn that failed still spent tokens, and
  // may still have rotated the credential on its way to failing.
  await reportTurnToHub(live, node, turn.usage);

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
