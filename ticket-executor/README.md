# Ticket Executor

A local web UI that runs the **Claude Code CLI** against your tickets. Flow
Runner plans your sprint and starts a **D-Agent run** per ticket: a chain of
subagents works in a git worktree of the target repo — it plans, writes the
code, has it reviewed, commits, pushes and opens a draft PR. Each run is
watched live on **Workflow** (`/workflow?ticket=<id>`).

> **This tool makes real changes.** A run commits and pushes to a real
> repository and opens a real pull request, with `--dangerously-skip-permissions`.
> Point it at a scratch repo the first time.

This is a **developer tool you run on your own machine**, not a shared service:
the Claude CLI, the git clones and the Postgres DB all live locally.

---

## 1. Prerequisites

Install these before touching the app.

| # | What | Check | Notes |
|---|------|-------|-------|
| 1 | Node.js 20+ | `node -v` | `@types/node` is pinned to 20. |
| 2 | PostgreSQL | `psql --version` | Any local instance. The repo's convention is port **5438**. |
| 3 | Claude Code CLI, logged in | `claude --version` | The engine spawns this binary. If it is not on `PATH`, set `CLAUDE_BIN`. |
| 4 | The bundled skills and agents installed | `ls ~/.claude/skills ~/.claude/agents` | Installed by the app on boot. See §4. |
| 5 | Target repo cloned | `git -C <path> status` | The clone you want runs to happen in. Its path is the ticket's **Root repo** value. See §5. |
| 6 | Azure DevOps PAT | — | Scopes in §6. |

Rows 1–4 and 6 are all verified for you by the **System Check** page once the app
is running (§8) — set things up, then let it tell you what is still missing.

## 2. Install and configure

```bash
cd ticket-executor
npm install
cp .env.example .env          # then edit it
```

Fill in `.env` — every variable is documented inline in `.env.example`. The
minimum is `DATABASE_URL`; you almost certainly also want
`APP_ACCESS_PASSWORD` and `SETTINGS_ENC_KEY`.

> `.env.local` is also read, and Next.js loads it *after* `.env`, so it wins.
> Use one file only.

## 3. Database

Create the database, then apply the migrations:

```bash
npx prisma migrate dev        # creates/applies migrations locally
npx prisma generate           # regenerate the client after schema changes
npx prisma studio             # optional: inspect the rows
```

Among the tables: `Setting` (a single `default` row mirroring the Settings
page), `ProviderCredential` (org URL + encrypted PAT per provider), the sprint
plan (`SprintPlan`, `PlannedTicket`, `AutomationEvent`) and the D-Agent runs
(`DagentRun`, `DagentStep`, `DagentTransition`, `DagentArtifact`).

## 4. Skills and agents

A run is a **D-Agent** run: each step is a subagent shipped in `agents/` and
copied into `~/.claude/agents/` when the server boots (an older installed copy
is replaced, and a run is refused while one is missing or outdated). The
skills in `skills/` are only Flow Runner's own turns:

| Skill | Used when |
|-------|-----------|
| `triage-sprint-v4` | Flow Runner triage (building the plan) |
| `reply-qa-v4` | The drafted reply to QA |

The skills of the retired Ticket Execution engine (`implement-ticket-v4`,
`fix-code-review-v4`, `review-changes-v4`, `fix-qa-v4`) are no longer bundled;
a copy left in `~/.claude/skills` is harmless and stays denied to D-Agent turns.

Runs read the project's `KNOWLEDGE.md` (repo root of the **Root repo**) and add
the lessons the reviewer and QA taught them. The file is local project memory:
it is excluded from git and never committed.

## 5. Target repositories

A run executes with its working directory set to **exactly** the ticket's
**Root repo** value — the app does not append the project name to it. So that
value must be the path of the git repo itself, e.g. `C:\repos\my-service`, not
a parent folder.

There is **no environment variable and no app-wide default** for it — one
provider connection spans many projects, so the value is per ticket:

1. The **Root repo** combobox on the ticket's **Overview** tab. Free text; the
   dropdown only suggests paths already used before (`SavedOption`).
2. Auto-filled from the last root repo used for that project (remembered in the
   `RootRepoProjectMap` table).

So the first run for a project needs the path typed once (and **Save**d — Flow
Runner reads the saved mapping); after that it is prefilled. Until it is set,
the field is flagged **REQUIRED** on the Overview tab.

The D-Agent admission re-validates it server-side before spawning the CLI
(exists + is a git repo) and refuses the run — so a wrong path costs no tokens.

For each repo you intend to run against:

1. Clone it anywhere you like, then point Root repo at that clone.
2. Make sure the working tree is **clean** and on the default branch.
3. Make sure `git push` works non-interactively (credential manager / PAT
   cached). The run cannot answer a credential prompt — verify by hand with
   `git push --dry-run` inside the clone. This one is **not** covered by the
   System Check page, since it has no repo to check against.

Every run gets its own git worktree, so concurrent runs (up to Settings →
**Concurrent runs**) don't share one index. The worktree is removed when the
run finishes; the branch and commits it created live in the real repo and are
never touched.

## 6. Azure DevOps connection

The connection is configured at **organization** level; the project is picked in
the UI per run.

Create a PAT with:

- **Work Items** — Read & Write (read tickets, update status)
- **Code** — Read & Write (push branches)
- **Pull Request** *(Code → Read, write & manage)* — create PRs, read/reply to
  review threads

Then start the app, open **Settings**, and enter:

- Provider: **Azure DevOps** (GitHub / Jira / GitLab are scaffolded only —
  they degrade to an empty "not connected" state)
- Organization URL: `https://dev.azure.com/<your-org>` — the **org**, not a project URL
- PAT

Hit **Test connection**, then **Save**. The PAT is encrypted at rest and never
sent back to the browser (the API returns only a `hasPat` boolean).

### Claude's own access to the provider (MCP)

There are **two** credential paths to the provider, and they are independent:

| Who | How | Configured where |
|---|---|---|
| The app (ticket list, sprints, PR data) | REST, with the PAT above | Settings |
| The Claude CLI a run spawns | the provider's **MCP server** | see below |

The D-Agent subagents read the work item and drive the PR through provider MCP
tools. Without one, a run spends tokens and then fails — so this is not optional.

**Settings → "Manage MCP for me"** (on by default) decides who sets it up:

- **On** — the app generates an Azure DevOps MCP server per run from the org +
  PAT you just saved and passes it to the CLI with `--mcp-config`. Nothing to
  install, nothing to keep in sync with Settings. If you already configured your
  own server for that provider, the app detects it and steps aside.
- **Off** — the app never touches MCP. Configure it yourself once:

  ```bash
  claude mcp add azure-devops -s user -e AZURE_DEVOPS_TOKEN=<PAT> -- npx -y @azure-devops/mcp@2 <your-org>
  ```

Either way System Check verifies the result (§8). Three things worth knowing:

- The generated config is written to a temp file for the length of one turn and
  deleted afterwards — it holds the PAT in clear text, so it is never written
  inside the repo (where a run's own `git add` could pick it up).
- `CLAUDE_MCP_CONFIG` overrides all of this and comes with
  `--strict-mcp-config`, so that file must declare the provider's server itself.
- **Recommended:** install the server once to make every turn start faster.

  ```bash
  npm i -g @azure-devops/mcp@2
  ```

  A run spawns a fresh CLI process per turn, and `npx -y` re-resolves the package
  against the registry each time (measured on Windows: ~6.9s cold, ~3.4s warm,
  versus ~1.0s starting the installed copy directly). The app picks the global
  install up automatically when its major version matches, and falls back to
  `npx` otherwise — so this is purely an optimisation, never a requirement.
  System Check's "MCP server package resolves" row tells you which path is live.

## 7. Start the app

```bash
npm run dev      # http://localhost:3000 (Turbopack)
npm run build    # production build
npm run start    # serve the production build
```

Log in with `APP_ACCESS_PASSWORD` (if you left it empty, the auth gate is off
and you go straight in).

### Host or container — never both at once

The app also ships as a container (`dagent-web`). Both copies
can point at the same Postgres, and that is the supported setup: one database, one
set of settings, one run history. What is **not** supported is running both at the
same time.

`reconcileOrphans()` (`lib/dagent/engine.ts`) treats every D-Agent row with
`state: "running"` that the *current* process is not driving as an orphan and
fails it. That check is an in-memory map, not a database lock — so whichever
copy looks second fails the other's live run, while its `claude` keeps working
on the same worktree.

Pick one side per session:

| Doing | Command |
|---|---|
| Implementing — you want your own skills, `~/.claude.json` MCP config, and sibling clones | `docker stop emesoft-dagent-web-1` then `npm run dev` |
| Demoing the container build | stop `npm run dev`, then `docker start emesoft-dagent-web-1` |

Before switching sides, make sure no run is mid-flight — a `running` row left
behind is exactly what the other side picks up:

```bash
# nothing should be running
docker exec emesoft-dagent-db-1 psql -U dagent -d dagent -c "select id, state from \"DagentRun\" where state = 'running';"

# and when you are on the host, this should print nothing
docker ps --format "{{.Names}}" | grep dagent-web
```

## 8. Verify the setup — System Check

Go to **System Check** in the sidebar (`/system-check`) *before* your first
ticket. It re-runs every check live on each visit — nothing is cached, nothing
is remembered as "passed" — and it costs no Claude tokens.

| Section | What it verifies |
|---|---|
| ENVIRONMENT | Postgres reachable, all migrations applied, `claude --version` runs, `git --version` runs, plus an advisory warning when `SETTINGS_ENC_KEY` is not set explicitly |
| SKILLS | Each bundled skill resolves to a real folder, and shows which one |
| AGENTS | Each D-Agent subagent is installed and not older than the bundled copy |
| PROVIDER CONNECTION | A credential is saved for the selected provider, and that the provider is actually wired up (only Azure DevOps is) |
| CLAUDE'S PROVIDER ACCESS | Whether the run's MCP path exists at all — app-managed, your own server, or nothing. With your own server it also compares the **organization baked into it** against Settings (a mismatch reads the wrong work items without erroring); app-managed adds a Node/npx check |

Read the badges as:

- **FAIL** on a blocker → a run would not get anywhere; fix it first. Each row
  states what was found and one concrete fix.
- **WARN** (`optional`) → nothing is blocked, but it commonly bites later.

**Re-run checks** repeats the local checks (~1s). **Run deep checks** additionally
calls the provider with the saved token *and* health-checks every MCP server the
CLI knows about (`claude mcp list`) — network requests that take ~30s, which is
why they are opt-in. A server reported as *needs authentication* or *pending
approval* is a blocker: a non-interactive run can neither complete an OAuth flow
nor approve a `.mcp.json`.

The deep verdict for MCP is cached for 5 minutes and read at run start: a cached
failure blocks the run, a cache miss lets it start with a warning toast, and any
Settings change clears it.

When there are no blockers the footer turns into a **Go to Ticket Execution**
button.

Two things this page deliberately does *not* check, because they belong to a
single run rather than to your machine:

- **Root repo** — a per-ticket value (§5). It is validated by the D-Agent
  admission on every start instead.
- **git push credentials** — verify manually per clone (§5).

> The page is currently advisory: it reports and links, it does not lock
> `/ticket-execution`. The hard gates that exist today run at start instead:
> Root-repo validation, and the cheap half of the MCP check (no provider server
> at all, missing credential, or an org mismatch → HTTP 400, no tokens spent).

## 9. First run

1. **Ticket Execution** — pick the project + sprint in the header, select a
   ticket, and on its **Overview** tab set and **Save** the **Root repo**
   (flagged `· REQUIRED` while empty).
2. **Flow Runner** (My Sprint) — **Build plan**, then **Activate**. With
   **Auto-implement** on, the scheduler starts the next ticket in the queue as a
   D-Agent run; the row's run icon starts one by hand.
3. **Workflow** (`/workflow?ticket=<id>`, the row's Watch / Result icon) — the
   live run: each subagent step, the reviewer sending work back, the draft PR.

The run buttons on Ticket Execution are kept but not wired to D-Agent yet — they
say so instead of starting a run.

What happens before a run spends anything — the cheap guards come first:

1. **Scheduler** — the ticket is still yours, not blocked by triage, and its
   project has a saved Root repo. A miss is logged and nothing is sent.
2. **D-Agent admission** (`startRun()` in `lib/dagent`) — Root repo exists and
   is a git repo, the agents are installed, no other run is active for the
   ticket, and a concurrency slot is free. A refusal creates no run row.
3. **Engine** — creates the worktree, then spawns `claude`. This is the first
   step that costs money.

## 10. Notifications on your phone

The bell in the header only refreshes while the app is open in a browser. To be
told about a review comment or an overnight run while the app is **closed** —
on an iPhone lock screen, or as a desktop notification — the server has to push
it, and that needs three things set up once.

**1. VAPID keys** (the server's identity to Apple's and Google's push services):

```bash
npx web-push generate-vapid-keys
```

Put the pair in `.env` as `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, set
`VAPID_SUBJECT` to your own `mailto:` address, and restart the app. Leaving them
empty keeps push off entirely — nothing is polled and nothing is sent.
Regenerating them later invalidates every device: each one has to be enabled
again.

**2. A stable HTTPS origin.** A push subscription is issued against one origin
and dies with it, so `localhost` cannot receive one and a tunnel whose URL
changes on every restart means re-enabling every time. Use a reserved domain
(ngrok static domain, Cloudflare tunnel, a real host).

**3. The app installed to the Home Screen (iOS).** iOS grants push only to an
installed web app, never to a Safari tab. Open the site in Safari, **Share → Add
to Home Screen**, then launch it from that icon. An icon added before this app
had a manifest is only a bookmark — remove it and add it again.

Then, inside the installed app: **Settings → Notifications → Enable on this
device**, allow the permission prompt, and press **Send a test**. The switch is
per device, not per account — each phone and laptop enables itself.

What arrives is exactly what the bell would have shown: the server re-asks the
same sources every two minutes and sends only what it has not sent before. The
first check after you enable is silent on purpose — it records the standing
backlog rather than announcing three days of it.

Note that this only works while the app is actually running on your machine. It
is a local tool: nothing pushes while the laptop is asleep.

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Run fails immediately, log shows `spawn claude ENOENT` | CLI not on `PATH` | Set `CLAUDE_BIN` to the full path — System Check (§8) flags this |
| `Failed to set up isolated git worktree` before any token is spent, git says `Filename too long` (Windows) | The worktree lives at `<root repo>\.te-worktrees\<project>-<runId>`, which is deeper than the original clone — deep repos cross the 260-char limit | `git config --global core.longpaths true` (the Windows `LongPathsEnabled` policy alone is not enough; git opts in separately) |
| Run is refused before it starts | A D-Agent subagent is missing or older than the bundled copy | §4 / System Check |
| Log stalls at branch/push | git credentials not cached for the clone | `git push --dry-run` in the repo, fix the credential |
| `Root repo is required` / `Root repo not found` (400, nothing ran) | Root repo empty or wrong on the Overview tab | Set it to the clone path; it is then remembered for that project |
| Run works but nothing appears in the expected repo | Root repo points at a different clone | Check the Overview tab value |
| Tickets list is empty / "not connected" | Provider not `azure-devops`, or org URL/PAT wrong | §6, then **Test connection** |
| PAT suddenly rejected after a DB change | Encryption key was derived from `DATABASE_URL`, which changed | Set `SETTINGS_ENC_KEY` explicitly and re-enter the PAT |
| `No concurrency slot` (429) | Settings → Concurrent runs is reached | Wait for a run to finish, or raise the limit |
| Prisma client type errors after pulling | Schema changed | `npx prisma generate` |
| Root repo dropdown is empty on a fresh install | It only lists paths used before — there are no built-in suggestions | Type the clone path once; it is remembered per project afterwards |
| Settings → Notifications says "Add to Home Screen" on an iPhone that already has the icon | The icon predates the app manifest, so iOS treats it as a bookmark | Delete the icon, re-add it from Safari's Share menu, open the app from it |
| Notifications enabled, test says "Sent to 1 device", nothing appears | Notifications are muted for the installed app at the OS level | iOS Settings → Notifications → D-Agent → Allow Notifications |
| The Notifications tab says the server has no VAPID keys | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` unset, or the app was not restarted after setting them | §10 |

## 12. Notes

- `npm run test` runs the unit suite (`node --test` over `tests/*.test.ts`, TypeScript
  via `tests/register.mjs`) — it needs no database and costs no tokens. Run it after
  any change to a D-Agent graph, an edge or a node contract.
- There is no lint script. Don't add tooling implicitly; ask first.
- Type-check with `npx tsc --noEmit`.
- The check logic lives in `lib/preflight.ts` (read-only, token-free) and has two
  consumers: `GET /api/preflight` for the System Check page, and
  `validateRootRepo()` for the D-Agent admission. Add new checks there, not in a
  route.
- Lock-screen notifications need VAPID keys, a stable HTTPS origin and (on iOS)
  the app installed to the Home Screen — see §10.
- Cost control: there is no spend ceiling by design (see `CLAUDE.md`). Watch what
  a run costs on Workflow and in Flow Runner's per-ticket cost, and use Cancel to stop one.
- Architecture, module layout and conventions: see `CLAUDE.md` (repo root and
  this folder) and `UI-STYLEGUIDE.md` before changing code.
- This project pins `next@16.2.10` / `react@19.2.4` — read
  `node_modules/next/dist/docs/` before writing Next.js code; the APIs differ
  from older versions (e.g. middleware is now `proxy.ts`).
