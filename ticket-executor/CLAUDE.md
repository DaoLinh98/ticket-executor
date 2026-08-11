@AGENTS.md

## Where code lives

Two areas are split into modules — put new code in the right file rather than
growing one:

- **Pages / shell** — every authenticated page is a route under the
  `app/(app)/` route group, sharing one `app/(app)/layout.tsx` (persistent
  `AppReactor` backdrop + `Sidebar` nav): `page.tsx` (Home), `projects/`,
  `ticket-execution/` (renders `TicketExecutor` in a `Suspense`), `dashboard/`,
  `settings/`, `system-check/`, `guide/`. `/login` stays outside the group.
  Cross-page nav belongs in the `Sidebar`; the app-wide reactor is mounted once in
  the layout — pages must not render their own `<Reactor>`. Every page's header is
  `PageHeading` + `ProviderBadge` (both in `app/(app)/`) — do not hand-roll a
  page header again.
- **Ticket Execution UI** — `app/TicketExecutor.tsx` is the *only* stateful
  screen component: it owns all Ticket-Execution state (incl. the selected
  connection `project` + sprint), data fetching, SSE/polling and derived values;
  it reads settings for behaviour but does not edit them. Everything under
  `app/ticket-executor/` is presentational (props in, JSX out): `AppHeader`,
  `TicketSidebar`, `TicketDetailHeader`,
  `tabs/{Overview,Execution,Plan,ResolveReview,Result,Commits}Tab`, `DiffModal`,
  `DiffView`, `CommitFilesModal`, `Toast`, `LoadingRing`, `RichText`, plus
  `types.ts`, `constants.ts` and `helpers.tsx`. The Settings form is its own page
  (`app/(app)/settings/page.tsx`), not a modal. New Ticket-Execution state or
  fetching belongs in the container; new markup belongs in (or next to) one of
  the children.
- **Execution engine** — `lib/executionStore.ts` is a facade that only re-exports;
  the implementation is in `lib/execution/`, built around a graph runtime:
  `graph/{types,schemas,graphs,prompts,exec,drive,persist}.ts`, plus
  `runner.ts` (lifecycle, worktrees, admission, gate resolution, crash recovery),
  `admission.ts` (the pure "may this run start" rule — no Prisma import, so it is
  testable without a database), `claudeCli.ts` (spawn + NDJSON parsing +
  `--json-schema`), `git.ts` (diffs), `queries.ts` (read models + dashboard),
  `format.ts`, `store.ts`. API routes must keep importing from
  `lib/executionStore` only.

  Six rules bind any change here. **Every agent node declares a JSON Schema and
  edges route only on the validated `structured_output`** — never re-introduce
  parsing prose or scraping the log to infer state. **An `external` node is never
  on a cycle** — anything that leaves the machine (push, PR, tracker writes) is a
  leaf that runs once, or a retry becomes a duplicate PR. **Admission control
  belongs to `startRun()`, not to a route** — which skill runs (and therefore
  whether the run has a human gate) is resolved server-side from `Setting` by
  `resolveSkill()`, and the "may this start at all" check is committed in the
  same transaction as the `Run` insert, under a Postgres advisory lock. A route
  that re-implements any of that becomes a second place to keep in sync, and the
  one that drifts is the one that lets two agents write to the same working tree.

  The rules above are the design document for this layer — they live here, next
  to the code they bind. `Documentation.md` carries the mechanics.
  `Agent-Harness.md` (repo root) is a short business-level overview for
  presenting the system, not a spec: update it only when a **flow, a stopping
  point, or a gap** changes, and keep it around 100 lines. Remaining engine work
  is tracked as GitHub issues (#83–#87), not as a backlog inside a document.

  **A guard that is documented must be wired and observable.** Do not leave a
  ceiling (`budgetUsd`, the hop limit, a visit cap) that cannot be reached in the
  default configuration, and do not let a declared policy degrade silently — a
  node that asks for `context: "resume"` with no session to resume into says so
  in the run log rather than quietly running fresh at a fresh system prompt's
  cost. If you document a limit, wire the value path and give it a visible home.

  **A node that judges another node's work runs with `context: "fresh"`, gets its
  brief from a versioned skill, and anything that changes a graph's shape is
  encoded in its id.** The `evaluate`
  node exists to be able to disagree with `implement`; resuming that session would
  make it confirm what it just wrote. And because
  `Setting.evaluateBeforePublish` adds nodes rather than changing their content,
  it becomes part of `graphId` (`implement-v3-eval`) — a run parked at a gate must
  finish on the shape it started on, whatever the setting says by then. Any future
  shape-changing option goes through `GraphOptions` and gets the same treatment.
  A node that invokes a skill only the setting reaches belongs in
  `OPTIONAL_SKILLS` (`lib/skillPack.ts`) — bundled and version-checked, a warning
  when absent, and a hard **admission** refusal when the setting is on without it.
  Never let a run reach a node whose skill is not on the machine: by then a plan
  has been approved and code committed.

  **Never re-derive state the harness already owns.** Want the reason a run
  failed? It is the `reason` on the edge that returned `FAIL` (and the
  `Transition` row it wrote) — not something to recover by matching the log the
  harness itself printed. Want to know a node is a gate? Read its `kind`, never
  its id. Want what a node produced? Read `channels` / `Step.output`. Every
  regex over a run's own log is the same bug the graph runtime was built to
  delete, wearing a new hat.

  **Run `npm run test` after any change to a graph, an edge, a node contract or
  `resolveSkill()`.** The suite asserts the whole routing table plus the
  `external`-is-a-leaf invariant across all four graphs. Edges are pure
  synchronous functions, so it costs about a second and zero tokens — there is no
  excuse for changing routing without it.

## UI changes — mandatory

Before writing or editing ANY React/CSS in `app/` (styles, new components,
layout tweaks), read `@UI-STYLEGUIDE.md` and follow it strictly. This app has
one shared design system in `lib/ui.ts` (`COLORS`, `ringBorder`, `clipCorner`,
`card`, `tintedCard`, `modalShellStyle`, `logoText`, `dropdownPanelStyle`,
`pill`, `ctaButtonStyle`) — never hand-roll a new inline gradient/clip-path/
color/border/modal-shell that duplicates an existing helper. Reuse or extend
the helpers in `lib/ui.ts` instead.

**Mandatory checklist — run through this before reporting ANY UI task done:**

1. Did I read `lib/ui.ts` and `UI-STYLEGUIDE.md` in full before writing style
   code (not just skim from memory of a prior session)?
2. For every new visual element (button, pill, card, badge, panel, modal,
   gradient text), did I check whether an existing `lib/ui.ts` helper already
   produces this shape, instead of writing a fresh inline style object?
3. Did I reuse `COLORS.*` for every color reference — no new raw hex for
   accent/success/danger/warning/info, no new hex duplicating an existing
   `COLORS` entry?
4. Did I reuse the existing corner-cut sizes (6/7/8px), ring durations
   (~1.6s–5.5s) and gradient stop layouts instead of inventing new ones?
5. If I needed a variant a helper doesn't support (a new color, a new size,
   an extra animation, a new `ctaButtonStyle` variant), did I extend that
   helper's `opts`/union in `lib/ui.ts` — rather than hand-rolling a one-off
   inline style in the component file?
6. If I ended up writing a copy-pasted style object identical (or near-
   identical) to one already in another component file, did I stop and
   consolidate it into a `lib/ui.ts` helper instead of letting the
   duplication stand?
7. When combining a `ringBorder(...)`-derived style with any other
   `animation` (e.g. an entrance stagger), did I use `extraAnimation`/
   `extraAnimationDelay` instead of spreading a second `animation` key —
   spreading silently kills the ring's spin.
8. Did I re-run `npx tsc --noEmit` and, where practical, actually view the
   changed screen (dev server / browser) rather than only trusting the type
   check?
9. If none of the above applied cleanly and I *did* introduce something new,
   did I update `lib/ui.ts` (the helper) and `UI-STYLEGUIDE.md` (the doc row)
   in the same change — never let the two drift out of sync.

If any answer above is "no", stop and fix it before considering the UI task
finished — this checklist exists because letting style drift accumulate is
exactly what makes future UI edits slow and inconsistent.

## Multi-provider support — mandatory

This app targets multiple ticket providers (`azure-devops`, `github`, `jira`,
`gitlab` — see `lib/providers.ts`), not just Azure DevOps. When implementing
ANY change, backend or frontend, that touches ticket/provider logic (API
routes, `lib/tickets.ts`, `lib/ado.ts`/`lib/github.ts`-style clients, review
polling, execution flow, UI copy/labels tied to a provider), do not hard-code
assumptions for a single provider. Branch/dispatch by `ProviderId` the same
way existing code does (e.g. `loadTickets`, `loadReviewsSummary`), and keep
non-implemented providers degrading gracefully (empty/"not connected") rather
than throwing. If a provider genuinely can't support a feature yet, stub it
following the existing pattern instead of skipping the abstraction.
