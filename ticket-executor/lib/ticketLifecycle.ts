export type Stage =
  | "ready"
  | "doing"
  | "blocked"
  | "code-review"
  | "qa"
  | "qa-failed"
  | "qa-passed"
  | "done";

const STAGE_BY_STATUS: Record<string, Stage> = {
  new: "ready",
  refined: "ready",
  "ready for development": "ready",
  "to do": "ready",
  "in progress": "doing",
  active: "doing",
  doing: "doing",
  development: "doing",
  blocked: "blocked",
  "code review": "code-review",
  "in code review": "code-review",
  "in review": "code-review",
  review: "code-review",
  "peer review": "code-review",
  "ready for qa": "qa",
  "in qa": "qa",
  qa: "qa",
  testing: "qa",
  "qa failed": "qa-failed",
  "qa passed": "qa-passed",
  resolved: "done",
  done: "done",
  closed: "done",
  completed: "done",
  accepted: "done",
  removed: "done",
};

export function stageOf(status: string): Stage {
  return STAGE_BY_STATUS[(status ?? "").trim().toLowerCase()] ?? "ready";
}

export function isQueueable(stage: Stage): boolean {
  return stage === "ready" || stage === "doing" || stage === "blocked";
}

export type PendingAction = "" | "move-to-qa" | "fix-qa";

const WITH_QA: ReadonlySet<Stage> = new Set<Stage>(["qa", "qa-passed", "qa-failed"]);

export function pendingActionFor(f: {
  stage: Stage;
  prevStage: Stage | "";
  prMerged: boolean;
  current: PendingAction;
}): PendingAction {
  if (f.stage === "qa-failed") return "fix-qa";
  if (f.stage === "doing" && (f.current === "fix-qa" || (f.prevStage !== "" && WITH_QA.has(f.prevStage)))) {
    return "fix-qa";
  }
  if (f.stage === "code-review" && f.prMerged) return "move-to-qa";
  return "";
}

export function isFixingQa(row: {
  qaRounds: number;
  implementState: string;
  releasedAt: Date | string | null;
}): boolean {
  if (row.qaRounds <= 0) return false;
  return row.implementState === "running" || (row.implementState === "implemented" && !row.releasedAt);
}

export const QA_STAGES: ReadonlySet<Stage> = new Set<Stage>(["qa", "qa-failed", "qa-passed"]);

export function commentsSince(
  marks: { at: string; authorName: string }[],
  since: string,
  isMe: (authorName: string) => boolean
): { count: number; latestAt: string } {
  let count = 0;
  let latestAt = since;
  for (const m of marks) {
    if (m.at > latestAt) latestAt = m.at;
    if (m.at > since && !isMe(m.authorName)) count += 1;
  }
  return { count, latestAt };
}

export const STAGE_LABEL: Record<Stage, string> = {
  ready: "Ready",
  doing: "In progress",
  blocked: "Blocked",
  "code-review": "With reviewer",
  qa: "In QA",
  "qa-failed": "QA failed",
  "qa-passed": "QA passed",
  done: "Done",
};
