import path from "node:path";

export function reviewTargets(row: { prUrl: string; companionPrUrls: string[] }): string[] {
  const urls = [row.prUrl, ...row.companionPrUrls].filter(Boolean);
  return urls.filter((u, i) => urls.indexOf(u) === i);
}

export function reviewRoundLimit(row: { prUrl: string; companionPrUrls: string[] }, perPr: number): number {
  return perPr * Math.max(1, reviewTargets(row).length);
}

export function prNumberFromUrl(url: string): string {
  return /\/(?:pullrequest|pull)\/(\d+)/i.exec(url)?.[1] ?? "";
}

export function repoNameFromPrUrl(url: string): string {
  const ado = /\/_git\/([^/?#]+)/i.exec(url)?.[1];
  if (ado) return safeDecode(ado);
  const gh = /github\.com\/[^/]+\/([^/?#]+)\/pull\//i.exec(url)?.[1];
  return gh ? safeDecode(gh) : "";
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function repoKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function localRepoForPr(
  prUrl: string,
  rootRepo: string,
  companions: { name: string; path: string }[]
): string {
  const wanted = repoKey(repoNameFromPrUrl(prUrl));
  if (!wanted) return "";
  if (repoKey(path.basename(rootRepo)) === wanted) return rootRepo;
  return companions.find((c) => repoKey(c.name) === wanted)?.path ?? "";
}

export function openCommentsTotal(counts: number[]): number {
  return counts.reduce((sum, n) => sum + n, 0);
}

export function pickReviewPr(
  row: { prUrl: string; openComments: number },
  tracked: { prUrl: string; openComments: number }[]
): string {
  const trackedOpen = openCommentsTotal(tracked.map((t) => t.openComments));
  if (row.openComments - trackedOpen > 0) return row.prUrl;
  return tracked.find((t) => t.openComments > 0)?.prUrl ?? row.prUrl;
}
