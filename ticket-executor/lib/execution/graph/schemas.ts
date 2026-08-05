// JSON Schemas handed to the Claude CLI as --json-schema. The CLI forces the
// agent to call its StructuredOutput tool and reports the validated object on the
// final `result` event as `structured_output` — so the harness never parses text
// to work out what happened.
//
// Discipline for anything added here: **no field without a consumer.** Every
// property below is read by a named edge (lib/execution/graph/graphs/*.ts) or
// rendered by a named piece of UI. A field that is merely interesting belongs in
// the prose summary, not in the contract — it costs output tokens on every run.

const BLOCKED = {
  type: "object",
  description:
    "Set is=true only on a hard external blocker you cannot work around (missing credentials, repo absent, an unrelated failure you cannot fix). This ends the run cleanly.",
  properties: {
    is: { type: "boolean" },
    reason: { type: "string", description: "One sentence. Empty when is=false." },
  },
  required: ["is", "reason"],
  additionalProperties: false,
} as const;

const VERIFICATION = {
  type: "object",
  description:
    "Report only what you actually ran. In the two-phase flow the runner blocks publishing on these values; in the one-shot flow publishing has already happened, so a reported failure instead marks the whole run failed and leaves the ticket where it was. Either way a false 'passed' is how unverified code reaches a pull request.",
  properties: {
    tests: { type: "string", enum: ["passed", "failed", "not-run"] },
    build: { type: "string", enum: ["passed", "failed", "not-run"] },
    acceptanceCriteria: { type: "string", enum: ["met", "partial", "cannot-verify"] },
  },
  required: ["tests", "build", "acceptanceCriteria"],
  additionalProperties: false,
} as const;

const ASSUMPTIONS = {
  type: "array",
  description: "Choices you made where the ticket was ambiguous.",
  items: {
    type: "object",
    properties: { item: { type: "string" }, reasoning: { type: "string" } },
    required: ["item", "reasoning"],
    additionalProperties: false,
  },
} as const;

/** plan / replan — consumed by the plan edge (park vs fail) and the Plan tab. */
export const PLAN_OUTPUT = {
  type: "object",
  properties: {
    planWritten: {
      type: "boolean",
      description: "True only if .te/plan.md now exists on disk with the full plan in it.",
    },
    summary: { type: "string", description: "One or two sentences on what the plan covers." },
    assumptions: ASSUMPTIONS,
    blocked: BLOCKED,
  },
  required: ["planWritten", "summary", "assumptions", "blocked"],
  additionalProperties: false,
} as const;

/** implement — consumed by the implement edge (publish vs fail) and the Result tab. */
export const IMPLEMENT_OUTPUT = {
  type: "object",
  properties: {
    committed: {
      type: "boolean",
      description: "True only if the work is committed on the branch. Do NOT push in this phase.",
    },
    branch: { type: "string", description: "The branch you committed on." },
    summary: { type: "string", description: "One or two sentences: what was implemented." },
    verification: VERIFICATION,
    deviations: {
      type: "array",
      description: "Anything that diverged from the approved .te/plan.md.",
      items: {
        type: "object",
        properties: { what: { type: "string" }, why: { type: "string" } },
        required: ["what", "why"],
        additionalProperties: false,
      },
    },
    blocked: BLOCKED,
  },
  required: ["committed", "branch", "summary", "verification", "deviations", "blocked"],
  additionalProperties: false,
} as const;

/** evaluate — the independent review that runs between `implement` and
 *  `publish`, in a **fresh** session so it has not seen the reasoning it is
 *  judging. Deliberately tiny: `verdict` is read by the evaluate edge, and each
 *  `blockers[]` entry is fed verbatim into the fix node's prompt. There is no
 *  `summary` field — the blockers *are* the summary, and a second prose field
 *  would cost output tokens on every review for nothing to read it. */
export const EVALUATE_OUTPUT = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ["pass", "changes-required"],
      description:
        "changes-required only for a defect that must not reach a pull request: a bug this change introduces, an acceptance criterion it misses, or a security/data-loss risk. Style preferences and pre-existing problems are not blockers.",
    },
    blockers: {
      type: "array",
      description: "Empty when verdict is pass. Each entry is handed to the fix step verbatim, so make it actionable.",
      items: {
        type: "object",
        properties: {
          file: { type: "string", description: "Path, with a line number when you have one." },
          issue: { type: "string", description: "What is wrong and what it breaks — one or two sentences." },
        },
        required: ["file", "issue"],
        additionalProperties: false,
      },
    },
    blocked: BLOCKED,
  },
  required: ["verdict", "blockers", "blocked"],
  additionalProperties: false,
} as const;

/** publish — the only external node in the implement graph. `prUrl` replaces the
 *  old regex sniffing of the log for a PR link. */
export const PUBLISH_OUTPUT = {
  type: "object",
  properties: {
    pushed: { type: "boolean" },
    prUrl: { type: "string", description: "Full URL of the pull/merge request. Empty only if none exists." },
    linked: { type: "boolean", description: "True if the ticket is linked to the PR (or the PR body closes it)." },
    reusedExisting: {
      type: "boolean",
      description: "True if a PR already existed for this branch and you reused it instead of creating one.",
    },
    blocked: BLOCKED,
  },
  required: ["pushed", "prUrl", "linked", "reusedExisting", "blocked"],
  additionalProperties: false,
} as const;

/** The v2 one-shot skills do implement + publish in a single external leaf node,
 *  so their contract is the union of the two. */
export const ONESHOT_OUTPUT = {
  type: "object",
  properties: {
    committed: { type: "boolean" },
    branch: { type: "string" },
    summary: { type: "string" },
    verification: VERIFICATION,
    pushed: { type: "boolean" },
    prUrl: { type: "string" },
    linked: { type: "boolean" },
    blocked: BLOCKED,
  },
  required: ["committed", "branch", "summary", "verification", "pushed", "prUrl", "linked", "blocked"],
  additionalProperties: false,
} as const;

/** fix-code-review publish — the external act is writing on someone else's PR
 *  (replies, resolving threads), not opening one. */
export const REVIEW_PUBLISH_OUTPUT = {
  type: "object",
  properties: {
    pushed: { type: "boolean" },
    prUrl: { type: "string" },
    threadsReplied: { type: "integer", description: "How many review threads you replied to." },
    threadsResolved: { type: "integer", description: "How many you marked resolved." },
    blocked: BLOCKED,
  },
  required: ["pushed", "prUrl", "threadsReplied", "threadsResolved", "blocked"],
  additionalProperties: false,
} as const;

/** The v2 fix-code-review one-shot. */
export const REVIEW_ONESHOT_OUTPUT = {
  type: "object",
  properties: {
    committed: { type: "boolean" },
    branch: { type: "string" },
    summary: { type: "string" },
    verification: VERIFICATION,
    pushed: { type: "boolean" },
    prUrl: { type: "string" },
    threadsReplied: { type: "integer" },
    threadsResolved: { type: "integer" },
    blocked: BLOCKED,
  },
  required: [
    "committed", "branch", "summary", "verification",
    "pushed", "prUrl", "threadsReplied", "threadsResolved", "blocked",
  ],
  additionalProperties: false,
} as const;

// ---- typed readers ----
// Structured output is validated by the CLI against the schema above, so these
// only narrow types; they never re-validate or repair.

export type Blocked = { is: boolean; reason: string };

export function blockedOf(data: Record<string, unknown>): Blocked {
  const b = data.blocked as Blocked | undefined;
  return { is: !!b?.is, reason: b?.reason ?? "" };
}

export type Verification = {
  tests: "passed" | "failed" | "not-run";
  build: "passed" | "failed" | "not-run";
  acceptanceCriteria: "met" | "partial" | "cannot-verify";
};

export function verificationOf(data: Record<string, unknown>): Verification {
  const v = data.verification as Partial<Verification> | undefined;
  return {
    tests: v?.tests ?? "not-run",
    build: v?.build ?? "not-run",
    acceptanceCriteria: v?.acceptanceCriteria ?? "cannot-verify",
  };
}

/** A verification result that must stop the run before anything is published.
 *  "not-run" is not a failure — plenty of repos have no test command — but a
 *  check that ran and failed is. */
export function verificationFailed(v: Verification): string {
  if (v.tests === "failed") return "verification.tests=failed";
  if (v.build === "failed") return "verification.build=failed";
  return "";
}
