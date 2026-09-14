// The log-scraping deriveStep() heuristic that used to live here is gone: a
// run's progress is the state of its graph nodes, reported by the API, not a
// guess made from regexes over the terminal output.

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
