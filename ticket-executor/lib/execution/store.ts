import type { LiveRun } from "./graph/types";

// In-process run state, kept across dev HMR via globalThis. Not persisted — what
// survives a restart lives in the Run/Step/Artifact/Transition rows, and
// rehydrate() rebuilds this from them.
const g = globalThis as unknown as { __runStore?: Map<string, LiveRun> };
export const store: Map<string, LiveRun> = g.__runStore ?? new Map();
g.__runStore = store;
