# CLAUDE.md

Developer contract for this repo. `README.md` is the operator guide.
`UI-STYLEGUIDE.md` binds every change under `app/`.

@AGENTS.md

## What this app is

A local Next.js UI that spawns the **Claude Code CLI** against a ticket: pick a work
item, hit Implement, and the engine branches a real clone, runs `claude` with
`--dangerously-skip-permissions`, commits, pushes and opens a draft PR — streaming
log, steps and cost to the browser. **Flow Runner** runs a whole sprint unattended: an
agent triages the iteration, the harness lays it on two schedules (an implement queue
and a release calendar) and a server-side scheduler acts on both with the browser
closed. Runs cost money and touch real repositories, so guards fail *before* a spawn,
never after.

## Two engines — keep them apart

The app carries two independent run engines. They share only the shell, preflight
(`validateRootRepo()` / `validateAgentAccess()`), credentials and the MCP config
writer — no graph, table, prompt or contract.

| | **Ticket Execution** | **D-Agent workflow** |
|---|---|---|
| Page | Ticket Execution screen, My Sprint, Flow Runner | `/workflow` |
| Engine | `lib/execution/` via `lib/executionStore.ts` | `lib/dagent/` |
| Step runs | a **skill** (`implement-ticket-v4`, …) | a **subagent** from `~/.claude/agents/` |
| Tables | `Run`, `Step`, … | `DagentRun`, `DagentStep`, `DagentTransition`, `DagentArtifact` |
| Rules | [Engine invariants](#engine-invariants--ticket-execution-libexecution) | [D-Agent workflow engine](#d-agent-workflow-engine-workflow-libdagent) |

**When asked about one flow, read and answer from that flow's code only.** Do not
compare it with the other engine, borrow its rules, or "align" one with the other
unless explicitly asked. A rule stated for one engine does not bind the other.

**The one junction is Flow Runner's scheduler.** `SprintPlan.engine` (`classic` |
`dagent`, the ENGINE switch on Flow Runner) picks which engine `startNextTicket`,
`startReviewRun` and `startQaFix` start on (`startOn()` in `scheduler.ts`). The planned
ticket stamps `runEngine` / `reviewEngine` at start, and reconcile/cancel read the
matching table — D-Agent outcomes via `runOutcomes()` (`lib/dagent/index.ts`) — so a run
outlives a switch. A D-Agent row's Watch/Result opens `/workflow?ticket=<id>`.

## Commands

```bash
npm run dev                 # http://localhost:3000 (Turbopack)
npm run build && npm start  # production build
npm run test                # node --test over tests/*.test.ts (TS via tests/register.mjs)
npx tsc --noEmit            # type check — there is no lint script
npx prisma migrate dev      # apply/create migrations
npx prisma generate         # after any schema.prisma change
```

**A `schema.prisma` change is unfinished until migrated and generated** — a column
only in the schema file is a 500 on the first page that selects it, and a hand-written
migration backfills the rows already in the table. Next is pinned at `16.2.10` /
React `19.2.4`: read `node_modules/next/dist/docs/` before writing framework code
(middleware is `proxy.ts`).

## Where code lives

- **Pages / shell** — `app/(app)/*` under one layout (`AppReactor` + `Sidebar`);
  `/login` sits outside the group and pages never render their own `<Reactor>`. A page
  header is exactly `PageHeading` + `NotificationCenter` + `ProviderBadge`; the page's
  own controls go on a `PageToolbar` between the header and `<main>` — never inside
  `<main>`, which clips open dropdowns.
- **Ticket Execution UI** — `app/TicketExecutor.tsx` is the only stateful screen
  component (state, fetching, SSE/polling); everything under `app/ticket-executor/` is
  presentational. New state goes in the container, new markup in a child.
- **Execution engine** — `lib/executionStore.ts` is a re-export facade over
  `lib/execution/` (`graph/*`, `runner.ts`, `admission.ts`, `claudeCli.ts`, `git.ts`,
  `queries.ts`, `triage.ts`, `planStore.ts`, `release.ts`,
  `scheduler.ts`). **API routes import from `lib/executionStore` only.**
- **D-Agent workflow** — page `app/(app)/workflow` → `app/ticket-executor/workflow/`
  (`WorkflowView.tsx` is the stateful container; the rest is presentational), canvas
  layout/presentation in `lib/workflow/`, engine in `lib/dagent/`. **API routes
  (`app/api/dagent/runs/*`) import from `lib/dagent` (`index.ts`) only.**
- **Pure rule modules** — `admission.ts`, `identity.ts`, `sprintPlan.ts`,
  `notifications.ts`, `execution/loopMetrics.ts`: no Prisma, no provider, covered by
  `tests/*.test.ts` in ~1s. A rule the machine acts on unattended belongs here, not in
  a route or a component.
- **Provider access** — `lib/tickets.ts` dispatches on `ProviderId`; `lib/ado.ts` /
  `lib/github.ts` are the clients; credentials resolve via
  `lib/providerCredentials.ts`.
- **Auth** — one shared password (`APP_ACCESS_PASSWORD`), no accounts: `lib/auth.ts`
  is the HMAC cookie, `proxy.ts` the gate, `/login` + `/api/auth/*` the only public
  paths. An empty password disables the gate (the local-dev default).
- **Boot and push** — `instrumentation.ts` installs bundled `skills/` and `agents/`, runs
  `recoverInterruptedRuns()`, then starts the scheduler and the push watcher
  (`lib/push.ts`, `lib/pushWatcher.ts`, `app/api/push/*`, `public/sw.js`,
  `app/manifest.ts` — iOS grants push only to a Home-Screen install of a
  `display: "standalone"` manifest).

## Engine invariants — Ticket Execution (`lib/execution/`)

Nine rules bind any change under `lib/execution/`. They do not apply to `lib/dagent/`.

1. **Every agent node declares a JSON Schema; edges route only on the validated
   `structured_output`.** Never parse prose or scrape the log.
2. **An `external` node is never on a cycle.** Anything leaving the machine (push,
   PR, tracker write) is a leaf that runs once — a retry is a duplicate PR.
3. **Admission control belongs to `startRun()`, not to a route.** `resolveSkill()`
   picks the skill server-side and the may-it-start check commits in the same
   transaction as the `Run` insert, under a Postgres advisory lock.
4. **A documented guard must be wired and observable.** No unreachable ceiling and no
   silent degradation — a `context: "resume"` with no session says so in the log.
5. **A judging node runs `context: "fresh"`, and anything changing a graph's shape is
   encoded in its id** (`implement-v5`), so a run resumed after a restart finishes on
   the shape it started on — `graphById()` still serves the `-v4` shape (no `reflect`)
   to a run that began on it. Skill names are not graph ids and stay `*-v4`. Every skill a graph invokes — its own and
   `review-changes-v4` — is checked by `skillProblem()` in `startRun()`: a missing or
   older-than-bundled copy is an **admission** refusal, never a mid-run failure.
6. **Never re-derive state the harness owns.** Failure reason is the edge's `reason`
   plus its `Transition`; what a node is comes from its `kind`, never the id; output
   is `channels` / `Step.output`. A regex over a run's own log is always the bug.
7. **Every run is one closed loop, and nobody approves a plan.** All three flows
   (`implement-ticket-v4`, `fix-code-review-v4`, `fix-qa-v4`) walk
   `implement → check → evaluate → fix → publish`: a zero-token test gate, then a
   fresh reviewer, with `fix` bounded by `MAX_FIX_ATTEMPTS`. `.te/plan.md` is a record,
   not a gate. The outer loop is the project's `KNOWLEDGE.md`, read and written by
   absolute path in the **Root repo** (`knowledgeFile()`), never in the worktree, and
   never committed.
8. **An exhausted loop leaves a lesson, then fails.** When `fix` hits
   `MAX_FIX_ATTEMPTS` and check/evaluate still refuse, the edge goes to `reflect`
   (`effects: "local"`, `context: "resume"`, `REFLECT_OUTPUT`), whose only edge is
   FAIL with the standing refusal as reason. It edits no code and never commits or
   pushes; a turn error, quota park or cancel never reaches it.
9. **`KNOWLEDGE.md` is audited, not trusted.** `LiveRun.knowledgeAtStart` holds the
   file's content at spawn; `finish()` saves the line diff (`knowledgeChange()`,
   `graph/knowledge.ts`) as Artifact kind `knowledge`, shown on the run's Result or
   Execution tab, and warns past `KNOWLEDGE_MAX_LINES` (200). Skills keep entries to
   two lines and prune before growing past that.

**Run `npm run test` after touching a graph, an edge, a node contract,
`resolveSkill()`, or any pure rule module.**

## D-Agent workflow engine (`/workflow`, `lib/dagent/`)

One graph, `dagent-implement-v2` (`graph.ts`), driven by `engine.ts`. Every agent step
is a subagent spawned by `cli.ts` as `claude -p --agent <name> --json-schema …`;
**no skill is invoked**. Behaviour lives in the agent's system prompt
(`~/.claude/agents/<name>.md`) plus the brief from `prompts.ts`.

| Node | Kind | Runs | Does | Next |
|---|---|---|---|---|
| `setup` | harness | git | exclude run files, set identity, pick base (`origin` default or retry seed), one **worktree** per repo, restore `.te/plan.md` on retry | readiness / FAIL |
| `readiness` | agent | `analyst` | ready?, acceptance criteria, `delivery` (none/partial/done) checked on base | plan / END (done) / NEEDS_INPUT / FAIL |
| `plan` | agent | `planner` | `planMd` (harness writes `.te/plan.md`), `branch`, `acMap`, `repos`; ≤ `MAX_PLAN_ATTEMPTS` (2) | planCheck |
| `planCheck` | check | `planIssues()` | plan file, branch, every AC → files + test, repos in scope | implement / plan / FAIL |
| `implement` | agent | `implementer` | code the plan, build/test, **commit locally, no push** | syncBase / FAIL (nothing committed) |
| `syncBase` | harness | git | fetch + rebase onto origin default; conflict → abort + warning | diffGuard |
| `diffGuard` | check | `diffViolations()` | agent/secret/unplanned-config files, credential-like lines; records `changed` + `heads` | evaluate |
| `evaluate` | agent | `reviewer` | review `base..HEAD` against AC + plan + harness warnings → `blockers` | prePublish / fix / reflect |
| `fix` | agent | `fixer` | fix exactly the blockers, commit; ≤ `MAX_FIX_ATTEMPTS` (5) | syncBase / reflect (blocked) |
| `reflect` | agent | `reflector` | maybe record a lesson in Root repo `KNOWLEDGE.md`; no code, no commit | FAIL |
| `prePublish` | check | git | clean tree, right branch, HEAD = verified, base unmoved (else re-sync ≤ `MAX_PRE_PUBLISH` 3) | publish / syncBase / FAIL |
| `publish` | agent | `publisher` | push + open/reuse **draft PR** per changed repo; `maxVisits: 1` | verifyPublish / FAIL |
| `verifyPublish` | check | git + provider | remote head = local HEAD, draft, ticket linked (ADO: tracker read-back) | END / NEEDS_REVIEW |

Two more graphs share these nodes (`GRAPHS` keyed by `Flow`; `Ctx.flow` / `Ctx.prUrl`):

- **`dagent-fix-review-v1`** — `setup` checks out the PR's source branch
  (`loadPullRequestBranch()`; base = PR head) → `reviewTriage` (`review-triager`:
  fix / reject / informational per open thread) → `implement` → `diffGuard` ⇄
  `evaluate` ⇄ `fix` → `prePublish` (no base-moved re-sync) → `respond` (`responder`,
  the external leaf: push, one reply per thread, **never resolve**). No `syncBase`: a
  published PR branch is never rebased.
- **`dagent-fix-qa-v1`** — `setup` (new branch from origin default) → `qaTriage`
  (`qa-triager`; `no-fix-needed` → END with `qaReply`) → the implement loop from
  `implement` through `verifyPublish` (a new draft PR).

`/workflow` has no run picker and no start form: it shows the run in flight (else the
latest) for `?ticket=`, or overall, derived from the live runs list.

Rules that bind any change under `lib/dagent/`:

1. **Edges route only on validated `structured_output`** (`schemas.ts`); an edge may
   only target a node listed in that node's `next` (or a `retryEntries` node from
   `setup`). `MAX_HOPS` (60) fails a looping run.
2. **`publish` is the only `external` node and is never on a cycle.**
3. **Every agent turn is `context: "fresh"`**, with the `Agent` tool and every
   pipeline skill (`Skill(<name>)` for each of `DENIED_SKILLS` in `cli.ts`: the
   `BUNDLED_SKILLS` plus the hand-run `implement-ticket`, `fix-code-review`,
   `dev-team`) disallowed,
   plugins disabled, a per-turn MCP config (`lib/mcp.ts`, deleted after the turn) and
   related repos passed via `--add-dir`.
4. **Admission is `startRun()`**: preflight (`validateRootRepo`, `validateAgentAccess`,
   `checkAgents()` — every agent the graph uses must be installed, named correctly,
   allow `StructuredOutput`, have a body and not be older than the bundled copy),
   then under the
   `ticket-executor:dagent-admission` advisory lock: no active D-Agent run for the
   ticket, no active main-flow `Run` for it, and a free slot (`concurrentRuns`).
5. **Parking, not failing, for humans**: `NEEDS_INPUT` (ticket not ready) resumes with
   `recheck-readiness`; `NEEDS_REVIEW` (PR read-back mismatch) resumes with `accept`.
   A failed/cancelled run is retried as a new run from `plan`, `implement` or
   `syncBase`, seeded with the old base, branches and plan.
6. **Worktrees are per run and always removed** in `finish()`; a `running` row not
   held by this process is failed by `reconcileOrphans()` ("Interrupted by a server
   restart").
7. **`KNOWLEDGE.md` is audited**: content at start is stored on the run and the line
   diff is saved as artifact kind `knowledge` at finish.
8. **The agents ship in the repo.** `agents/<name>.md` is the source of truth,
   `lib/agentPack.ts` (`BUNDLED_AGENTS`, kept equal to `allAgents()` by a test) installs
   them into `~/.claude/agents` on boot and from System Check / Guide, the same way
   `lib/skillPack.ts` does skills. **Changing an agent's prompt or contract bumps its
   `version:`** — an older installed copy is then replaced on boot and refused at
   admission; a same-version copy edited by hand is reported, never overwritten.
9. **A graph shape change gets a new graph id**, and `graphById()` keeps serving the
   old id, so a parked run (`rehydrate()`) finishes on the shape it started on.

After touching a node, edge, contract or rule in `lib/dagent/` or `lib/workflow/`, run
`node --import ./tests/register.mjs --test tests/dagent.test.ts tests/workflowLayout.test.ts`.

## Credentials — one source, no fallbacks

- **Provider auth** is `ProviderCredential` (org URL + PAT, one row per org, encrypted
  by `lib/crypto.ts`, never returned to a page), always read via `resolveCredential()`.
- **Who the developer is** lives on that same row (`identityEmail` / `identityName`),
  not on `Setting` — the same person is a different account per org. `isMine()` /
  `mineOnly()` (`lib/identity.ts`) are the only answer, and **an empty identity means
  do not filter, with `isMine` returning false** for every ticket.
- **The Claude CLI** uses the machine's own `~/.claude` login; the app writes no
  credential file and only adds `IS_SANDBOX=1` when running as uid 0.
- The PAT also reaches the agent through the generated MCP config (`lib/mcp.ts`): one
  file per run under `tmpdir()/te-mcp`, deleted when the turn ends, outside the repo
  so a run's own `git add` cannot pick it up.

## Sprint plan and automation

Binds `lib/execution/{triage,planStore,release,scheduler}.ts` and `lib/sprintPlan.ts`.

1. **Implementing and releasing are two schedules; never collapse them.**
   `implementOrder` is a queue worked back to back; `releaseDay` is a calendar paced by
   `pointsPerDay` (**points**, not rows). A run finishing does not move a work item.
2. **Every PR this app opens is a draft, and the harness publishes it, not the skill.**
   `DRAFT_RULE` is carried by `publishPrompt()`, the only prompt of a node that opens
   one; `isDraft` is a required contract field, never scraped.
3. **Release is not a node** — it happens days later and may not hold a worktree or a
   slot. Its three writes are three columns (`prPublished` / `reviewersSet` /
   `statusMoved`), each re-reading current state; `releasedAt` is stamped only on a
   complete release. This is the one retryable outward action.
4. **The scheduler owns no policy.** `tick()` only calls `startRun()` and
   `releasePlannedTicket()`, takes an advisory lock per tick, and writes an
   `AutomationEvent` for **every** decision including "do nothing". A `draft` plan is
   never scheduled.
5. **Allocation is arithmetic, not an agent** — `buildPlan()` is pure and tested. The
   agent's judgement enters only through `triage-sprint-v4`'s JSON contract
   (`suggestedPoints`, `workOrder`, `needsClarification`); triage writes nothing and is
   not a Run.
6. **A sprint read is not the Backlog tab.** `deliverablesOnly()` drops hierarchy types
   (Azure DevOps only — a GitHub `enhancement` is real work) and every
   `/api/my-sprint*` route applies it **before** `mineOnly()`.
7. **A sprint is what the developer carried, not what still bears their name.**
   `lib/sprintClaim.ts` classifies `mine` / `handed-off` / `dropped` from the app's own
   record (plan progress, `Run`, PR), never the tracker's revision history. So:
   `savePlan()` deletes nothing and never re-dates a settled row; `handed-off` is
   delivered and costs no capacity while `dropped` counts in nothing; `buildPlan()` and
   `startNextTicket()` exclude non-`mine` but `dueForRelease()` deliberately does not;
   `refreshClaims()` runs first each tick, cancels the run of a ticket that changed
   hands, writes only `claim`/`assigneeNow`, and refuses on an empty sprint read, a
   foreign `org` or a changed identity.

## The notification bell

`lib/notifications.ts` owns the merge; `lib/notificationSources.ts` owns the
server-side sources, so the push watcher asks the same question with no browser.

1. **No notification carries a human's words** — the ticket and what happened, only.
2. **Read state is keyed `kind::ticketId::refId`** plus a fingerprint, so a changed
   notification is unread again, and **only `severity: "action"` reaches the badge**.
3. **A new source must be flat in cost** — nothing costing a round-trip per ticket
   goes on this timer.
4. **The lock screen is the same notification set**, built by `lib/pushWatcher.ts` from
   the same two calls and deduped through `PushDelivery`; nothing else may push. It is
   not on the scheduler tick, costs nothing with no subscriber or no VAPID keys, and
   *seeds* the standing backlog as delivered on its first tick (`__seeded__`). There is
   no "stale draft" notification and none for a degraded provider read, which stays the
   dropdown's banner.

## Multi-provider support — mandatory

Any change touching ticket/provider logic branches on `ProviderId` the way
`loadTickets` / `loadReviewsSummary` do, and unimplemented providers degrade
gracefully (empty / "not connected") rather than throwing.

## Redis cache on every load — mandatory

**Every read that backs a load API goes through `cached()` (`lib/redis.ts`).** A new
GET route, or a new provider/DB read behind an existing one, is unfinished until it does.

1. **Provider reads** (Azure DevOps, GitHub, …) are cached in the provider module, keyed
   under that module's prefix (`ADO_CACHE_PREFIX` = `ado:`, `GITHUB_CACHE_PREFIX` = `gh:`)
   and scoped by org/repo, with the TTL taken from that module's `TTL` table.
2. **Heavy DB reads** (aggregates, scans, reports) use `DB_CACHE_PREFIX` with a short TTL,
   like `dashboardMetrics`.
3. **Every write drops what it can stale** (`invalidateWorkItems`, `invalidatePullRequests`,
   `invalidateSetting`, …) before returning, so the user never sees their own change
   missing. A new write path adds its invalidation in the same change.
4. **Only JSON-safe values**, and **never cache a failure**: a `load()` that would return a
   placeholder (`[]`, `null`) for an error throws inside `cached()` and is caught outside.
5. **Redis stays optional** — a miss or a down Redis is never an error.
6. **Exempt, by design:** live execution state (runs, steps, SSE streams), watermark /
   delta polls (notification activity), the System Check probe, the fresh re-read after a
   failed write (`getWorkItemState`), and local-only reads (files, in-memory lists).

## Data fetching and live state — mandatory

**A screen never needs a refresh to be right.** Every new feature is built to these
rules; they are part of "done", not a follow-up.

1. **Server reads in a client component are TanStack Query**, never `useEffect` +
   `fetch` + `setState`. A key read by more than one component lives in
   `app/queries.ts` with its fetcher and hook (`useConnections`, `useProjects`,
   `usePreflight`, `SETTINGS_KEY`, …) so every consumer shares one request and one
   cache. A fetcher throws on a failed response (or carries the server's `error` field
   through); it never invents a placeholder for one.
2. **Keys are exact on purpose.** A key that is a prefix of another (`["my-sprint"]`
   vs `["my-sprint", "plan"]`) invalidates both — pass `exact: true`, or invalidate by
   the prefix only when that is the intent. Anything with refresh semantics keeps
   `staleTime: 0`; only static reads (models, graphs) get a long one.
3. **Writes update the cache in the same change.** Use `useMutation` (the My Sprint
   `act()` is the model: per-key pending set, `onMutate` / `onError` / `onSettled`).
   A write with bespoke error handling may stay imperative, but it must
   `setQueryData` or `invalidateQueries` every key it can stale. Optimistic updates
   are allowed only where a pure function already decides the result (`reorderQueue`
   in `lib/sprintPlan.ts`), and must roll back on error — never re-implement a rule
   the server owns.
4. **State that changes without the user must reach the screen on its own.** Anything
   the scheduler, a run or another tab can change (plan rows, run state, drafts,
   dashboard numbers) is pushed: a route returns `liveStream(req, fingerprint)`
   (`lib/liveStream.ts`) and the page subscribes with `useLive` / `useLiveInvalidate`
   (`app/useLive.ts`, one shared `EventSource` per URL). Existing channels:
   `/api/live/runs` (any run starts, ends or changes state) and
   `/api/my-sprint/plan/stream?plan=`. A fingerprint is **DB-only and flat in cost** —
   never a provider call. Polling stays as the fallback; provider-owned data (the
   board) cannot be pushed, so it revalidates in the background on focus.
5. **An organization switch is handled once**, by `QueryProvider`, which invalidates
   every query on `CONNECTION_CHANGED_EVENT`. A page does not add its own listener for
   query data.
6. **Not converted, by design — extend, do not rewrite:** `SettingsProvider` and
   `NotificationsProvider` (single owners with visibility / `pageshow` / read-state
   convergence; `SettingsProvider` reads through the query client for dedupe),
   `settings/PushNotifications` (browser-device state), and the sequential loaders in
   `TicketExecutor.tsx` (`loadWorkspace`, `reloadTickets`, run SSE/polling). A new read
   there goes through `queryClient.fetchQuery` (the `readJson` helper); a new live
   behaviour is an additive `useLive` effect, never a rewrite of a flow.

## Mobile first — mandatory

**The phone is the primary target; the desktop is the same screen with more room.**
This app is driven from a phone as often as from the machine it runs on, so a feature
that only works at 1440px is unfinished. Decide the 390px layout before the wide one,
and check every UI change at **390 × 844** as well as at desktop width.

1. **One breakpoint, `max-width: 900px`**, whose JS twin is `MOBILE_QUERY`
   (`app/(app)/MobileNav.tsx`) — change both or neither.
2. **Responsive rules live in CSS**, in the one media block at the foot of
   `app/globals.css`; components only contribute a `te-*` class. `useIsMobile()` is for
   the drawer only, never for choosing a layout.
3. **Tap targets are at least 40px, and nothing important hides behind `:hover`.**
4. **`var(--te-app-h)`, never `100vh`**; anything touching an edge respects
   `env(safe-area-inset-*)` (enabled by `viewportFit: "cover"`).
5. **State that matters lives server-side** and is re-read on focus — `localStorage`
   diverges silently between the phone and the laptop.

## UI changes — mandatory

Read `UI-STYLEGUIDE.md` and `lib/ui.ts` in full before editing anything under `app/` —
not from memory of a prior session. Reuse a helper before writing an inline style,
extend a helper rather than forking it, take every colour from `COLORS` and every size
from `FONT`, and add a new token to `app/globals.css` rather than a hex to a component.
Anything genuinely new updates `lib/ui.ts` **and** the `UI-STYLEGUIDE.md` table in the
same change, then `npx tsc --noEmit` and look at the screen.

## Conventions that bite

- **Root repo is per ticket, not configuration.** A run's cwd is exactly the ticket's
  Root repo value, remembered in `RootRepoProjectMap` and re-validated server-side
  before any spawn.
- **New preflight checks go in `lib/preflight.ts`**, never in a route:
  `runPreflight()` answers the System Check page, `validateRootRepo()` +
  `validateAgentAccess()` refuse a run before the spawn.
- **A finished run no longer moves the work item** — that lives in
  `lib/execution/release.ts`, server-side, on the release day. Nothing in `app/` may
  write a status on a run completing.
- **Host and container must not run at once.** `recoverInterruptedRuns()` adopts any
  `running` row this process does not hold, so a second copy re-spawns `claude` on the
  same worktree; the scheduler is safe only because every tick locks first.
- **`instrumentation.ts` starts the scheduler after the recovery sweep**, never before.
  The push watcher has no such ordering constraint — it only reads.
- **There is a second way to spawn `claude`, and it is deliberately not a run.**
  `lib/terminal.ts` (Open Terminal) and `lib/ask.ts` (the Ask Claude tab, how a phone
  drives it) start the CLI in the Root repo with full permissions and the machine's own
  MCP servers — no graph, contract, worktree, branch, PR, `Run` row or admission check;
  the moment one needs a schema or a gate it is a run and belongs in the engine.
  `validateRootRepo()` still validates the path, `lib/ask.ts` allows one live session
  per Root repo (it runs in the checkout itself), and an Ask transcript is in-process
  only.
- **No spend ceiling by design.** Watch cost on the Dashboard; Cancel stops a run.
- **The Dashboard measures the loop, not just its cost.** LOOP PASS, REVIEW ESCAPES
  (`reviewEscapes()`: an evaluator-passed implement run later followed by a
  review- or QA-fix run on the same ticket), TEST GATE (check refusals) and FAILURE
  LESSONS (`reflect` steps with `recorded: true`) come from `Step.output`, never the log.
- No lint script and no test runner beyond `node --test`; don't add tooling
  implicitly — ask first.
