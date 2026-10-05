import type { RunContext } from "./types";

// The ticket is addressed by its provider URL when we know it: a URL names the
// org/project/work item unambiguously, so the skill can open it directly instead
// of searching the tracker for an id that several projects may share.
/**
 * Why every pull request this app opens starts as a draft.
 *
 * Opening a pull request is what notifies a reviewer, so opening it *is*
 * publishing. The agent works ahead — through the night, through a weekend,
 * several tickets deep — and if each finished ticket announced itself the moment
 * it was done, a reviewer would receive a fortnight of work in two days and
 * review none of it properly.
 *
 * So the two are separated: the agent finishes and parks the work in draft, and
 * the harness publishes it on the day the sprint plan says (`lib/execution/
 * release.ts`), assigning the reviewers and moving the work item then. The agent
 * is told not to assign reviewers for the same reason it is told not to publish —
 * both are the reviewer's notification, and neither belongs to the node.
 */
export const DRAFT_RULE =
  "Open it as a DRAFT pull request and leave it as one — do NOT mark it ready for review, and do NOT add reviewers. " +
  "This is not optional and it is not a limitation: the work is handed to a reviewer later, on a schedule, by the " +
  "application itself. Report the draft state in your `isDraft` field. If a pull request already exists and is " +
  "already published, leave it published and report `isDraft: false` rather than turning it back into a draft.\n";

export function invokeSkill(c: RunContext, mode: string): string {
  const ticket = `Ticket: ${c.ticketUrl || c.ticketId}`;
  const target = c.prUrl ? `PR: ${c.prUrl} - ${ticket}` : ticket;
  return `/${c.skill} Provider: ${c.provider} - ${target} - Project name: ${c.project}${mode ? ` - Mode: ${mode}` : ""}`;
}

/**
 * The opening prompt of a run, with what earlier runs learned about this repo
 * appended.
 *
 * Only the *first* turn gets it. A `resume` node is already carrying the block
 * in its transcript, and re-stating it would pay for the same lines twice while
 * inviting the agent to treat a repetition as new emphasis. `publish` is fresh
 * but is not deciding anything a repo convention bears on — it pushes a branch
 * that is already final.
 */
/**
 * Why a review run has to check out a branch that already exists.
 *
 * An isolated run gets its working tree from `git worktree add --detach <wt> HEAD`
 * (`runner.ts`), which puts it on whatever commit the root repository happened to
 * be sitting on. For the implement flow that is the right starting point — the
 * branch does not exist yet and the agent creates it. For the review flow it is
 * the wrong tree entirely: the pull request's changes are not in it, so every file
 * the threads point at is read at its pre-change contents, and a commit would
 * land on a detached HEAD that nothing can push.
 *
 * The fix is a prompt rather than a second worktree recipe in the engine: the
 * source branch is a fact only the provider knows, and resolving it before the
 * tree exists would put a provider read inside `startRun()`'s advisory-lock
 * transaction. The agent is already talking to the provider for the threads.
 */
export const REVIEW_BRANCH_RULE =
  "\n\nBEFORE you read any file or change anything: this working tree is NOT on the pull request's branch. " +
  "It was created detached at an unrelated commit, so the code under review is not in it and every file would read " +
  "at its pre-change contents. Run `git fetch origin`, take the source branch name from the pull request you just " +
  "fetched, and check it out (it already exists on the remote). Verify with `git branch --show-current` before going " +
  "further. Every read, commit and push in this run happens on that branch: never create a branch, and never commit " +
  "on a detached HEAD.\n";

export function openingPrompt(
  c: RunContext,
  mode: string,
  opts: { opensPr?: boolean; review?: boolean } = {}
): string {
  // The one-shot implement flow opens its pull request inside this same node —
  // there is no separate publish prompt to carry the draft rule — so it is
  // attached here instead. The graph says whether the node opens anything rather
  // than this function inferring it from `mode`: the one-shot *review* flow
  // shares both this prompt and that mode, and it opens nothing at all. It works
  // on a pull request somebody else already published, so telling it to open a
  // draft would be an instruction with no referent, and asking it for `isDraft`
  // would ask for a field its contract does not declare.
  const draft = opts.opensPr ? "\n\n" + DRAFT_RULE : "";
  // Both review nodes that run `fresh` need this, and for the same reason: the
  // plan phase reads the code under review, the one-shot reads and rewrites it,
  // and neither is on the branch that holds it until it says so.
  const branch = opts.review ? REVIEW_BRANCH_RULE : "";
  return invokeSkill(c, mode) + branch + draft + c.knowledge;
}

// Resume prompts stay short: the session already holds the ticket and the
// codebase reading. Each opens with the same `Mode:` token the first turn used —
// the skill's mode table treats an absent Mode as a different flow entirely.

/**
 * Sent when a node is re-entered after the account ran out of quota mid-turn.
 *
 * It replaces the node's own prompt rather than repeating it, and that is the
 * whole point of resuming the cut-off session instead of starting the node over:
 * the transcript already holds the brief, the files read and the work done, and
 * re-sending the opening prompt would ask an agent that is halfway through a
 * ticket to begin it again. It says nothing about *what* to do — only that the
 * interruption was ours, and that the same output contract still applies.
 */
export const LIMIT_RESUME_PROMPT =
  "Continue. Your previous turn was cut off because the account hit its usage limit — nothing you did was rejected and " +
  "nothing about the task has changed. Check the current state of the working tree and the branch before acting, since " +
  "some of what you intended may already be done, then finish the work and report the result through your output contract.";

export const REPLAN_PROMPT =
  "Mode: replan. The plan was rejected. Read .te/feedback.md for the reviewer's reason, then rewrite .te/plan.md to address it. " +
  "Stay in plan mode: no source edits, no branch, no commit. Re-read only the code the feedback actually questions.";

export const IMPLEMENT_PROMPT =
  "Mode: implement. The plan has been reviewed and approved. Re-read .te/plan.md from disk now — the reviewer may have edited it, " +
  "and where that file differs from the plan you proposed earlier, the file wins. Then create the branch, implement the approved " +
  "plan, verify it, and commit locally. " +
  "Do NOT push and do NOT open a pull request — publishing is a separate phase that runs after this one. " +
  "Do not ask for confirmation. You already explored this codebase in the plan phase — do not re-read files you have already read this session.";

/**
 * The publish brief for the **implement** flow, sent in a *fresh* session.
 *
 * Publishing used to resume the plan+implement session, and that was the single
 * most expensive thing the harness did per unit of work. Measured on one 8-file
 * ticket: pushing a branch and opening a PR took 6 turns, 602k cache-read and
 * 153k cache-write tokens — about a fifth of the whole run's cost — because
 * `--resume` replays the entire transcript and the human gate ahead of it had
 * long since let the prompt cache expire.
 *
 * It resumed for no reason: publishing needs four facts, and every one of them is
 * already a contract field or a file on disk. So this node is now told them
 * outright. The transcript it no longer carries was never read — the skill's
 * publish phase forbids editing, committing and re-verifying, which is all the
 * transcript was good for.
 *
 * `invokeSkill` is used rather than a bare instruction because a fresh session
 * has not loaded the skill: without the slash command the CLI answers `Unknown
 * command` and the node fails its contract. Re-reading the ~14 KB skill is the
 * price of this change, and it is roughly two orders of magnitude cheaper than
 * the transcript it replaces.
 *
 * **The review flow deliberately does not use this** — see REVIEW_PUBLISH_PROMPT.
 */
export function publishPrompt(c: RunContext): string {
  // Whichever node committed last owns the branch name: with the evaluator on,
  // that is `fix`, otherwise `implement`. Both answer IMPLEMENT_OUTPUT, so the
  // field is in the same place either way.
  const branch =
    String(c.channels.fix?.branch ?? c.channels.implement?.branch ?? "").trim();
  return (
    `${invokeSkill(c, "publish")}${branch ? ` - Branch: ${branch}` : ""}\n\n` +
    "You are starting a FRESH session: you did not write this code and have no memory of the earlier phases. " +
    "That is deliberate and nothing is missing — the work is already committed and final on the branch above " +
    (branch ? "" : "(find it with `git branch --show-current` in this working tree) ") +
    "and your only job is to publish it.\n" +
    "Push the branch, then open the pull request. Check first whether one already exists for this branch and reuse " +
    "it if so, since this phase may be retried after a crash. Use `.te/plan.md` and `git log` for the PR title and " +
    "description — do not re-derive them by reading the source.\n" +
    DRAFT_RULE +
    "Do not edit source, do not commit, do not re-verify, and do not review the diff."
  );
}

/** The skill the evaluate node invokes. Versioned and preflight-checked like the
 *  other four rather than living as a paragraph in this file: `evaluate` is the
 *  only node that runs `fresh` *and* loads no other skill, so it is the one whose
 *  reading discipline is least constrained and most expensive to get wrong. */
export const REVIEW_SKILL = "review-changes-v1";

/** The evaluator's prompt. This node runs in a **fresh** session on purpose, so
 *  unlike the resume prompts above it can assume nothing: it has to be told the
 *  ticket and where the change set starts. Everything else — what counts as a
 *  blocker, what it may not touch, how much it is allowed to read — is the
 *  skill's job, so it can be edited and versioned without a code change. */
export function evaluatePrompt(c: RunContext): string {
  const ticket = c.ticketUrl || c.ticketId;
  return `/${REVIEW_SKILL} Provider: ${c.provider} - Ticket: ${ticket}${c.baseSha ? ` - Base: ${c.baseSha}` : ""}`;
}

export function qaEvaluatePrompt(c: RunContext): string {
  return `${evaluatePrompt(c)} - Mode: qa-fix`;
}

export function qaFixPrompt(c: RunContext): string {
  const check = c.channels.check;
  if (check && check.passed === false) {
    const blockers = (check.blockers ?? []) as { file?: string; issue?: string }[];
    const list = blockers.map((b, i) => `${i + 1}. ${b.issue ?? ""}`).join("\n");
    return (
      "Mode: implement. The runner's own check of your change refused it:\n\n" +
      `${list}\n\n` +
      "Add or update a test that fails without your fix and passes with it, following the existing test style, re-run it, " +
      "and commit locally. If the change truly has nothing a test can cover (markup, style or copy only), say why in " +
      "`testExemption` instead. Do NOT push or open a pull request."
    );
  }
  return fixPrompt(c);
}

/** Fed the reviewer's own findings back to the implementer. Built from the
 *  evaluate node's channel rather than from prose in the transcript — the fix
 *  node resumes the implementer's session, so everything else it needs is
 *  already there. */
export function fixPrompt(c: RunContext): string {
  const blockers = (c.channels.evaluate?.blockers ?? []) as { file?: string; issue?: string }[];
  const list = blockers
    .map((b, i) => `${i + 1}. ${b.file ? `${b.file} — ` : ""}${b.issue ?? ""}`)
    .join("\n");
  return (
    "Mode: implement. An independent review of your change found blocking issues:\n\n" +
    `${list}\n\n` +
    "Fix exactly these, re-run the verification you ran before, and commit locally. " +
    "Do not rewrite anything the review did not raise, and do NOT push or open a pull request — " +
    "publishing is a separate phase that runs after the review passes."
  );
}

/**
 * The publish brief for the **review** flow. Still `context: "resume"`, and that
 * asymmetry with `publishPrompt` is the point rather than an oversight.
 *
 * This phase does not just ship code: it answers the reviewer, thread by thread,
 * for the threads *this run chose to act on*. Which threads those were, and what
 * was done about each, exists only in the session that did the work — it is not a
 * contract field, not in `.te/`, and not recoverable from the diff, since a
 * commit does not say which comment it answers. A fresh session here would have
 * to guess, and guessing means replying on the wrong thread or resolving one
 * nobody addressed, on someone else's pull request, where it cannot be taken back.
 *
 * Publishing the implement flow costs a transcript replay it never reads; this
 * one reads it. Do not "make the two consistent" without first giving the fix
 * node a contract field that names the threads it answered.
 */
export const REVIEW_PUBLISH_PROMPT =
  "Mode: publish. The fixes are committed and final. Publish them and nothing else: push the branch, then reply to each review " +
  "thread you addressed and mark it resolved. Check each thread first — if it already carries your reply or is already resolved, " +
  "skip it, since this phase may be retried after a crash. Do not edit source, do not commit, do not re-verify.";
