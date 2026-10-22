import path from "path";
import { acceptancePartial, lastDelivery } from "./schemas";
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
 * The project's memory: `KNOWLEDGE.md` in the Root repo, never in the worktree.
 *
 * An isolated run's worktree is deleted when the run finishes, so a lesson
 * written there would die with it — and the file is local-only by design, never
 * committed, so git would not carry it back either. Naming the Root repo copy
 * by absolute path is what lets a lesson outlive the run that learned it. Two
 * runs may share the file; the skills re-read it right before editing.
 */
export function knowledgeFile(rootRepo: string): string {
  return rootRepo ? path.join(rootRepo, "KNOWLEDGE.md") : "";
}

function withKnowledge(c: RunContext, prompt: string): string {
  const file = knowledgeFile(c.rootRepo);
  return file ? `${prompt} - Knowledge: ${file}` : prompt;
}

function withRepos(c: RunContext, prompt: string): string {
  if (!c.companions.length) return prompt;
  return `${prompt} - Repos: ${c.companions.map((m) => `${m.name}=${m.cwd} base=${m.baseSha}`).join("; ")}`;
}

export function companionsToPublish(c: RunContext): { name: string; cwd: string; branch: string }[] {
  const list = c.channels.check?.companions;
  return Array.isArray(list) ? (list as { name: string; cwd: string; branch: string }[]) : [];
}

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

/** The first turn of a run. It carries the project's memory path; the `fix`
 *  turns that resume its session already hold that line in their transcript. */
export function openingPrompt(c: RunContext, mode: string, opts: { review?: boolean } = {}): string {
  // The review flow's first turn reads and rewrites the code under review, and
  // it is not on the branch that holds that code until it checks it out.
  const branch = opts.review ? REVIEW_BRANCH_RULE : "";
  return withRepos(c, withKnowledge(c, invokeSkill(c, mode))) + branch;
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
  // Whichever node committed last owns the branch name: `fix` when a refusal
  // sent the run round the loop, otherwise `implement`. Both answer
  // STEP_OUTPUT, so the field is in the same place either way.
  const branch =
    String(c.channels.fix?.branch ?? c.channels.implement?.branch ?? "").trim();
  const companions = companionsToPublish(c);
  const rootUnchanged = c.channels.check?.rootChanged === false;
  const others = companions.length
    ? "\n\nThis ticket also changed other repositories. Publish each of them the same way — push its branch, reuse the " +
      "pull request already open for that branch or open one against that repository's default branch, and link the " +
      "ticket — and report every one in `prs`, using the name given here:\n" +
      companions.map((m) => `- ${m.name}: working tree \`${m.cwd}\`, branch \`${m.branch}\``).join("\n") +
      "\nIn every pull request description, list the ticket's other pull requests as companion pull requests." +
      (rootUnchanged
        ? `\nThe root repository \`${path.basename(c.rootRepo)}\` (\`${c.cwd}\`) has no change for this ticket: do not push it and do not open a pull request for it. ` +
          "That is expected, not an error — the work lives in the repositories listed above, so publish every one of them " +
          "as instructed and report `pushed: false` and an empty `prUrl` for the root repository only."
        : "") +
      "\n"
    : "";
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
    "Do not edit source, do not commit, do not re-verify, and do not review the diff." +
    others
  );
}

/** The skill the evaluate node invokes. Versioned and preflight-checked like the
 *  other four rather than living as a paragraph in this file: `evaluate` is the
 *  only node that runs `fresh` *and* loads no other skill, so it is the one whose
 *  reading discipline is least constrained and most expensive to get wrong. */
export const REVIEW_SKILL = "review-changes-v4";

/** The evaluator's prompt. This node runs in a **fresh** session on purpose, so
 *  unlike the resume prompts above it can assume nothing: it has to be told the
 *  ticket and where the change set starts. Everything else — what counts as a
 *  blocker, what it may not touch, how much it is allowed to read — is the
 *  skill's job, so it can be edited and versioned without a code change. */
export function evaluatePrompt(c: RunContext, mode = ""): string {
  const ticket = c.ticketUrl || c.ticketId;
  const pr = mode === "review-fix" && c.prUrl ? ` - PR: ${c.prUrl}` : "";
  const base = `/${REVIEW_SKILL} Provider: ${c.provider} - Ticket: ${ticket}${pr}${c.baseSha ? ` - Base: ${c.baseSha}` : ""}`;
  return withRepos(c, withKnowledge(c, base)) + (mode ? ` - Mode: ${mode}` : "");
}

/** Fed whichever refusal sent the run round the loop back to the implementer.
 *  Built from the refusing node's channel rather than from prose in the
 *  transcript — the fix node resumes the implementer's session, so everything
 *  else it needs is already there. The test gate is read first: it runs before
 *  the reviewer, so a failed check is always the newer refusal. */
export function fixPrompt(c: RunContext, gateAcceptance = false): string {
  const lesson =
    "Before you commit, record the lesson each item taught in KNOWLEDGE.md when it is reusable, as your skill describes. ";
  const last = lastDelivery(c);
  if (gateAcceptance && acceptancePartial(last)) {
    const left = (Array.isArray(last.deviations) ? (last.deviations as { what?: string; why?: string }[]) : [])
      .map((d, i) => `${i + 1}. ${d.what ?? ""}${d.why ? ` — ${d.why}` : ""}`)
      .join("\n");
    return (
      "Mode: implement. You reported `acceptanceCriteria: partial`, and a change that does not meet every Acceptance " +
      "Criterion is not published." +
      (left ? ` What you reported leaving out:\n\n${left}\n\n` : " ") +
      "Implement the missing criteria now — in the repository the work belongs to, including any listed under `Repos:` — " +
      "re-run the verification, and commit locally. An Acceptance Criterion is never out of scope. If one truly cannot be " +
      "met (it needs a repository you were not given, or information the ticket does not contain), set `blocked.is = true` " +
      "and name exactly what is missing. " + lesson + "Do NOT push or open a pull request."
    );
  }
  const check = c.channels.check;
  if (check && check.passed === false) {
    const issues = (check.blockers ?? []) as { issue?: string }[];
    const list = issues.map((b, i) => `${i + 1}. ${b.issue ?? ""}`).join("\n");
    return (
      "Mode: implement. The runner's own check of your change refused it:\n\n" +
      `${list}\n\n` +
      "Add or update a test that fails without your fix and passes with it, following the existing test style, re-run it, " +
      "and commit locally. If the change truly has nothing a test can cover (markup, style or copy only), say why in " +
      "`testExemption` instead. " + lesson + "Do NOT push or open a pull request."
    );
  }
  const blockers = (c.channels.evaluate?.blockers ?? []) as { file?: string; issue?: string }[];
  const list = blockers
    .map((b, i) => `${i + 1}. ${b.file ? `${b.file} — ` : ""}${b.issue ?? ""}`)
    .join("\n");
  return (
    "Mode: implement. An independent review of your change found blocking issues:\n\n" +
    `${list}\n\n` +
    "Fix exactly these, re-run the verification you ran before, and commit locally. " + lesson +
    "Do not rewrite anything the review did not raise, and do NOT push or open a pull request — " +
    "publishing is a separate phase that runs after the review passes."
  );
}

export function reflectPrompt(c: RunContext): string {
  return withKnowledge(
    c,
    "Mode: reflect. This run is stopping: the runner's checks and the independent review still refuse the change after " +
      `${c.visits.fix ?? 0} fix attempt(s). Do NOT edit source, do NOT commit, do NOT push. Decide whether this failure ` +
      "teaches a reusable lesson about this project — a convention, a pitfall, a test setup — that would have let a " +
      "future run get it right the first time. If it does, record it in KNOWLEDGE.md as your skill describes; if it is " +
      "specific to this ticket only, record nothing."
  );
}

/**
 * The publish brief for the **review** flow. Still `context: "resume"`, and that
 * asymmetry with `publishPrompt` is the point rather than an oversight.
 *
 * This phase does not just ship code: it answers the reviewer, thread by thread,
 * for the threads *this run chose to act on*. Which threads those were, and what
 * was done about each, lives in the session that did the work — it is not a
 * contract field, only summarised in `.te/plan.md`, and not recoverable from the diff, since a
 * commit does not say which comment it answers. A fresh session here would have
 * to guess, and guessing means replying on the wrong thread or resolving one
 * nobody addressed, on someone else's pull request, where it cannot be taken back.
 *
 * Publishing the implement flow costs a transcript replay it never reads; this
 * one reads it. Do not "make the two consistent" without first giving the fix
 * node a contract field that names the threads it answered.
 */
export const REVIEW_PUBLISH_PROMPT =
  "Mode: publish. The fixes are committed and final. Publish them and nothing else: push the branch if anything was committed, " +
  "then answer every thread in the Thread Decisions table of .te/plan.md — reply to each in English, in one or two short sentences stating what changed or why nothing did, and skip " +
  "threads the table marks Informational. " +
  "Never mark any thread resolved or change its status: the next review of the pushed commit decides that. Check each thread " +
  "first — if it already carries your reply, skip it, since this phase may be retried after a crash. Do not edit source, do not commit, do not re-verify, do not edit KNOWLEDGE.md.";
