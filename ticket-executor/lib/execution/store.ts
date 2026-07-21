import type { Entry } from "./types";

// In-process execution state, kept across dev HMR via globalThis. Not persisted —
// restarting the server loses in-flight log/step state (final status/result lives in Postgres).
const g = globalThis as unknown as { __execStore?: Map<string, Entry> };
export const store: Map<string, Entry> = g.__execStore ?? new Map();
g.__execStore = store;
