// Runs once when a Next.js server instance starts, before it handles requests:
// installs the bundled skills and agents, then starts the scheduler and the push watcher.
// A D-Agent run orphaned by a restart is failed by `reconcileOrphans()` (lib/dagent).
/**
 * Put this repo's skills where the Claude CLI reads them.
 *
 * The skills ship in `skills/` and the CLI only ever looks in
 * `~/.claude/skills` — so somebody has to copy them across, and until now that
 * was a button on the Guide page. That was right while the app ran on a
 * developer's own machine, whose home directory persists. It is wrong in a
 * container: `~/.claude` is recreated with the container, so a fresh deploy
 * starts with no skills and the first triage fails on
 * `Unknown command: /triage-sprint-v4`.
 *
 * Idempotent. A copy older than the bundle is replaced — it answers an older
 * contract — while a copy of the same version
 * whose contents differ is left alone, so a skill somebody deliberately edited
 * in place survives a restart.
 *
 * Never fatal. A read-only home directory is a reason for System Check to show
 * the skills as missing, not a reason for the server to refuse to boot.
 */
async function installBundledSkills() {
  const { installSkill, skillStates } = await import("./lib/skillPack");
  const installed: string[] = [];
  for (const { name, status } of skillStates()) {
    try {
      const outcome = installSkill(name, { force: status === "outdated" });
      if (outcome.ok && !outcome.detail.startsWith("Already")) installed.push(name);
    } catch {
      /* reported by System Check, which reads the same state */
    }
  }
  if (installed.length) console.log(`[ticket-executor] installed skills: ${installed.join(", ")}`);
}

/** The same, for the D-Agent subagents in `agents/` → `~/.claude/agents`. */
async function installBundledAgents() {
  const { agentStates, installAgent } = await import("./lib/agentPack");
  const installed: string[] = [];
  for (const { name, status } of agentStates()) {
    try {
      const outcome = installAgent(name, { force: status === "outdated" });
      if (outcome.ok && !outcome.detail.startsWith("Already")) installed.push(name);
    } catch {
      /* reported by System Check, which reads the same state */
    }
  }
  if (installed.length) console.log(`[ticket-executor] installed agents: ${installed.join(", ")}`);
}

export async function register() {
  // Only the Node.js runtime can spawn processes or reach Postgres; the edge
  // runtime also evaluates this file.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await installBundledSkills();
  await installBundledAgents();

  // The scheduler's own tick takes a Postgres advisory lock, so a host and a
  // container sharing one database still only schedule once.
  const { startScheduler } = await import("./lib/executionStore");
  startScheduler();

  // The bell's server half. Separate from the scheduler because it answers a
  // different question on a different clock and takes no lock — see
  // lib/pushWatcher.ts. A no-op when no VAPID keys are configured.
  const { startPushWatcher } = await import("./lib/pushWatcher");
  startPushWatcher();
}
