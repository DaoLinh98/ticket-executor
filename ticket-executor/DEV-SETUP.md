# Dev quick start

Docker runs only **Postgres** and **Redis**. The app itself runs on your machine, so Claude keeps using your own skills, MCP config and sibling clones.

## Prerequisites

- Node.js 20+
- Docker Desktop (running)
- Claude Code CLI, logged in
- Git

## First time

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from the template and set these two lines:

   ```bash
   cp .env.example .env
   ```

   ```
   DATABASE_URL=postgresql://te:te@localhost:5438/te
   REDIS_URL=redis://localhost:6379
   ```

## Every day

```bash
npm run dev:docker
```

This starts Postgres and Redis, applies pending migrations, then starts the app at http://localhost:3000.

Then open **System Check** in the sidebar to confirm everything is green.

## Useful commands

| Goal | Command |
|---|---|
| Stop Postgres and Redis (data kept) | `docker compose down` |
| Reset the database (deletes all data) | `docker compose down -v` |
| Start the app only, with your own DB | `npm run dev` |

## Troubleshooting

- **Port already in use:** set `DB_PORT` / `REDIS_PORT` in `.env` and update `DATABASE_URL` / `REDIS_URL` to match.
- **`docker compose` fails:** start Docker Desktop first.
- **Don't run two copies at once** against the same repo (for example a container build and `npm run dev`).
