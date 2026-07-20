// Model/effort choices offered on the Overview tab and passed to the `claude`
// CLI as --model / --effort. Keep ids in sync with what the installed CLI
// accepts (`claude --help`).
export const CLAUDE_MODELS = [
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  { id: "claude-fable-5", label: "Fable 5" },
] as const;

export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5";
export const DEFAULT_CLAUDE_EFFORT = "medium";

export function modelLabel(id: string): string {
  return CLAUDE_MODELS.find((m) => m.id === id)?.label ?? id;
}

export function modelIdForLabel(label: string): string {
  return CLAUDE_MODELS.find((m) => m.label === label)?.id ?? label;
}
