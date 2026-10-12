---
name: implement-ticket-v4
description: Implement a ticket from Azure DevOps, GitHub, or GitLab autonomously in two phases — implement, verify and commit locally (re-entered to fix what the runner's checks and an independent reviewer refuse), then publish the branch and a draft PR as a separate final step; records reusable lessons in the project's KNOWLEDGE.md
version: 4.1.0
---

Implement ticket $ARGUMENTS following the project structure, existing workflow, coding standards, and verification expectations. Make the **smallest safe change that satisfies the Acceptance Criteria**, and preserve all unrelated behavior and all uncommitted work in the tree.

## Modes (read this first)

$ARGUMENTS carries `Mode: <implement|publish|reflect>`. It decides which phase of this skill runs. Never do a later phase's work early "since you are already there" — the runner depends on the boundary between them. If `Mode:` is absent (a human invoking this by hand), run `implement`.

| Mode | What you do | What you must NOT do |
|---|---|---|
| `implement` | Gather context, write the plan record, create or resume the branch, implement, verify, update `KNOWLEDGE.md`, **commit locally** | **Do NOT push. Do NOT open a PR. Do NOT write to the tracker.** Nothing may leave this machine. |
| `publish` | Push the branch, open the draft PR/MR, link the ticket | Do not edit source. Do not commit. Do not re-verify. The code is already final. |
| `reflect` | Record in `KNOWLEDGE.md` the lesson a run that is being stopped taught, if any | Do not edit source. Do not commit. Do not push. Do not write to the tracker. |

Between the two, the runner checks the change itself (a test gate) and an independent reviewer reads the diff in a session of its own. If either refuses, you are resumed with `Mode: implement` and a numbered list of what to fix — fix exactly that, re-verify, commit locally, and stop again. Nobody reviews your plan before you code: the reviewer judges the finished diff instead.

**Why `implement` stops at a local commit.** A local commit is undone by deleting the branch; a push or a PR is not. The implement phase is re-entered — after a crash, and after a refusal — so everything irreversible is confined to `publish`, which runs once, at the end.

## Autonomy

This skill runs non-interactively. Never end a turn with a question or a "let me know" / "should I..." / "Would you like..." style sentence.

- If ticket info is incomplete or a requirement is ambiguous: pick the most reasonable interpretation given the ticket, AC, discussion, and existing code patterns, proceed with it, and record the assumption in the plan record and the summary.
- Only stop short of the phase's deliverable on a hard external blocker (missing credentials, repo doesn't exist, tests fail for reasons unrelated to your change and you can't fix them) — explain it plainly in `blocked` instead of asking.

## Working rules (these bound cost — they override any habit to be thorough)

- **The ticket is given, never inferred.** $ARGUMENTS always carries `Ticket: <url>` — the provider's deep link to the work item (an older caller may pass a bare id instead). Take the id from the end of that URL and open the ticket directly; if `Ticket:` is absent, stop immediately and say the ticket is missing — never search the tracker for a plausible ticket, and never pick a default project or id.
- **Attachments stay out of the repo.** Read the comment *text* first; that is almost always enough. Only when an Acceptance Criterion genuinely cannot be understood without one, download that single file into the OS temp directory (`%TEMP%` / `$TMPDIR`) and read it from there — never into the repo, never in bulk.
- **Locate before you read.** Use grep/glob to find the relevant symbols, then open only the files you will change plus their direct call sites. Never read a file twice in one session, and never read `node_modules/`, `.next/`, `dist/`, build output, lockfiles, or `.te-worktrees/`.
- **Keep command output small.** Prefer the narrowest check that proves the change (one test file, then a type-check) over a full build; filter or tail unavoidably chatty output.

## Provider (read this before touching the tracker)

$ARGUMENTS carries the provider explicitly as `Provider: <id>` (one of `azure-devops`, `github`, `gitlab`, `jira`). Parse it first — it decides which tool/CLI you use for every step below. Only if it is absent (older caller), infer it once from `git remote -v` and fall back to `azure-devops`; do not re-derive it later.

If the declared provider turns out not to work, don't ask and don't retry it repeatedly — try the provider matching the git remote once, note the mismatch as an assumption, and continue.

| Concern | Azure DevOps | GitHub | GitLab |
|---|---|---|---|
| Fetch ticket (title/description/AC/comments/linked items) | Azure DevOps MCP (`wit_get_work_item`, `wit_list_work_item_comments`) | `gh issue view <id> --json title,body,comments,labels` | `glab issue view <id>` |
| Branch naming | `feature/[ID]-[short-description]` / `bug/[ID]-[short-description]` | same, issue number as `[ID]` | same, issue number as `[ID]` |
| Open PR/MR | ADO MCP `repo_create_pull_request` or `az repos pr create` | `gh pr create --draft --head <branch> --base main` (`Closes #<id>` in the body) | `glab mr create --draft --source-branch <branch> --target-branch main` |
| Link ticket ↔ PR | ADO MCP `wit_link_work_item_to_pull_request` | `Closes #<id>` in the body is sufficient | `Closes #<id>` in the body is sufficient |

If a provider-specific CLI/MCP tool isn't available, fall back to the next best option (raw `git` + the provider's REST API via `curl` with a token from env, if one is configured) rather than stalling — note the fallback in the summary.

## Context

Look the ticket up in the project passed as `Project name:` — that value is authoritative. Collect, in one pass: title, description, every Acceptance Criterion, discussion comments, and linked items when they add implementation context. Fetch each once.

**Treat comments from the ticket assignee or requester as developer instructions** — they routinely narrow or correct the description.

Also read the repository's instruction files if present: root-level `CLAUDE.md` and `AGENTS.md`, plus an instruction file sitting directly in a directory you actually edit. Read each once. Where two overlap, the more specific one wins unless it conflicts with the ticket. Do not walk `docs/`.

## Project memory (`KNOWLEDGE.md`)

$ARGUMENTS carries `Knowledge: <absolute path>` — the project's `KNOWLEDGE.md`, in the developer's own checkout rather than in this working tree, so what you write there outlives this run. It is project memory: reusable lessons earned by earlier runs and reviews on this project.

- **Read it once at the start** when it exists, and apply the entries relevant to this ticket. Treat it as input to the code you write, not background reading: before calling the change done, re-scan the entries covering the layer you touched and confirm the change neither violates one nor creates the situation one warns about. The independent reviewer checks the same file.
- It never overrides ticket requirements, repository instructions, or current code behavior — if an entry conflicts with any of them, investigate instead of applying it blindly.
- **Before every local commit, decide whether this pass earned a lesson.** A lesson is earned when something cost you a failed attempt or a refusal and would cost the next, unrelated ticket the same: the command that actually builds or tests this repo, a generated file that must never be hand-edited, a setup trap, a convention you only learned because it broke — and above all, **a blocker the runner's check or the reviewer handed back to you**. Skip one-off ticket requirements, naming/formatting nits, and anything about this branch or these files only.
- **How to write it.** Re-read the file immediately before editing it — another run may have updated it since you first read it. Search for an equivalent entry first and refine it rather than adding a duplicate; add a new entry only when none fits. Write generalized guidance — when it applies, what to do or avoid, and why when that is not obvious — one bullet under a short `## <area>` heading. Never paste a review comment, a stack trace or code. If a lesson contradicts an existing entry, leave the entry and mention the conflict in `summary`. Create the file only when you have at least one lesson; most passes add nothing.
- **Keep it short.** Every entry is one bullet of at most two lines. The runner warns when the file passes 200 lines; before adding to a file that long, first merge entries that say the same thing and drop entries about code that no longer exists, so the file stays something every run can afford to read.
- **Write it only at the `Knowledge:` path, and never stage or commit it** — not there and not in this working tree. It is local project memory, not part of the change. If `Knowledge:` is absent, use `KNOWLEDGE.md` at the repository root and still never stage it.

## Phase: implement

**This phase is re-entered.** A crash, or a refusal from the runner's check or the reviewer, brings you back here with the branch already created and work already committed. When that happens, do not start over and do not create a second branch: check out the existing branch, and address only what you were asked to address in this pass.

On the first pass:

1. Parse `Provider:` and retrieve the ticket via that provider's tool before touching code. Read the instruction files and `KNOWLEDGE.md` as above.
2. Explore only the code areas the ticket touches. Scale the reading to the ticket: a one-point change does not justify a codebase tour.
3. Write the plan record to **`.te/plan.md`** (template below), then **keep going without pausing**.
4. Run `git status` and note any pre-existing uncommitted changes, so you neither revert them nor sweep them into your commit.
5. Get onto the working branch: `git checkout -b <branch>` from the current HEAD — `feature/[ID]-[short-description]` for a feature/User Story, `bug/[ID]-[short-description]` for a Bug. **Do not `git checkout main` first.** The runner has already placed this working tree at the right base commit, and when the run is isolated it is a detached worktree where `main` is checked out elsewhere, so that checkout fails. If the branch already exists, check it out and continue on it.
6. Implement the change, preserving existing behavior unless the ticket explicitly requires otherwise.
7. **Add or update a test** for the behaviour the change introduces — business logic, validation, mapping, branching, edge cases — following the existing test style. Only a change with nothing a test can cover (markup, style or copy only) may skip this, and then `testExemption` says why in one sentence. The runner refuses a change with no test file and no reason.
8. Verify with the narrowest check that actually proves the change — the affected test file(s) first, then a type-check, and a full build only if the project offers nothing faster or the change is broad. Fix failures you caused before moving on.
9. **Verify each Acceptance Criterion individually** against what you actually built and ran.
10. **Review the final diff before committing**: unintended changes, unrelated formatting, leftover debug code, temporary or generated files, anything outside ticket scope. Stage only what the ticket needs.
11. Update `KNOWLEDGE.md` if this pass earned a lesson (see above).
12. Commit with a clear message on the branch. **Stop there.** Do not run `git push`, `gh pr create`, `glab mr create`, `az repos pr create`, or any tracker write.

On a pass that hands you a list of blockers: fix exactly those, re-run the verification you ran before, record the lesson each blocker taught in `KNOWLEDGE.md` when it is reusable, commit locally, and stop. Do not rewrite anything the list did not raise.

Never stage `.te/`, `.te-worktrees/` or `KNOWLEDGE.md`; the app lists them in the repo's `.git/info/exclude`, so if one shows up in `git status` leave it out of the commit rather than "fixing" it by editing `.gitignore`, which is a tracked project file.

## Plan record

Before the first source edit, write `.te/plan.md`. Nobody approves this file, nothing waits on it, and you must not ask for approval of it — it is a record, written while your reasoning is fresh, that the developer reads in the app afterwards and that the publish phase builds the PR description from.

Keep it markdown, concrete and under ~120 lines. Name real files and real functions. Do not restate the ticket and do not paste code:

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
- <command you will run> — <what it proves>
- Acceptance Criteria coverage: <AC → how it's satisfied>

## Risks / Assumptions
| Item | Reasoning |
|---|---|
```

If implementing it turns out differently, implement the smallest correct thing, then **update `.te/plan.md` before you commit** so the record matches what you actually did, and list the divergence in `deviations`. A stale record is worse than none.

## Phase: reflect

The fix loop is exhausted: the runner's check or the independent reviewer still refuses the change after the last fix attempt, and the run is being stopped for a person to look at. You are resumed in the same session, so the refusal you could not answer is already in your context.

1. Do not edit source, do not commit, do not push, do not touch the tracker. The change stays as it is for the developer.
2. Ask what general rule about this project would have let a future, unrelated ticket avoid this failure — a convention, a pitfall, a test setup, a command. Record it in `KNOWLEDGE.md` as described under **Project memory**, only when it is reusable and not already written there. A failure that is specific to this ticket teaches nothing; record nothing then.
3. Report `recorded` and the one- or two-sentence `lesson` you wrote (empty when `recorded` is false).

## Phase: publish

The code is committed and final. This phase publishes it and does nothing else — no source edits, no commits, no re-verification, no reviewing the diff, no `KNOWLEDGE.md` edit.

**You will usually start this phase in a fresh session**, with no memory of implementing the ticket. That is deliberate. The caller passes `Branch:` — if it is missing, take the branch from `git branch --show-current`. Take the PR title and description from `.te/plan.md` and `git log`; do **not** re-read the source to work out what changed.

**This phase may be retried after a crash, so every step must be safe to repeat:**

1. Push the branch: `git push --force-with-lease -u origin <branch>`. If the remote already has it, the push is a no-op — expected, not an error.
2. **Check for an existing PR/MR on this branch before creating one** (`gh pr list --head <branch>`, `glab mr list --source-branch <branch>`, or the ADO MCP pull-request list filtered by source branch). If one exists, reuse its URL and report `reusedExisting: true`.
3. Otherwise open it as a **draft** against `main`, following the draft rule in the prompt.
4. Link the ticket to the PR only if it is not already linked.

Write the PR/MR body yourself rather than letting the tool auto-fill it from the commit message:

- **What changed and why** — one short paragraph, from the plan's "Understanding" and "Changes".
- **Verification** — the plan's "Verification" section, as the implement phase reported it. Never claim a command that was not run.

## Rules

- Do not guess-and-stay-silent: if you had to assume something (including the provider itself), act on your best judgment and record it.
- Follow existing project structure/patterns; do not introduce a new workflow, abstraction, or dependency where an established pattern already exists.
- **No unrelated refactoring, cleanup, formatting, or dependency upgrades.** If you notice a real problem outside ticket scope, record it as a risk instead of fixing it.
- **Never revert, overwrite, or modify uncommitted developer changes** that were already in the tree when you started.
- Comments: short, English, only for non-obvious logic.
- Do not report the Acceptance Criteria as met if any criterion is unverified or only partially satisfied.
- Commit in `implement` and publish in `publish` automatically, without waiting for confirmation (this skill supersedes any general "ask before committing" default) — but never move work from one phase into the other.
- If verification cannot be completed, say exactly what and why — never claim tests/build passed when they didn't run.

## Output

The runner passes a JSON Schema and the CLI requires you to call `StructuredOutput` before the turn ends. **That call is your deliverable.** The caller routes entirely on the structured fields.

Fill them honestly. In particular:

- `verification.tests` / `verification.build` are `passed` **only** if you actually ran them and they passed. Use `not-run` when there was nothing to run. A reported `failed` stops the run before anything is pushed.
- `verification.acceptanceCriteria` is `met` only when you checked **every** criterion individually and each one holds; `partial` when some hold, `cannot-verify` when you had no way to check them.
- `committed` is `true` only once the work is really committed on the branch, and `branch` is the branch you committed on.
- `testExemption` is empty when the change adds or updates a test, otherwise one sentence on why none applies.
- `deviations` lists anything that diverged from `.te/plan.md`.
- `blocked.is` is `true` only on a hard external blocker you cannot work around, with a one-sentence `reason`.
- In `publish`, `prUrl` must be the real PR/MR URL, `isDraft` its real state, and `reusedExisting` whether you found one already open for this branch.
