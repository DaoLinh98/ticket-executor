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

**A run walks a graph.** The skill selects which graph
(`graphForSkill()` in `lib/execution/graph/graphs.ts`); the graph — not a flag —
decides the shape of the run:

- *One-shot* (`*-v2`) → `implement-v2` / `fix-review-v2`: a single `deliver` node
  that goes branch → implement → verify → commit → push → PR. No gate.

  This flow **cannot block on verification** — implement and publish happen inside
  one turn, so the PR already exists by the time the harness reads the contract.
  What it does instead is refuse to call such a run a success: a reported
  `verification.tests`/`build` of `failed` (or `committed: false`) sends the run to
  `FAIL`, so the dashboard scores it as a failure and the UI leaves the ticket
  where it was. The transition reason is prefixed `PR was opened but …`, which
  deliberately does *not* match the `verification.` prefix `blockedOnVerification`
  counts — nothing was stopped in time here.
- *Gated* (`*-v3`) → `implement-v3` / `fix-review-v3`:

  ```
  plan ─► planCheck ─► [review gate] ─► implement ─► publish ─► END
   ▲                        │            (local)     (external)
   └── replan ◄─────────────┘ request changes
  ```

  `plan` runs `Mode: plan` and stops after writing `.te/plan.md`. `planCheck` is
  a zero-token code check that the file exists. The run then **parks** at the
  gate in state `waiting`, holding no child process, and the plan is stored as an
  `Artifact`. From the Plan tab: **Accept** → the (possibly edited) plan is
  written back as a new human-authored Artifact version and the run resumes with
  `Mode: implement` on the same session · **Request changes** → feedback to
  `.te/feedback.md`, resume with `Mode: replan`, re-park · **Cancel** →
  `endReason = plan-rejected`.

Both v3 skills share one `.te/plan.md` / `.te/feedback.md` / `Mode:` contract, so
one graph definition serves both.

**Optional: an independent reviewer before publishing** (`Setting.evaluateBeforePublish`,
**off by default**). When on, the gated graph grows the two nodes that the
`implement`/`publish` split was made to leave room for:

```
implement ─► evaluate ─► publish ─► END
   (local)     │  ▲  (pure, FRESH)   (external)
               ▼  │
              fix ─┘  (local, resume) — bounded at 2 attempts
```

`evaluate` runs in a **fresh** Claude session and is given only the ticket and the
base commit; it may not edit, commit or push. That is the whole point — a reviewer
that resumed the implementer's session would inherit the conclusions it is
supposed to check.

It invokes the **`review-changes-v1`** skill rather than carrying its brief inline,
because it is the only node that runs `fresh` *and* loads no other skill: its
reading discipline is therefore the least constrained in the system and the most
expensive to get wrong. The skill is bundled, installable and version-checked like
the other four, but it is **optional** — `lib/skillPack.ts` splits
`REQUIRED_SKILLS` from `OPTIONAL_SKILLS`, so a missing copy is a *warning* in
System Check rather than a blocker on every install. What makes it hard is the
setting being on, and that is enforced in admission (see the `missing-skill`
refusal above). Its contract is deliberately tiny
(`verdict`, `blockers[]`, `blocked`): `verdict` is read by the edge, and each
blocker is fed verbatim into the `fix` node's prompt. `fix` answers the same
contract as `implement` and is held to the same verification bar, then goes **back
to the reviewer** rather than to publish. After two fix attempts a still-blocking
verdict ends the run at `FAIL` — publishing over a standing objection would make
the review decorative.

The option changes the graph's *shape*, so it is encoded into the graph id
(`implement-v3-eval` / `fix-review-v3-eval`). A run parked at the gate therefore
finishes on the shape it started on even if the switch is flipped while it waits.
It is off by default on purpose: it costs about one extra review turn per run plus
whatever the fixes cost, and whether that pays for itself is a question for the
dashboard (`quality.firstPassRate` / `quality.reworkFactor` against
`cost.costPerShippedTicket`) rather than something a default should presume.
`publish` remains the only `external` node and remains a leaf, so the cycle is
between a `pure` node and a `local` one — the invariant is untouched.

`.te/` is scratch, not project state: `clearRunArtifacts()` deletes it in the
run's working tree **at both ends of a run** (before the first node, and in
`finish()`). Nothing is lost — the plan the agent drafted and the version the
reviewer approved are both `Artifact` rows. Clearing it at the *start* is the
load-bearing half: an isolated run's worktree is thrown away anyway, but a
single-ticket-mode run executes directly in `rootRepo`, where a leftover
`plan.md` was still on disk when the next ticket's `plan` node ran — the agent
then read a different ticket's plan and paid tokens to work out it was stale.

**Every agent node declares a typed output.** Its JSON Schema is passed to the
CLI as `--json-schema`, which forces a `StructuredOutput` tool call and reports
the validated object on the final `result` event as `structured_output`. Edges
route on that object and nothing else: a turn that ends without honouring its
contract is a **failed node**, never a fallback to parsing prose. This is why the
old log-scraping helpers (`stepForTool()`, `detectArtifacts()`) are gone — the
branch name and the PR URL are contract fields now, not regex hits.

**Effect classes, and the one invariant everything rests on.** Each node declares
what it does to the world: `pure` (reads only), `local` (writes inside the
worktree — source edits and *local commits*, undone by discarding the branch), or
`external` (leaves this machine: push, PR, tracker writes — not undoable).

> **An `external` node is never on a cycle.** It is a leaf, entered once, after
> every loop has converged.

That is why `implement` stops at a local commit and `publish` is separate: a
retry edge into a node that had already pushed would mean a second push or a
duplicate PR. It is also what leaves a slot between the two for a review step to
be added later without touching anything already published.

Which shape a button uses comes from two Settings toggles — `autoImplement` and
`autoResolveCodeReview` — on ⇒ the one-shot `*-v2`, off ⇒ the gated `*-v3`. A
per-ticket skill override always wins.

**A ticket is shown in the shape it was written.** Description and Acceptance
Criteria are rich text at the provider (Azure DevOps stores them as HTML,
GitHub as Markdown), and real requirements use that: numbered criteria with
lettered sub-points, tables, links and pasted screenshots. Both fields are
carried through as **sanitized HTML** (`sanitizeHtml()` / `markdownToHtml()` in
`lib/richText.ts` — a strict tag/attribute allowlist, applied once at the
producer) and rendered by `RichText` under the `.te-rich` stylesheet. Embedded
images need the PAT, so the sanitizer rewrites their `src` to
`GET /api/attachments`, which re-issues the request with the stored credential
and refuses any URL outside the configured organization.

**Ticket status is the provider's, never the app's.** A status change — whether
picked from the dropdown or applied automatically when a run succeeds
(`nextStatusAfter()`) — is written to the provider, and the app then displays
**what the provider recorded**, not what was requested: `resolveStatusForUpdate()`
maps the wanted label onto a real workflow state (process templates differ), and
`updateWorkItemState()` returns the state echoed back by ADO's PATCH response. If
the write is rejected, the optimistic value is dropped and replaced by the
`current` status the API reads back, so the app can never sit on a status the
tracker refused. Opening the status dropdown reconciles the same way, since
`GET /api/tickets/[id]/status` returns `current` alongside `options`.

A failed status write does **not** turn a successful run into a failure notice:
the completion toast still reports that the run finished, and says separately
that the status stayed where the provider had it.

**Resolve Review** is the second first-class flow: a PR's review threads are read
back into the Resolve Review tab, and a `fix-code-review-v*` run fixes, replies
and resolves them. Unresolved counts across loaded tickets feed the header bell.

**Admission control lives in the engine, not the route.** `startRun()` is the
single place that decides whether a run may start and what shape it has:

- *Which skill runs* is resolved server-side by `resolveSkill()` from
  `Setting.autoImplement` / `Setting.autoResolveCodeReview`. The caller picks the
  **family** (implement vs resolve-review) via `skillName`; the settings pick the
  **variant** (one-shot `*-v2` vs plan-gated `*-v3`). The client's choice of
  variant is honoured only when the request carries `skillExplicit: true`, which
  the UI sends solely for a skill hand-picked on the ticket's Overview tab. An
  unrecognised `skillName` is a **400** rather than a silent fall-through to the
  one-shot graph.
- *Whether it may start* is checked and committed inside **one transaction**,
  opened with a Postgres advisory lock
  (`pg_advisory_xact_lock(hashtext('ticket-executor:admission'))`). Without the
  lock, two simultaneous POSTs both read "nothing active" and both start.
  Three rules are enforced there, in this order (the first match is the message
  the user sees): **one active run per ticket** (in both modes — two runs on one
  ticket race for the same branch name regardless of worktrees); in single-ticket
  mode, **one active run overall**; and **`Setting.concurrentRuns` as a ceiling on
  runs actually computing**. All three return **409** and persist a
  `BlockedAttempt` (`duplicate-ticket` / `single-ticket-mode` / `concurrency-cap`).

  The first two count a run as active when it is `running` **or** `waiting` — a
  parked run still owns its worktree and its branch. The cap counts only
  `running`, and that difference is deliberate: the cap bounds what the *machine*
  is doing, and a run parked at a gate holds no child process and spends nothing
  while it waits for a human. Counting parked runs would let two unanswered plan
  reviews block every other ticket, and it would disagree with the client, which
  releases its batch slot the moment a run parks.

  The concurrency ceiling used to live **only** in the Ticket Execution screen's
  state, which meant two browser tabs — or one reload mid-batch — could put an
  unbounded number of Claude processes, worktrees and MCP servers on the machine,
  each with its own per-run budget and nothing capping the sum. The client queue
  still decides who goes *next*; the server decides how many may be in flight at
  all. The rule itself is a pure function (`admissionDenial()` in
  `lib/execution/admission.ts`) so it is asserted without a database; only the
  three facts it judges are read inside the lock.

  A run is also refused (**400**, `missing-skill`) when a node's skill is not
  installed — today that means `evaluateBeforePublish` is on but
  `review-changes-v1` is absent. Refusing up front matters here: the evaluate node
  sits *after* the plan was written, a human approved it and the code was
  committed, which is an expensive place to discover a missing file.

**Isolation** (`Setting.multiTicketMode`): on ⇒ each run gets its own
`git worktree --detach` under `rootRepo/.te-worktrees/`, so concurrent runs never
share an index; removed when the run finishes (a parked run keeps its worktree),
and the branch/commits/PR live in the real repo, so removal loses nothing.
Off ⇒ the run executes directly in `rootRepo`, which is only safe because the
admission check above guarantees nothing else is in flight. `Setting.concurrentRuns`
caps runs in flight and is enforced **server-side** in that same admission check.
The batch *queue* — which ticket is pulled in when a slot frees — is still client
state and does not survive a page reload; runs already started keep going, but
nothing pulls the next one in.

**Run artifacts never reach a commit.** Before spawning, `startRun()`
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
plugins off. The app's own skills live in `~/.claude/skills`, are not
plugin-provided, and still load. `CLAUDE_KEEP_PLUGINS=1` opts back in.

**Token discipline is part of the skill contract.** All five skills carry a
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
exists and is a git repo, Claude has an MCP path to the provider. (3) *Engine*
(`startRun`, under the admission lock): known skill, no run already in flight for
this ticket, and in single-ticket mode no run in flight at all — a miss returns
400/409, creates no run row, and persists a `BlockedAttempt`. (4) *Engine*: worktree + spawn — the first step that costs
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
it only); the implementation is `lib/execution/`, split around the graph runtime:

| File | Owns |
|---|---|
| `graph/types.ts` | `Node` / `Edge` / `Graph` / `NodeResult` / `RunContext` / `LiveRun`, and the `EffectClass` union |
| `graph/schemas.ts` | the JSON Schema each agent node must answer with |
| `graph/graphs.ts` | the graph definitions — pure data plus **pure, synchronous edges** |
| `graph/prompts.ts` | the prompt each node sends |
| `graph/exec.ts` | one node execution: per-turn MCP, spawn, contract check |
| `graph/drive.ts` | the driver loop, gates, budget/hop guards, termination |
| `graph/persist.ts` | every DB write the walk makes |
| `claudeCli.ts` | CLI args and the NDJSON `stream-json` turn runner |
| `runner.ts` | worktree isolation, run lifecycle, gate resolution, crash recovery |

`drive()` is one loop: pick node → run it → persist a `Step` → reduce its output
into the run's channels → ask the edge where to go → persist a `Transition`. It
replaced two near-identical post-turn dispatchers, which is what made adding a
node mean copy-pasting a third.

Edges are pure and synchronous on purpose: that is what makes a graph testable
without spawning a CLI.

**Context policy is per node.** `resume` continues the run's session (cheap, but
it inherits the earlier node's conclusions); `fresh` opens its own (a fresh
system prompt, but it has *not* seen the reasoning it is about to act on). The
rule: a node that produces an artifact resumes; a node that judges one must be
fresh, or it is marking its own homework.

**Progress comes from the graph.** The UI's step list is the node list, reported
by the API as `RunView.nodes` — there is no `STEPS` array to keep in sync, and
adding a node adds a step. `GET /api/graphs` serves the outline for a skill that
has not run yet.

**Guards.** Three, and all three are reachable from the default configuration:

- a per-node `--max-budget-usd` (falls back to `CLAUDE_MAX_BUDGET_USD`);
- a run-level ceiling checked **between** nodes — `Setting.runBudgetUsd`
  (Settings page, `0` = no run-level ceiling) snapshotted onto `Run.budgetUsd`
  when the run starts, so raising the limit later cannot retroactively un-fail a
  run that already stopped on the old one. Ending this way sets
  `endReason = "budget"`;
- a 40-transition hop limit as a backstop against a looping graph
  (`endReason = "hop-limit"`).

The hop count and the per-node visit count live on the `Run` row, not in the
driver's local state: `drive()` is re-entered on every gate resolution and every
crash recovery, and a counter that restarted there would never catch the loop it
exists to catch.

**Crash recovery.** Live state is an in-process `Map` (kept across HMR via
`globalThis`); everything durable is in Postgres, and `rehydrate()` rebuilds the
`LiveRun` from it (flagging `resumedAfterRestart`). `instrumentation.ts` runs
`recoverInterruptedRuns()` once per server start and sweeps runs left `running`,
deciding purely on the effect class of the step that was open — which is why that
class is copied onto the `Step` row:

| Open step was | What happens |
|---|---|
| `pure` | re-run it; nothing escaped |
| `local` | `--resume` the session, `attempt + 1` |
| `external` | **never auto-retried** — the run goes to `waiting` with `endReason = needs-review`, because nobody can tell from here whether the push landed |

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
and `git push` credentials (nothing to check against). The required skills
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

There is also a **per-node roll-up** — cost, failures and duration by node —
which answers "which step costs the money and which step fails". A single run row
could not answer that; `Step` rows can.

Implementation constraints worth knowing: money and tokens are summed from the
`Step` rows in one `groupBy`, so the `Run` table carries no duplicated totals and
the aggregate never touches a blob — diffs live in `Artifact` rows and logs in
`Step` rows, and neither is selected. The denormalized
`filesTouched` / `linesAdded` / `linesDeleted` columns on `Run` exist for the
same reason. Day buckets use the
**server's** local day (`toISOString()` would file an evening GMT+7 run under the
wrong date). The funnel is a separate endpoint because resolving PR outcomes
costs 1–2 provider round-trips *per PR* — capped at the 60 most recent, reporting
how many it `sampled`, and degrading to "not measured" rather than a misleading
zero. And **any success rate must exclude the human-ended reasons**.

---

## 5. Data model (Postgres via Prisma)

Eight models. Full column comments live in `prisma/schema.prisma`.

- **`Setting`** — single `default` row mirroring the Settings page, plus the
  dashboard ROI inputs (`hourlyRateUsd` 0 ⇒ tile hidden; `hoursPerStoryPoint`).
  Four fields decide how a run behaves rather than how it looks, and all four are
  read **server-side** when the run starts, never taken from the client:
  `autoImplement` / `autoResolveCodeReview` (one-shot vs plan-gated flow — see
  `resolveSkill()`), `multiTicketMode` (worktree isolation + the one-run-at-a-time
  rule), `runBudgetUsd` (snapshotted onto `Run.budgetUsd`) and
  `evaluateBeforePublish` (adds the `evaluate`/`fix` pair, and is baked into
  `graphId`).
  Two presentation switches live here too: `animatedBackground` (freezes the
  reactor backdrop) and `clickEffects` (suppresses every lightning bolt — the
  click strikes *and* the self-strikes each mounted spinner fires, so the buttons
  of a running ticket stop flashing). Both are read once by their consumer
  (`AppReactor`, `BoltsProvider`) and updated live by the `te:settings-updated`
  window event the Settings page dispatches on save.
- **`ProviderCredential`** — per-provider `org` + encrypted `pat`. For ADO, `org`
  is the **organization** URL. The PAT never lives in `Setting`.
- **`Run`** — one execution of one graph against one ticket. It owns no agent
  output of its own: what an agent produced belongs to a `Step`, what a human
  reads belongs to an `Artifact`, and every routing decision belongs to a
  `Transition`. `state` (`running` | `waiting` | `succeeded` | `failed` |
  `cancelled`) plus `currentNodeId` is the **whole** answer to "where is this
  run" — the old `status` × `phase` × `planStatus` triple is gone, along with
  `currentStep`. `channels` holds each node's validated output, which is what
  edges read.

  | Column | Why it exists |
  |---|---|
  | `endReason` (`""`\|`cancelled`\|`plan-rejected`\|`blocked`\|`budget`\|`hop-limit`\|`needs-review`) | A human's decision must never be scored as an agent failure |
  | `parkedAt` / `humanWaitMs` | Keeps "the agent was computing" separable from "a human hadn't answered", across however many gate rounds happen |
  | `resumedAfterRestart` | A session a bare terminal would have lost |
  | `skill` / `prUrl` / `branch` / `resultText` | Promoted out of node output because each has a consumer that must not have to open a `Step` row. `resultText` is taken only from a node whose output carries `committed` — i.e. one that actually delivered — so a run that failed at `implement` no longer displays the *plan's* summary as its result |
  | `baseSha` + `filesTouched`/`linesAdded`/`linesDeleted` | The run's diff is measured by the harness against `baseSha` (free, no tokens); the scalars let aggregates skip the blob |
  | `estimateHours` | The team's sizing, snapshotted at start so a re-estimate can't rewrite history |
  | `budgetUsd` | Run-level ceiling, snapshotted from `Setting.runBudgetUsd`, checked between nodes |
  | `hops` / `visits` | Loop guards that belong to the run, not to the process driving it — they survive a gate round and a crash resume |

- **`Step`** — one *attempt* at one node. A node re-entered by a cycle, or
  resumed after a crash, produces another row with `attempt + 1` rather than
  overwriting the first: the history of what was tried is the point. Carries the
  node's `effects` (so recovery can decide without resolving the graph), the
  validated `output`, that step's slice of the log, its own usage, and a
  `claimedAt` lease so two processes cannot claim the same node.
- **`Artifact`** — something a human reads or edits: `plan` | `feedback` |
  `diff`. A reviewer's edit creates a **new version** rather than overwriting the
  agent's, so "what was proposed" and "what was approved" stay comparable.

  The plan's *body* still travels between nodes as `.te/plan.md` inside the run's
  own working tree — `plan` writes it, `planCheck` reads it, `POST .../plan`
  writes the reviewer's edit back over it, and `implement` re-reads it under a
  "the file wins" instruction. That channel is deliberate: re-sending a whole
  plan through the prompt on every turn would cost more than it buys. What the
  `Artifact` rows changed is ownership of the *record* — the harness no longer
  has to read the filesystem to know what was proposed or approved, and a
  reviewer's edit is preserved next to the agent's original instead of
  overwriting it in place.
- **`Transition`** — why the harness went from one node to the next
  (`fromNode`, `toNode`, `reason`). Four of these explain a run better than the
  thousand lines of tool log beside them, and they are what makes a graph
  auditable rather than merely automated. `toNode` is a node id, `END`, `FAIL`,
  or `CANCELLED` — the last written when a person stops the run, so a cancelled
  run's history still says which node it was on and why it left. `CANCELLED` is
  not a routing target: no edge may return it, because a cancellation is imposed
  on the graph rather than decided by it.

  The `reason` string is load-bearing in one place: the implement edge emits
  `verification.tests=failed` / `verification.build=failed`, and the dashboard's
  `blockedOnVerification` counts exactly those. That coupling is asserted in
  `tests/graph.test.ts` rather than left to be noticed when the tile reads zero.
- **`BlockedAttempt`** — a request preflight rejected before spawning
  (`root-repo` / `agent-access` / `duplicate-ticket` / `single-ticket-mode` /
  `concurrency-cap` / `unknown-skill` / `missing-skill`). Recorded because a 400
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
| Work items | `GET /api/projects` · `/api/tickets` (`project`+`sprint`) · `/api/sprints` · `/api/tickets/[id]/{comments,review,commits,commits/[sha],executions}` · `GET\|POST /api/tickets/[id]/status` (GET → `{ options, current }`; POST → `{ status }` = the state the provider actually recorded, or `{ error, current }` when it refused) |
| Runs | `POST /api/tickets/[id]/implement` (body: `skillName` = requested family, optional `skillExplicit`, `projectName`, `rootRepo`, `provider`, `ticketUrl`, `model`, `effort`, `estimateHours`/`storyPoints`, optional `prUrl`. Validates Root repo + agent access, then hands admission to `startRun()`, which resolves the actual skill from Settings and enforces one-run-per-ticket + single-ticket mode under an advisory lock; snapshots the estimate, records a `BlockedAttempt` on rejection, returns `{ runId }`, may return `warnings[]`) · `GET /api/executions/[id]` → `{ run }` · `/stream` (**SSE**: emits only on change, closes as soon as `state !== "running"` — a gate is terminal for the stream too) · `POST .../cancel` · `POST .../plan` (approve/revise/cancel) · `GET /api/graphs` (node outline per skill, for the pre-run timeline) |
| Metrics | `GET /api/dashboard` (`provider`+`project`+`days`) · `/api/dashboard/funnel` · `/api/reviews/summary` |
| Assets | `GET /api/attachments?url=` (streams a ticket's embedded images with the stored PAT; rejects anything that is not an attachment of the configured org) |
| Setup | `GET\|POST /api/settings` (PAT never returned) · `POST /api/settings/test` · `GET /api/preflight` · `GET /api/skills` · `GET\|POST /api/skills/install` · `GET\|POST /api/options` · `/api/options/mapping` |

---

## 7. Sharp edges

- Runs make real changes — point Root repo at a scratch clone the first time.
- The skill dropdown can list a skill that isn't installed; the run then fails
  partway, after spending tokens.
- The skills are **2.x**, and the contract is breaking: a 1.x copy answers
  in prose, which the runner cannot route on, so every node fails at once. System
  Check treats a major-version gap as a **blocker**, not a warning.
- A crash during the `publish` node leaves the run in `waiting` /
  `needs-review` on purpose. Nothing auto-retries it, because whether the push or
  the PR landed is not knowable from here — check the branch and the tracker
  before retrying or discarding.
- `git push` must work non-interactively per clone; a run cannot answer a
  credential prompt and System Check cannot verify this.
- Changing `DATABASE_URL` without an explicit `SETTINGS_ENC_KEY` makes stored
  PATs unreadable — they come back empty and must be re-entered.
- A user-configured MCP server can silently serve a different organization.
- A rejected status write is usually a PAT scope problem: writing
  `System.State` needs **Work Items (Read & Write)**, which a read-only token
  passes every other check with. ADO's failure body is logged in full server-side
  (`[ado]`), while the UI gets the one-sentence `message` from its JSON envelope.
- The Resolve Review tab's PR link is *reconstructed* from the provider (the
  Result tab uses the URL the run itself recorded, which is always right). For
  ADO it comes from `repository.webUrl`, falling back to a hand-built URL and
  then to the recorded one — never to a partial URL, since an empty repo segment
  (`.../_git//pullrequest/<n>`) resolves to the project's PR *list*.
- `Ticket.description` / `Ticket.criteria` are **HTML**, and the UI renders them
  with `dangerouslySetInnerHTML`. Every producer must pass provider markup
  through `lib/richText.ts` first — that function is the only allowlist, and a
  new provider that assigns raw markup would ship an XSS hole.
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
