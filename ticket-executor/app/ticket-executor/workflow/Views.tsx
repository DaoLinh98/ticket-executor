"use client";

import { COLORS, FONT, chipShape } from "@/lib/ui";
import { STATUS, TONE, clock } from "@/lib/workflow/meta";
import type { Timeline } from "@/lib/workflow/present";
import type { LogLevel, LogLine } from "@/lib/workflow/types";
import { Ico, MONO } from "./parts";

const LEVEL_COLOR: Record<LogLevel, string> = { INFO: "var(--te-text-dim)", WARN: "var(--te-warning)", ERROR: "var(--te-danger)" };

export function TimelineView({ timeline, selectedId, onPick }: { timeline: Timeline; selectedId: string; onPick: (id: string) => void }) {
  const cols = "minmax(120px, 220px) 1fr";
  return (
    <div className="te-scroll" style={{ position: "absolute", inset: 0, overflow: "auto", background: COLORS.panelBgDark, padding: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, fontSize: FONT.xs, color: COLORS.textMuted, paddingBottom: 6, borderBottom: `1px solid ${COLORS.border}` }}>
        <span>Step</span>
        <span style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO }}>
          {timeline.ticks.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </span>
      </div>
      {timeline.rows.map((r, i) => {
        const st = STATUS[r.status];
        return (
          <button
            key={i}
            type="button"
            className="te-wf-tap"
            onClick={() => onPick(r.nodeId)}
            style={{ width: "100%", display: "grid", gridTemplateColumns: cols, alignItems: "center", minHeight: 28, border: 0, borderBottom: `1px solid ${COLORS.borderSubtle}`, background: selectedId === r.nodeId ? "var(--te-accent-soft)" : "transparent", padding: 0, textAlign: "left", cursor: "pointer", color: COLORS.text }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: FONT.sm }}>
              <span style={{ color: TONE[st.tone].c, display: "inline-flex" }}>
                <Ico d={st.icon} size={12} sw={2.6} />
              </span>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
              <span style={{ color: COLORS.textMuted, fontFamily: MONO }}>#{r.attempt}</span>
            </span>
            <span style={{ position: "relative", height: 16 }}>
              <span className={r.running ? "te-wf-blink" : undefined} title={r.title} style={{ ...chipShape(6), position: "absolute", top: 2, height: 12, left: `${r.left}%`, width: `${r.width}%`, minWidth: 3, background: TONE[st.tone].c }} />
            </span>
          </button>
        );
      })}
      <span style={{ display: "block", marginTop: 10, fontSize: FONT.xs, color: COLORS.textMuted }}>Bar width = duration · colour + icon = status · total {timeline.total}</span>
    </div>
  );
}

export function RawLog({ lines, live, withTime }: { lines: LogLine[]; live: boolean; withTime: boolean }) {
  return (
    <div className="te-scroll" role="log" aria-label="Raw run log" style={{ position: "absolute", inset: 0, overflow: "auto", background: COLORS.panelBgDark, padding: "12px 16px", fontSize: FONT.sm, lineHeight: 1.6, fontFamily: MONO }}>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 10, whiteSpace: "pre-wrap" }}>
          {withTime ? <span style={{ flex: "0 0 auto", color: COLORS.textMuted }}>{l.ts ? clock(l.ts) : "--:--:--"}</span> : null}
          <span style={{ flex: "0 0 44px", color: LEVEL_COLOR[l.lvl] }}>{l.lvl}</span>
          <span style={{ flex: "0 0 100px", color: COLORS.indigo, overflow: "hidden" }}>{l.node}</span>
          <span style={{ color: COLORS.textSoft }}>{l.text}</span>
        </div>
      ))}
      {live ? (
        <div className="te-wf-blink" style={{ color: COLORS.accent }}>
          █
        </div>
      ) : null}
    </div>
  );
}
