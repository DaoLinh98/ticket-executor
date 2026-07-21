import type { LogLine } from "../types";
import type { Entry } from "./types";

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
export const stripAnsi = (s: string) => s.replace(ANSI, "");
export const cleanPath = (s: string) => s.replace(/[\r\n]+/g, "").trim();

// Pull-request URLs for GitHub and Azure DevOps (also matches GitLab merge requests).
const PR_URL =
  /https?:\/\/[^\s)"'\]]*(?:\/pull\/\d+|\/pullrequest\/\d+|\/-\/merge_requests\/\d+)/i;
// Branch created via git checkout -b / switch -c, or targeted by gh pr create --head.
const BRANCH_CMD =
  /git\s+(?:checkout\s+-b|switch\s+-c)\s+(?:"([^"]+)"|'([^']+)'|(\S+))|gh\s+pr\s+create[^\n]*--head[= ]+(?:"([^"]+)"|'([^']+)'|(\S+))/i;

// Scan free text / command output for a PR URL and branch name.
export function detectArtifacts(entry: Entry, text: string) {
  if (!entry.prUrl) {
    const m = text.match(PR_URL);
    if (m) entry.prUrl = m[0];
  }
  if (!entry.branch) {
    const b = text.match(BRANCH_CMD);
    if (b) entry.branch = (b[1] || b[2] || b[3] || b[4] || b[5] || b[6] || "").trim();
  }
}

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

export function safeParseLogs(s: string): LogLine[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as LogLine[]) : [];
  } catch {
    return [];
  }
}
