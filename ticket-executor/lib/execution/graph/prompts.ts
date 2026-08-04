import type { RunContext } from "./types";

// The ticket is addressed by its provider URL when we know it: a URL names the
// org/project/work item unambiguously, so the skill can open it directly instead
// of searching the tracker for an id that several projects may share.
export function invokeSkill(c: RunContext, mode: string): string {
  const ticket = `Ticket: ${c.ticketUrl || c.ticketId}`;
  const target = c.prUrl ? `PR: ${c.prUrl} - ${ticket}` : ticket;
  return `/${c.skill} Provider: ${c.provider} - ${target} - Project name: ${c.project}${mode ? ` - Mode: ${mode}` : ""}`;
}

// Resume prompts stay short: the session already holds the ticket and the
// codebase reading. Each opens with the same `Mode:` token the first turn used —
// the skill's mode table treats an absent Mode as a different flow entirely.

export const REPLAN_PROMPT =
  "Mode: replan. The plan was rejected. Read .te/feedback.md for the reviewer's reason, then rewrite .te/plan.md to address it. " +
  "Stay in plan mode: no source edits, no branch, no commit. Re-read only the code the feedback actually questions.";

export const IMPLEMENT_PROMPT =
  "Mode: implement. The plan has been reviewed and approved. Re-read .te/plan.md from disk now — the reviewer may have edited it, " +
  "and where that file differs from the plan you proposed earlier, the file wins. Then create the branch, implement the approved " +
  "plan, verify it, and commit locally. " +
  "Do NOT push and do NOT open a pull request — publishing is a separate phase that runs after this one. " +
  "Do not ask for confirmation. You already explored this codebase in the plan phase — do not re-read files you have already read this session.";

export const PUBLISH_PROMPT =
  "Mode: publish. The code is committed and final. Publish it and nothing else: push the branch, then open the pull request — " +
  "but first check whether one already exists for this branch and reuse it if so, since this phase may be retried after a crash. " +
  "Do not edit source, do not commit, do not re-verify, do not re-read the plan.";

export const REVIEW_PUBLISH_PROMPT =
  "Mode: publish. The fixes are committed and final. Publish them and nothing else: push the branch, then reply to each review " +
  "thread you addressed and mark it resolved. Check each thread first — if it already carries your reply or is already resolved, " +
  "skip it, since this phase may be retried after a crash. Do not edit source, do not commit, do not re-verify.";
