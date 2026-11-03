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

/** A plan row's stored `stage` is already a stage id (`qa-failed`, `code-review`) — not a tracker status, so it must
 *  not go through `stageOf()`. Falls back to the live status when the row has none yet. */
export function stageFrom(stored: string, status: string): Stage {
  return stored in STAGE_LABEL ? (stored as Stage) : stageOf(status);
}

export function isQueueable(stage: Stage): boolean {
  return stage === "ready" || stage === "doing" || stage === "blocked";
}

export const MAX_QA_ROUNDS = 3;

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

/** What the tracker says about a ticket right now: its work item status and its linked pull request, if any. */
export type TrackerFacts = {
  status: string;
  pr: { status: string; isDraft: boolean } | null;
};

export type TrackerStage = { status: "done" | "active" | "blocked"; detail: string };

const PAST_REVIEW: ReadonlySet<Stage> = new Set<Stage>(["qa", "qa-failed", "qa-passed", "done"]);

/** The lifecycle bar's stages (ids from `STAGES`) as the tracker proves them, whatever run is on screen. A stage the
 *  tracker cannot speak to is absent. CI has no source of its own: an active or merged PR counts as CI passed. */
export function trackerStages(t: TrackerFacts): Record<string, TrackerStage> {
  const stage = stageOf(t.status);
  const pr = t.pr && t.pr.status !== "abandoned" ? t.pr : null;
  const merged = pr?.status === "completed";
  const past = PAST_REVIEW.has(stage);
  const out: Record<string, TrackerStage> = {};
  if (pr || past) {
    out.readiness = { status: "done", detail: "Ready" };
    out.implement = { status: "done", detail: "Implemented" };
    out.pr = { status: "done", detail: merged ? "Merged" : pr?.isDraft ? "Draft PR" : "PR open" };
  }
  if (pr?.status === "active" || merged || past) out.ci = { status: "done", detail: merged ? "Merged" : "PR active" };
  if ((pr && !pr.isDraft) || merged || past) out.release = { status: "done", detail: merged ? "Merged" : "Published" };
  if (stage === "code-review") out.review = { status: "active", detail: STAGE_LABEL[stage] };
  else if (past || merged) out.review = { status: "done", detail: "Reviewed" };
  if (stage === "qa") out.qa = { status: "active", detail: STAGE_LABEL[stage] };
  else if (stage === "qa-failed") out.qa = { status: "blocked", detail: STAGE_LABEL[stage] };
  else if (stage === "qa-passed" || stage === "done") out.qa = { status: "done", detail: STAGE_LABEL[stage] };
  if (merged || past) out.merged = { status: "done", detail: "Merged" };
  if (stage === "done") out.closed = { status: "done", detail: STAGE_LABEL[stage] };
  return out;
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
