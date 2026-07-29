# Ticket Executor — Project Documentation

What the app does and why, at the level a new contributor needs before reading
code. Setup steps: `ticket-executor/README.md`. Module layout and coding rules:
`ticket-executor/CLAUDE.md` + `UI-STYLEGUIDE.md`. Neither is repeated here.

---

## 1. The product

A **local web UI that drives the Claude Code CLI against work-tracker tickets**.
Pick a sprint ticket, press one button: the app spawns `claude` non-interactively
inside the target git clone, and the agent branches, implements, verifies,
commits, pushes and opens a PR — with the live log, inferred progress step and
token/cost streamed back to the browser.

Framing decisions that shape the whole codebase:

- **A developer tool on one machine, not a shared service.** CLI, git clones,
  Postgres and the installed skills are all local.
- **It makes real commits, pushes and PRs** (`--dangerously-skip-permissions`).
- **Provider-agnostic by design.** `ProviderId = azure-devops | github | jira |
  gitlab`. ADO is fully wired; GitHub is partial (issues, PR review, commits,
  status); Jira/GitLab are scaffolds that degrade to an empty "not connected"
  state instead of throwing.
- **Its baseline is "driving the CLI by hand, one session at a time"** — not
  "coding manually". The dashboard is built on that distinction.

What it adds over the bare CLI: batch runs in isolated worktrees · ticket
context pulled from the provider · preflight gates that reject a doomed run
before tokens are spent · parked plans that survive a restart · a persisted
record of every run's cost, change size and outcome.

---

## 2. Business flows

**Connect → pick work → run.** Settings (provider + **organization** URL + PAT)
→ Projects (org's project list) → Ticket Execution (project + sprint + ticket) →
Overview tab (set **Root repo**, confirm skill) → CTA.

**Two run shapes**, keyed on the skill
(`TWO_PHASE_SKILLS = { implement-ticket-v3, fix-code-review-v3 }`):

- *Single-phase* (`*-v2`) — one turn, branch → implement → verify → commit →
  push → PR. No gate.
- *Two-phase* (`*-v3`) — turn 1 runs `Mode: plan` and stops after writing
  `.te/plan.md` (no branch, no source edits). The run **parks** at
  `awaiting-approval` holding no child process. From the Plan tab:
  **Accept** → plan written back, `claude --resume <session-id> "Mode: implement"`
  keeps the same session's context · **Request changes** → feedback to
  `.te/feedback.md`, resume with `Mode: replan`, re-park · **Cancel** → killed
  (`endReason = plan-rejected`).

Both v3 skills share one `.te/plan.md` / `.te/feedback.md` / `Mode:` contract, so
the engine and the Plan tab are skill-agnostic.

Which shape a button uses comes from two Settings toggles — `autoImplement` and
`autoResolveCodeReview` — on ⇒ the one-shot `*-v2`, off ⇒ the gated `*-v3`. A
per-ticket skill override always wins.

**Resolve Review** is the second first-class flow: a PR's review threads are read
back into the Resolve Review tab, and a `fix-code-review-v*` run fixes, replies
and resolves them. Unresolved counts across loaded tickets feed the header bell.

**Isolation** (`Setting.multiTicketMode`): on ⇒ each run gets its own
`git worktree --detach` under `rootRepo/.te-worktrees/`, so concurrent runs never
share an index; removed when the run finishes (a parked run keeps its worktree),
and the branch/commits/PR live in the real repo, so removal loses nothing.
Off ⇒ the run executes directly in `rootRepo`, and a second start returns **409**
while any run — live *or* a parked plan — is active. Batch runs are capped by
`Setting.concurrentRuns`.

**Run artifacts never reach a commit.** Before spawning, `startExecution()`
appends `/.te/` and `/.te-worktrees/` to the repo's `.git/info/exclude`
(idempotent, resolved via `--git-common-dir` so it also covers every worktree).
This is the engine's job, not the skill's: an agent that forgets commits the
plan, and a worktree left by a crashed run would otherwise be untracked noise in
every later diff. `.gitignore` is never touched — it is the project's own
tracked file.

**Plugins are switched off for a run.** `commonArgs()` passes `--settings` with
an `enabledPlugins` overlay (every plugin key found in the user's settings files,
set to `false`). A run drives one known skill non-interactively, so a plugin's
extra skills, commands, MCP servers and hooks are per-turn context it never uses.
Measured per turn on a developer machine: **26.8k** system-prompt tokens
inheriting everything → **11.3k** with `--strict-mcp-config` → **6.0k** with
plugins off. The app's own four skills live in `~/.claude/skills`, are not
plugin-provided, and still load. `CLAUDE_KEEP_PLUGINS=1` opts back in.

**Token discipline is part of the skill contract.** All four skills carry a
"Working rules" block: the ticket/PR id is given and never inferred; work-item
attachments are read as *text* and only downloaded — one file, into the OS temp
dir, never the repo — when an AC is otherwise incomprehensible; reading is
grep-first and scoped to the files being changed; verification runs the narrowest
check that proves the change. Two-phase runs additionally must not re-explore in
`implement` what they already read while planning, and the resume prompts open
with an explicit `Mode:` token so the skill's mode table cannot read the turn as
"plan then implement in one go".

**Status write-back** uses the provider's *real* workflow states, never a
hard-coded list. Since ADO states vary per work-item type, a desired label is
mapped onto an existing state first; no match → **422**. After an implement run
the ticket advances to `Code Review`.

**Preflight — cheap guards first.** (1) *Client*: run already active? another
ticket running in single-ticket mode? runnable status? Root repo set? — a miss
sends no request. (2) *Server* (`POST .../implement`): project present, Root repo
exists and is a git repo, Claude has an MCP path to the provider, single-ticket
guard — a miss returns 400/409, creates no run row, and persists a
`BlockedAttempt`. (3) *Engine*: worktree + spawn — the first step that costs
money. Only *cheap* MCP failures block; the slow verdict is read from a 5-minute
cache (miss ⇒ start with a warning toast).

---

## 3. Architecture

Pages live under the `app/(app)/` route group (one shared shell: persistent
`AppReactor` backdrop + `Sidebar`): `/` Home · `/projects` · `/ticket-execution`
· `/dashboard` · `/system-check` · `/guide` · `/settings`. `/login` sits outside.
Auth is enforced upstream in `proxy.ts` (Next 16's renamed middleware), not in
the layout.

`app/TicketExecutor.tsx` is the only stateful screen component — all Ticket
Execution state, fetching, SSE and derived values; everything under
`app/ticket-executor/` is presentational.

**Engine.** `lib/executionStore.ts` is a re-export facade (API routes import from
it only); the implementation is `lib/execution/`. `startExecution()` spawns
`claude` with `--output-format stream-json --dangerously-skip-permissions
--session-id <uuid>` and parses NDJSON events into a live log plus the furthest
of 10 steps reached — inference is **phase-aware**, so the same tool means "Draft
plan" in the plan phase and "Implement changes" in the implement phase.
Live state is an in-process `Map` (kept across HMR via `globalThis`); status,
result and plan fields go to Postgres so completed *and parked* runs survive a
restart, with `rehydrate()` rebuilding the entry (flagging
`resumedAfterRestart`).

**Two independent credential paths — the thing most easily missed:**

| Who | How | Configured where |
|---|---|---|
| The app (tickets, sprints, PR data, status writes) | REST with the stored PAT | Settings |
| The Claude CLI a run spawns | the provider's **MCP server** | `Setting.manageMcp` / the user's own config |

The skills read the work item and drive the PR through MCP tools, so a run
without an MCP path burns tokens and then fails. `resolveMcp()` picks one of:
**managed** (build the server from the stored org+PAT, `--mcp-config` **with**
`--strict-mcp-config`, so the run sees only that one server — every other MCP
server on the machine would otherwise load its whole tool schema into the system
prompt on every turn) · **user** (their own server found → the app stays out of
*configuring* it, but a stdio server's verbatim declaration — `env` included — is
still copied into the run's own config so that run can be strict too; a
remote/OAuth server is left unpinned, since its credentials live in the CLI's
state rather than the config, and only that run keeps inheriting the machine's
servers) · **env-override** (`CLAUDE_MCP_CONFIG`, strict) ·
**unmanaged/unsupported** (carries a blocker + a fix). It resolves **per turn**,
not per run, since a parked plan can resume after Settings changed; the generated
config is deleted the moment the turn ends and written outside the repo — it
holds the PAT in clear text. There is deliberately no cache of that file:
rebuilding it costs ~1ms, while a stored copy would be a standing plaintext
credential *and* would silently serve a rotated PAT or a changed org.

The managed ADO server itself runs from a **global install when one exists**
(`npm i -g @azure-devops/mcp@2`), resolved to the package's own entry point and
started as `node <entry>`, with `npx -y` as the fallback. Each turn is a fresh
CLI process, so `npx` pays a full registry resolution every time — measured
~6.9s cold / ~3.4s warm against ~1.0s for the installed copy. A major-version
mismatch falls back to `npx`, so the pinned contract can never drift. A user-configured ADO server takes the org as a
positional argument, so it can silently serve a *different* org than Settings;
System Check compares them.

**Provider layer.** `lib/ado.ts` is configured at org level with the **project as
a per-call parameter**. `lib/tickets.ts` dispatches every provider-facing
operation on `ProviderId` and returns graceful empty results for unwired ones.
`PersonalFilter` narrows tickets to the configured account and notifications to
PRs it authored, matching loosely (`sara.lin@company.com` ↔ `Sara Lin`).
GitHub has no work-item→PR link API, so the PR URL recorded on the ticket's most
recent execution is used instead — ADO falls back to it too.

**Secrets & auth.** PATs are AES-256-GCM encrypted at rest (`enc:v1:`), keyed by
`SETTINGS_ENC_KEY` → `DATABASE_URL` → a dev constant; `GET /api/settings` returns
only `hasPat`. Auth is a shared-password POC with no user accounts: the cookie is
`HMAC-SHA256(APP_ACCESS_PASSWORD, "authenticated")`, recomputed and
constant-time-compared in `proxy.ts` — no session store. Empty password ⇒ the
gate is disabled entirely.

**Preflight & skills.** `lib/preflight.ts` is read-only and token-free, grouped
into `environment` / `skills` / `connection` / `agent-access` / `repo`, with an
opt-in deep tier (~30s) that calls the provider and health-checks every MCP
server. The System Check page is **advisory** — the hard gates run at start
instead. It deliberately skips Root repo (per-ticket, validated on every start)
and `git push` credentials (nothing to check against). The four required skills
ship inside the repo and install by copying into `~/.claude/skills/`;
`installSkill()` only writes the four allowlisted names, never deletes, and
refuses (**409**) an existing folder whose content differs until `force`. Note
`GET /api/skills` (the Overview combobox) falls back to a curated list when no
directory is readable, so it can list a skill that is not installed — trust
System Check.

---

## 4. Dashboard

Three tiers, three different questions. Filters: days + provider + project.
Every comparison tile states its baseline inline; **`leverage` compares against
one sequential CLI session and `roi` against not using an agent at all — never
conflate the two.**

- **01 VALUE** — compression factor, peak concurrency, hours saved by overlap
  (Σ run wall-clock − union wall-clock), agent active vs human-wait hours,
  runs blocked before spawn and the USD that averted, sessions recovered after a
  restart. Plus an optional estimate-priced ROI panel, hidden unless
  `hourlyRateUsd` is set — a made-up rate is worse than no number.
- **02 QUALITY** — measured **per ticket, not per run** (rework is exactly what a
  per-run view hides): first-pass rate, rework factor, plan-approval rate and
  revisions, review-fix ratio, change size, delivery funnel, per-skill
  consistency.
- **03 OPERATIONS** — cost trend by local day overlaid with runs/shipped,
  reliability, spend and tokens, cache hit ratio, breakdowns by
  provider/project/skill/model/effort.

Implementation constraints worth knowing: the aggregate's `select` is
deliberately narrow — `filesChanged` / `logLines` / `planMarkdown` are large
blobs and must never enter a table-wide aggregate, which is why the denormalized
`filesTouched` / `linesAdded` / `linesDeleted` columns exist. Day buckets use the
**server's** local day (`toISOString()` would file an evening GMT+7 run under the
wrong date). The funnel is a separate endpoint because resolving PR outcomes
costs 1–2 provider round-trips *per PR* — capped at the 60 most recent, reporting
how many it `sampled`, and degrading to "not measured" rather than a misleading
zero. And **any success rate must exclude the human-ended reasons**.

---

## 5. Data model (Postgres via Prisma)

Six models. Full column comments live in `prisma/schema.prisma`.

- **`Setting`** — single `default` row mirroring the Settings page, plus the
  dashboard ROI inputs (`hourlyRateUsd` 0 ⇒ tile hidden; `hoursPerStoryPoint`).
- **`ProviderCredential`** — per-provider `org` + encrypted `pat`. For ADO, `org`
  is the **organization** URL. The PAT never lives in `Setting`.
- **`Execution`** — one run: identity/state, two-phase resume state
  (`sessionId`/`worktreePath`/`rootRepo`/`phase`/`planStatus`/`planMarkdown`),
  CLI-reported usage accumulated across turns, and the dashboard's measurement
  columns:

  | Column | Why it exists |
  |---|---|
  | `endReason` (`""`\|`cancelled`\|`plan-rejected`) | `status` stays `failed` for all three so the retry affordance is unchanged — but a human's decision must not be scored as an agent failure |
  | `parkedAt` / `humanWaitMs` | Keeps "the agent was computing" separable from "a human hadn't answered", across several park/resume rounds |
  | `planRevisions` | Revise rounds before approval |
  | `resumedAfterRestart` | A session a bare terminal would have lost |
  | `filesTouched`/`linesAdded`/`linesDeleted` | Scalar summary so aggregates never load the diff blob |
  | `estimateHours` | The team's sizing, snapshotted at start so a re-estimate can't rewrite history |

- **`BlockedAttempt`** — a request preflight rejected before spawning
  (`root-repo` / `agent-access` / `single-ticket-mode`). Recorded because a 400
  otherwise leaves nothing to measure; written best-effort so logging can never
  turn a 400 into a 500.
- **`SavedOption`** + **`RootRepoProjectMap`** — combobox memory, and the last
  root repo per project.

**Root repo is deliberately not defaultable.** The connection project (a UI
choice) is independent of the git repo a run executes in, and one org connection
spans many repos — so `rootRepo` is per ticket, prefilled from
`RootRepoProjectMap`, with no env var or app-wide default. It is used verbatim as
the run's cwd; the project name is never appended.

---

## 6. API surface

All routes are thin wrappers over `lib/*`, all behind the auth gate.

| Group | Routes |
|---|---|
| Auth (public) | `POST /api/auth/login` · `logout` |
| Work items | `GET /api/projects` · `/api/tickets` (`project`+`sprint`) · `/api/sprints` · `/api/tickets/[id]/{comments,review,commits,commits/[sha],executions}` · `GET\|POST /api/tickets/[id]/status` |
| Runs | `POST /api/tickets/[id]/implement` (any skill; validates Root repo + agent access, enforces single-ticket mode, snapshots the estimate, records a `BlockedAttempt` on rejection, may return `warnings[]`) · `GET /api/executions/[id]` · `/stream` (**SSE**: polls the in-process store, emits only on change, closes on completed/failed/**awaiting-approval**) · `POST .../cancel` · `POST .../plan` (approve/revise/cancel) |
| Metrics | `GET /api/dashboard` (`provider`+`project`+`days`) · `/api/dashboard/funnel` · `/api/reviews/summary` |
| Setup | `GET\|POST /api/settings` (PAT never returned) · `POST /api/settings/test` · `GET /api/preflight` · `GET /api/skills` · `GET\|POST /api/skills/install` · `GET\|POST /api/options` · `/api/options/mapping` |

---

## 7. Sharp edges

- Runs make real changes — point Root repo at a scratch clone the first time.
- The skill dropdown can list a skill that isn't installed; the run then fails
  partway, after spending tokens.
- `git push` must work non-interactively per clone; a run cannot answer a
  credential prompt and System Check cannot verify this.
- Changing `DATABASE_URL` without an explicit `SETTINGS_ENC_KEY` makes stored
  PATs unreadable — they come back empty and must be re-entered.
- A user-configured MCP server can silently serve a different organization.
- The Resolve Review tab's PR link is *reconstructed* from the provider (the
  Result tab uses the URL the run itself recorded, which is always right). For
  ADO it comes from `repository.webUrl`, falling back to a hand-built URL and
  then to the recorded one — never to a partial URL, since an empty repo segment
  (`.../_git//pullrequest/<n>`) resolves to the project's PR *list*.
- Only ADO is fully wired; GitHub is partial; Jira/GitLab are scaffolds.
- Next 16.2.10 / React 19.2.4 are ahead of most training data (middleware is
  `proxy.ts`, route `params` are a `Promise`) — read
  `node_modules/next/dist/docs/` before writing Next.js code.
- No lint or test script exists; type-check with `npx tsc --noEmit`.

---

## 8. Keeping this document accurate

**Mandatory:** after every code change, review the change against this document
and update it in the same change if any of these moved — business flow, run
shapes or gating rules, pages, API surface, data model, dashboard metrics or
their baselines, provider/MCP behaviour. Also recorded in `CLAUDE.md`.
