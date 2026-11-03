// Model and effort per agent step. Judgement that every later step builds on (readiness, plan, evaluate) gets the
// strongest model; the bulk of the token spend (implement, fix) a mid one; mechanical steps whose result a check
// re-verifies (publish → verifyPublish) the cheapest. Aliases resolve to the newest model of the family in the CLI.
// A step missing here runs on the model and effort chosen for the run.
export type StepTurn = { model: string; effort?: string };

export const STEP_MODELS: Record<string, StepTurn> = {
  readiness: { model: "opus", effort: "medium" },
  plan: { model: "opus", effort: "high" },
  implement: { model: "sonnet" },
  evaluate: { model: "opus", effort: "high" },
  fix: { model: "sonnet" },
  reflect: { model: "sonnet" },
  publish: { model: "haiku", effort: "low" },
  qaTriage: { model: "opus" },
  reviewTriage: { model: "sonnet" },
  respond: { model: "sonnet" },
};

/** From this fix attempt on, the same blockers have survived Sonnet twice — escalate. */
export const FIX_ESCALATES_AT = 3;

export function turnFor(nodeId: string, visits: Record<string, number>, run: { model: string; effort: string }): { model: string; effort: string } {
  const step = STEP_MODELS[nodeId];
  if (!step) return { model: run.model, effort: run.effort };
  const escalate = nodeId === "fix" && (visits.fix ?? 0) >= FIX_ESCALATES_AT;
  return { model: escalate ? "opus" : step.model, effort: step.effort ?? run.effort };
}
