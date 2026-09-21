// Model/effort choices offered on the Overview tab and passed to the `claude`
// CLI as --model / --effort.
//
// The real list is read from the installed CLI at request time
// (`lib/claudeModels.ts`) so it never lags a release. `CLAUDE_MODELS` below is
// the fallback for when that scan finds nothing: family aliases, which the CLI
// documents as "an alias for the latest model", so a run still gets the current
// model — only its version number is unnamed in the dropdown.
export type ClaudeModel = { id: string; label: string };

export const CLAUDE_MODELS: readonly ClaudeModel[] = [
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
  { id: "fable", label: "Fable" },
];

export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export const DEFAULT_CLAUDE_MODEL = "opus";
export const DEFAULT_CLAUDE_EFFORT = "medium";

export function modelLabel(id: string, models: readonly ClaudeModel[] = CLAUDE_MODELS): string {
  return models.find((m) => m.id === id)?.label ?? id;
}

export function modelIdForLabel(label: string, models: readonly ClaudeModel[] = CLAUDE_MODELS): string {
  return models.find((m) => m.label === label)?.id ?? label;
}

/** The stored `opus` alias against a scanned list means the concrete newest Opus. */
export function resolveModelId(id: string, models: readonly ClaudeModel[]): string {
  if (models.some((m) => m.id === id)) return id;
  const byFamily = models.find((m) => m.id.includes(`-${id}-`) || m.id === `claude-${id}`);
  return byFamily?.id ?? id;
}
