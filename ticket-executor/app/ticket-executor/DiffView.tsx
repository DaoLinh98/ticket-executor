"use client";

import { useEffect, useMemo, useRef } from "react";
import { FONT } from "@/lib/ui";

type Seg = { text: string; changed: boolean };
type DiffRow = {
  key: number;
  text: string;
  kind: "add" | "del" | "hunk" | "meta" | "context";
  segments?: Seg[];
};

// Character-level LCS diff between a paired -/+ line, so only the substring that
// actually changed gets highlighted (matches GitHub/VSCode word-diff behavior)
// instead of tinting the whole line.
function inlineDiff(a: string, b: string): { aSegs: Seg[]; bSegs: Seg[] } {
  const n = a.length, m = b.length;
  if (n * m > 250000) return { aSegs: [{ text: a, changed: false }], bSegs: [{ text: b, changed: false }] };
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const aMatched = new Array(n).fill(false);
  const bMatched = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j] && dp[i][j] === dp[i + 1][j + 1] + 1) {
      aMatched[i] = true;
      bMatched[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const toSegs = (s: string, matched: boolean[]): Seg[] => {
    const segs: Seg[] = [];
    let buf = "";
    let changed: boolean | null = null;
    for (let k = 0; k < s.length; k++) {
      const isChanged = !matched[k];
      if (changed === null) changed = isChanged;
      if (isChanged !== changed) {
        segs.push({ text: buf, changed });
        buf = "";
        changed = isChanged;
      }
      buf += s[k];
    }
    if (buf) segs.push({ text: buf, changed: changed ?? false });
    return segs;
  };
  return { aSegs: toSegs(a, aMatched), bSegs: toSegs(b, bMatched) };
}

function buildRows(diff: string): DiffRow[] {
  const lines = diff.trim() ? diff.split(/\r?\n/) : [];
  const rows: DiffRow[] = lines.map((line, i) => {
    const isAdd = line.startsWith("+") && !line.startsWith("+++");
    const isDel = line.startsWith("-") && !line.startsWith("---");
    const isHunk = line.startsWith("@@");
    const isMeta = line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---");
    return { key: i, text: line, kind: isAdd ? "add" : isDel ? "del" : isHunk ? "hunk" : isMeta ? "meta" : "context" };
  });

  // Pair each run of removed lines with the run of added lines immediately
  // following it, index-for-index, and compute an inline diff for each pair.
  let idx = 0;
  while (idx < rows.length) {
    if (rows[idx].kind !== "del") {
      idx++;
      continue;
    }
    let delEnd = idx;
    while (delEnd < rows.length && rows[delEnd].kind === "del") delEnd++;
    let addEnd = delEnd;
    while (addEnd < rows.length && rows[addEnd].kind === "add") addEnd++;
    const pairCount = Math.min(delEnd - idx, addEnd - delEnd);
    for (let k = 0; k < pairCount; k++) {
      const delRow = rows[idx + k];
      const addRow = rows[delEnd + k];
      const { aSegs, bSegs } = inlineDiff(delRow.text.slice(1), addRow.text.slice(1));
      delRow.segments = aSegs;
      addRow.segments = bSegs;
    }
    idx = addEnd;
  }
  return rows;
}

// Renders one file's unified diff with line + inline highlighting, and
// auto-scrolls to the first changed line when the diff text changes. Shared by
// DiffModal (single-file popup) and CommitFilesModal (per-commit file list).
export default function DiffView({ diff }: { diff: string }) {
  const rows = useMemo(() => buildRows(diff), [diff]);
  const firstChangeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    firstChangeRef.current?.scrollIntoView({ block: "center" });
  }, [diff]);

  let firstChangeAssigned = false;

  if (!rows.length) {
    return <div style={{ padding: "0 20px", color: "#5B6273", fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm }}>No diff content available for this file.</div>;
  }

  return (
    <div className="te-scroll te-diffview" style={{ flex: 1, overflow: "auto", padding: "14px 0", fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, lineHeight: 1.6 }}>
      {rows.map((row) => {
        const isAdd = row.kind === "add";
        const isDel = row.kind === "del";
        const isHunk = row.kind === "hunk";
        const isMeta = row.kind === "meta";
        let ref: ((el: HTMLDivElement | null) => void) | undefined;
        if ((isAdd || isDel) && !firstChangeAssigned) {
          firstChangeAssigned = true;
          ref = (el) => { firstChangeRef.current = el; };
        }
        return (
          <div
            key={row.key}
            ref={ref}
            style={{
              padding: "1px 20px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: isAdd ? "#5BE8B8" : isDel ? "#FF8F8F" : isHunk ? "#9BA6E8" : isMeta ? "#5B6273" : "#C7CCD8",
              background: isAdd ? "rgba(53,214,164,.08)" : isDel ? "rgba(255,107,107,.08)" : "transparent",
            }}
          >
            {row.segments ? (
              <>
                <span>{row.text.slice(0, 1)}</span>
                {row.segments.map((seg, si) => (
                  <span
                    key={si}
                    style={seg.changed ? { background: isAdd ? "rgba(53,214,164,.4)" : "rgba(255,107,107,.4)", borderRadius: "2px" } : undefined}
                  >
                    {seg.text}
                  </span>
                ))}
              </>
            ) : (
              row.text || " "
            )}
          </div>
        );
      })}
    </div>
  );
}
