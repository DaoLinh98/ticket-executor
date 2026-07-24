import type { LogLine, ReviewSummaryEntry } from "@/lib/types";

// Heuristic: derive how many of the 7 steps a running log has reached.
const STEP_PATTERNS = [
  /\bcd \b|working director|resolv/i,
  /\bado\b|mcp|reading ticket|ticket #|fetch.*ticket/i,
  /checkout -b|create.*branch|switched to/i,
  /implement|editing|writing|creat.*file|modif|\.tsx?|\.cs\b/i,
  /\btest\b|lint|verif|npm run|dotnet|build/i,
  /commit/i,
  /pull request|\bpr #|gh pr/i,
];
export function deriveStep(logLines: LogLine[]): number {
  const text = logLines.map((l) => l.text).join("\n");
  let reached = 0;
  for (let i = 0; i < STEP_PATTERNS.length; i++) if (STEP_PATTERNS[i].test(text)) reached = i + 1;
  return reached;
}

// Render a comment body: color @mentions and keep line breaks (ADO-style).
const MENTION_RE = /(@[A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?)/g;
export function renderCommentBody(text: string) {
  return text.split("\n").map((line, li) => (
    <span key={li}>
      {li > 0 && <br />}
      {line.split(MENTION_RE).map((part, pi) =>
        /^@[A-Z]/.test(part) ? (
          <span key={pi} style={{ color: "#6C8EEF", fontWeight: 600 }}>{part}</span>
        ) : (
          part
        )
      )}
    </span>
  ));
}

// Identifies a review summary's current state of activity — used to detect a
// *new* comment even when the raw unresolved count happens to net out the same
// (e.g. one thread got resolved while a fresh one landed).
export function reviewFingerprint(rv: ReviewSummaryEntry): string {
  return `${rv.unresolvedCount}::${rv.latestAt}::${rv.latestComment}`;
}

// Format a token count compactly ("12.3K", "1.2M") for the Result tab's usage badges.
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

// Format a USD cost with just enough precision to be meaningful at Claude's
// per-run scale (fractions of a cent still show as non-zero).
export function formatCost(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

// Format an ISO date as a short relative label ("2 days ago") for the PR overview.
export function timeAgo(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
