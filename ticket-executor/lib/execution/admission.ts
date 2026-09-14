// Whether a run may start. Deliberately a module of its own with no Prisma
// import: the SQL that gathers these facts has to run inside the advisory-locked
// transaction in runner.ts, but the *rule* is the part worth asserting, and
// asserting it must not need a database (see tests/graph.test.ts).

/** What the admission transaction observed, inside the lock. */
export type AdmissionFacts = {
  ticketId: string;
  /** This ticket already has a run in flight. */
  duplicate: boolean;
  /** Ticket id of some *other* run in flight, if there is one. */
  otherTicketId: string;
  /** How many runs for *other* tickets are actually computing right now.
   *
   *  Parked runs are excluded on purpose, and the distinction is the whole point
   *  of this field: the cap exists to bound what the machine is doing — Claude
   *  processes, CPU, tokens in flight — and a run parked at a gate holds no child
   *  process and spends nothing while it waits for a human. Counting it would let
   *  two unanswered plan reviews block every other ticket indefinitely.
   *
   *  A parked run *does* still own its worktree and its branch, which is why the
   *  duplicate-ticket and single-ticket rules above count it and this one does not. */
  runningOthers: number;
  /** false = single-ticket mode (the run executes directly in rootRepo). */
  isolate: boolean;
  /** Setting.concurrentRuns — the ceiling on runs in flight at once. */
  cap: number;
  /** Setting.agentPausedUntil — the instant the Claude account's usage limit is
   *  expected to reset, written by whichever run hit it. Null = not paused. */
  pausedUntil: Date | null;
  /** Passed in rather than read from the clock, so the rule stays a pure
   *  function of its facts and the test does not have to wait for one. */
  now: Date;
};

export type AdmissionDenial = { message: string; status: number; blocked: string };

/**
 * The rule. Order matters: the first match produces the message the user sees,
 * so the most specific explanation comes first.
 */
export function admissionDenial(f: AdmissionFacts): AdmissionDenial | null {
  // Two runs on one ticket race for the same branch name whether or not they have
  // separate worktrees, so this holds in both modes.
  if (f.duplicate) {
    return {
      message: `Ticket #${f.ticketId} already has a run in flight. Finish or cancel it before starting another.`,
      status: 409,
      blocked: "duplicate-ticket",
    };
  }
  // Single-ticket mode executes in the developer's own working copy. A second run
  // there would share one index and one HEAD — the exact failure worktrees exist
  // to prevent.
  if (!f.isolate && f.otherTicketId) {
    return {
      message: `Ticket #${f.otherTicketId} is currently running. Multi-ticket mode is off — finish or cancel it first.`,
      status: 409,
      blocked: "single-ticket-mode",
    };
  }
  // The Claude account is out of quota, and every run on this machine spends the
  // same one. Placed after the two ticket-specific rules and before the cap: a
  // duplicate or a busy working tree is something the caller can act on right
  // now, while this and the cap are both "the machine cannot take it yet" — and
  // of those two, the quota is the one that outlasts the other.
  //
  // Refusing here rather than letting the spawn happen is the whole point. A run
  // started against a spent account reaches its first node, pays for the turn and
  // dies: that is exactly how one afternoon's limit turned into two failed
  // tickets and $0.38 of nothing.
  if (f.pausedUntil && f.pausedUntil > f.now) {
    return {
      message:
        `The Claude account has hit its usage limit. Runs resume automatically at ` +
        `${f.pausedUntil.toLocaleString()} — anything parked continues where it stopped.`,
      status: 429,
      blocked: "rate-limited",
    };
  }
  // The concurrency ceiling. Until this existed it lived *only* in the Ticket
  // Execution screen's state, so two browser tabs — or one reload mid-batch —
  // could put an unbounded number of Claude processes, worktrees and MCP servers
  // on the machine at once. The client queue still decides who goes *next*; this
  // decides how many may be in flight at all.
  const cap = Math.max(1, f.cap);
  if (f.runningOthers >= cap) {
    return {
      message:
        `${f.runningOthers} run${f.runningOthers === 1 ? " is" : "s are"} already running and the concurrent-run limit is ${cap}. ` +
        `Wait for one to finish, or raise "Concurrent runs" in Settings.`,
      status: 409,
      blocked: "concurrency-cap",
    };
  }
  return null;
}
