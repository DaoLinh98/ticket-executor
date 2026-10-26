import { COLORS } from "@/lib/ui";

export const ACCENT = COLORS.accent;
// Suggested skills for the Ask tab — free text is still allowed.
export const SKILL_OPTIONS = [
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
