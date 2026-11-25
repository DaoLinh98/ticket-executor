// What the sprint has cost so far and what finishing it is likely to cost, from what the plan already holds.
// Pure: rows, spend by ticket id and the calendar come in; nothing is read or written here.

export type SpendRow = {
  ticketId: string;
  claim: string;
  points: number;
  implementState: string;
  implementOrder: number;
  prUrl: string;
};

export type SprintSpend = {
  /** Everything spent on the tickets in the plan. */
  spent: number;
  /** Tickets an agent has delivered a pull request for, and what they cost on average (0 until one is). */
  finished: number;
  avgPerFinished: number;
  /** Tickets still to run, and the estimate for them: the average times the count. */
  remaining: number;
  projectedRemaining: number;
  projectedTotal: number;
  overBudget: number;
  /** Points still to build against the points the days left can release. */
  pointsLeft: number;
  capacityLeft: number;
  fits: boolean;
};

const TODO = new Set(["pending", "failed", "skipped"]);

export function sprintSpend(rows: SpendRow[], costs: Record<string, number>, budgetUsd: number, daysLeft: number, pointsPerDay: number): SprintSpend {
  const cost = (t: SpendRow) => costs[t.ticketId] ?? 0;
  const mine = rows.filter((t) => t.claim === "mine");
  const finishedRows = mine.filter((t) => !!t.prUrl && t.implementState === "implemented" && cost(t) > 0);
  const todo = mine.filter((t) => !t.prUrl && t.implementOrder > 0 && TODO.has(t.implementState));
  const running = mine.filter((t) => t.implementState === "running");
  const spent = rows.reduce((n, t) => n + cost(t), 0);
  const avgPerFinished = finishedRows.length ? finishedRows.reduce((n, t) => n + cost(t), 0) / finishedRows.length : 0;
  const projectedRemaining = avgPerFinished * todo.length;
  const pointsLeft = [...todo, ...running].reduce((n, t) => n + t.points, 0);
  const capacityLeft = Math.max(0, daysLeft) * Math.max(0, pointsPerDay);
  return {
    spent,
    finished: finishedRows.length,
    avgPerFinished,
    remaining: todo.length,
    projectedRemaining,
    projectedTotal: spent + projectedRemaining,
    overBudget: budgetUsd > 0 ? mine.filter((t) => cost(t) >= budgetUsd).length : 0,
    pointsLeft,
    capacityLeft,
    fits: pointsLeft <= capacityLeft,
  };
}
