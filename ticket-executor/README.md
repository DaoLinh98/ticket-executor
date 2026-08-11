# Ticket Executor

A local web UI that runs the **Claude Code CLI** against your tickets. Pick a
sprint ticket from Azure DevOps, hit Implement, and the app spawns `claude`
non-interactively in the target repo: it creates the branch, writes the code,
commits, pushes and opens the PR — streaming the live log, progress steps and
token/cost back into the browser.

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
| 4 | The four skills installed | `ls ~/.claude/skills` | `implement-ticket-v2`, `implement-ticket-v3`, `fix-code-review-v2`, `fix-code-review-v3`. See §4. |
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

Five tables are created: `Setting` (a single `default` row mirroring the
Settings page), `ProviderCredential` (org URL + encrypted PAT per provider),
`Execution` (one row per Claude run) and two combobox-memory helpers.

## 4. Skills

The app does not ship the skills — it runs whichever skill name you select, so
the skill must exist on your machine under `~/.claude/skills/<name>/`. The four
the UI depends on:

| Skill | Used when |
|-------|-----------|
| `implement-ticket-v2` | Implement, **Auto implement = on** (one-shot, no plan gate) |
| `implement-ticket-v3` | Implement, **Auto implement = off** (plan → review → implement) |
| `fix-code-review-v2` | Resolve Review, **Auto resolve = on** |
| `fix-code-review-v3` | Resolve Review, **Auto resolve = off** |

Sanity check:

```bash
ls ~/.claude/skills | grep -E 'implement-ticket-v[23]|fix-code-review-v[23]'
```

> **Known sharp edge:** the skill dropdown falls back to a hard-coded list when
> it cannot read the directory, so a name can appear in the UI that is *not*
> installed. The run then fails partway through, after spending tokens. Trust
> the **System Check** page (§8) or the command above, not the dropdown.

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

So the first run for a project needs the path typed once; after that it is
prefilled. Until it is set, the field is flagged **REQUIRED** on the Overview
tab and the run button reminds you instead of starting.

`POST /api/tickets/[id]/implement` re-validates it server-side before spawning
the CLI (exists + is a git repo) and rejects with 400 — so a wrong path costs
no tokens.

For each repo you intend to run against:

1. Clone it anywhere you like, then point Root repo at that clone.
2. Make sure the working tree is **clean** and on the default branch.
3. Make sure `git push` works non-interactively (credential manager / PAT
   cached). The run cannot answer a credential prompt — verify by hand with
   `git push --dry-run` inside the clone. This one is **not** covered by the
   System Check page, since it has no repo to check against.

With **Multi-ticket mode** on (the default), each run gets its own git worktree
under `<repo>\.te-worktrees\`, so concurrent runs don't share one index. The
worktree is removed when the run finishes; the branch and commits it created
live in the real repo and are never touched.

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

The skills (`implement-ticket-v*`, `fix-code-review-v*`) read the work item and
drive the PR through provider MCP tools. Without one, a run spends tokens and
then fails — so this is not optional.

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

## 8. Verify the setup — System Check

Go to **System Check** in the sidebar (`/system-check`) *before* your first
ticket. It re-runs every check live on each visit — nothing is cached, nothing
is remembered as "passed" — and it costs no Claude tokens.

| Section | What it verifies |
|---|---|
| ENVIRONMENT | Postgres reachable, all migrations applied, `claude --version` runs, `git --version` runs, plus an advisory warning when `SETTINGS_ENC_KEY` is not set explicitly |
| SKILLS | Each of the four required skills resolves to a real folder, and shows which one |
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

- **Root repo** — a per-ticket value (§5). It is validated by
  `POST /api/tickets/[id]/implement` on every start instead.
- **git push credentials** — verify manually per clone (§5).

> The page is currently advisory: it reports and links, it does not lock
> `/ticket-execution`. The hard gates that exist today run at start instead:
> Root-repo validation, and the cheap half of the MCP check (no provider server
> at all, missing credential, or an org mismatch → HTTP 400, no tokens spent).

## 9. First run

1. **Projects** — the org's projects. Click one; it routes to Ticket Execution.
2. **Ticket Execution** — pick the project + sprint in the header, select a ticket.
3. **Overview** tab — set **Root repo** (flagged `· REQUIRED` while empty) and
   confirm **Skill**. The command preview under the fields shows exactly what
   will be spawned.
4. Hit the primary CTA.
   - Two-phase skill (`*-v3`): the run stops at **Awaiting your review** and the
     **Plan** tab shows `.te/plan.md`. Edit it if you like, then
     **Accept** (resume and implement) / **Request changes** (re-plan) /
     **Cancel**.
   - One-shot skill (`*-v2`): it goes end-to-end without a gate.
5. **Execution** tab for the live log, **Result** tab for the diff, duration,
   tokens and cost, **Commits** tab for what landed.
6. **Dashboard** for run metrics across tickets.

A parked plan survives a dev-server restart (the resume state is persisted), so
you can stop `npm run dev` and come back to it.

What happens when you press the CTA, in order — the cheap guards come first:

1. **Client** — is a run already active for this ticket? Is another ticket
   running while multi-ticket mode is off? Does the status have a runnable
   action? Is **Root repo** filled in? A miss here shows a toast and jumps to
   the Overview tab; no request is sent.
2. **Server** (`POST /api/tickets/[id]/implement`) — project present, Root repo
   exists and is a git repo, and (single-ticket mode) no other run is active.
   A miss returns **400/409** and no run row is created — nothing was spawned,
   so nothing was spent.
3. **Engine** (`startExecution`) — creates the worktree if multi-ticket mode is
   on, then spawns `claude`. This is the first step that costs money.

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Run fails immediately, log shows `spawn claude ENOENT` | CLI not on `PATH` | Set `CLAUDE_BIN` to the full path — System Check (§8) flags this |
| Run starts, then fails partway with nothing useful done | Selected skill is not installed locally | §4 / System Check |
| Log stalls at branch/push | git credentials not cached for the clone | `git push --dry-run` in the repo, fix the credential |
| `Root repo is required` / `Root repo not found` (400, nothing ran) | Root repo empty or wrong on the Overview tab | Set it to the clone path; it is then remembered for that project |
| Run works but nothing appears in the expected repo | Root repo points at a different clone | Check the Overview tab value |
| Tickets list is empty / "not connected" | Provider not `azure-devops`, or org URL/PAT wrong | §6, then **Test connection** |
| PAT suddenly rejected after a DB change | Encryption key was derived from `DATABASE_URL`, which changed | Set `SETTINGS_ENC_KEY` explicitly and re-enter the PAT |
| `Ticket #N is currently running` (409) | Multi-ticket mode is off — one run at a time | Finish/cancel that run, or turn multi-ticket mode on |
| Prisma client type errors after pulling | Schema changed | `npx prisma generate` |
| Root repo dropdown is empty on a fresh install | It only lists paths used before — there are no built-in suggestions | Type the clone path once; it is remembered per project afterwards |

## 11. Notes

- There is no lint or test script — `package.json` has only `dev` / `build` /
  `start`. Don't add tooling implicitly; ask first.
- Type-check with `npx tsc --noEmit`.
- The check logic lives in `lib/preflight.ts` (read-only, token-free) and has two
  consumers: `GET /api/preflight` for the System Check page, and
  `validateRootRepo()` for the implement route. Add new checks there, not in a
  route.
- Cost control: there is no spend ceiling by design (see `CLAUDE.md`). Watch what
  a run costs on the Dashboard's OPERATIONS tier, and use Cancel to stop one.
- Architecture, module layout and conventions: see `CLAUDE.md` (repo root and
  this folder) and `UI-STYLEGUIDE.md` before changing code.
- This project pins `next@16.2.10` / `react@19.2.4` — read
  `node_modules/next/dist/docs/` before writing Next.js code; the APIs differ
  from older versions (e.g. middleware is now `proxy.ts`).
