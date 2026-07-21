// Builds a git-style unified diff from two full file contents. Azure DevOps'
// REST API exposes file content per commit but no textual patch (unlike
// GitHub's commit API, which returns one directly) — this fills that gap for
// the Commits tab.
const CONTEXT_LINES = 3;
const MAX_DIFF_LINES = 4000; // guard against O(n*m) LCS blowing up on huge files

type Op = { type: "equal" | "add" | "del"; line: string };

function diffLines(oldLines: string[], newLines: string[]): Op[] {
  const n = oldLines.length, m = newLines.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: "equal", line: oldLines[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", line: oldLines[i] });
      i++;
    } else {
      ops.push({ type: "add", line: newLines[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", line: oldLines[i++] });
  while (j < m) ops.push({ type: "add", line: newLines[j++] });
  return ops;
}

// Groups the flat op list into git-style hunks with a few lines of context
// around each changed run, emitting "@@ -a,b +c,d @@" headers.
function opsToHunks(ops: Op[]): string[] {
  const changedIdx = ops.map((o, idx) => (o.type !== "equal" ? idx : -1)).filter((idx) => idx >= 0);
  if (!changedIdx.length) return [];

  const ranges: Array<[number, number]> = [];
  let start = Math.max(0, changedIdx[0] - CONTEXT_LINES);
  let end = Math.min(ops.length - 1, changedIdx[0] + CONTEXT_LINES);
  for (const idx of changedIdx.slice(1)) {
    const s = Math.max(0, idx - CONTEXT_LINES);
    const e = Math.min(ops.length - 1, idx + CONTEXT_LINES);
    if (s <= end + 1) end = Math.max(end, e);
    else {
      ranges.push([start, end]);
      start = s; end = e;
    }
  }
  ranges.push([start, end]);

  const hunks: string[] = [];
  let oldLine = 1, newLine = 1;
  let opIdx = 0;
  for (const [rs, re] of ranges) {
    // Advance line counters through the untouched ops before this range.
    while (opIdx < rs) {
      if (ops[opIdx].type !== "add") oldLine++;
      if (ops[opIdx].type !== "del") newLine++;
      opIdx++;
    }
    const body: string[] = [];
    let oldCount = 0, newCount = 0;
    const hunkOldStart = oldLine, hunkNewStart = newLine;
    for (let k = rs; k <= re; k++) {
      const op = ops[k];
      if (op.type === "equal") { body.push(" " + op.line); oldCount++; newCount++; oldLine++; newLine++; }
      else if (op.type === "del") { body.push("-" + op.line); oldCount++; oldLine++; }
      else { body.push("+" + op.line); newCount++; newLine++; }
    }
    opIdx = re + 1;
    hunks.push(`@@ -${hunkOldStart},${oldCount} +${hunkNewStart},${newCount} @@\n${body.join("\n")}`);
  }
  return hunks;
}

export function buildUnifiedDiff(
  path: string,
  oldContent: string | null,
  newContent: string | null
): { diff: string; additions: number; deletions: number } {
  const oldLines = oldContent != null ? oldContent.split(/\r?\n/) : [];
  const newLines = newContent != null ? newContent.split(/\r?\n/) : [];
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    return { diff: "(diff omitted — file too large to render)", additions: 0, deletions: 0 };
  }

  const ops = diffLines(oldLines, newLines);
  const additions = ops.filter((o) => o.type === "add").length;
  const deletions = ops.filter((o) => o.type === "del").length;
  const hunks = opsToHunks(ops);
  if (!hunks.length) return { diff: "", additions: 0, deletions: 0 };

  const header = `--- ${oldContent != null ? `a/${path}` : "/dev/null"}\n+++ ${newContent != null ? `b/${path}` : "/dev/null"}\n`;
  return { diff: header + hunks.join("\n"), additions, deletions };
}
