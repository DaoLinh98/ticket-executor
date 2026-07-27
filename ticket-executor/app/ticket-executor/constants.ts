import { COLORS } from "@/lib/ui";

export const ACCENT = COLORS.accent;
export const DEFAULT_SKILL = "implement-ticket-v3";

// Result-tab section split: order implementation before review, with friendly titles.
// "senior-code-review" section disabled along with the run code-review feature below.
export const RESULT_SKILL_ORDER = ["implement-ticket-v3", "implement-ticket-v2", /* "senior-code-review", */ "fix-code-review-v2", "fix-code-review-v3"];
export const RESULT_SKILL_TITLE: Record<string, string> = {
  "implement-ticket-v3": "Implementation",
  "implement-ticket-v2": "Implementation",
  // "senior-code-review": "Code Review",
  "fix-code-review-v2": "Fix Code Review",
  "fix-code-review-v3": "Fix Code Review",
};

// Suggested skills for the Overview combobox — free text is still allowed.
export const SKILL_OPTIONS = [
  "implement-ticket-v3",
  "implement-ticket-v2",
  "fix-issue",
  "fix-code-review",
  // "senior-code-review", // run code-review feature disabled for now
  "testing-report",
  "review-re-estimate-ado-tickets",
  "tackle-requirement",
];
// Root Repo has no suggested defaults on purpose: it must be the clone itself,
// so a generic parent folder like C:\repos is always wrong. The combobox is
// seeded only from paths actually used before (SavedOption / RootRepoProjectMap).
