---
name: implement-ticket-v2
description: Implement a ticket from Azure DevOps, GitHub, or GitLab fully autonomously, end-to-end — branch, implement, verify, commit, push, PR — in a single non-interactive run
version: 1.0.0
---

Implement ticket $ARGUMENTS following the project structure, existing workflow, coding standards, and verification expectations.

## Goal

Implement the ticket correctly based on full ticket context, existing implementation patterns, and appropriate test coverage — then get it to an open pull/merge request, without pausing to ask the user anything mid-run.

## Autonomy (read this first)

This skill may run non-interactively (no human available to answer mid-run). Never end a turn with a question or a "let me know" / "should I..." / "Would you like..." style sentence.

- If ticket info is incomplete or a requirement is ambiguous: do not stop and ask. Pick the most reasonable interpretation given the ticket, AC, discussion, and existing code patterns, proceed with it, and state the assumption you made in the final summary (in the "Notes/Assumptions" row of the output table).
- Only stop short of a finished PR if you hit a hard external blocker (e.g. missing credentials, repo doesn't exist, tests fail for reasons unrelated to your change and you can't fix them) — in that case explain the blocker plainly instead of asking a question.

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

## Steps

1. Parse `Provider:` from $ARGUMENTS (or infer it, see above) and retrieve/summarize the ticket via that provider's tool (description, AC, discussion) before touching code.
2. Read root-level `CLAUDE.md`/`SKILL.md` and explore related code areas / existing patterns.
3. Create a branch from `main`: `feature/[ID]-[short-description]` for a feature/User Story, `bug/[ID]-[short-description]` for a Bug.
4. Implement the change, preserving existing behavior unless the ticket explicitly requires otherwise.
5. Add/update unit tests when the change affects business logic, validation, mapping, branching, or edge cases — follow existing test style.
6. Run relevant tests/build; compare result against ticket + Acceptance Criteria. Fix failures you caused before moving on.
7. Commit the changes with a clear message, push the branch, and open a pull/merge request against `main` using the provider-specific tool from the table above, linking the ticket.

## Rules

- Do not guess-and-stay-silent: if you had to assume something (including the provider itself), implement your best judgment call and record it — never leave the ticket half-done waiting for clarification.
- Follow existing project structure/patterns; do not introduce inconsistent workflow changes.
- Comments: short, English, only for non-obvious logic — never for obvious code.
- Tests are not mandatory for every change, but add them when they meaningfully verify behavior; never invent a new test structure.
- Commit, push, and open the PR/MR automatically once implementation + verification are done — do not wait for explicit confirmation to do this (this skill supersedes any general "ask before committing" default).
- If verification cannot be completed, say exactly what and why — never claim tests/build passed when they didn't run.

## Output

Return the final response with clear structure. Use only the sections below — skip a section entirely if it has nothing to report,

**Summary & Changes**

| Category | Change | Purpose | Verification Result |
|---|---|---|---|

**Tests / Verification**
In 
| Item | Result | Notes |
|---|---|---|
| Unit tests | Passed / Not run / Failed | |
| Build | Passed / Not run / Failed | |
| Acceptance Criteria | Passed / Partial / Cannot verify | |

**Branch / PR**

| Provider | Branch | PR/MR URL |
|---|---|---|

**Notes/Assumptions** (only if you had to make a judgment call on ambiguous/missing info, including provider inference)

| Assumption | Reasoning |
|---|---|
