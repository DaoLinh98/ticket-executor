# CLAUDE.md

Developer contract. `README.md` is the operator guide; `UI-STYLEGUIDE.md` binds every change under `app/`.
`AGENTS.md` maps a task to the sections below — read only those.

@AGENTS.md

## What this app is
A local Next.js UI that spawns the **Claude Code CLI** against a ticket: a D-Agent run works the ticket in a
worktree of a real clone through subagents, commits, pushes and opens a draft PR, watched live on `/workflow`.
**Flow Runner** runs a sprint unattended: an agent triages it, the harness lays it on two schedules (implement
queue + release calendar), a server-side scheduler acts on both with the browser closed. Runs cost money and touch
real repos, so guards fail *before* a spawn, never after.

## One engine — D-Agent
Every run is a D-Agent run (`lib/dagent/`, tables `DagentRun`, `DagentStep`, `DagentTransition`, `DagentArtifact`).
The Ticket Execution ("classic") engine — `Run`/`Step` tables, skill-driven graphs, `/api/executions` — is retired.
Flow Runner's scheduler starts implement / review fix / QA fix as D-Agent flows (`startRun({ flow })`) and
reconciles via `runOutcomes()`; a row's Watch/Result opens `/workflow?ticket=<id>`. The Ticket Execution page keeps
its run buttons, not yet wired to D-Agent (`RUNS_MOVED` in `app/TicketExecutor.tsx`).

## Commands
`npm run dev` (:3000, Turbopack) · `npm run build && npm start` · `npm run test` (`node --test` over
`tests/*.test.ts` via `tests/register.mjs`) · `npx tsc --noEmit` (type check) · `npx prisma migrate dev` ·
`npx prisma generate`. **A `schema.prisma` change is unfinished until migrated and generated** (schema-only column = 500; a hand-written
migration backfills existing rows). Next `16.2.10` / React `19.2.4` (middleware is `proxy.ts`). No lint, no test
runner beyond `node --test`; ask before adding tooling.

## Where code lives
- **Shell** — `app/(app)/*` under one layout (`AppReactor` + `Sidebar`); `/login` outside; pages never render a
  `<Reactor>`. Header = `PageHeading` + `NotificationCenter` + `ProviderBadge`; page controls on a `PageToolbar`
  between header and `<main>`, never inside `<main>` (clips dropdowns).
- **Ticket Execution UI** — `app/TicketExecutor.tsx` is the only stateful container; `app/ticket-executor/` is
  presentational. New state → container, new markup → child. Tabs: Overview, Resolve Review, Commits, Ask.
- **Flow Runner** — `lib/executionStore.ts` re-exports `lib/execution/` (`claudeCli`, `triage`, `planStore`,
  `release`, `scheduler`, `lifecycle`, `qaFollowUp`, `translate`). **Routes import `lib/executionStore` only.**
- **D-Agent** — `app/(app)/workflow` → `app/ticket-executor/workflow/` (`WorkflowView.tsx` stateful), canvas in
  `lib/workflow/`, engine in `lib/dagent/`. **`app/api/dagent/runs/*` import `lib/dagent` (`index.ts`) only.**
- **Pure rule modules** — `identity`, `sprintPlan`, `notifications`, `ticketLifecycle`: no Prisma, no provider,
  tested in ~1s. A rule acted on unattended lives here, not in a route or component.
- **Providers** — `lib/tickets.ts` dispatches on `ProviderId`; clients `lib/ado.ts` / `lib/github.ts`. **Auth** —
  `APP_ACCESS_PASSWORD`, `lib/auth.ts` HMAC cookie, `proxy.ts` gate, `/login` + `/api/auth/*` public; empty = no gate.
- **Boot** — `instrumentation.ts` installs bundled `skills/` + `agents/`, then starts the scheduler, plus the
  read-only push watcher (`lib/push.ts`, `lib/pushWatcher.ts`, `app/api/push/*`,
  `public/sw.js`, `app/manifest.ts` — iOS push needs a Home-Screen install, `display: "standalone"`).

## D-Agent workflow engine (`/workflow`, `lib/dagent/`)
`dagent-implement-v3` (`graph.ts`) driven by `engine.ts`; each agent step is `claude -p --agent <name>
--json-schema …` from `cli.ts`. **No skill runs as a step** — behaviour = `~/.claude/agents/<name>.md` + `prompts.ts` brief.
**Ticket skills:** the first judging role (`readiness` / `qaTriage` / `reviewTriage`) picks from `skillCatalog()`
(`skills.ts`: Root repo `.claude/skills` + `~/.claude/skills`, minus `DENIED_SKILLS`) into `skills`; `applySkills()`
(`engine.ts`) resolves each to its `SKILL.md`, which every later brief names (brief wins on branch/commit/push/PR).
A picked skill's `baseBranch` → `seatBase()` moves each repo with `origin/<branch>` onto it before `plan`
(none has it = FAIL); `basesOf()` then drives `syncBase`, `prePublish` and the publisher's PR target.

| Node | Kind | Runs | Does | Next |
|---|---|---|---|---|
| `setup` | harness | git | identity, base (`origin` default or retry seed), a **worktree** per repo, restore `.te/plan.md` | readiness / FAIL |
| `readiness` | agent | `analyst` | ready?, AC, `delivery` (none/partial/done) on base | plan / END / NEEDS_INPUT / FAIL |
| `plan` | agent | `planner` | `planMd`, `branch`, `acMap`, `repos`; ≤ `MAX_PLAN_ATTEMPTS` (2) | planCheck |
| `planCheck` | check | `planIssues()` | plan file, branch, every AC → files + test, repos in scope | implement / plan / FAIL |
| `implement` | agent | `implementer` | code, build/test, **commit locally, no push**; nothing to change (clean, 0 files, not blocked) → park | syncBase / NEEDS_REVIEW / FAIL |
| `syncBase` | harness | git | fetch + rebase onto origin default (or the skill's base); conflict → abort + warning | diffGuard |
| `diffGuard` | check | `diffViolations()` | agent/secret/unplanned-config files, credential lines; `changed` + `heads` | evaluate |
| `evaluate` | agent | `reviewer` | `base..HEAD` vs AC + plan + warnings → `blockers` | prePublish / fix / reflect |
| `fix` | agent | `fixer` | exactly the blockers, commit; ≤ `MAX_FIX_ATTEMPTS` (5) | syncBase / reflect |
| `reflect` | agent | `reflector` | maybe a lesson in Root repo `KNOWLEDGE.md` | FAIL |
| `prePublish` | check | git | clean, right branch, HEAD verified, base unmoved (re-sync ≤ `MAX_PRE_PUBLISH` 3) | publish / syncBase / FAIL |
| `publish` | agent | `publisher` | push + open/reuse **draft PR** per repo; `maxVisits: 1` | verifyPublish / FAIL |
| `verifyPublish` | check | git + provider | remote head = HEAD, draft, ticket linked | END / NEEDS_REVIEW |

Also in `GRAPHS` (keyed by `Flow`; `Ctx.flow` / `Ctx.prUrl`):
**`dagent-fix-review-v1`** — `setup` on the PR source branch (`loadPullRequestBranch()`) → `reviewTriage`
(`review-triager`) → `implement` → `diffGuard` ⇄ `evaluate` ⇄ `fix` → `prePublish` → `respond` (`responder`: push,
one reply per thread, **never resolve**). No `syncBase` — a published PR branch is never rebased.
**`dagent-fix-qa-v3`** — `setup` → `qaTriage` (`qa-triager`; seeded `followUp` without a `decision` → END: analysis only;
`no-fix-needed` → END with `qaReply`) → `implement` …
`verifyPublish`. `/workflow` has no picker or start form: it shows the run in flight (else latest) for `?ticket=`.

1. **Edges route only on validated `structured_output`** (`schemas.ts`), only to the node's `next` (or a
   `retryEntries` node from `setup`). `MAX_HOPS` (60) fails a looping run.
2. **`publish` is the only `external` node and is never on a cycle.**
3. **Every turn is `context: "fresh"`**: `Agent` tool and `Skill(<name>)` for each `DENIED_SKILLS` (`cli.ts`)
   disallowed, plugins off, per-turn MCP config (`lib/mcp.ts`), related repos via `--add-dir`.
4. **Admission is `startRun()`**: preflight + `checkAgents()` (installed, named right, allows `StructuredOutput`,
   has a body, not older than bundled), then under `ticket-executor:dagent-admission`: no active D-Agent run for
   the ticket, and a free slot (`concurrentRuns`).
5. **Park, don't fail, for humans**: `NEEDS_INPUT` → `recheck-readiness`; `NEEDS_REVIEW` (read-back mismatch, or
   implement changed nothing) → `accept`; `runOutcomes().output.noChange` settles the plan row `no-fix-needed`. Failed or
   cancelled → new run from `plan` / `implement` / `syncBase`, seeded with old base, branches, plan.
6. **Worktrees are per run, removed in `finish()`**; a `running` row not held by this process is failed by `reconcileOrphans()`.
7. **`KNOWLEDGE.md` is audited**: start content on the run, diff saved as artifact `knowledge`.
8. **Agents ship in `agents/<name>.md`**; `lib/agentPack.ts` (`BUNDLED_AGENTS` = `allAgents()`, tested) installs
   them on boot and from System Check / Guide. **A prompt/contract change bumps `version:`** — older copies replaced
   on boot and refused at admission; a same-version hand edit is reported, never overwritten.
9. **A shape change gets a new graph id**; `graphById()` keeps the old so a parked run (`rehydrate()`) finishes on it.

After touching `lib/dagent/` or `lib/workflow/`:
`node --import ./tests/register.mjs --test tests/dagent.test.ts tests/workflowLayout.test.ts`.

## Credentials — one source, no fallbacks
- **Provider auth** = `ProviderCredential` (org URL + PAT per org, encrypted by `lib/crypto.ts`, never sent to a
  page), read only via `resolveCredential()`.
- **Identity** (`identityEmail` / `identityName`) lives on that row, not `Setting`. `isMine()` / `mineOnly()`
  (`lib/identity.ts`) are the only answer; **empty identity = no filter, and `isMine` is false** for every ticket.
- **Claude CLI** uses the machine's `~/.claude` login (only `IS_SANDBOX=1` added at uid 0). The PAT reaches agents
  via `lib/mcp.ts`: one file per run in `tmpdir()/te-mcp`, deleted after the turn, outside the repo.

## Sprint plan and automation
Binds `lib/execution/{triage,planStore,release,scheduler,lifecycle,qaFollowUp}.ts`, `lib/sprintPlan.ts` and
`lib/qaFollowUp.ts`. Skills bundled in `skills/` are Flow Runner's own turns only (`triage-sprint-v4`); retired skills
stay in `RETIRED_SKILLS` so D-Agent turns keep them denied.

1. **Implementing and releasing are two schedules.** `implementOrder` is a queue; `releaseDay` a calendar paced by
   `pointsPerDay` (**points**). A finished run moves no work item — nothing in `app/` writes a status on completion.
2. **Every PR is a draft, published by the harness.** The D-Agent `publisher` opens it as a draft and
   `verifyPublish` checks it; release is the only step that publishes it.
3. **Release is not a node** (no worktree/slot). Three writes = three columns (`prPublished` / `reviewersSet` /
   `statusMoved`), each re-reading state; `releasedAt` only when complete. The one retryable outward action.
4. **The scheduler owns no policy.** `tick()` only calls D-Agent `startRun()` / `releasePlannedTicket()`, locks per tick,
   logs an `AutomationEvent` for **every** decision incl. "do nothing". A `draft` plan is never scheduled.
5. **Allocation is arithmetic** — `buildPlan()` is pure. Agent judgement enters only via `triage-sprint-v4`'s JSON
   (`suggestedPoints`, `workOrder`, `needsClarification`); triage writes nothing and is not a Run.
6. **`deliverablesOnly()`** drops hierarchy types (ADO only) and runs **before** `mineOnly()` in every `/api/my-sprint*`.
7. **A sprint is what the developer carried.** `lib/sprintClaim.ts` → `mine` / `handed-off` / `dropped` from the
   app's record (plan, `DagentRun`, PR), never tracker history. `savePlan()` deletes nothing, never re-dates a settled
   row; `handed-off` = delivered at no capacity, `dropped` counts nowhere; `buildPlan()` / `startNextTicket()` skip
   non-`mine`, `dueForRelease()` doesn't. `refreshClaims()` runs first each tick, cancels a handed-over ticket's run,
   writes only `claim`/`assigneeNow`, refuses on empty read, foreign `org` or changed identity.
8. **QC feedback ends in a decision, never a stall.** `watchLifecycle()` turns a QC comment, QA failed or back to In
   Progress on **any** tracked row (every claim) into a signal on the ticket's one open `QaCase` (`onSignal()`).
   A due case (`dueForAnalysis()`: auto on, 10-min debounce) starts a D-Agent `qa` run seeded with `followUp` that
   ends after `qaTriage`; `reconcileQaCases()` stores `normalizeFindings()` + `recommend()` — the harness's verdict,
   an unproven `not-defect` becomes `needs-info`. The developer approves a fix (`approveFix()` → `qa` run seeded with
   the binding `decision`), posts the reply, or dismisses; only `postCaseReply()` writes to the work item. Comments
   after a case's window open the next case (`followUpAfter()`); the bell re-raises a waiting case every `SLA_MS`.

## The notification bell
`lib/notifications.ts` merges; `lib/notificationSources.ts` holds the server-side sources. **No notification carries
a human's words.** Read state is keyed `kind::ticketId::refId` + fingerprint; only `severity: "action"` reaches the
badge. New sources are **flat in cost** (no per-ticket round-trip). **Lock screen = same set** via
`lib/pushWatcher.ts`, deduped by `PushDelivery`; nothing else pushes. Off the scheduler tick, free without
subscribers/VAPID, seeds the backlog on first tick (`__seeded__`).

## Multi-provider support — mandatory
Branch on `ProviderId` like `loadTickets`; unimplemented providers degrade (empty / "not connected"), never throw.

## Redis cache on every load — mandatory
**Every read backing a load API goes through `cached()` (`lib/redis.ts`).** Provider reads are cached in the provider
module under its prefix (`ado:`, `gh:`), scoped by org/repo, TTL from its `TTL` table; heavy DB reads use
`DB_CACHE_PREFIX` with a short TTL. **Every write invalidates what it stales** (`invalidateWorkItems`, …) in the same
change. JSON-safe only; **never cache a failure** (throw inside `cached()`, catch outside). Redis is optional.
Exempt: live run state/SSE, watermark polls, System Check probe, `getWorkItemState` re-read, local-only reads.

## Data fetching and live state — mandatory
**A screen never needs a refresh to be right.**
1. **Client reads are TanStack Query**, never `useEffect` + `fetch`; shared keys + fetcher + hook in `app/queries.ts`;
   fetchers throw on failure. **Keys are exact** (`exact: true` unless a prefix sweep is meant); refreshable = `staleTime: 0`.
2. **Writes update the cache in the same change** — `useMutation` (model: My Sprint `act()`) or `setQueryData` /
   `invalidateQueries`. Optimistic only where a pure function decides (`reorderQueue`), with rollback.
3. **State changed without the user is pushed**: route returns `liveStream(req, fingerprint)`; page uses `useLive` /
   `useLiveInvalidate` (`app/useLive.ts`). Channels `/api/live/runs`, `/api/my-sprint/plan/stream?plan=`.
   Fingerprints are DB-only, flat in cost. Provider data revalidates on focus.
4. **Org switch is handled once** by `QueryProvider` (`CONNECTION_CHANGED_EVENT`). **Extend, don't rewrite**
   `SettingsProvider`, `NotificationsProvider`, `settings/PushNotifications`, `TicketExecutor.tsx` loaders — new
   reads via `queryClient.fetchQuery` (`readJson`), new live behaviour as `useLive`.

## Mobile first — mandatory
Decide the 390px layout first; check every UI change at **390 × 844** and desktop. One breakpoint `max-width: 900px`
(JS twin `MOBILE_QUERY`, change both); responsive rules only in the media block at the foot of `app/globals.css`
(components add `te-*` classes; `useIsMobile()` is for the drawer only); tap targets ≥ 40px, nothing behind `:hover`;
`var(--te-app-h)`, never `100vh`; respect `env(safe-area-inset-*)`; state that matters is server-side, not `localStorage`.

## UI changes — mandatory
Read `UI-STYLEGUIDE.md` and `lib/ui.ts` in full before editing `app/`. Reuse/extend helpers; colours from `COLORS`,
sizes from `FONT`, new tokens in `app/globals.css`. Anything new updates `lib/ui.ts` **and** `UI-STYLEGUIDE.md`,
then `npx tsc --noEmit` and look at the screen.

## Conventions that bite
- **Root repo is per ticket** (`RootRepoProjectMap`), re-validated server-side before any spawn. **Preflight checks go
  in `lib/preflight.ts`**: `runPreflight()` (System Check), `validateRootRepo()` + `validateAgentAccess()`.
- **Host and container must not run at once** — `reconcileOrphans()` fails any `running` D-Agent row it doesn't hold.
- **`lib/terminal.ts` / `lib/ask.ts` spawn `claude` but are deliberately not runs** — no graph, worktree, `DagentRun`
  row or admission; one Ask session per Root repo; needing a schema or gate makes it an engine run.
- **No spend ceiling by design** (Cancel stops a run).
