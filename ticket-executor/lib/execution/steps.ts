import type { Entry } from "./types";

// Map a tool call to the furthest workflow step it implies (index into STEPS), or -1.
export function stepForTool(name: string, input: Record<string, unknown>): number {
  const n = name.toLowerCase();
  if (n.includes("ado") || n.includes("azure") || n.includes("workitem") || n.includes("github") || n.includes("gitlab") || n.includes("issue")) return 1; // Read ticket
  const cmd = typeof input?.command === "string" ? (input.command as string).toLowerCase() : "";
  if (n === "bash" && cmd) {
    if (/git\s+(checkout\s+-b|switch\s+-c|branch\b)/.test(cmd)) return 2; // Create branch
    if (/git\s+commit/.test(cmd)) return 5; // Commit
    if (/git\s+push|gh\s+pr\s+create/.test(cmd)) return 6; // Open PR
    if (/\btest\b|\blint\b|dotnet\s+(test|build)|npm\s+(run\s+)?(test|build|lint)|jest|vitest|pytest|\bbuild\b/.test(cmd))
      return 4; // Verification
    if (/^cd\s|git\s+status|pwd/.test(cmd)) return 0; // Resolve root
  }
  if (["edit", "write", "multiedit", "notebookedit", "applypatch"].includes(n)) return 3; // Implement
  return -1;
}

export function bump(entry: Entry, step: number) {
  if (step >= 0 && step + 1 > entry.currentStep) entry.currentStep = step + 1;
}
