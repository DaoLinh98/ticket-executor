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

const SKILLS = {
  type: "array",
  description: "Every installed skill from the brief whose description fits this ticket — empty when none does.",
  items: {
    type: "object",
    properties: {
      name: { type: "string", description: "The skill's name exactly as the brief lists it." },
      reason: { type: "string", description: "One sentence: what in the ticket makes it apply." },
    },
    required: ["name", "reason"],
    additionalProperties: false,
  },
} as const;

const BASE_BRANCH = {
  type: "string",
  description: "The branch a picked skill requires the work to start from and the pull request to target, when it is not the default branch. Empty otherwise.",
} as const;

export const READINESS_OUTPUT = {
  type: "object",
  properties: {
    title: { type: "string", description: "The work item's title." },
    type: { type: "string", description: "The work item's type, e.g. User Story, Bug, Task." },
    ready: { type: "boolean" },
    acceptanceCriteria: { ...STRINGS, description: "The ticket's stated acceptance criteria, one per entry in its order — never items from the description. Only when it states none: criteria derived from the description, each prefixed '(derived)'." },
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
    skills: SKILLS,
    baseBranch: BASE_BRANCH,
    blocked: BLOCKED,
  },
  required: ["title", "type", "ready", "acceptanceCriteria", "missing", "ambiguities", "questions", "delivery", "skills", "baseBranch", "blocked"],
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
    decisions: {
      type: "array",
      description:
        "Judgement calls you made where the ticket leaves room and the readings would build different things — the reading you chose, stated with confidence. " +
        "Most plans need none, a few need one or two. Never list details the code or the ticket already settles, never list alternatives, never ask.",
      items: {
        type: "object",
        properties: {
          point: { type: "string", description: "What the ticket leaves open, in a few words." },
          decision: { type: "string", description: "The reading this plan builds, one sentence." },
          why: { type: "string", description: "The evidence that makes it the right reading: the ticket, the code (path:line) or the product." },
        },
        required: ["point", "decision", "why"],
        additionalProperties: false,
      },
    },
    planMd: { type: "string", description: "The full plan in Markdown, under 80 lines. The harness writes it to .te/plan.md." },
    blocked: BLOCKED,
  },
  required: ["branch", "acMap", "repos", "risks", "decisions", "planMd", "blocked"],
  additionalProperties: false,
} as const;

export const STEP_OUTPUT = {
  type: "object",
  properties: {
    committed: { type: "boolean", description: "True only if the work is committed locally. Do NOT push. False with a clean, unchanged worktree only when the base already does everything asked — say why in summary; a person confirms it." },
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
    checked: {
      type: "array",
      description: "One entry per acceptance criterion and per bug-axis check you actually performed. A pass with none is not a review.",
      items: {
        type: "object",
        properties: {
          subject: { type: "string", description: "The acceptance criterion, or the check (e.g. 'axis bound vs data scale')." },
          how: { type: "string", description: "What you read or ran to verify it." },
          evidence: { type: "string", description: "What proves the result: file:line plus the quoted code or the command run and its outcome. Never empty." },
          result: { type: "string", enum: ["ok", "issue", "unverified"] },
        },
        required: ["subject", "how", "evidence", "result"],
        additionalProperties: false,
      },
    },
    assumptions: { ...STRINGS, description: "What you could not verify and what would settle it. Empty when nothing was left open." },
    blocked: BLOCKED,
  },
  required: ["verdict", "blockers", "checked", "assumptions", "blocked"],
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

export const REVIEW_TRIAGE_OUTPUT = {
  type: "object",
  properties: {
    threads: {
      type: "array",
      description: "One entry per open review thread on the pull request, in the order the provider lists them.",
      items: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "The provider's id for the thread." },
          file: { type: "string", description: "Path with a line number when the thread is anchored to code; empty otherwise." },
          comment: { type: "string", description: "The reviewer's request, in one sentence." },
          decision: {
            type: "string",
            enum: ["fix", "reject", "informational"],
            description: "fix: a valid finding this run changes code for. reject: invalid, out of scope or architectural — answered, not changed. informational: needs no reply.",
          },
          reason: { type: "string", description: "Why, in one sentence. For fix: what will change." },
        },
        required: ["threadId", "file", "comment", "decision", "reason"],
        additionalProperties: false,
      },
    },
    planMd: { type: "string", description: "A short Markdown plan: a Thread Decisions table and, for each fix, the files to change. The harness writes it to .te/plan.md." },
    skills: SKILLS,
    blocked: BLOCKED,
  },
  required: ["threads", "planMd", "skills", "blocked"],
  additionalProperties: false,
} as const;

export const QA_TRIAGE_OUTPUT = {
  type: "object",
  properties: {
    title: { type: "string", description: "The work item's title." },
    findings: {
      type: "array",
      description: "One entry per point QC raised (question, issue, failure) in the comments the brief's window covers.",
      items: {
        type: "object",
        properties: {
          finding: { type: "string", description: "What QC asked or reported, in one sentence." },
          kind: {
            type: "string",
            enum: ["question", "defect", "not-defect", "needs-info", "new-scope", "acknowledgement"],
            description:
              "question: QC asks, and the answer shows the code is right. defect: the code is wrong against the ticket — also when a question's answer reveals that. " +
              "not-defect: the behaviour is right, proven by file:line or the acceptance criterion. needs-info: the code cannot settle it. " +
              "new-scope: QC asks for something the ticket never did. acknowledgement: QC only confirms or informs (a pass, \"verified\", thanks) — it raises nothing to fix, answer or decide.",
          },
          defect: { type: "boolean", description: "True exactly when kind is defect." },
          reason: { type: "string", description: "Evidence for the verdict: file:line with the code, or the acceptance criterion it is checked against. For needs-info, what would settle it." },
          files: { ...STRINGS, description: "Files the fix changes, repo-prefixed when several repos are listed. Empty unless kind is defect." },
        },
        required: ["finding", "kind", "defect", "reason", "files"],
        additionalProperties: false,
      },
    },
    outcome: {
      type: "string",
      enum: ["fix", "no-fix-needed"],
      description: "fix: at least one finding is a real defect. no-fix-needed: none is — nothing will change and the run ends with qaReply.",
    },
    branch: { type: "string", description: "The branch the fix is committed on. Empty when outcome is no-fix-needed." },
    repos: { ...STRINGS, description: "Every repository the fix touches, by the names the brief uses." },
    planMd: { type: "string", description: "The fix plan in Markdown, under 60 lines. Empty when outcome is no-fix-needed. The harness writes it to .te/plan.md." },
    qaReply: {
      type: "string",
      description:
        "The developer's reply to QC, plain text in QC's language, one line per finding: the answer, the evidence that it is right, " +
        "the fix that is coming, or the question that would settle it. Never empty.",
    },
    summary: { type: "string", description: "One sentence: what QA reported and what this run decided." },
    skills: SKILLS,
    baseBranch: BASE_BRANCH,
    blocked: BLOCKED,
  },
  required: ["title", "findings", "outcome", "branch", "repos", "planMd", "qaReply", "summary", "skills", "baseBranch", "blocked"],
  additionalProperties: false,
} as const;

export const RESPOND_OUTPUT = {
  type: "object",
  properties: {
    branch: { type: "string" },
    pushed: { type: "boolean", description: "True if the branch was pushed. False when nothing was committed." },
    replies: {
      type: "array",
      description: "One entry per thread you were asked to answer.",
      items: {
        type: "object",
        properties: {
          threadId: { type: "string" },
          replied: { type: "boolean", description: "True if your reply is on the thread (including one already there from an earlier attempt)." },
        },
        required: ["threadId", "replied"],
        additionalProperties: false,
      },
    },
    threadsReplied: { type: "integer", description: "How many threads carry your reply." },
    threadsResolved: { type: "integer", description: "Always 0 — threads are never resolved by this step." },
    blocked: BLOCKED,
  },
  required: ["branch", "pushed", "replies", "threadsReplied", "threadsResolved", "blocked"],
  additionalProperties: false,
} as const;
