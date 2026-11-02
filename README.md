# Ticket Executor

A local web UI that runs the **Claude Code CLI** against your tickets. It plans a
sprint, then drives a **D-Agent run** per ticket: a chain of subagents works in a
git worktree of the target repo — plans, writes the code, has it reviewed, commits,
pushes and opens a draft PR. Each run is watched live on **Workflow**.

> **This tool makes real changes.** A run commits and pushes to a real repository
> and opens a real pull request, with `--dangerously-skip-permissions`. Point it
> at a scratch repo the first time.

The app lives in [`ticket-executor/`](ticket-executor). Full setup, configuration
and usage docs are in **[`ticket-executor/README.md`](ticket-executor/README.md)**;
architecture, engine invariants and conventions are in
[`ticket-executor/CLAUDE.md`](ticket-executor/CLAUDE.md).

## Quick start

```bash
cd ticket-executor
npm install
cp .env.example .env   # fill in DATABASE_URL at minimum
npx prisma migrate dev
npm run dev            # http://localhost:3000
```

See `ticket-executor/README.md` for prerequisites, the Azure DevOps connection,
skills/agents, and troubleshooting.
