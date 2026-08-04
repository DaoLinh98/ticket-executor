import type { LogLine } from "../types";

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
export const stripAnsi = (s: string) => s.replace(ANSI, "");
export const cleanPath = (s: string) => s.replace(/[\r\n]+/g, "").trim();

// There used to be a detectArtifacts() here that scanned the log with regexes for
// a PR URL and a branch name. It is gone on purpose: the branch and the PR URL
// are fields of a node's output contract now (IMPLEMENT_OUTPUT.branch,
// PUBLISH_OUTPUT.prUrl), reported by the agent and validated by the CLI. Sniffing
// them back out of free text was the same anti-pattern as inferring progress from
// tool names — the harness guessing at state it should have been told.

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function safeParseJson<T>(s: string, fallback: T): T {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function asLogLines(v: unknown): LogLine[] {
  return Array.isArray(v) ? (v as LogLine[]) : [];
}
