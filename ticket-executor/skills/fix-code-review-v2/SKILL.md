---
name: fix-code-review-v2
description: Fully autonomously resolve open PR/MR review comments end-to-end across Azure DevOps, GitHub, or GitLab — read threads, validate, implement fixes, reply, and mark resolved — in a single non-interactive run
version: 2.0.0
---

Resolve the open code-review comments on the pull/merge request described in $ARGUMENTS (format: `Provider: <id> - PR: <pr-url-or-id> - Ticket: <ticket-url> - Project name: <project>`, where `Ticket:` is the provider's deep link to the work item — an older caller may pass a bare id instead) then close the loop on the tracker yourself. Everything you need is in this file — do not load another skill to find the implementation rules.

## Goal

Every open review thread on the PR/MR should end the run either resolved (fix applied + replied) or explicitly left open with a reply explaining why — never silently ignored, and never left for a human to reply or click "Resolve" by hand.

## Autonomy (read this first)

This skill may run non-interactively (no human available to answer mid-run). Never end a turn with a question or a "let me know" / "should I..." / "bạn có muốn..." style sentence.

- If a comment is ambiguous or under-specified, pick the most reasonable interpretation given the ticket, the surrounding code, and the reviewer's wording — implement it, and say so in the final summary.
- Only leave a thread open (not resolved) when the finding is invalid, out of scope, or needs a human decision — in that case reply explaining why instead of guessing, but still reply (don't go silent).

## Working rules (these bound cost — they override any habit to be thorough)

- **The PR is given, never searched for.** $ARGUMENTS always carries `PR:`. If it doesn't, stop immediately and say so — never list a repo's pull requests looking for the right one.
- **Attachments stay out of the repo.** Review comments and the linked ticket may embed images/PDFs. Read the text first; only when a finding is incomprehensible without it, download that one file into the OS temp directory (`%TEMP%` / `$TMPDIR`) and read it from there — never into the repo, never in bulk.
- **Read only what the threads point at.** Each thread names a file and line: open that file and its direct call sites, nothing more. Never read a file twice in one session, and never read `node_modules/`, `.next/`, `dist/`, build output, lockfiles, or `.te-worktrees/`.
- **Fetch the threads once.** Pull the full thread list in a single call and work from it; re-list only after posting replies, if you need to confirm final state.
- **Keep command output small.** Prefer the narrowest check that proves the fix over a full build; filter or tail unavoidably chatty output.

## Provider (read this before touching the tracker)

$ARGUMENTS carries the provider explicitly as `Provider: <id>` (one of `azure-devops`, `github`, `gitlab`). Parse it first — it decides which tool/CLI you use for every step below. Only if it is absent (older caller), infer it once from the `PR:` URL host, else from `git remote -v`, falling back to `azure-devops`.

If the declared provider turns out not to work (e.g. `gh`/`glab` isn't authenticated, or ADO MCP has no such PR), don't ask and don't retry it repeatedly — try the provider matching the git remote once, note the mismatch as an assumption, and continue.

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

Parse `Provider:` from $ARGUMENTS (or infer it, see above), then look up the PR/MR and its threads via that provider's tool from the table above. If a `Ticket:` link is given, open it too (ADO MCP `wit_get_work_item` / `gh issue view` / `glab issue view`) to re-check description/AC/discussion and confirm intended scope. Read root-level `CLAUDE.md`/`AGENTS.md` (root only, once) before implementing.

## Steps

1. Parse `Provider:` from $ARGUMENTS (or infer it, see above).
2. Fetch the PR/MR and every thread via that provider's tool; list open (active/pending/unresolved) threads with file, line, author, and comment text.
3. Classify each: **Fix now** / **Reply only (invalid/out of scope)** / **Reply only (needs human decision — still leave open with an explanation)**.
4. Implement valid fixes on the PR/MR's existing branch (do not create a new branch): preserve behaviour unless the ticket or finding requires a change, add/update tests for logic/validation/branching changes following existing test style, and keep the diff to what the finding asks for.
5. Verify with the narrowest check that proves the fixes — the affected test file(s), then a type-check, a full build only if nothing faster exists; re-check the diff against the ticket and each addressed finding.
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
- `committed` / `pushed` describe what really happened, not what you intended.
- `blocked.is` is `true` only on a hard external blocker you cannot work around,
  with a one-sentence `reason`. This ends the run cleanly instead of leaving a
  half-done ticket.
- `threadsReplied` and `threadsResolved` count the threads you actually wrote to
  in this run. Read each thread before writing: this run can be retried after a
  crash, and a duplicate reply on someone else's pull request cannot be taken
  back. A thread you skipped because it already carried your reply is not counted.
