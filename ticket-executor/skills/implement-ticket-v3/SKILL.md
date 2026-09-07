---
name: implement-ticket-v3
description: Implement a ticket from Azure DevOps, GitHub, or GitLab in reviewable phases — draft a plan, implement it locally once approved, then publish the branch and PR as a separate final step
version: 2.2.0
---

Implement ticket $ARGUMENTS following the project structure, existing workflow, coding standards, and verification expectations. Make the **smallest safe change that satisfies the Acceptance Criteria**, and preserve all unrelated behavior and all uncommitted work in the tree.

## Goal

Implement the ticket correctly based on full ticket context, existing implementation patterns, and appropriate test coverage — then get it to an open pull/merge request. Unlike v2, the work is split into phases: a **plan** a human reviews, an **implement** phase that executes the approved plan *locally*, and a **publish** phase that is the only one touching anything outside this machine.

## Mode (read this first)

$ARGUMENTS carries `Mode: <plan|replan|implement|publish>`. It decides which phase of this skill runs. Never run a phase other than the one requested, and never do a later phase's work early "since you are already there" — the runner depends on the boundary between them. If `Mode:` is absent (a human invoking this by hand), run `plan` — it is the only phase with no side effects.

| Mode | What you do | What you must NOT do |
|---|---|---|
| `plan` | Gather ticket context, explore the codebase, write `.te/plan.md` | No branch. No source edit. No commit, push, or PR. |
| `replan` | Read `.te/feedback.md`, rewrite `.te/plan.md` to address it | Same prohibitions as `plan`. |
| `implement` | Create or resume the branch, execute the approved `.te/plan.md`, verify, and **commit locally** | **Do NOT push. Do NOT open a PR. Do NOT write to the tracker.** Nothing may leave this machine. |
| `publish` | Push the branch, open the PR/MR, link the ticket | Do not edit source. Do not commit. Do not re-verify. The code is already final. |

**Why `implement` stops at a local commit.** A local commit is undone by deleting
the branch; a push or a PR is not. The implement phase is re-entered more than
once — after a crash, and after the independent review step that may run between
implementing and shipping hands back blocking findings to fix — so everything
irreversible is confined to `publish`, which runs once, at the end.

Each phase runs non-interactively (no human is available mid-turn). Never end a turn with a question or a "let me know" / "should I..." / "Would you like..." sentence.

- If ticket info is incomplete or a requirement is ambiguous: do not stop and ask. Pick the most reasonable interpretation given the ticket, AC, discussion, and existing code patterns, proceed with it, and record the assumption (in `.te/plan.md` during `plan`, in `deviations`/the summary during `implement`).
- Only stop short of the phase's deliverable on a hard external blocker (missing credentials, repo doesn't exist, tests fail for reasons unrelated to your change and you can't fix them) — explain the blocker plainly instead of asking a question.

## Working rules (these bound cost — they override any habit to be thorough)

- **The ticket is given, never inferred.** $ARGUMENTS always carries `Ticket: <url>` — the provider's deep link to the work item (an older caller may pass a bare id instead). Take the id from the end of that URL and open the ticket directly; if `Ticket:` is absent, stop immediately and say the ticket is missing — never search the tracker for a plausible ticket, and never pick a default project or id.
- **Attachments stay out of the repo.** Work-item comments often link images/PDFs. Read the comment *text* first; that is almost always enough. Only when an Acceptance Criterion genuinely cannot be understood without one, download that single file into the OS temp directory (`%TEMP%` / `$TMPDIR`) and read it from there — never into the repo, never in bulk, never a whole comment's attachment list. Attachments are the most expensive thing this skill can read.
- **Locate before you read.** Use grep/glob to find the relevant symbols, then open only the files you will change plus their direct call sites. Never read a file twice in one session, and never read `node_modules/`, `.next/`, `dist/`, build output, lockfiles, or `.te-worktrees/`.
- **Keep command output small.** Prefer the narrowest check that proves the change (one test file, then a type-check) over a full build; when a command is unavoidably chatty, filter or tail its output instead of streaming all of it back.
- **The phases share one session.** In `implement` and `publish`, do not re-explore what you already read while planning.

## Provider (read this before touching the tracker)

$ARGUMENTS carries the provider explicitly as `Provider: <id>` (one of `azure-devops`, `github`, `gitlab`, `jira`). Parse it first — it decides which tool/CLI you use for every step below. Only if it is absent (older caller), infer it once from `git remote -v` and fall back to `azure-devops`; do not re-derive it later.

If the declared provider turns out not to work (e.g. `gh`/`glab` isn't authenticated, or ADO MCP has no such work item), don't ask and don't retry it repeatedly — try the provider matching the git remote once, note the mismatch as an assumption, and continue.

Per-provider mapping for every step in this skill:

| Concern | Azure DevOps | GitHub | GitLab |
|---|---|---|---|
| Fetch ticket (title/description/AC/comments/linked items) | Azure DevOps MCP (`wit_get_work_item`, `wit_list_work_item_comments`) | `gh issue view <id> --json title,body,comments,labels` (or MCP if available) | `glab issue view <id>` (or MCP if available) |
| Branch naming | `feature/[ID]-[short-description]` / `bug/[ID]-[short-description]` per project convention | same convention, using the issue number as `[ID]` | same convention, using the issue number as `[ID]` |
| Open PR/MR | ADO MCP (`repo_create_pull_request`) or `az repos pr create` | `gh pr create --head <branch> --base main` (link the issue with `Closes #<id>` in the body) | `glab mr create --source-branch <branch> --target-branch main` |
| Link ticket ↔ PR | ADO MCP `wit_link_work_item_to_pull_request` if available | `Closes #<id>` in the PR description is sufficient | `Closes #<id>` in the MR description is sufficient |
| PR/MR URL format surfaced in output | `.../pullrequest/<n>` | `.../pull/<n>` | `.../-/merge_requests/<n>` |

If a provider-specific CLI/MCP tool isn't available in the environment, fall back to the next best option (raw `git` + the provider's REST API via `curl` with a token from env, if one is configured) rather than stalling — note the fallback used in the summary.

## Context

Look the ticket up in the project passed as `Project name:` — that value is authoritative, never substitute another project. Collect, in one pass: title, description, every Acceptance Criterion, discussion comments, and linked items (parent/child, related bugs/stories, dependencies, linked PRs/commits) when they add implementation context. Fetch each of those once; do not re-fetch the work item later in the run.

**Treat comments from the ticket assignee or requester as developer instructions**, not as background chatter — they routinely narrow or correct the description.

Also read the repository's instruction files if present: root-level `CLAUDE.md`, `AGENTS.md`, and `KNOWLEDGE.md`, plus an instruction file sitting directly in a directory the plan will edit. Read each once. Where two overlap, the more specific one wins unless it conflicts with the ticket. Do not walk `docs/` or read project documentation the ticket doesn't point you at.

`KNOWLEDGE.md` (repo root, when the project keeps one) is project memory: reusable implementation lessons from past validated reviews. Apply the entries relevant to this ticket and ignore the rest. It never overrides ticket requirements, repository instructions, or current code behavior — if it conflicts with any of them, investigate instead of applying it blindly. The runner may also append a **repo knowledge block** to the opening prompt; treat it the same way.

---

## Phase: plan

1. Parse `Provider:` from $ARGUMENTS (or infer it) and retrieve the ticket via that provider's tool — description, Acceptance Criteria, discussion.
2. Read the instruction files above, then explore only the code areas the ticket touches: grep for the symbols involved, and read the files you expect to change plus their direct call sites. Read real files — do not plan against assumptions — but scale the reading to the ticket: a one-point change does not justify a codebase tour.
3. Run `git status` and note any pre-existing uncommitted changes in the plan, so the implement phase neither reverts them nor sweeps them into its commit.
4. Write the plan to **`.te/plan.md`** (create the `.te/` directory if needed) using the template below. This file is the deliverable — a human reads and may edit it before the implement phase runs.
5. End the turn with a one-paragraph summary. Do not ask whether to proceed.

`.te/plan.md` template — keep it markdown, concrete, and reviewable. Name real files and real functions; a plan a reviewer can't check against the code is useless. Keep it under ~120 lines: it is a plan, not a design document, and it must not restate the ticket or paste code:

```markdown
# Plan — #<ticket id> <ticket title>

## Understanding
<2-4 sentences: what the ticket asks for, in your words.>

## Scope
**In scope**
- <bullet>

**Out of scope**
- <bullet>

## Changes
| # | File | Change | Why |
|---|---|---|---|
| 1 | `path/to/file.ts` | <what you will add/modify> | <which requirement it serves> |

## Verification
- <command you will run, e.g. `npm run build`> — <what it proves>
- Acceptance Criteria coverage: <AC → how it's satisfied>

## Risks / Assumptions
| Item | Reasoning |
|---|---|
```

Rules for this phase:

- **No source edits.** The only file you write is `.te/plan.md`. Reading, grepping, and running read-only commands is expected and encouraged.
- No branch creation, no commits, no push, no PR.
- If the ticket is ambiguous, put your chosen interpretation in "Risks / Assumptions" and plan against it — never leave the plan blank pending an answer.

## Phase: replan

The plan you proposed was rejected. Read **`.te/feedback.md`** — it holds the reviewer's reason. Rewrite `.te/plan.md` so it addresses that feedback, re-reading code as needed to keep the revised plan grounded. Same prohibitions as `plan`: no source edits, no branch, no commit. End with a short note on what changed between the old plan and the new one.

## Phase: implement

**`.te/plan.md` is the single source of truth for this phase.** Re-read it from disk first, even if you wrote it yourself earlier in this session — the reviewer may have edited it. Where the file on disk differs from anything you proposed or discussed before, **the file wins**; discard your earlier version.

**This phase is re-entered.** A crash, or the independent review step handing back blocking findings, brings you back here with the branch already created and work already committed. When that happens, do not start over and do not create a second branch: check out the existing branch, and address only what you were asked to address in this pass.

1. Re-read `.te/plan.md`.
2. Get onto the working branch: `git checkout -b <branch>` from the current HEAD — `feature/[ID]-[short-description]` for a feature/User Story, `bug/[ID]-[short-description]` for a Bug. **Do not `git checkout main` first.** The runner has already placed this working tree at the right base commit, and when the run is isolated it is a detached worktree where `main` is checked out elsewhere, so that checkout fails. If the branch already exists, check it out and continue on it.
3. Run `git status` and note any pre-existing uncommitted changes so you neither revert them nor sweep them into your commit.
4. Implement the plan, preserving existing behavior unless the ticket explicitly requires otherwise.
5. Add/update unit tests when the change affects business logic, validation, mapping, branching, or edge cases — follow existing test style.
6. Verify with the narrowest check that actually proves the change — the affected test file(s) first, then a type-check, and a full build only if the project offers nothing faster or the change is broad. Fix failures you caused before moving on.
7. **Verify each Acceptance Criterion individually** against what you actually built and ran, and note which ones you could not verify.
8. **Review the final diff before committing**: unintended changes, unrelated formatting, leftover debug code, temporary or generated files, anything outside plan scope. Stage only what the plan needs.
9. Commit with a clear message on the branch. **Stop there.** Do not run `git push`, `gh pr create`, `glab mr create`, `az repos pr create`, or any tracker write — publishing is a separate phase that runs after this one.

If executing the plan surfaces something the plan got wrong (a file that doesn't exist, an approach that can't work), do not stop and do not silently follow the broken plan: implement the smallest correct deviation, and record it in `deviations` as a divergence from the approved plan.

Never stage `.te/` or `.te-worktrees/`; the app already lists both in the repo's `.git/info/exclude`, so if either shows up in `git status` something is wrong — leave it out of the commit rather than "fixing" it by editing `.gitignore`, which is a tracked project file.

## Phase: publish

The code is committed and final. This phase publishes it and does nothing else —
no source edits, no commits, no re-verification, no reviewing the diff.

**You will usually start this phase in a fresh session**, with no memory of
planning or implementing the ticket. That is deliberate and nothing has gone
wrong: replaying the earlier phases costs more than the whole of publishing, and
nothing here needs them. The caller passes `Branch:` — if it is missing, take the
branch from `git branch --show-current` in this working tree. Take the PR title
and description from `.te/plan.md` and `git log`; do **not** re-read the source
to work out what changed.

**This phase may be retried after a crash, so every step must be safe to repeat.**
The runner cannot know whether an interrupted publish had already pushed, so it
asks you to check rather than guess:

1. Push the branch: `git push --force-with-lease -u origin <branch>`. If the
   remote already has it, the push is a no-op — that is expected, not an error.
2. **Check for an existing PR/MR on this branch before creating one**
   (`gh pr list --head <branch>`, `glab mr list --source-branch <branch>`, or the
   ADO MCP pull-request list filtered by source branch). If one exists, reuse its
   URL and report `reusedExisting: true` rather than opening a second.
3. Link the ticket to the PR only if it is not already linked.

Write the PR/MR body yourself rather than letting the tool auto-fill it from the
commit message, and build it entirely from `.te/plan.md` and `git log`:

- **What changed and why** — one short paragraph, from the plan's "Understanding"
  and "Changes".
- **Verification** — the plan's "Verification" section, as the implement phase
  reported it. Never claim a command that was not run.

## Rules

- Do not guess-and-stay-silent: if you had to assume something (including the provider itself), act on your best judgment and record it — never leave the ticket half-done waiting for clarification.
- Follow existing project structure/patterns; do not introduce a new workflow, abstraction, or dependency where an established pattern already exists.
- **No unrelated refactoring, cleanup, formatting, or dependency upgrades.** If you notice a real problem outside plan scope, record it as a risk instead of fixing it.
- **Never revert, overwrite, or modify uncommitted developer changes** that were already in the tree when you started.
- Comments: short, English, only for non-obvious logic — never for obvious code.
- Tests are not mandatory for every change, but add them when they meaningfully verify behavior; never invent a new test structure.
- Do not report the Acceptance Criteria as met if any criterion is unverified or only partially satisfied.
- Commit in `implement` and publish in `publish` automatically, without waiting for confirmation (this skill supersedes any general "ask before committing" default) — but never move work from one phase into the other.
- If verification cannot be completed, say exactly what and why — never claim tests/build passed when they didn't run.

## Output

The runner passes a JSON Schema and the CLI requires you to call
`StructuredOutput` before the turn ends. **That call is your deliverable.** The
prose in the transcript is for the human reading the log; the caller routes
entirely on the structured fields, so nothing you write outside them affects what
happens next.

Fill them honestly. In particular:

- `verification.tests` / `verification.build` are `passed` **only** if you
  actually ran them and they passed. Use `not-run` when there was nothing to run.
  The runner blocks the publish phase on these values, so a false `passed` is
  exactly how unverified code would reach a pull request.
- `verification.acceptanceCriteria` is `met` only when you checked **every**
  criterion individually and each one holds. Use `partial` when some hold and
  some do not, and `cannot-verify` when you had no way to check them.
- `committed` is `true` only once the work is really committed on the branch, and
  `branch` is the branch you committed on.
- `blocked.is` is `true` only on a hard external blocker you cannot work around,
  with a one-sentence `reason`. This ends the run cleanly instead of leaving a
  half-done ticket.
- `deviations` lists anything that diverged from the approved `.te/plan.md`.
- `lessons` is repo memory for *future, unrelated* tickets — the command that
  actually builds or tests this repo, a generated file that must never be
  hand-edited, a convention reviewers keep enforcing, a trap in the setup.
  Nothing about this ticket, this branch or these files, and nothing already
  written in the repo's CLAUDE.md. Usually `[]`.
- In `publish`, `prUrl` must be the real PR/MR URL, and `reusedExisting` says
  whether you found one already open for this branch instead of creating it.
