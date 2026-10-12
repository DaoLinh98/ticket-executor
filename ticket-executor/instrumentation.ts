// Runs once when a Next.js server instance starts, before it handles requests.
//
// This is where crash recovery belongs. A run's live state is in-process, so a
// restart orphans anything that was mid-flight: without this sweep those rows
// sit at state "running" forever, with no process behind them. What each one is
// eligible for is decided by the effect class of the step that was open —
// see recoverInterruptedRuns(): pure re-runs, local resumes, and external stops
// for a human, because nobody can tell from here whether the push landed.
/**
 * Put this repo's skills where the Claude CLI reads them.
 *
 * The skills ship in `skills/` and the CLI only ever looks in
 * `~/.claude/skills` — so somebody has to copy them across, and until now that
 * was a button on the Guide page. That was right while the app ran on a
 * developer's own machine, whose home directory persists. It is wrong in a
 * container: `~/.claude` is recreated with the container, so a fresh deploy
 * starts with no skills and the first run fails on
 * `Unknown command: /implement-ticket-v4`.
 *
 * Idempotent. A copy older than the bundle is replaced — it answers an older
 * contract, and startRun() refuses to run it — while a copy of the same version
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

export async function register() {
  // Only the Node.js runtime can spawn processes or reach Postgres; the edge
  // runtime also evaluates this file.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await installBundledSkills();
  const { recoverInterruptedRuns } = await import("./lib/executionStore");
  try {
    const n = await recoverInterruptedRuns();
    if (n > 0) console.log(`[ticket-executor] resumed ${n} run(s) interrupted by a restart`);
  } catch (e) {
    console.error("[ticket-executor] crash-recovery sweep failed:", e);
  }

  // The scheduler comes last, and after the recovery sweep on purpose: it may
  // start runs, and it must not do that while the sweep is still deciding which
  // of the previous process's runs are still alive. Its own tick takes a
  // Postgres advisory lock, so a host and a container sharing one database still
  // only schedule once.
  const { startScheduler } = await import("./lib/executionStore");
  startScheduler();

  // The bell's server half. Separate from the scheduler because it answers a
  // different question on a different clock and takes no lock — see
  // lib/pushWatcher.ts. A no-op when no VAPID keys are configured.
  const { startPushWatcher } = await import("./lib/pushWatcher");
  startPushWatcher();
}
