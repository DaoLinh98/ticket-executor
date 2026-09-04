# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this app is

A local Next.js web UI that spawns the **Claude Code CLI** against a ticket: pick a
work item, hit Implement, and the engine creates a branch in a real clone, runs
`claude` non-interactively with `--dangerously-skip-permissions`, commits, pushes and
opens the PR — streaming log, steps and token/cost back to the browser. Runs cost
money and touch real repositories; guards exist to fail *before* a spawn, never after.

`README.md` is the operator guide (setup, MCP, System Check, troubleshooting). This
file is the developer contract. `UI-STYLEGUIDE.md` binds any change under `app/`.

## Commands

```bash
npm run dev                 # http://localhost:3000 (Turbopack)
npm run build && npm start  # production build
npm run test                # node --test over tests/*.test.ts (TS via tests/register.mjs)
node --import ./tests/register.mjs --test tests/graph.test.ts   # a single test file
npx tsc --noEmit            # type check — there is no lint script
npx prisma migrate dev      # apply/create migrations
npx prisma generate         # after any schema.prisma change
```

Next is pinned at `16.2.10` / React `19.2.4`: read `node_modules/next/dist/docs/`
before writing framework code (middleware is `proxy.ts`, not `middleware.ts`).

## Where code lives

- **Pages / shell** — every authenticated page is a route under `app/(app)/`,
  sharing one `app/(app)/layout.tsx` (persistent `AppReactor` backdrop + `Sidebar`):
  Home, `projects/`, `ticket-execution/`, `dashboard/`, `settings/`, `system-check/`,
  `guide/`. `/login` stays outside the group. Cross-page nav belongs in the
  `Sidebar`; the reactor is mounted once in the layout — pages must not render their
  own `<Reactor>`. Every page header is `PageHeading` + `ProviderBadge`.
- **Ticket Execution UI** — `app/TicketExecutor.tsx` is the *only* stateful screen
  component: it owns all Ticket-Execution state (selected project + sprint), fetching,
  SSE/polling and derived values; it reads settings but never edits them. Everything
  under `app/ticket-executor/` is presentational (props in, JSX out) — `AppHeader`,
  `TicketSidebar`, `TicketDetailHeader`, `tabs/*Tab`, the modals, plus `types.ts`,
  `constants.ts`, `helpers.tsx`. New state or fetching goes in the container; new
  markup in a child. Settings is a page, not a modal.
- **Execution engine** — `lib/executionStore.ts` is a facade that only re-exports;
  the implementation is `lib/execution/`: `graph/{types,schemas,graphs,prompts,exec,drive,persist}.ts`,
  `runner.ts` (lifecycle, worktrees, admission, gate resolution, crash recovery),
  `admission.ts` (the pure "may this run start" rule — no Prisma import, so it is
  testable without a database), `claudeCli.ts` (spawn + NDJSON parsing +
  `--json-schema`), `git.ts`, `queries.ts` (read models + dashboard),
  `knowledge.ts` (the pure rules for what counts as a lesson) + `knowledgeStore.ts`
  (its reads/writes), `format.ts`, `store.ts`.
  **API routes import from `lib/executionStore` only.**
- **Provider access** — `lib/tickets.ts` dispatches on `ProviderId`
  (`azure-devops`, `github`, `jira`, `gitlab` — `lib/providers.ts`);
  `lib/ado.ts` / `lib/github.ts` are the clients, and every credential is
  resolved through `lib/providerCredentials.ts`.
- **Auth** — one shared password (`APP_ACCESS_PASSWORD`), no user accounts.
  `lib/auth.ts` is the HMAC cookie, `proxy.ts` is the gate (Next 16 renamed
  Middleware → Proxy) and `/login` + `/api/auth/*` are the only public paths. An
  empty password disables the gate outright, which is the local-dev default.
- **Boot** — `instrumentation.ts` installs the bundled `skills/` into
  `~/.claude/skills` and runs `recoverInterruptedRuns()` on every server start.

## Engine invariants

Six rules bind any change under `lib/execution/`.

1. **Every agent node declares a JSON Schema and edges route only on the validated
   `structured_output`.** Never parse prose or scrape the log to infer state.
2. **An `external` node is never on a cycle.** Anything leaving the machine (push,
   PR, tracker writes) is a leaf that runs once — a retry is a duplicate PR.
3. **Admission control belongs to `startRun()`, not to a route.** Which skill runs
   (and therefore whether the run has a human gate) is resolved server-side from
   `Setting` by `resolveSkill()`, and the "may this start" check is committed in the
   same transaction as the `Run` insert under a Postgres advisory lock. A route that
   re-implements any of it becomes a second place to drift — and drift is what lets
   two agents write to one working tree.
4. **A documented guard must be wired and observable.** No ceiling (hop limit, visit
   cap) that is unreachable in the default configuration, and no policy that degrades
   silently — a node asking for `context: "resume"` with no session to resume into
   says so in the run log instead of quietly running fresh. The spend ceiling that
   used to live here was deleted rather than left unenforced; don't reintroduce one
   without wiring it.
5. **A node that judges another node's work runs with `context: "fresh"`, gets its
   brief from a versioned skill, and anything that changes a graph's shape is encoded
   in its id.** `evaluate` exists to be able to disagree with `implement`; resuming
   that session would make it confirm what it just wrote. Because
   `Setting.evaluateBeforePublish` adds nodes rather than changing their content, it
   becomes part of `graphId` (`implement-v3-eval`) — a run parked at a gate finishes
   on the shape it started on, whatever the setting says by then. Future
   shape-changing options go through `GraphOptions` the same way. A node invoking a
   setting-only skill belongs in `OPTIONAL_SKILLS` (`lib/skillPack.ts`): bundled,
   version-checked, warned about when absent, and a hard **admission** refusal when
   the setting is on without it. Never let a run reach a node whose skill is missing —
   by then a plan is approved and code is committed.
6. **Never re-derive state the harness already owns.** The reason a run failed is the
   `reason` on the edge that returned `FAIL` (and its `Transition` row). Whether a node
   is a gate is its `kind`, never its id. What a node produced is `channels` /
   `Step.output`. Every regex over a run's own log is the bug the graph runtime was
   built to delete, wearing a new hat.

**Run `npm run test` after any change to a graph, an edge, a node contract or
`resolveSkill()`.** The suite asserts the whole routing table plus the
`external`-is-a-leaf invariant across the graphs. Edges are pure synchronous
functions — about a second, zero tokens.

## Credentials — one source, no fallbacks

This app is standalone: it holds its own credentials and talks to the provider
itself. Two independent things authenticate, and conflating them is the mistake
this section exists to prevent.

- **The provider** (reading tickets, writing status, resolving PRs) uses
  `ProviderCredential` — org URL + PAT, one row per `ProviderId`, PAT encrypted at
  rest by `lib/crypto.ts` and never returned to a page. Every consumer goes through
  `resolveCredential()` in `lib/providerCredentials.ts`; a call site that reads the
  table directly is a second place to get the organization wrong.
- **The Claude CLI** uses the machine's own `~/.claude` login. The app never writes
  a credential file and never relocates the config root; the only thing it adds to
  the spawn environment is `IS_SANDBOX=1` when running as uid 0, which the CLI
  requires before it will accept `--dangerously-skip-permissions`. A run therefore
  spends whatever account the machine is logged in as.

The same PAT reaches the agent a second way, through the generated MCP config
(`lib/mcp.ts`, `Setting.manageMcp`): one file per run under `tmpdir()/te-mcp`,
holding the token in clear text and deleted the moment the turn ends (`releaseMcp`,
plus a stale sweep on every write). It lives outside the repo on purpose — inside a
worktree the run's own `git add` could pick it up.

## Multi-provider support — mandatory

Any change touching ticket/provider logic (API routes, `lib/tickets.ts`, the clients,
review polling, execution flow, provider-tied UI copy) must branch on `ProviderId` the
way existing code does (`loadTickets`, `loadReviewsSummary`) and keep unimplemented
providers degrading gracefully (empty / "not connected") rather than throwing. Stub a
provider following the existing pattern instead of skipping the abstraction.

## UI changes — mandatory

Read `UI-STYLEGUIDE.md` and `lib/ui.ts` in full before writing or editing any
React/CSS under `app/` — not from memory of a prior session. One design system
(`COLORS`, `FONT`, `ringBorder`, `clipCorner`, `card`, `tintedCard`, `modalShellStyle`,
`logoText`, `dropdownPanelStyle`, `pill`, `ctaButtonStyle`). Before calling a UI task
done:

1. Does an existing helper already produce this shape? Use it rather than a fresh
   inline style object.
2. Every colour from `COLORS`, every size from `FONT`, corner cuts from
   `clipCorner(6|7|8)`, ring durations inside the existing ~1.6s–5.5s range.
3. `COLORS.*` are `var(--te-…)` **CSS values, not hex**: no string concatenation (use
   `color-mix(...)`), no `new THREE.Color(...)` (use `resolveColor`), and SVG
   `fill`/`stroke` must go through `style={{ … }}`. A new token is added to
   `app/globals.css`, never as a raw hex in a component.
4. Need a variant a helper lacks? Extend that helper's `opts`/union in `lib/ui.ts` —
   never hand-roll a one-off in a component. If you wrote a style object near-identical
   to one in another component, consolidate it into `lib/ui.ts` instead.
5. Combining `ringBorder(...)` with another animation uses `extraAnimation` /
   `extraAnimationDelay` — spreading a second `animation` key silently kills the spin.
6. Re-run `npx tsc --noEmit` and view the changed screen where practical.
7. Anything genuinely new updates `lib/ui.ts` and the `UI-STYLEGUIDE.md` row in the
   same change.

## Conventions that bite

- **Root repo is per ticket, not configuration.** A run's cwd is exactly the ticket's
  Root repo value (the project name is not appended); it is remembered per project in
  `RootRepoProjectMap` and re-validated server-side by
  `POST /api/tickets/[id]/implement` before any spawn.
- **New preflight checks go in `lib/preflight.ts`** (read-only, token-free), never in
  a route. It has two entry points and they are not interchangeable: `runPreflight()`
  answers `GET /api/preflight` (the System Check page), while `validateRootRepo()` +
  `validateAgentAccess()` are what `POST /api/tickets/[id]/implement` calls to refuse
  a run *before* the spawn.
- **Host and container must not run at once.** Both can share one Postgres, but
  `recoverInterruptedRuns()` adopts any `running` row the current process does not hold
  in memory, so a second copy re-spawns `claude` on the same worktree.
- **No spend ceiling by design.** Watch cost on the Dashboard; Cancel stops a run.
- There is no lint script and no test runner beyond `node --test`. Don't add tooling
  implicitly; ask first.
