import { COLORS } from "@/lib/ui";

export const ACCENT = COLORS.accent;
export const DEFAULT_SKILL = "implement-ticket-v3";

// Result-tab section split: order implementation before review, with friendly titles.
// "senior-code-review" section disabled along with the run code-review feature below.
export const RESULT_SKILL_ORDER = ["implement-ticket-v3", "implement-ticket-v2", /* "senior-code-review", */ "fix-code-review-v2"];
export const RESULT_SKILL_TITLE: Record<string, string> = {
  "implement-ticket-v3": "Implementation",
  "implement-ticket-v2": "Implementation",
  // "senior-code-review": "Code Review",
  "fix-code-review-v2": "Fix Code Review",
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
export const COMMON_ROOT_REPOS = ["C:\\repos", "C:\\src", "D:\\repos"];
