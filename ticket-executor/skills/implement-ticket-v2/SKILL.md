---
name: implement-ticket-v2
description: Implement a ticket from Azure DevOps, GitHub, or GitLab fully autonomously, end-to-end — branch, implement, verify, commit, push, PR — in a single non-interactive run
version: 2.1.0
---

Implement ticket $ARGUMENTS following the project structure, existing workflow, coding standards, and verification expectations. Make the **smallest safe change that satisfies the Acceptance Criteria**, and preserve all unrelated behavior and all uncommitted work in the tree.

## Goal

Implement the ticket correctly based on full ticket context, existing implementation patterns, and appropriate test coverage — then get it to an open pull/merge request, without pausing to ask the user anything mid-run.

## Autonomy (read this first)

This skill may run non-interactively (no human available to answer mid-run). Never end a turn with a question or a "let me know" / "should I..." / "Would you like..." style sentence.

- If ticket info is incomplete or a requirement is ambiguous: do not stop and ask. Pick the most reasonable interpretation given the ticket, AC, discussion, and existing code patterns, proceed with it, and state the assumption you made in the final summary.
- Only stop short of a finished PR if you hit a hard external blocker (e.g. missing credentials, repo doesn't exist, tests fail for reasons unrelated to your change and you can't fix them) — in that case explain the blocker plainly instead of asking a question.

## Working rules (these bound cost — they override any habit to be thorough)

- **The ticket is given, never inferred.** $ARGUMENTS always carries `Ticket: <url>` — the provider's deep link to the work item (an older caller may pass a bare id instead). Take the id from the end of that URL and open the ticket directly; if `Ticket:` is absent, stop immediately and say the ticket is missing — never search the tracker for a plausible ticket, and never pick a default project or id.
- **Attachments stay out of the repo.** Work-item comments often link images/PDFs. Read the comment *text* first; that is almost always enough. Only when an Acceptance Criterion genuinely cannot be understood without one, download that single file into the OS temp directory (`%TEMP%` / `$TMPDIR`) and read it from there — never into the repo, never in bulk, never a whole comment's attachment list. Attachments are the most expensive thing this skill can read.
- **Locate before you read.** Use grep/glob to find the relevant symbols, then open only the files you will change plus their direct call sites. Never read a file twice in one session, and never read `node_modules/`, `.next/`, `dist/`, build output, lockfiles, or `.te-worktrees/`.
- **Keep command output small.** Prefer the narrowest check that proves the change (one test file, then a type-check) over a full build; when a command is unavoidably chatty, filter or tail its output instead of streaming all of it back.

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

Also read the repository's instruction files if present: root-level `CLAUDE.md`, `AGENTS.md`, and `KNOWLEDGE.md`, plus an instruction file sitting directly in a directory you actually edit. Read each once. Where two overlap, the more specific one wins unless it conflicts with the ticket. Do not walk `docs/` or read project documentation the ticket doesn't point you at.

`KNOWLEDGE.md` (repo root, when the project keeps one) is project memory: reusable implementation lessons from past validated reviews. Apply the entries relevant to this ticket and ignore the rest. It never overrides ticket requirements, repository instructions, or current code behavior — if it conflicts with any of them, investigate instead of applying it blindly. The runner may also append a **repo knowledge block** to the opening prompt; treat it the same way.

## Steps

1. Parse `Provider:` from $ARGUMENTS (or infer it, see above) and retrieve/summarize the ticket via that provider's tool (description, AC, discussion) before touching code.
2. Read the instruction files above, then explore only the code areas the ticket touches — grep for the symbols involved and read the files you expect to change plus their direct call sites. Scale the reading to the ticket: a one-point change does not justify a codebase tour.
3. Run `git status` and note any pre-existing uncommitted changes, so you neither revert them nor sweep them into your commit.
4. Get onto the working branch: `git checkout -b <branch>` from the current HEAD — `feature/[ID]-[short-description]` for a feature/User Story, `bug/[ID]-[short-description]` for a Bug. **Do not `git checkout main` first.** The runner has already placed this working tree at the right base commit, and when the run is isolated it is a detached worktree where `main` is checked out elsewhere, so that checkout fails. **This run can be retried after a crash** — if the branch already exists, check it out and continue on it rather than failing or inventing a second name.
5. Implement the change, preserving existing behavior unless the ticket explicitly requires otherwise.
6. Add/update unit tests when the change affects business logic, validation, mapping, branching, or edge cases — follow existing test style.
7. Verify with the narrowest check that actually proves the change — the affected test file(s) first, then a type-check, and a full build only if the project offers nothing faster or the change is broad. Fix failures you caused before moving on.
8. **Verify each Acceptance Criterion individually** against what you actually built and ran, and note which ones you could not verify.
9. **Review the final diff before committing**: unintended changes, unrelated formatting, leftover debug code, temporary or generated files, anything outside ticket scope. Stage only what the ticket needs.
10. Commit with a clear message and push the branch.
11. Open a pull/merge request against `main` using the provider-specific tool from the table above, linking the ticket. **Check for an existing PR/MR on this branch first** (`gh pr list --head <branch>`, `glab mr list --source-branch <branch>`, or the ADO MCP pull-request list filtered by source branch) — a second PR for the same branch is worse than no PR at all. If one exists, reuse its URL.

## Pull request description

Write the PR/MR body yourself instead of letting the tool auto-fill it from the commit message. Keep it short and factual:

- **What changed and why** — one short paragraph tying the change to the ticket.
- **Verification** — the commands you actually ran and their result. Never list a command you did not run.

## Rules

- Do not guess-and-stay-silent: if you had to assume something (including the provider itself), implement your best judgment call and record it — never leave the ticket half-done waiting for clarification.
- Follow existing project structure/patterns; do not introduce a new workflow, abstraction, or dependency where an established pattern already exists.
- **No unrelated refactoring, cleanup, formatting, or dependency upgrades.** If you notice a real problem outside ticket scope, mention it in the summary instead of fixing it.
- **Never revert, overwrite, or modify uncommitted developer changes** that were already in the tree when you started.
- Comments: short, English, only for non-obvious logic — never for obvious code.
- Tests are not mandatory for every change, but add them when they meaningfully verify behavior; never invent a new test structure.
- Do not report the Acceptance Criteria as met if any criterion is unverified or only partially satisfied.
- Commit, push, and open the PR/MR automatically once implementation + verification are done — do not wait for explicit confirmation to do this (this skill supersedes any general "ask before committing" default).
- Everything that leaves this machine (push, PR, tracker writes) happens in this single run, so make each of those steps safe to repeat: check whether it has already been done before doing it.
- If verification cannot be completed, say exactly what and why — never claim tests/build passed when they didn't run.

## Output

The runner passes a JSON Schema and the CLI requires you to call
`StructuredOutput` before the turn ends. **That call is your deliverable.** The
prose in the transcript is for the human reading the log; the caller records and
routes entirely on the structured fields.

Fill them honestly. In particular:

- `verification.tests` / `verification.build` are `passed` **only** if you
  actually ran them and they passed. Use `not-run` when there was nothing to run.
  Never report `passed` for a check you did not run.
  A reported `failed` marks the whole run failed even though the PR is already
  open, and the ticket is left where it was — that is the intended outcome, and
  it is far cheaper than a false `passed` that hides unverified code in a PR.
- `verification.acceptanceCriteria` is `met` only when you checked **every**
  criterion individually and each one holds. Use `partial` when some hold and
  some do not, and `cannot-verify` when you had no way to check them.
- `committed` / `pushed` describe what really happened, not what you intended.
- `blocked.is` is `true` only on a hard external blocker you cannot work around,
  with a one-sentence `reason`. This ends the run cleanly instead of leaving a
  half-done ticket.
- `lessons` is repo memory for *future, unrelated* tickets — the command that
  actually builds or tests this repo, a generated file that must never be
  hand-edited, a convention reviewers keep enforcing, a trap in the setup.
  Nothing about this ticket, this branch or these files, and nothing already
  written in the repo's CLAUDE.md. Usually `[]`.
- `prUrl` must be the real PR/MR URL.
