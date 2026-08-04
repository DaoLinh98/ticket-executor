// Runs once when a Next.js server instance starts, before it handles requests.
//
// This is where crash recovery belongs. A run's live state is in-process, so a
// restart orphans anything that was mid-flight: without this sweep those rows
// sit at state "running" forever, with no process behind them. What each one is
// eligible for is decided by the effect class of the step that was open —
// see recoverInterruptedRuns(): pure re-runs, local resumes, and external stops
// for a human, because nobody can tell from here whether the push landed.
export async function register() {
  // Only the Node.js runtime can spawn processes or reach Postgres; the edge
  // runtime also evaluates this file.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recoverInterruptedRuns } = await import("./lib/executionStore");
  try {
    const n = await recoverInterruptedRuns();
    if (n > 0) console.log(`[ticket-executor] resumed ${n} run(s) interrupted by a restart`);
  } catch (e) {
    console.error("[ticket-executor] crash-recovery sweep failed:", e);
  }
}
