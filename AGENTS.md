# Repository Guidelines

## Project Structure & Module Organization

The application is in `ticket-executor/`, a Next.js app using TypeScript, React, and Prisma. Route handlers and UI live under `ticket-executor/app/`; shared server logic is in `ticket-executor/lib/`; database schema and migrations are under `ticket-executor/prisma/`. Bundled Claude agents and skills are in `ticket-executor/agents/` and `ticket-executor/skills/`. Static assets are in `ticket-executor/public/`, and Node test files are in `ticket-executor/tests/`. Read the root README for orientation and `ticket-executor/CLAUDE.md` plus its README for architecture and development details.

## Build, Test, and Development Commands

Run commands from `ticket-executor/`:

- `npm install` installs dependencies.
- `npm run dev` starts the local Next.js development server at `http://localhost:3000`.
- `npm run build` creates a production build; `npm run start` serves it.
- `npm test` runs the Node test suite in `tests/*.test.ts` without requiring a database.
- `npx tsc --noEmit` checks TypeScript types.
- `npx prisma migrate dev` applies local database migrations; after schema changes, run `npx prisma generate`.

## Coding Style & Naming Conventions

Use TypeScript for application code and follow nearby patterns for React components, route handlers, and server modules. Use descriptive names consistent with the existing code: PascalCase for React components and types, camelCase for functions and variables, and `*.test.ts` for tests. There is no configured lint or formatting script; do not introduce tooling without coordinating with maintainers. Before changing Next.js behavior, consult the installed Next.js documentation under `node_modules/next/dist/docs/` because this repository uses Next.js 16.

## Testing Guidelines

Add or update focused tests under `ticket-executor/tests/` for behavior changes, using the built-in Node test runner conventions and `node:assert`. Run `npm test` from `ticket-executor/`; use `npx tsc --noEmit` for type checking. Tests do not need a database unless a test explicitly documents otherwise.

## Commit & Pull Request Guidelines

Recent history uses concise, imperative commit subjects (for example, “Improve sprint and workflow pages”); keep commits focused and descriptive. Pull requests should explain the user-visible or engine change, note relevant validation commands, link the issue or ticket when available, and include screenshots for UI changes. Call out schema or configuration changes and update the relevant README or architecture documentation.

## Security & Configuration

Keep credentials in local environment files and never commit secrets. Review `ticket-executor/.env.example` for supported settings. This tool can commit, push, and open pull requests in a configured target repository; use a scratch repository when exercising automation for the first time.
