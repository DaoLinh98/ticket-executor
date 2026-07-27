---
name: implement-ticket-v3
description: Implement a ticket from Azure DevOps, GitHub, or GitLab in two phases — draft a reviewable plan first, then implement it end-to-end (branch, code, verify, commit, push, PR) after the plan is approved
version: 1.0.0
---

Implement ticket $ARGUMENTS following the project structure, existing workflow, coding standards, and verification expectations.

## Goal

Implement the ticket correctly based on full ticket context, existing implementation patterns, and appropriate test coverage — then get it to an open pull/merge request. Unlike v2, the work is split into a **plan phase** a human reviews and a **implement phase** that executes the approved plan.

## Mode (read this first)

$ARGUMENTS carries `Mode: <plan|replan|implement>`. It decides which half of this skill runs. Never run a phase other than the one requested.

| Mode | What you do | What you must NOT do |
|---|---|---|
| `plan` | Gather ticket context, explore the codebase, write `.te/plan.md` | Do not create a branch. Do not edit any source file. Do not commit, push, or open a PR. |
| `replan` | Read `.te/feedback.md`, rewrite `.te/plan.md` to address it | Same prohibitions as `plan`. |
| `implement` | Execute the approved `.te/plan.md` end-to-end | Do not re-litigate the plan or ask for confirmation. |
| *(absent)* | Run `plan`, then immediately `implement` without stopping — the fully autonomous v2 behaviour | — |

Each phase runs non-interactively (no human is available mid-turn). Never end a turn with a question or a "let me know" / "should I..." / "Would you like..." sentence.

- If ticket info is incomplete or a requirement is ambiguous: do not stop and ask. Pick the most reasonable interpretation given the ticket, AC, discussion, and existing code patterns, proceed with it, and record the assumption (in `.te/plan.md` during `plan`, in the output table during `implement`).
- Only stop short of the phase's deliverable on a hard external blocker (missing credentials, repo doesn't exist, tests fail for reasons unrelated to your change and you can't fix them) — explain the blocker plainly instead of asking a question.

## Provider (read this before touching the tracker)

$ARGUMENTS carries the provider explicitly as `Provider: <id>` (one of `azure-devops`, `github`, `gitlab`, `jira`). Parse it first — it decides which tool/CLI you use for every step below. If `Provider:` is missing (older caller), infer it from the ticket ID shape and fall back to `azure-devops`:

- Plain numeric ID (e.g. `12345`) → `azure-devops`.
- `owner/repo#123`, or a bare `#123` when a GitHub remote is evident (`git remote -v` shows `github.com`) → `github`.
- `owner/repo!123`, or a bare `!123` when a GitLab remote is evident → `gitlab`.

If the inferred/declared provider doesn't match reality once you start (e.g. `gh`/`glab` isn't authenticated, or ADO MCP has no such work item), don't ask — try the other provider whose remote matches `git remote -v`, note the mismatch as an assumption, and continue.

Per-provider mapping for every step in this skill:

| Concern | Azure DevOps | GitHub | GitLab |
|---|---|---|---|
| Fetch ticket (title/description/AC/comments/linked items) | Azure DevOps MCP (`wit_get_work_item`, `wit_list_work_item_comments`) | `gh issue view <id> --json title,body,comments,labels` (or MCP if available) | `glab issue view <id>` (or MCP if available) |
| Branch naming | `feature/[ID]-[short-description]` / `bug/[ID]-[short-description]` per project convention | same convention, using the issue number as `[ID]` | same convention, using the issue number as `[ID]` |
| Open PR/MR | ADO MCP (`repo_create_pull_request`) or `az repos pr create` | `gh pr create --fill --head <branch> --base main` (link the issue with `Closes #<id>` in the body) | `glab mr create --fill --source-branch <branch> --target-branch main` |
| Link ticket ↔ PR | ADO MCP `wit_link_work_item_to_pull_request` if available | `Closes #<id>` in the PR description is sufficient | `Closes #<id>` in the MR description is sufficient |
| PR/MR URL format surfaced in output | `.../pullrequest/<n>` | `.../pull/<n>` | `.../-/merge_requests/<n>` |

If a provider-specific CLI/MCP tool isn't available in the environment, fall back to the next best option (raw `git` + the provider's REST API via `curl` with a token from env, if one is configured) rather than stalling — note the fallback used in the summary.

## Context

If $ARGUMENTS has no ticket ID, use the most reasonable default project/ID you can infer; otherwise proceed with what's given. For `azure-devops`, look up the ticket via Azure DevOps MCP in the 'Application Support' or 'RIS' project. For `github`/`gitlab`, use the project/repo name passed as `Project name:` (or the current repo if none given). Collect: title, description, Acceptance Criteria, discussion comments (Ken Nguyen is me), linked items.

Also read root-level guidance (`CLAUDE.md`, `SKILL.md`, other instruction files) to understand structure, conventions, and existing patterns before implementing.

---

## Phase: plan

1. Parse `Provider:` from $ARGUMENTS (or infer it) and retrieve the ticket via that provider's tool — description, Acceptance Criteria, discussion.
2. Read root-level `CLAUDE.md`/`SKILL.md` and explore the code areas the ticket touches. Read the real files; do not plan against assumptions about what the code looks like.
3. Write the plan to **`.te/plan.md`** (create the `.te/` directory if needed) using the template below. This file is the deliverable — a human reads and may edit it before the implement phase runs.
4. End the turn with a one-paragraph summary. Do not ask whether to proceed.

`.te/plan.md` template — keep it markdown, concrete, and reviewable. Name real files and real functions; a plan a reviewer can't check against the code is useless:

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

1. Re-read `.te/plan.md`.
2. Create a branch from `main`: `feature/[ID]-[short-description]` for a feature/User Story, `bug/[ID]-[short-description]` for a Bug.
3. Implement the plan, preserving existing behavior unless the ticket explicitly requires otherwise.
4. Add/update unit tests when the change affects business logic, validation, mapping, branching, or edge cases — follow existing test style.
5. Run relevant tests/build; compare the result against the ticket + Acceptance Criteria. Fix failures you caused before moving on.
6. Commit with a clear message, push the branch, and open a pull/merge request against `main` using the provider-specific tool from the table above, linking the ticket.

If executing the plan surfaces something the plan got wrong (a file that doesn't exist, an approach that can't work), do not stop and do not silently follow the broken plan: implement the smallest correct deviation, and record it in "Notes/Assumptions" as a deviation from the approved plan.

Do not commit `.te/` — add it to `.git/info/exclude` (not `.gitignore`, which is a tracked project file) if it would otherwise be picked up.

## Rules

- Do not guess-and-stay-silent: if you had to assume something (including the provider itself), act on your best judgment and record it — never leave the ticket half-done waiting for clarification.
- Follow existing project structure/patterns; do not introduce inconsistent workflow changes.
- Comments: short, English, only for non-obvious logic — never for obvious code.
- Tests are not mandatory for every change, but add them when they meaningfully verify behavior; never invent a new test structure.
- In the `implement` phase, commit/push/open the PR automatically once implementation + verification are done — do not wait for explicit confirmation (this skill supersedes any general "ask before committing" default).
- If verification cannot be completed, say exactly what and why — never claim tests/build passed when they didn't run.

## Output

**Plan / replan phases** — a short prose summary of what the plan covers. The real deliverable is `.te/plan.md`; don't duplicate the whole plan in the response.

**Implement phase** — keep this short; the reviewer already read the plan, so don't re-explain it. Report only what changed since the plan was approved: what happened, whether it verified, and where to look. Use only the sections below; skip a section entirely if it has nothing to report, and skip rows in "Deviations" unless something actually diverged from the approved plan.

**Result**

One or two sentences: what was implemented and its current state (PR open / verification failed / blocked).

**Verification**

| Check | Result |
|---|---|
| Tests | Passed / Not run / Failed |
| Build | Passed / Not run / Failed |
| Acceptance Criteria | Met / Partial / Cannot verify |

**Branch / PR**

| Branch | PR/MR URL |
|---|---|

**Deviations from the plan** (only if something diverged from the approved `.te/plan.md` — a judgment call on ambiguous info, or a fix forced by something the plan got wrong)

| What changed | Why |
|---|---|
