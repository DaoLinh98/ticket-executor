---
name: fix-code-review-v2
description: Fully autonomously resolve open PR/MR review comments end-to-end across Azure DevOps, GitHub, or GitLab — read threads, validate, implement fixes, reply, and mark resolved — in a single non-interactive run
version: 1.0.0
---

Resolve the open code-review comments on the pull/merge request described in $ARGUMENTS (format: `Provider: <id> - PR: <pr-url-or-id> - Ticket ID: <id> - Project name: <project>`) following the same implementation workflow/rules as `implement-ticket-v2`, then close the loop on the tracker yourself.

## Goal

Every open review thread on the PR/MR should end the run either resolved (fix applied + replied) or explicitly left open with a reply explaining why — never silently ignored, and never left for a human to reply or click "Resolve" by hand.

## Autonomy (read this first)

This skill may run non-interactively (no human available to answer mid-run). Never end a turn with a question or a "let me know" / "should I..." / "bạn có muốn..." style sentence.

- If a comment is ambiguous or under-specified, pick the most reasonable interpretation given the ticket, the surrounding code, and the reviewer's wording — implement it, and say so in the final summary.
- Only leave a thread open (not resolved) when the finding is invalid, out of scope, or needs a human decision — in that case reply explaining why instead of guessing, but still reply (don't go silent).

## Provider (read this before touching the tracker)

$ARGUMENTS carries the provider explicitly as `Provider: <id>` (one of `azure-devops`, `github`, `gitlab`). Parse it first — it decides which tool/CLI you use for every step below. If `Provider:` is missing (older caller), infer it from the `PR:` value shape and fall back to `azure-devops`:

- ADO URL (`dev.azure.com/.../pullrequest/<n>`) or a plain numeric PR id with no repo host → `azure-devops`.
- GitHub URL (`github.com/<owner>/<repo>/pull/<n>`), or a bare PR number when a GitHub remote is evident (`git remote -v` shows `github.com`) → `github`.
- GitLab URL (`gitlab.com/.../-/merge_requests/<n>`), or a bare MR number when a GitLab remote is evident → `gitlab`.

If the inferred/declared provider doesn't match reality once you start (e.g. `gh`/`glab` isn't authenticated, or ADO MCP has no such PR), don't ask — try the other provider whose remote matches `git remote -v`, note the mismatch as an assumption, and continue.

Per-provider mapping for every step in this skill:

| Concern | Azure DevOps | GitHub | GitLab |
|---|---|---|---|
| Fetch PR/MR overview | ADO MCP `repo_get_pull_request_by_id` | `gh pr view <n> --json title,body,baseRefName,headRefName,url` (or MCP if available) | `glab mr view <n>` (or MCP if available) |
| List review threads (with resolved status) | ADO MCP `repo_list_pull_request_threads` | `gh api graphql` query for `pullRequest.reviewThreads` (`isResolved`, thread `id`, first comment `databaseId`/body/path/line) — REST alone does not expose resolved state | `glab api projects/:id/merge_requests/:iid/discussions` (each discussion has `id` + `resolved`) |
| List comments in a thread | ADO MCP `repo_list_pull_request_thread_comments` | same GraphQL query's `comments` connection per thread | same discussions payload's `notes` array |
| Reply to a thread | ADO MCP `repo_reply_to_comment` | `gh api repos/<owner>/<repo>/pulls/<n>/comments/<comment_id>/replies -f body="..."` (replies to the specific review-comment thread) | `glab api projects/:id/merge_requests/:iid/discussions/:discussion_id/notes -f body="..."` |
| Mark thread resolved | ADO MCP `repo_update_pull_request_thread` (status → `fixed`) | `gh api graphql` mutation `resolveReviewThread(input:{threadId:$threadId})` | `glab api -X PUT projects/:id/merge_requests/:iid/discussions/:discussion_id -f resolved=true` |
| Push fix to existing branch | `git push` (same branch ADO PR already tracks) | `git push` (same branch the GitHub PR already tracks) | `git push` (same branch the GitLab MR already tracks) |

If a provider-specific CLI/MCP tool isn't available in the environment, fall back to the next best option (raw REST API via `curl` with a token from env, if one is configured) rather than stalling — note the fallback used in the summary.

## Context

Parse `Provider:` from $ARGUMENTS (or infer it, see above), then look up the PR/MR and its threads via that provider's tool from the table above. If a ticket ID is given, look it up too (ADO MCP `wit_get_work_item` / `gh issue view` / `glab issue view`) to re-check description/AC/discussion and confirm intended scope. Read root-level `CLAUDE.md`/`SKILL.md` before implementing.

## Steps

1. Parse `Provider:` from $ARGUMENTS (or infer it, see above).
2. Fetch the PR/MR and every thread via that provider's tool; list open (active/pending/unresolved) threads with file, line, author, and comment text.
3. Classify each: **Fix now** / **Reply only (invalid/out of scope)** / **Reply only (needs human decision — still leave open with an explanation)**.
4. Implement valid fixes using `implement-ticket-v2`'s workflow on the PR/MR's existing branch (do not create a new branch): preserve behavior unless the ticket or finding requires a change, add/update tests for logic/validation/branching changes, follow existing test style.
5. Run relevant tests/build; re-check the diff against the ticket and each addressed finding.
6. Commit and push the fixes to the PR/MR's branch.
7. For every thread you fixed: reply via the provider's reply tool explaining what changed (file/line), then mark the thread resolved via the provider's resolve tool.
8. For every thread you decided not to fix: reply via the provider's reply tool explaining why (invalid / out of scope / needs a decision) — leave its status as-is.

## Rules

- Validate every finding against the ticket + code + tests before changing anything; every reply states the reasoning briefly.
- Do not expand scope beyond what the threads/ticket ask for; no unrelated refactors.
- Don't remove code just because it "looks unused" unless verified safe.
- Push directly to the PR/MR's existing branch — do not open a new PR/MR or create a new branch.
- Reply to and update every open thread you touched — do not leave a fixed issue without a reply, and do not mark a thread resolved without having replied to it first.

## Output

Return the final response. Use only these sections — omit any with nothing to report:

**Review Thread Decisions**

| Thread (file:line) | Finding | Decision | Reply posted | Thread status set |
|---|---|---|---|---|

**Implementation Summary**

| Area / File | Change | Verification Result |
|---|---|---|

**Tests / Verification**

| Item | Result | Notes |
|---|---|---|
| Unit tests | Passed / Not run / Failed | |
| Build | Passed / Not run / Failed | |

**Notes/Assumptions** (only if you had to make a judgment call on ambiguous/missing info, including provider inference)

| Assumption | Reasoning |
|---|---|

**Final Summary**: 1–2 sentences on how many threads were resolved vs. left open, and overall PR/MR readiness.
