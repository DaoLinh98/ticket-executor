export type LoopRun = {
  id: string;
  ticketId: string;
  skill: string;
  state: string;
  startedAt: Date;
  endedAt: Date | null;
};

const isImplement = (skill: string) => skill.startsWith("implement-ticket");
const isRework = (skill: string) => skill.startsWith("fix-code-review-") || skill.startsWith("fix-qa-");

export function reviewEscapes(runs: LoopRun[], reviewedRunIds: Set<string>): { passed: number; escaped: number } {
  const passed = runs.filter((r) => isImplement(r.skill) && r.state === "succeeded" && r.endedAt && reviewedRunIds.has(r.id));
  const escaped = passed.filter((p) =>
    runs.some((r) => r.ticketId === p.ticketId && isRework(r.skill) && r.startedAt.getTime() >= p.endedAt!.getTime())
  );
  return { passed: passed.length, escaped: escaped.length };
}
