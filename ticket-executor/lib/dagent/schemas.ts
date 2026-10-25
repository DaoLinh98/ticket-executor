const BLOCKED = {
  type: "object",
  description: "Set is=true only on a hard external blocker you cannot work around. This ends the run.",
  properties: {
    is: { type: "boolean" },
    reason: { type: "string", description: "One sentence. Empty when is=false." },
  },
  required: ["is", "reason"],
  additionalProperties: false,
} as const;

const STRINGS = { type: "array", items: { type: "string" } } as const;

export const READINESS_OUTPUT = {
  type: "object",
  properties: {
    title: { type: "string", description: "The work item's title." },
    type: { type: "string", description: "The work item's type, e.g. User Story, Bug, Task." },
    ready: { type: "boolean" },
    acceptanceCriteria: { ...STRINGS, description: "Every acceptance criterion, stated or derived, one per entry." },
    missing: { ...STRINGS, description: "Information the ticket lacks. Empty when ready." },
    ambiguities: { ...STRINGS, description: "Requirements with materially different readings. Empty when ready." },
    questions: { ...STRINGS, description: "Questions for the Product Owner. Empty when ready." },
    delivery: {
      type: "object",
      description: "Whether the acceptance criteria are already on the base commits named in the brief.",
      properties: {
        status: { type: "string", enum: ["none", "partial", "done"], description: "done only when every acceptance criterion is already delivered." },
        evidence: {
          type: "array",
          description: "One entry per acceptance criterion that is already delivered. Empty when status is none.",
          items: {
            type: "object",
            properties: {
              ac: { type: "string" },
              repo: { type: "string", description: "The repository name exactly as the brief gives it." },
              proof: { type: "string", description: "Commit, merged pull request or file:line that delivers it." },
            },
            required: ["ac", "repo", "proof"],
            additionalProperties: false,
          },
        },
      },
      required: ["status", "evidence"],
      additionalProperties: false,
    },
    blocked: BLOCKED,
  },
  required: ["title", "type", "ready", "acceptanceCriteria", "missing", "ambiguities", "questions", "delivery", "blocked"],
  additionalProperties: false,
} as const;

export const PLAN_OUTPUT = {
  type: "object",
  properties: {
    branch: { type: "string", description: "The branch the implementer must create." },
    acMap: {
      type: "array",
      description: "One entry per acceptance criterion.",
      items: {
        type: "object",
        properties: {
          ac: { type: "string" },
          files: { ...STRINGS, description: "Files that implement it, repo-prefixed when several repos are listed." },
          test: { type: "string", description: "The test that proves it." },
        },
        required: ["ac", "files", "test"],
        additionalProperties: false,
      },
    },
    repos: { ...STRINGS, description: "Every repository the change touches, by the names the brief uses." },
    risks: STRINGS,
    planMd: { type: "string", description: "The full plan in Markdown, under 80 lines. The harness writes it to .te/plan.md." },
    blocked: BLOCKED,
  },
  required: ["branch", "acMap", "repos", "risks", "planMd", "blocked"],
  additionalProperties: false,
} as const;

export const STEP_OUTPUT = {
  type: "object",
  properties: {
    committed: { type: "boolean", description: "True only if the work is committed locally. Do NOT push." },
    branch: { type: "string", description: "The branch you committed on." },
    summary: { type: "string", description: "One or two sentences: what changed." },
    verification: {
      type: "object",
      description: "Report only what you actually ran.",
      properties: {
        tests: { type: "string", enum: ["passed", "failed", "not-run"] },
        build: { type: "string", enum: ["passed", "failed", "not-run"] },
        acceptanceCriteria: { type: "string", enum: ["met", "partial", "cannot-verify"] },
      },
      required: ["tests", "build", "acceptanceCriteria"],
      additionalProperties: false,
    },
    deviations: {
      type: "array",
      description: "Anything that diverged from .te/plan.md, including any acceptance criterion left out.",
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

export const EVALUATE_OUTPUT = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "changes-required"] },
    blockers: {
      type: "array",
      description: "Empty when verdict is pass. Each entry is handed to the fixer verbatim.",
      items: {
        type: "object",
        properties: {
          file: { type: "string", description: "Path, with a line number when you have one." },
          issue: { type: "string", description: "What is wrong and what it breaks." },
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

export const REFLECT_OUTPUT = {
  type: "object",
  properties: {
    recorded: { type: "boolean", description: "True if you added or updated a lesson in KNOWLEDGE.md." },
    lesson: { type: "string", description: "The lesson recorded. Empty when recorded is false." },
  },
  required: ["recorded", "lesson"],
  additionalProperties: false,
} as const;

export const PUBLISH_OUTPUT = {
  type: "object",
  properties: {
    prs: {
      type: "array",
      description: "One entry per repository you were asked to publish.",
      items: {
        type: "object",
        properties: {
          repo: { type: "string", description: "The repository name exactly as the brief gave it." },
          branch: { type: "string" },
          pushed: { type: "boolean" },
          prUrl: { type: "string", description: "Full URL of the pull request. Empty only if none exists." },
          isDraft: { type: "boolean" },
          reusedExisting: { type: "boolean" },
          linked: { type: "boolean", description: "True if the ticket is linked to the pull request." },
        },
        required: ["repo", "branch", "pushed", "prUrl", "isDraft", "reusedExisting", "linked"],
        additionalProperties: false,
      },
    },
    blocked: BLOCKED,
  },
  required: ["prs", "blocked"],
  additionalProperties: false,
} as const;
