# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mandatory: keep the two root documents in sync

There are exactly **two** living documents at the repo root, and no third:

- **`Documentation.md`** — functional + technical documentation: business flows,
  run shapes and gating rules, pages, API surface, data model, dashboard metrics
  and their baselines, provider/MCP behaviour, environment variables.
- **`Agent-Harness.md`** — a short, **business-level** overview of the agent
  system for presenting and deciding: what the four flows are
  (implement/resolve × auto/plan), what a ticket goes through, where the system
  stops itself, what it is good at, and what is still missing. Deliberately kept
  around 100 lines and deliberately light on internals — it is the document a
  non-engineer reads. Update it when a **flow, a stopping point, or a gap**
  changes; do not grow it back into a design document.

  The things it used to carry now live where they belong: the architecture laws
  in `ticket-executor/CLAUDE.md`, the mechanics in `Documentation.md`, and the
  open backlog as GitHub issues (#83–#87).

**After every code change, review the change against both documents and update
them in the same change if any of those areas moved.** This is not optional: a
task that changes documented behaviour is not finished until the documents match
the code. If nothing documented changed, say so explicitly rather than skipping
the check silently. Document only what the code actually does — never add
speculative or aspirational content, and never create a second analysis or
refactor-notes file alongside these two.

## Repo layout

The repo holds one application plus the two root documents described above:

- `ticket-executor/` — the Next.js application. All development happens here.
- `Documentation.md` · `Agent-Harness.md` — see the sync rule above.
  (`Client-Brief.md` is the original brief, kept for reference and not maintained.)

All commands below assume `cd ticket-executor` first.

## Critical: this is a bleeding-edge Next.js version

`package.json` pins `next@16.2.10` / `react@19.2.4`, well ahead of most training data. `ticket-executor/AGENTS.md` (auto-loaded) states: APIs/conventions/file structure may differ from what you expect — **read `node_modules/next/dist/docs/` before writing Next.js code**, and heed deprecation notices.

## Commands

```bash
cd ticket-executor
npm run dev      # start dev server (Turbopack, next dev)
npm run build    # production build
npm run start    # run production build
npm run test     # graph routing table + effect-class invariants (node:test, ~1s, no DB, no tokens)

npx prisma generate      # regenerate Prisma client after schema.prisma changes
npx prisma migrate dev   # create/apply a local migration
npx prisma studio        # inspect the local Postgres DB
```

`npm run test` runs `tests/*.test.ts` on node:test — the app's TypeScript is
executed directly (Node 24 strips types; `tests/register.mjs` supplies the
bundler-style import resolution the sources assume, with no added dependency).
It covers the graph routing table, the `external`-is-a-leaf invariant and
`resolveSkill()`; it needs no database and spends no tokens. **Run it after any
change to a graph, an edge, a node contract or admission control.**

There is still no lint script — don't invent one implicitly; ask before adding
tooling.

Local Postgres is expected at the `DATABASE_URL` in `.env` (comment notes port 5438 locally). `.env.local` holds the Azure DevOps and Claude CLI settings — never print or commit its values.

## Architecture

Multi-page Next.js App Router app. Every authenticated page lives under the **`app/(app)/` route group**, which owns one shared shell; everything else is a thin API layer around one subprocess-driven execution engine.

- **`app/(app)/layout.tsx`** — the shared authenticated shell: renders one persistent `<AppReactor>` backdrop + `<Sidebar>` alongside the active page. Auth is enforced upstream in `proxy.ts` (Next 16's renamed middleware), so no gate lives here.
  - **`app/(app)/Sidebar.tsx`** — the vertical nav (Home / Projects / Ticket Execution / Dashboard / Settings) with active-route highlight + a Log out button. This is the only cross-page nav; individual pages no longer hand-roll their own nav links.
  - **`app/(app)/AppReactor.tsx`** — mounts the single `app/Reactor.tsx` WebGL backdrop once for the whole shell (it owns the `window.__reactor` singleton); `frozen` mirrors the `animatedBackground` setting, re-read on route change. Pages must **not** render their own `<Reactor>`.
  - **`app/(app)/page.tsx`** — Home (static hero/slogan).
  - **`app/(app)/projects/page.tsx`** — card grid of the configured org's projects (from `GET /api/projects`); clicking a card routes to `/ticket-execution?project=<name>`.
  - **`app/(app)/ticket-execution/page.tsx`** — renders `<TicketExecutor>` inside a `<Suspense>` boundary (it reads the `?project=` query via `useSearchParams`).
  - **`app/(app)/dashboard/page.tsx`** — the run-metrics dashboard, organized in **three tiers** answering three different questions, in descending visual weight: **01 VALUE** (what the app adds over driving the Claude CLI by hand — compression factor, hours saved by overlap, waste averted by preflight, sessions recovered, plus an optional estimate-priced ROI panel), **02 QUALITY** (measured *per ticket*, not per run: first-pass rate, rework factor, plan-approval rate, review-fix ratio, change size, delivery funnel, per-skill consistency), **03 OPERATIONS** (cost trend overlaid with runs completed, reliability, spend/tokens, provider/project/skill breakdowns). Filters: time range + provider + project. Every comparison tile states its baseline inline — `leverage` compares against one sequential CLI session, `roi` against not using an agent at all; the two must never be conflated.
  - **`app/(app)/settings/page.tsx`** — the connection + execution-defaults form (self-contained: owns its settings state and the load / save / test-connection calls). This replaced the old `SettingsModal`.
  - **`app/(app)/system-check/page.tsx`** — renders `GET /api/preflight`: environment, skills (with an Install action), connection, agent access and Root repo, each as pass/warn/blocker with a fix.
  - **`app/(app)/guide/page.tsx`** — the setup walkthrough (install skills, connect a provider, pick a Root repo).
  - **`app/(app)/PageHeading.tsx`** / **`ProviderBadge.tsx`** — the shared page title block and the connected-provider badge. Every page uses both; do not hand-roll a header again.
- **`app/TicketExecutor.tsx`** — the Ticket Execution container. It owns *all* client state for that screen (tickets, the selected connection **project** + sprint, per-ticket overrides, executions, settings, reviews, toasts), the SSE/polling plumbing, the batch-run scheduler, and every derived value (CTA `action`, workflow `steps`, styled `logLines`, `resultSections`), then composes the presentational pieces below. It reads settings for behaviour but no longer edits them (that moved to the Settings page). `app/Bolts.tsx` is the click-effect layer.
- **`app/ticket-executor/`** — the UI split out of that container. Each file is presentational: it takes props and renders, holding no fetch/business logic.
  - `types.ts` — UI-only types (`ExecView`, `RunSummary`, `SettingsView`, `ConnTest`, `Action`, `StepView`, `ResultSection`, `TabId`, …).
  - `constants.ts` — `ACCENT`, `DEFAULT_SKILL`, `SKILL_OPTIONS`, Result-tab section order/titles. (No Root-repo suggestions: that combobox is seeded only from paths actually used before.)
  - `helpers.tsx` — pure view helpers: `renderCommentBody()`, `reviewFingerprint()`, `timeAgo()`, cost/token formatters. (The old `deriveStep()` log-scraping heuristic is gone — progress comes from the graph's node list.)
  - `AppHeader.tsx` — brand, **project picker + sprint picker**, active-run counter, review bell dropdown. (Nav / Settings / Logout live in the Sidebar, not here.)
  - `TicketSidebar.tsx` — search, filters, multi-select/batch controls, ticket rows.
  - `TicketDetailHeader.tsx` — ticket identity, provider status dropdown, tab bar, primary/secondary CTA.
  - `tabs/OverviewTab.tsx` · `tabs/ExecutionTab.tsx` · `tabs/PlanTab.tsx` · `tabs/ResolveReviewTab.tsx` · `tabs/ResultTab.tsx` · `tabs/CommitsTab.tsx` — the detail panes. `PlanTab` is the shared plan-review gate — used by both `implement-ticket-v3` and `fix-code-review-v3` (it is skill-agnostic, driven by `planMarkdown` + run state `waiting`): markdown preview/editor + Accept / Request changes / Cancel. It is offered only when the run's graph actually contains a gate node, which the UI reads off the reported node list rather than from a hard-coded list of skills.
  - `DiffModal.tsx`, `DiffView.tsx`, `CommitFilesModal.tsx`, `Toast.tsx`, `LoadingRing.tsx`, `RichText.tsx` — overlays, the diff renderer, the shared spinner, and the provider rich-text renderer (styled by selector in `.te-rich`, never inline).
  - Shared inputs (`app/Combobox.tsx`, `app/SelectMenu.tsx`, `app/SprintPicker.tsx`) stay at the `app/` root since they aren't specific to this screen. `SprintPicker` is a generic pill dropdown (optional `leading` icon) reused for both the sprint and project pickers.
- **`lib/types.ts`** — shared `Ticket`, `RunState` (`running` | `waiting` | `succeeded` | `failed` | `cancelled`), `UiRunState` (adds `none`, the UI-only "never run"), `EndReason`, `LogLine`, `FileChange`. The run's view model is *not* here: it is derived from the graph a run walks, so it lives beside that code as `RunView` in `lib/execution/queries.ts` and reaches the UI through the API.
- **`lib/providers.ts`** — provider abstraction (`ProviderId`: `azure-devops | github | jira | gitlab`) driving Settings-page labels. The ADO connection is configured at the **organization** level (`urlLabel: "ORGANIZATION URL"`). Only `azure-devops` is fully wired; the rest are scaffolded. Adding a new provider means: add a `PROVIDERS` entry here, then wire real fetching into `lib/tickets.ts`.
- **`lib/ado.ts`** — Azure DevOps REST client. Configured at the org level; the **project is a per-call parameter** (not baked into the connection). `listProjects()` enumerates the org's projects; `listIterations(project)` / `getSprintTickets(project, sprint?)` / `getWorkItemTypeStates(project, type)` / `getWorkItemComments(project, id)` are project-scoped; PR/commit/status-write calls resolve org-wide (repo GUID) and stay project-agnostic. Batches work-item GETs (chunked at 200 ids) and converts ADO's rich-text HTML fields to plain text/lines.
- **`lib/tickets.ts`** — `loadTickets(provider, project?, sprintOverride?, personalFilter?)` and `loadProjects(provider)` dispatch. Non-ADO providers return an empty, "not connected" result rather than throwing.
- **`lib/executionStore.ts`** — public facade for the execution engine
  (`startRun`, `cancelRun`, `resolvePlan`, `recoverInterruptedRuns`, `getRun`,
  `getPersistedRun`, `listRuns`, `outlineForSkill`, `dashboardMetrics`); API
  routes import from here only. The implementation lives in **`lib/execution/`**,
  built around a **graph runtime**:
  - `graph/types.ts` — `Node` / `Edge` / `Graph` / `NodeResult` / `RunContext` /
    `LiveRun`, plus the `EffectClass` union (`pure` | `local` | `external`) and
    `ContextPolicy` (`resume` | `fresh`).
  - `graph/schemas.ts` — the JSON Schema every agent node must answer with.
    House rule: **no field without a consumer** — each property is read by a
    named edge or rendered by a named piece of UI.
  - `graph/graphs.ts` — the graph definitions. `graphForSkill()` replaces the old
    `isTwoPhaseSkill` boolean; edges are **pure and synchronous**, which is what
    makes a graph testable without spawning a CLI.
  - `graph/prompts.ts` — the prompt each node sends: the `Mode: plan|replan|implement|publish` resume prompts, plus `evaluatePrompt()`/`fixPrompt()` and `REVIEW_SKILL` for the optional reviewer.
  - `graph/exec.ts` — one node execution: per-turn MCP resolution, spawn, and the
    contract check.
  - `graph/drive.ts` — the driver loop, gate parking/resolution, budget + hop
    guards, `finish()`, worktree cleanup, diff capture.
  - `graph/persist.ts` — every DB write the walk makes. These are **allowed to
    throw**: with a graph, Postgres is the source of truth *between* nodes, so a
    lost write must stop the run loudly rather than let it continue on a history
    that no longer matches reality.
  - `claudeCli.ts` — CLI args (`commonArgs()`, env guardrails, `--json-schema`)
    and `runTurn()`, the NDJSON `stream-json` parser.
  - `git.ts` — `collectFileChanges()`: diffs the worktree HEAD against `baseSha`.
  - `queries.ts` — read models (`RunView`, node progress, ticket history) **and
    `dashboardMetrics()`**.
  - `admission.ts` — `admissionDenial()`, the pure rule deciding whether a run may
    start (one per ticket · single-ticket mode · the concurrency cap). Kept free
    of Prisma so the policy is testable without a database.
  - `runner.ts` — worktree isolation, `startRun` (which owns admission, run shape
    and isolation, all resolved server-side from `Setting`), `rehydrate`, gate
    resolution, `recoverInterruptedRuns`.
  - `store.ts` — the `globalThis`-backed in-process `Map` of live runs.

  Behaviourally: **a run walks a graph.** The skill selects which one; the graph
  decides the shape. Each `agent` node declares a JSON Schema, which is passed to
  the CLI as `--json-schema`; that forces a `StructuredOutput` tool call and the
  validated object arrives on the final `result` event as `structured_output`.
  **Edges route on that object and nothing else** — a turn that ends without
  honouring its contract is a failed node, never a fallback to parsing prose.
  This is why `stepForTool()` and `detectArtifacts()` are gone: progress, the
  branch name and the PR URL are contract fields now, not guesses made from the
  log.

  **Effect classes and the invariant everything rests on.** Every node declares
  `pure` (reads only), `local` (writes inside the worktree — source edits and
  *local commits*, undone by discarding the branch) or `external` (leaves this
  machine: push, PR, tracker writes — not undoable). **An `external` node is
  never on a cycle**: it is a leaf, entered once, after every loop has converged.
  That is why the v3 flow splits `implement` (local, stops at a commit) from
  `publish` (external) — a retry edge into a node that had already pushed would
  mean a second push or a duplicate PR — and it is what leaves a slot between
  them for a review step to be added later.

  **Three graph shapes:**
    - *One-shot* (`implement-v2`, `fix-review-v2`): a single `deliver` node,
      `effects: external`. It is the only node, therefore a leaf — the invariant
      holds. It **cannot** block on `verification` (implement and publish are the
      same turn), so a reported failure fails the *run* instead, with a reason
      prefixed `PR was opened but …` so it is not counted as "stopped in time".
    - *Gated* (`implement-v3`, `fix-review-v3` — both share the identical
      `.te/plan.md` / `.te/feedback.md` / `Mode:` contract, so one definition
      serves both):
      `plan → planCheck → [review gate] → implement → publish → END`, with
      `replan` closing a cycle back from the gate. `planCheck` is a zero-token
      `check` node. The run **parks** at the gate in state `waiting` holding no
      child process, and the plan is stored as an `Artifact`.
      `POST /api/executions/[id]/plan` feeds the human's decision in as the gate
      node's own `NodeResult`, so the graph's edge routes it exactly like any
      other node's output — there is no special-case branch in the engine.
    - *Gated + reviewer* (`implement-v3-eval`, `fix-review-v3-eval`) — the same
      graph with `evaluate` (pure, **fresh**) and `fix` (local) inserted between
      `implement` and `publish`, bounded at two fix rounds. Switched on by
      `Setting.evaluateBeforePublish`, **off by default**. Because the option
      changes the graph's *shape* it is encoded in `graphId`, so a run parked at a
      gate finishes on the shape it started on. `evaluate` invokes the
      `review-changes-v1` skill; `publish` is still the only `external` node and
      still a leaf, so the cycle sits between a `pure` node and a `local` one.

  **Context policy is per node.** `resume` continues the run's session (cheap,
  but it inherits the previous node's conclusions); `fresh` opens its own (a new
  system prompt, but it has not seen the reasoning it is about to act on). Rule:
  a node that *produces* an artifact resumes; a node that *judges* one must be
  fresh, or it is marking its own homework.

  **Guards**, all three reachable from a default install: a per-node
  `--max-budget-usd` (falling back to `CLAUDE_MAX_BUDGET_USD`); a run-level
  ceiling checked **between** nodes — `Setting.runBudgetUsd` snapshotted onto
  `Run.budgetUsd` at start, so raising the limit later cannot un-fail a run that
  already stopped on the old one; and a 40-transition hop limit. `Run.hops` and
  `Run.visits` live on the row rather than in the driver's locals, because
  `drive()` is re-entered on every gate resolution and every crash recovery — a
  counter that restarted there would never catch the loop it exists to catch.

  **Crash recovery.** `instrumentation.ts` calls `recoverInterruptedRuns()` once
  per server start. What a run left `running` is eligible for is decided purely
  by the effect class of the step that was open (which is why that class is
  copied onto the `Step` row): `pure` → re-run, `local` → `--resume` with
  `attempt + 1`, `external` → **never auto-retried**; the run goes to `waiting`
  with `endReason = needs-review`, because nobody can tell from here whether the
  push landed, and guessing is how duplicate PRs happen.

  **Admission** is decided in `startRun()`, not in the route, and the check and
  the `Run` insert share one transaction opened with
  `pg_advisory_xact_lock` — otherwise two simultaneous POSTs both read "nothing
  active" and both start. Three rules: one active run **per ticket** (both modes:
  two runs race for the same branch name regardless of worktrees); in
  single-ticket mode, one active run **overall**; and `Setting.concurrentRuns` as
  a ceiling. The first two count `running` *and* `waiting` (a parked run owns a
  worktree and a branch); the cap counts only `running`, because it bounds machine
  load and a parked run holds no process. The rule itself is a pure function in
  `lib/execution/admission.ts`.

  Isolation is still gated by `Setting.multiTicketMode`: on ⇒ a fresh
  `git worktree add --detach` under `rootRepo/.te-worktrees/<project>-<id>`;
  off ⇒ the run executes directly in `rootRepo`, which is only safe because of the
  rule above. Optional guardrails via env:
  `CLAUDE_MCP_CONFIG`, `CLAUDE_MAX_BUDGET_USD`, `CLAUDE_EXTRA_ARGS`,
  `CLAUDE_KEEP_PLUGINS`. Every run is still spawned with the machine's plugins
  switched off (26.8k → 11.3k → 6.0k system-prompt tokens per turn), and
  `prepareMcp()`/`releaseMcp()` still resolve MCP per turn.

- **`lib/ui.ts`** — the design system: `COLORS`, `FONT`, and every shape helper (`ringBorder`, `clipCorner`, `card`, `tintedCard`, `pill`, `ctaButtonStyle`, `fieldLabel`/`fieldInput`, `sectionCaption`, `dropdownPanelStyle`, `modalShellStyle`, `logoText`) plus the domain badges (`typeBadge`, `statusPill`, `runDot`, `avatar`) and `branchOf()`. There is deliberately **no** `STEPS` array: a run's progress list comes from the graph it walks. See `UI-STYLEGUIDE.md` — extend a helper rather than hand-rolling a near-duplicate inline style.
- **`lib/skillPack.ts`** — the skills this repo ships under `skills/`, and installing them into `~/.claude/skills`. `REQUIRED_SKILLS` (the four run skills) block preflight when missing; `OPTIONAL_SKILLS` (`review-changes-v1`) only warn, because a setting has to switch their node on — and `startRun()` refuses the run outright if it is on without them.
- **`lib/prisma.ts`** — standard singleton-on-`globalThis` Prisma client pattern for dev hot-reload.
- **`prisma/schema.prisma`** — Postgres, nine models: `Setting` (single row,
  mirrors the Settings page; four of its fields decide *behaviour* and are read
  server-side when a run starts — `autoImplement`/`autoResolveCodeReview`,
  `multiTicketMode`, `runBudgetUsd`, `evaluateBeforePublish`),
  `ProviderCredential` (per-provider `org` + encrypted `pat`), and the run model
  proper:
  - **`Run`** — one execution of one graph against one ticket. It owns no agent
    output of its own. `state` (`running` | `waiting` | `succeeded` | `failed` |
    `cancelled`) plus `currentNodeId` is the *whole* answer to "where is this
    run": the old `status` × `phase` × `planStatus` triple and `currentStep` are
    gone. `channels` holds each node's validated output — what edges read.
    `endReason` distinguishes human decisions (`cancelled`, `plan-rejected`) from
    agent failures, and **anything computing a success rate must exclude them**.
    `skill`/`prUrl`/`branch`/`resultText` are promoted out of node output because
    each has a consumer that must not have to open a `Step` — `resultText` only
    from a node whose output carries `committed`, so a run that failed at
    `implement` does not display the *plan's* summary as its result. `baseSha` +
    `filesTouched`/`linesAdded`/`linesDeleted` let aggregates skip the diff blob.
    `budgetUsd`/`hops`/`visits` carry the guards (see above); `estimateHours` is
    the team's sizing snapshotted at start so a re-estimate cannot rewrite it.
  - **`Step`** — one *attempt* at one node; a cycle or a crash-resume adds
    `attempt + 1` rather than overwriting. Carries `effects` (so recovery decides
    without resolving the graph), the validated `output`, that step's log slice,
    its own usage, and a `claimedAt` lease.
  - **`Artifact`** — `plan` | `feedback` | `diff`. A reviewer's edit creates a
    new **version** rather than overwriting the agent's, so what was proposed and
    what was approved stay comparable.

    `.te/plan.md` and `.te/feedback.md` **are** how the plan's body travels
    between nodes, and that is deliberate, not a leftover: `plan` writes the
    file, `planCheck` reads it, `resolvePlan()` writes the reviewer's edit back
    over it, and `implement` re-reads it with "the file wins" in its prompt.
    Passing a full plan through the prompt on every turn instead would cost more
    than it buys, and the run's cwd is the boundary that keeps that channel
    private. What changed is that the file is no longer the *durable record* —
    the `Artifact` rows are — so the harness never has to guess at the
    filesystem to know what was proposed or approved.
  - **`Transition`** — why the harness moved (`fromNode`, `toNode`, `reason`).
    The primary artifact for debugging a run. `toNode` is a node id, `END`, `FAIL`
    or `CANCELLED`; the last is written when a person stops a run, and is
    deliberately **not** a routing target — no edge may return it, because a
    cancellation is imposed on the graph rather than decided by it. One `reason` is
    load-bearing: the implement edge emits `verification.tests=failed` /
    `…build=failed`, and the dashboard's `blockedOnVerification` counts exactly
    that prefix — asserted in `tests/graph.test.ts`.
  - **`BlockedAttempt`** — a start refused before the CLI ran (`root-repo` ·
    `agent-access` · `duplicate-ticket` · `single-ticket-mode` · `concurrency-cap`
    · `unknown-skill` · `missing-skill`). **`SavedOption`**,
    **`RootRepoProjectMap`** — unchanged.

- **`app/api/*`** routes are thin wrappers: `GET /api/projects` (provider-aware org project list), `GET /api/tickets` (provider-aware; takes `project` + `sprint`), `GET /api/sprints` (takes `project`), `POST /api/tickets/[id]/implement` (starts an execution for any skill — implement *or* resolve-review — validates the Root repo *and* MCP access before spawning anything, then hands admission to `startRun()`, which resolves the actual skill from `Setting` and enforces one-run-per-ticket, single-ticket mode and the concurrency cap under an advisory lock; may return `warnings[]` alongside `runId` for what it could not verify up front, which the UI shows as a toast; also snapshots the ticket's `estimateHours`/`storyPoints` from the body and records a `BlockedAttempt` row whenever it rejects), `GET /api/dashboard` (the three-tier metric aggregate; takes `provider` + `project` + `days`), `GET /api/dashboard/funnel` (**split out on purpose** — resolving PR outcomes costs one or two provider round-trips *per PR*, so the main metrics stay instant and the funnel fills in behind them; capped at the 60 most recent PRs), `GET /api/executions/[id]` / `POST /api/executions/[id]/cancel` / `POST /api/executions/[id]/plan` (approve/revise/cancel a parked plan), `GET|POST /api/settings` (the stored PAT is never sent back to the client — only a `hasPat` boolean), `POST /api/settings/test` (org-level connection check).

Note: the ADO connection project is a UI-selected value (Projects page / Ticket Execution dropdown), independent of the git repo a run executes in. `rootRepo` is chosen **per ticket** on the Overview tab (prefilled from `RootRepoProjectMap`) — there is deliberately no env var or app-wide default for it, since one org connection spans many repos. It is used verbatim as the run's cwd (the project name is never appended) and `POST /api/tickets/[id]/implement` validates it via `validateRootRepo()` (`lib/preflight.ts`) before spawning the CLI, returning 400 so a bad path costs no tokens.

- **`lib/preflight.ts`** — the setup/preflight checks (DB + migrations, `claude`/`git` on PATH, the bundled skills — `REQUIRED_SKILLS` block when missing, `OPTIONAL_SKILLS` only warn since a setting has to switch their node on, and `startRun()` refuses the run if it is on without them — stored provider credential + optional live token test, the `agent-access` group described below, Root repo exists/is-a-git-repo/clean/pushable). Read-only and token-free; consumed by `GET /api/preflight` (the `/system-check` page) and, via `validateRootRepo()` + `validateAgentAccess()`, by the implement route. `validateAgentAccess()` blocks on the cheap MCP failures (no provider server, missing credential, org mismatch) and otherwise reads the cached deep verdict: cached failure → block, cache miss → allow with a warning, cached pass → silent.
- **`lib/mcp.ts`** — MCP access for a run, i.e. *Claude's* path to the provider, which is independent of the app's REST credential: the skills read the work item and drive the PR through provider MCP tools, so a run without one burns tokens and fails. Server-only, and the home of the per-provider MCP metadata (server name, recognition hints, generated-config builder, `gh`/`glab` fallback) — kept here rather than in `lib/providers.ts` because that module is imported by client components. `resolveMcp()` decides one run's mode from `Setting.manageMcp`: **managed** (build the server from the stored org + PAT, write it to a temp file, pass `--mcp-config` **with** `--strict-mcp-config` so the run loads *only* the provider server — every other server on the machine would otherwise inject its full tool schema into the system prompt on every turn, which costs more tokens than the ticket; the run skills need nothing but the provider server plus git/gh/glab on the PATH), **user** (a server the user configured themselves was found — the app stays out of *configuring* it, but still pins it: a stdio server's verbatim declaration, `env` included, is copied into the run's own config file so the run can be strict too. A remote/OAuth server is left unpinned — its credentials live in the CLI's state, not the config — and that run alone keeps inheriting the machine's servers), **env-override** (`CLAUDE_MCP_CONFIG` wins, keeping its strict semantics), **unmanaged**/**unsupported** (nothing usable → the decision carries a `blocker` message + `fix`). The managed ADO server is started from a **global install when one is present** (`globalPackageEntry()`/`managedGlobalInstall()`: resolves `@azure-devops/mcp`'s own entry point out of the global `node_modules` and runs it as `node <entry>`, guarded on the pinned major), falling back to `npx -y @azure-devops/mcp@2`. A run spawns a fresh CLI process per turn, and `npx` re-resolves the package every time — measured ~6.9s cold / ~3.4s warm versus ~1.0s for the installed copy. The entry point is used rather than npm's shim because a `.cmd`/`.ps1` shim would pull a shell into the spawn. Also `scanConfiguredServers()` (static read of `~/.claude/settings.json`, `~/.claude.json` incl. its per-project section, `<cwd>/.mcp.json`, `<cwd>/.claude/settings*.json`, `CLAUDE_MCP_CONFIG` — the **public** shape, whose `env` is stripped because it reaches the browser; the server-only `scanRawServers()` keeps `env` for the pinning above), `adoServerOrg()` (the org is a positional CLI argument, so a server can silently serve a different org than Settings), `mcpListHealth()` (parses `claude mcp list` — tens of seconds, deep tier only) and the 5-minute deep-probe cache. Everything that can take seconds goes through `spawn`, never `spawnSync`: a synchronous wait here froze the whole Node process and starved the connection check's own fetch.

## Notes for making changes

- Running an execution for real invokes the actual `claude` CLI in the ticket's `rootRepo` — be deliberate when testing this locally, it will make real commits/PRs if pointed at a real repo.
- `CLAUDE_BIN`/`CLAUDE_MCP_CONFIG`/`CLAUDE_MAX_BUDGET_USD`/`CLAUDE_EXTRA_ARGS`/`CLAUDE_KEEP_PLUGINS` and `CLAUDE_SKILLS_DIR` are read directly from `process.env` (see `.env.example`); provider connection settings live in the DB-backed `Setting`/`ProviderCredential` rows the Settings page edits.
