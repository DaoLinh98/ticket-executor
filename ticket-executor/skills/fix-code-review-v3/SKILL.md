---
name: fix-code-review-v3
description: Resolve open PR/MR review comments across Azure DevOps, GitHub, or GitLab in two phases — draft a reviewable thread-resolution plan first, then execute it end-to-end (fix, reply, resolve) after the plan is approved
version: 1.0.0
---

Resolve the open code-review comments on the pull/merge request described in $ARGUMENTS (format: `Provider: <id> - PR: <pr-url-or-id> - Ticket ID: <id> - Project name: <project>`), following the same implementation workflow/rules as `implement-ticket-v2`. Unlike `fix-code-review-v2`, the work is split into a **plan phase** a human reviews and a **implement phase** that executes the approved plan.

## Goal

Every open review thread on the PR/MR should end the run either resolved (fix applied + replied) or explicitly left open with a reply explaining why — never silently ignored, and never left for a human to reply or click "Resolve" by hand.

## Mode (read this first)

$ARGUMENTS carries `Mode: <plan|replan|implement>`. It decides which half of this skill runs. Never run a phase other than the one requested.

| Mode | What you do | What you must NOT do |
|---|---|---|
| `plan` | Fetch the PR/MR + its review threads, classify each, write `.te/plan.md` | Do not edit any source file. Do not commit, push, reply to a thread, or mark anything resolved. |
| `replan` | Read `.te/feedback.md`, rewrite `.te/plan.md` to address it | Same prohibitions as `plan`. |
| `implement` | Execute the approved `.te/plan.md` end-to-end | Do not re-litigate the plan or ask for confirmation. |
| *(absent)* | Run `plan`, then immediately `implement` without stopping — the fully autonomous v2 behaviour | — |

Each phase runs non-interactively (no human is available mid-turn). Never end a turn with a question or a "let me know" / "should I..." / "Would you like..." sentence.

- If a comment is ambiguous or under-specified, pick the most reasonable interpretation given the ticket, the surrounding code, and the reviewer's wording — implement it, and record the interpretation in the plan.
- Only classify a thread as "leave open" when the finding is invalid, out of scope, or needs a human decision — never because you didn't look at it.

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

---

## Phase: plan

1. Parse `Provider:` from $ARGUMENTS (or infer it) and fetch the PR/MR overview + every review thread via that provider's tool.
2. If a ticket ID is given, fetch it too and re-check description/AC/discussion for intended scope.
3. Read root-level `CLAUDE.md`/`SKILL.md` and read the real files each thread touches — do not plan a fix against assumptions about what the code looks like.
4. Classify every open thread: **Fix now** / **Reply only (invalid/out of scope)** / **Reply only (needs a human decision)**.
5. Write the plan to **`.te/plan.md`** (create the `.te/` directory if needed) using the template below. This file is the deliverable — a human reads and may edit it before the implement phase runs.
6. End the turn with a one-paragraph summary. Do not ask whether to proceed.

`.te/plan.md` template — keep it markdown, concrete, and reviewable. Name real files, real threads (file:line), and real functions; a plan a reviewer can't check against the code is useless:

```markdown
# Plan — PR <pr id/url>

## Understanding
<2-4 sentences: what the PR/MR is, and what the review is asking for overall.>

## Thread Decisions
| # | Thread (file:line) | Finding | Decision | Reasoning |
|---|---|---|---|---|
| 1 | `path/to/file.ts:42` | <summary of the comment> | Fix now / Reply only (invalid) / Reply only (needs decision) | <why> |

## Changes
| # | File | Change | Addresses thread # |
|---|---|---|---|
| 1 | `path/to/file.ts` | <what you will add/modify> | 1 |

## Verification
- <command you will run, e.g. `npm run build`> — <what it proves>

## Risks / Assumptions
| Item | Reasoning |
|---|---|
```

Rules for this phase:

- **No source edits.** The only file you write is `.te/plan.md`. Reading, grepping, and running read-only commands is expected and encouraged.
- No commits, no push, no thread replies, no resolving threads.
- If a thread is ambiguous, put your chosen interpretation in "Risks / Assumptions" and plan against it — never leave the plan blank pending an answer.

## Phase: replan

The plan you proposed was rejected. Read **`.te/feedback.md`** — it holds the reviewer's reason. Rewrite `.te/plan.md` so it addresses that feedback, re-reading code/threads as needed to keep the revised plan grounded. Same prohibitions as `plan`: no source edits, no commit, no thread replies/resolves. End with a short note on what changed between the old plan and the new one.

## Phase: implement

**`.te/plan.md` is the single source of truth for this phase.** Re-read it from disk first, even if you wrote it yourself earlier in this session — the reviewer may have edited it. Where the file on disk differs from anything you proposed or discussed before, **the file wins**; discard your earlier version.

1. Re-read `.te/plan.md`.
2. For every thread marked **Fix now**: implement the change using `implement-ticket-v2`'s workflow on the PR/MR's existing branch (do not create a new branch): preserve behavior unless the ticket or finding requires a change, add/update tests for logic/validation/branching changes, follow existing test style.
3. Run relevant tests/build; re-check the diff against the ticket and each addressed finding. Fix failures you caused before moving on.
4. Commit and push the fixes to the PR/MR's branch.
5. For every thread you fixed: reply via the provider's reply tool explaining what changed (file/line), then mark the thread resolved via the provider's resolve tool.
6. For every thread marked **Reply only**: reply via the provider's reply tool explaining why (invalid / out of scope / needs a decision) — leave its status as-is.

If executing the plan surfaces something it got wrong (a file that doesn't exist, an approach that can't work), do not stop and do not silently follow the broken plan: implement the smallest correct deviation, and record it in "Notes/Assumptions" as a deviation from the approved plan.

Do not commit `.te/` — add it to `.git/info/exclude` (not `.gitignore`, which is a tracked project file) if it would otherwise be picked up.

## Rules

- Validate every finding against the ticket + code + tests before changing anything; every reply states the reasoning briefly.
- Do not expand scope beyond what the threads/ticket ask for; no unrelated refactors.
- Don't remove code just because it "looks unused" unless verified safe.
- Push directly to the PR/MR's existing branch — do not open a new PR/MR or create a new branch.
- Reply to and update every open thread you touched — do not leave a fixed issue without a reply, and do not mark a thread resolved without having replied to it first.
- In the `implement` phase, commit/push/reply/resolve automatically once implementation + verification are done — do not wait for explicit confirmation (this skill supersedes any general "ask before committing" default).
- If verification cannot be completed, say exactly what and why — never claim tests/build passed when they didn't run.

## Output

**Plan / replan phases** — a short prose summary of what the plan covers. The real deliverable is `.te/plan.md`; don't duplicate the whole plan in the response.

**Implement phase** — keep this short; the reviewer already read the plan, so don't re-explain it. Report only what happened since the plan was approved. Use only the sections below; skip a section entirely if it has nothing to report.

**Review Thread Decisions**

| Thread (file:line) | Decision | Reply posted | Thread status set |
|---|---|---|---|

**Tests / Verification**

| Item | Result | Notes |
|---|---|---|
| Unit tests | Passed / Not run / Failed | |
| Build | Passed / Not run / Failed | |

**Deviations from the plan** (only if something diverged from the approved `.te/plan.md`)

| What changed | Why |
|---|---|

**Final Summary**: 1–2 sentences on how many threads were resolved vs. left open, and overall PR/MR readiness.
