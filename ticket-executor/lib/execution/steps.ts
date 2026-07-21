import type { ExecPhase } from "../types";
import type { Entry } from "./types";

// Map a tool call to the furthest workflow step it implies (index into STEPS), or -1.
// The same tool means different things per phase — an Edit during the plan phase is
// the agent drafting .te/plan.md ("Draft plan"), during implement it is real code
// ("Implement changes") — so the mapping is phase-aware.
export function stepForTool(name: string, input: Record<string, unknown>, phase: ExecPhase): number {
  const n = name.toLowerCase();
  const cmd = typeof input?.command === "string" ? (input.command as string).toLowerCase() : "";
  const isTracker =
    n.includes("ado") || n.includes("azure") || n.includes("workitem") ||
    n.includes("github") || n.includes("gitlab") || n.includes("issue");
  const isWrite = ["edit", "write", "multiedit", "notebookedit", "applypatch"].includes(n);

  if (phase === "plan") {
    if (isTracker) return 1; // Read ticket
    if (isWrite) return 3; // Draft plan (the only file the plan phase writes is .te/plan.md)
    if (["read", "grep", "glob", "search", "webfetch"].includes(n)) return 2; // Analyze codebase
    if (n === "bash" && cmd) {
      if (/^cd\s|git\s+status|pwd|git\s+log|git\s+remote/.test(cmd)) return 0; // Prepare workspace
      return 2; // any other read-only probing still counts as analysis
    }
    return -1;
  }

  // implement phase — everything from the plan gate onwards
  if (n === "bash" && cmd) {
    if (/git\s+(checkout\s+-b|switch\s+-c|branch\b)/.test(cmd)) return 5; // Create branch
    if (/git\s+push|gh\s+pr\s+create|glab\s+mr\s+create|az\s+repos\s+pr/.test(cmd)) return 9; // Open PR
    if (/git\s+commit/.test(cmd)) return 8; // Commit & push
    if (/\btest\b|\blint\b|dotnet\s+(test|build)|npm\s+(run\s+)?(test|build|lint)|jest|vitest|pytest|\bbuild\b/.test(cmd))
      return 7; // Run verification
  }
  if (isTracker && /pull_request|pullrequest|link/.test(n)) return 9;
  if (isWrite) return 6; // Implement changes
  return -1;
}

export function bump(entry: Entry, step: number) {
  if (step >= 0 && step + 1 > entry.currentStep) entry.currentStep = step + 1;
}
