// What to do with a failed run — pure, so Flow Runner's unattended retry and the Workflow page's suggested
// retry node give the same answer from the same facts.
//
//   transient — the world hiccuped (network, quota, a server restart): the same run again is likely to pass.
//   env       — the machine or the connection is wrong (repo, credential, missing tool): retrying burns money
//               until a person fixes the setup.
//   agent     — the work itself stopped (blocked, review blockers left after every fix, a plan that never
//               checked out): a person has to read why.

export type FailureClass = "transient" | "agent" | "env";

const TRANSIENT = [
  /rate.?limit/i,
  /\b(429|502|503|529)\b/,
  /overloaded/i,
  /timed? ?out|ETIMEDOUT/i,
  /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i,
  /network/i,
  /server restart/i,
  /claude exited with code/i,
];

const ENV = [
  /root repo/i,
  /not a git repository/i,
  /credential|personal access token|\bPAT\b/i,
  /\b(401|403)\b|unauthori[sz]ed|forbidden|permission denied/i,
  /not installed|command not found|ENOENT/i,
  /worktree/i,
  /author identity unknown|user\.email/i,
];

export function classifyFailure(reason: string): FailureClass {
  const r = reason || "";
  // Checked first: an auth failure often arrives inside an otherwise "network-looking" message.
  if (ENV.some((p) => p.test(r))) return "env";
  if (TRANSIENT.some((p) => p.test(r))) return "transient";
  return "agent";
}

// Where each node's failure is retried from: the earliest retry entry that re-does the failed work while
// keeping what came before it. Nodes before `plan` have nothing worth keeping — a fresh run.
const RETRY_FROM: Record<string, string> = {
  plan: "plan",
  planCheck: "plan",
  implement: "implement",
  syncBase: "syncBase",
  diffGuard: "syncBase",
  evaluate: "syncBase",
  fix: "syncBase",
  reflect: "syncBase",
  prePublish: "syncBase",
  publish: "syncBase",
  verifyPublish: "syncBase",
};

/** The node a failed run is best retried from, or null when it should start over (or the flow has no retry entries). */
export function retryNodeFor(failedAt: string, retryEntries: string[]): string | null {
  const from = RETRY_FROM[failedAt];
  return from && retryEntries.includes(from) ? from : null;
}

/** Unattended retries a ticket gets for transient failures before it waits for a person. */
export const MAX_AUTO_RETRIES = 2;
