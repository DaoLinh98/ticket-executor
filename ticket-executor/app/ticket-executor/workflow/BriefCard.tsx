"use client";

import { useMemo, useState } from "react";
import { COLORS, FONT, card, chipShape, codeBlock, tabStyle } from "@/lib/ui";
import { IC, TONE, ktok, plural } from "@/lib/workflow/meta";
import { briefOutline, briefTokens, lineDiff, type DiffLine } from "@/lib/workflow/present";
import { FoldToggle, Ico, IconTile } from "./parts";
import PanelDialog from "./PanelDialog";

type View = "outline" | "full" | "diff";

type Props = {
  /** Node label, for the dialog's subtitle. */
  label: string;
  brief: string;
  /** The previous attempt's brief ("" when none) and its number. */
  prev: string;
  prevAttempt: number;
};

// Unchanged runs longer than this fold to one marker line, keeping a line of context on each side.
const FOLD = 6;

function folded(lines: DiffLine[]): (DiffLine | { op: "fold"; n: number })[] {
  const out: (DiffLine | { op: "fold"; n: number })[] = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i].op !== "same") {
      out.push(lines[i++]);
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].op === "same") j++;
    const head = i > 0 ? 1 : 0;
    const tail = j < lines.length ? 1 : 0;
    if (j - i > FOLD) out.push(...lines.slice(i, i + head), { op: "fold", n: j - i - head - tail }, ...lines.slice(j - tail, j));
    else out.push(...lines.slice(i, j));
    i = j;
  }
  return out;
}

const DIFF_STYLE = {
  add: { mark: "+", color: TONE.success.c, background: TONE.success.bg },
  del: { mark: "−", color: TONE.danger.c, background: TONE.danger.bg },
  same: { mark: " ", color: COLORS.textSoft, background: "transparent" },
} as const;

/** "Context received": the brief an agent started from — debug detail, so folded to one line by default. Opened, it
 *  shows the outline; the full text, the change from the previous attempt, and a roomy dialog are one tap away. */
export default function BriefCard({ label, brief, prev, prevAttempt }: Props) {
  const [shown, setShown] = useState(false);
  const [picked, setView] = useState<View>("outline");
  const [open, setOpen] = useState<{ focus?: string } | null>(null);
  const outline = useMemo(() => briefOutline(brief), [brief]);
  const changed = !!prev && prev !== brief;
  const lines = useMemo(() => (changed ? lineDiff(prev, brief) : []), [changed, prev, brief]);
  const diff = useMemo(() => folded(lines), [lines]);
  const counts = changed ? { add: lines.filter((l) => l.op === "add").length, del: lines.filter((l) => l.op === "del").length } : null;

  // A brief kept before briefs were sectioned has no outline: it reads as full text.
  const views: [View, string][] = [
    ...(outline.length ? ([["outline", "Outline"]] as [View, string][]) : []),
    ["full", "Full text"],
    ...(changed ? ([["diff", `Changes vs #${prevAttempt}`]] as [View, string][]) : []),
  ];
  const view = views.some(([k]) => k === picked) ? picked : views[0][0];
  const pre = { ...codeBlock({ fontSize: FONT.xs }), margin: "8px 0 0", maxHeight: 420, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.55 } as const;

  return (
    <div style={{ ...card({ padding: "12px", background: COLORS.panelBgDark, border: COLORS.borderSubtle }), marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FONT.base, fontWeight: 600, color: COLORS.text }}>
        <FoldToggle open={shown} onToggle={() => setShown((s) => !s)} label="the brief this agent started from">
          <IconTile d={IC.file} tone="indigo" size={24} iconSize={14} />
          <span style={{ flex: 1, minWidth: 0 }}>Context received</span>
        </FoldToggle>
        <button
          type="button"
          className="te-wf-tap"
          aria-label="Open the brief in a larger view"
          title="Open in a larger view"
          onClick={() => setOpen({})}
          style={{ ...chipShape(6), width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.textDim, cursor: "pointer" }}
        >
          <Ico d={IC.out} size={12} sw={2.2} />
        </button>
      </div>
      <span style={{ display: "block", marginTop: 2, fontSize: FONT.xs, color: COLORS.textMuted }}>
        the brief this agent started from · {brief.length.toLocaleString()} chars · ~{ktok(briefTokens(brief))} tokens{outline.length ? ` · ${plural(outline.length, "section")}` : ""}
        {counts ? (
          <>
            {" · "}
            <span style={{ color: TONE.success.c }}>+{counts.add}</span> <span style={{ color: TONE.danger.c }}>−{counts.del}</span> lines vs #{prevAttempt}
          </>
        ) : null}
      </span>

      {shown ? (
      <>
      <div role="tablist" aria-label="Brief view" style={{ display: "flex", gap: 4, marginTop: 10, flexWrap: "wrap" }}>
        {views.map(([k, text]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className="te-wf-tap" onClick={() => setView(k)} style={tabStyle({ active: view === k, enabled: true })}>
            {text}
          </button>
        ))}
      </div>

      {view === "outline" ? (
        <ol style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {outline.map((s) => (
            <li key={`${s.line}-${s.title}`}>
              <button
                type="button"
                className="te-wf-tap"
                title={`Open the brief at "${s.title}"`}
                onClick={() => setOpen({ focus: s.title })}
                style={{ ...chipShape(6), padding: "4px 10px", border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.textSoft, fontSize: FONT.xs, cursor: "pointer" }}
              >
                {s.title}
              </button>
            </li>
          ))}
        </ol>
      ) : view === "full" ? (
        <pre className="te-scroll" style={pre}>
          {brief}
        </pre>
      ) : (
        <pre className="te-scroll" style={{ ...pre, padding: 0 }}>
          {diff.map((l, i) =>
            l.op === "fold" ? (
              <div key={i} style={{ padding: "2px 10px", color: COLORS.textMuted, fontStyle: "italic" }}>
                … {plural(l.n, "unchanged line")}
              </div>
            ) : (
              <div key={i} style={{ padding: "0 10px", color: DIFF_STYLE[l.op].color, background: DIFF_STYLE[l.op].background }}>
                {DIFF_STYLE[l.op].mark} {l.text}
              </div>
            ),
          )}
        </pre>
      )}
      </>
      ) : null}

      {open ? (
        <PanelDialog
          title="Context received"
          subtitle={`${label} · the brief this agent started from`}
          icon={IC.file}
          tone="indigo"
          source={brief}
          focus={open.focus}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
