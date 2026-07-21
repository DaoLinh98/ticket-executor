// Public facade for the execution engine. The implementation is split across
// `lib/execution/*`:
//   types.ts      — the in-memory `Entry` / `TurnState` shapes
//   store.ts      — the globalThis-backed in-process Map
//   format.ts     — ANSI/path cleanup, duration formatting, PR/branch detection, JSON parsing
//   git.ts        — post-run diff collection against the worktree's base commit
//   steps.ts      — tool-call → workflow-step inference (STEPS in lib/ui.ts)
//   claudeCli.ts  — CLI args and the NDJSON stream-json turn runner
//   queries.ts    — read models (in-memory, persisted, history)
//   runner.ts     — worktree isolation, run lifecycle, cancellation
export { getExecution, getPersistedExecution, listExecutions } from "./execution/queries";
export { cancelExecution, startExecution } from "./execution/runner";
