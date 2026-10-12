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
    "Report only what you actually ran. The runner blocks publishing on these values, so a false 'passed' is how unverified code reaches a pull request.",
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

/** The delivering contract every local phase shares — consumed by the implement
 *  and fix edges (check vs fail) and the Result tab. */
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
      description: "Anything that diverged from .te/plan.md.",
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
    // The reviewer is the best-placed node to spot a *recurring* defect: it is
    // fresh, it judges rather than defends, and it sees the finished diff.
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
    isDraft: {
      type: "boolean",
      description: "True if the pull request is in draft state. The harness publishes it later, on the sprint plan's release day.",
    },
    blocked: BLOCKED,
  },
  required: ["pushed", "prUrl", "linked", "reusedExisting", "isDraft", "blocked"],
  additionalProperties: false,
} as const;

/** implement / fix — a local attempt that must also say why it adds no test,
 *  read by the `check` node's test gate. */
export const STEP_OUTPUT = {
  type: "object",
  properties: {
    ...IMPLEMENT_OUTPUT.properties,
    testExemption: {
      type: "string",
      description:
        "Empty when the change adds or updates a test. Otherwise one sentence on why no test applies (markup, style or copy only). The runner refuses a change with no test and no reason.",
    },
  },
  required: [...IMPLEMENT_OUTPUT.required, "testExemption"],
  additionalProperties: false,
} as const;

/** fix-qa `implement` — reviews the findings and either commits the fix
 *  locally or ends the run with a reply to QA. Nothing is pushed here. */
export const QA_IMPLEMENT_OUTPUT = {
  type: "object",
  properties: {
    ...STEP_OUTPUT.properties,
    outcome: {
      type: "string",
      enum: ["fixed", "no-fix-needed"],
      description:
        "fixed: at least one QA finding was a real defect and the fix is committed locally. " +
        "no-fix-needed: every finding was reviewed against the code and none is a defect in this ticket — nothing was changed or committed.",
    },
    qaReply: {
      type: "string",
      description: "When outcome is no-fix-needed: the developer's reply to QA, plain text, one line per finding. Empty when outcome is fixed.",
    },
  },
  required: [...STEP_OUTPUT.required, "outcome", "qaReply"],
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

export const REFLECT_OUTPUT = {
  type: "object",
  properties: {
    recorded: { type: "boolean", description: "True if you added or updated a lesson in KNOWLEDGE.md." },
    lesson: {
      type: "string",
      description: "The lesson you recorded, in one or two sentences. Empty when recorded is false.",
    },
  },
  required: ["recorded", "lesson"],
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
