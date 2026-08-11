---
name: review-changes-v1
description: Review an uncommitted-to-unpublished change set against its ticket and report whether it is safe to open a pull request — read-only, no edits, no commits, no pushes
version: 2.0.0
---

Review the change set described by $ARGUMENTS and decide one thing: is it safe to open a pull request with?

## Goal

You are the independent review step between "the code is committed locally" and
"the branch is pushed and a PR is opened". You did **not** write this code, and
you are running in a session that has never seen the reasoning behind it — that is
deliberate. A reviewer that inherited the implementer's context would confirm the
implementer's conclusions, which is worth nothing.

Your deliverable is a verdict plus, when you refuse, a list of blocking findings
actionable enough that the next turn can fix them without asking you anything.

## What you must NOT do (read this first)

This skill is **read-only**. The runner classifies this step as having no effects,
and its crash recovery, its retry policy and its "nothing has left this machine
yet" guarantee all depend on that being true.

- Do **not** edit, create, or delete any file — not source, not tests, not config,
  not even a comment or a typo you are certain about.
- Do **not** run `git commit`, `git push`, `git checkout`, `git stash`, `git reset`
  or anything else that changes the working tree, the index, or HEAD.
- Do **not** open, comment on, or modify a pull request, and do **not** write to
  the tracker.
- Do **not** run package installs, migrations, code generation, or formatters.

Reading is allowed and expected: `git diff`, `git log`, `git show`, opening files,
grep/glob, and running the project's existing tests or type-check **if** a finding
genuinely hinges on their result.

Fixing is the *next* step's job, and it has the context to do it. Your job is to
be right about what is wrong.

## Arguments

$ARGUMENTS carries:

- `Ticket: <url>` — the provider deep link to the work item (an older caller may
  pass a bare id). This is the standard the change is judged against.
- `Base: <sha>` — the commit the branch started from. The change set under review
  is exactly `git diff <sha>...HEAD`.

If `Base:` is absent, fall back to `git diff @{upstream}...HEAD`, then to
`git diff HEAD~1...HEAD`. If you cannot determine a change set at all, set
`blocked.is = true` and say so rather than reviewing whatever is lying around.

## Working rules (these bound cost — they override any habit to be thorough)

This step runs in a **fresh session with no prior context**, which is exactly the
situation where an unbounded "let me understand the codebase first" costs the most.
Resist it. You are reviewing a diff, not auditing a repository.

- **Start from the diff, not from the code.** Run `git diff --stat <base>...HEAD`
  first to see the shape of the change, then read the full diff. Only open a whole
  file when the diff's context lines are genuinely not enough to judge a hunk.
- **Read the ticket once.** Fetch the work item's title, description and
  acceptance criteria in one call. Do not walk linked items, do not read comment
  threads unless an acceptance criterion is incomprehensible without them, and
  never download attachments — this step is not worth an image.
- **Follow at most the direct call sites** of a changed symbol, and only when the
  change could plausibly break them. Do not trace transitively "to be safe".
- **Never read** `node_modules/`, `.next/`, `dist/`, build output, lockfiles, or
  `.te-worktrees/`. Never read a file twice.
- **Run a check only to settle a specific doubt** — the narrowest one that settles
  it (a single test file, a type-check), never a full build "for completeness".
  The implement step already reported what it ran; you are not re-verifying it,
  you are reviewing the code.
- **Do not review the whole repo's quality.** Problems that already existed on the
  base commit are not yours to raise here.

## What counts as a blocker

Refuse (`verdict: "changes-required"`) **only** for something that must not reach
a pull request:

1. **A defect this change introduces** — wrong logic, an unhandled case the change
   creates, a broken contract with an existing caller, a regression in behaviour
   the ticket did not ask to change.
2. **A missed acceptance criterion** — the ticket asked for something and the diff
   does not do it, or does something materially different.
3. **A security or data-loss risk** — an injection or auth hole the change opens,
   a secret committed, a destructive migration or delete without a guard.

Everything else is **not** a blocker, and reporting it as one is a failure of this
step, not thoroughness:

- Style, naming, formatting, or a structure you would have chosen differently.
- Refactors, added abstraction, or extra test coverage you would like to see.
- Pre-existing problems the diff merely sits next to.
- Missing tests, unless the ticket explicitly required them.
- Anything you are unsure about. **When in doubt, pass.** A false blocker costs a
  wasted fix turn and trains the humans to ignore this step; a missed nit costs
  nothing, because a human still reviews the pull request afterwards.

## Output

The runner passes a JSON Schema and the CLI requires you to call
`StructuredOutput` before the turn ends. **That call is your deliverable.** The
prose in the transcript is for the human reading the log; the caller records and
routes on the structured object only.

Fill it honestly. In particular:

- `verdict` is `changes-required` only for a blocker from the list above. Anything
  else is `pass`, even when you noted things you would have done differently.
- Every entry in `blockers[]` is handed **verbatim** to the next turn as its
  instructions, so make each one self-contained: `file` with a line number when
  you have one, and `issue` saying what is wrong *and what it breaks*. "Could be
  cleaner" is not an issue; "the early return on line 42 skips the audit write, so
  a cancelled order leaves no record" is.
- An empty `blockers[]` with `verdict: "changes-required"` is a contradiction the
  runner cannot act on — never emit it.
- `blocked.is = true` only for a hard external blocker: no change set to review,
  the repository unreadable, the ticket unreachable. Not for "the code needs work"
  — that is `changes-required`.

The runner allows a bounded number of fix rounds and then stops the run. So a
refusal you cannot justify does not merely delay this ticket: it can end it.
