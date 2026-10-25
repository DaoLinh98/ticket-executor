"use client";

import { COLORS, FONT, chipShape, fieldInput, sectionCaption, tabStyle } from "@/lib/ui";
import { STATUS, TONE, clock } from "@/lib/workflow/meta";
import type { Inspector } from "@/lib/workflow/present";
import type { LogLevel, LogLine, Section } from "@/lib/workflow/types";
import { Badge, IconTile, MONO, StatusBadge } from "./parts";
import Sections from "./Sections";

export type InspectorTab = "node" | "run";
export type SheetState = "peek" | "full" | "closed";
export type LogFilter = "all" | LogLevel;

type Props = {
  tab: InspectorTab;
  onTab: (t: InspectorTab) => void;
  inspector: Inspector;
  runSections: Section[];
  sheet: SheetState;
  onToggleSheet: () => void;
  following: boolean;
  onAttempt: (i: number) => void;
  json: boolean;
  onJson: () => void;
  logs: LogLine[];
  logFilter: LogFilter;
  onLogFilter: (f: LogFilter) => void;
  query: string;
  onQuery: (q: string) => void;
  copied: boolean;
  onCopy: (questions: string[]) => void;
  retryFrom: string | null;
  onRetryPick: (id: string) => void;
  onRetry: (label: string) => void;
};

const FILTERS: [LogFilter, string][] = [
  ["all", "All"],
  ["INFO", "Info"],
  ["WARN", "Warn"],
  ["ERROR", "Error"],
];

const LEVEL_COLOR: Record<LogLevel, string> = { INFO: "var(--te-text-dim)", WARN: "var(--te-warning)", ERROR: "var(--te-danger)" };

const heading = { ...sectionCaption(), margin: "18px 0 6px", fontSize: FONT.xs } as const;

export default function NodeInspector(p: Props) {
  const ins = p.inspector;
  const isNode = p.tab === "node";
  const secs = isNode ? ins.sections : p.runSections;
  return (
    <aside
      aria-label="Inspector"
      className="te-wf-inspector"
      data-sheet={p.sheet}
      style={{ width: 392, flex: "0 0 auto", display: "flex", flexDirection: "column", minHeight: 0, background: COLORS.panelBg, borderLeft: `1px solid ${COLORS.border}` }}
    >
      <div className="te-wf-mob">
        <button
          type="button"
          aria-label={p.sheet === "full" ? "Collapse inspector" : "Expand inspector"}
          onClick={p.onToggleSheet}
          style={{ width: "100%", height: 28, border: 0, background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <span aria-hidden="true" style={{ width: 44, height: 4, background: COLORS.border, borderRadius: 2 }} />
        </button>
      </div>
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
        <div role="tablist" aria-label="Inspector" style={{ display: "flex", gap: 4 }}>
          {([["node", "Step"], ["run", "Run"]] as [InspectorTab, string][]).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={p.tab === k} className="te-wf-tap" onClick={() => p.onTab(k)} style={tabStyle({ active: p.tab === k })}>
              {label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {p.following ? (
          <span className="te-mobile-hide" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: FONT.xs, color: COLORS.accent }}>
            <span aria-hidden="true" className="te-wf-blink" style={{ width: 6, height: 6, background: "currentColor" }} />
            Following live
          </span>
        ) : null}
      </div>

      <div className="te-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "12px 16px calc(24px + env(safe-area-inset-bottom))" }}>
        {isNode ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <IconTile d={ins.kindIcon} tone={ins.kindTone} size={32} iconSize={17} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: "block", fontSize: FONT.lg }}>{ins.label}</b>
                <span style={{ fontSize: FONT.xs, color: COLORS.textMuted, fontFamily: MONO }}>{ins.sub}</span>
              </span>
              <StatusBadge tone={STATUS[ins.status].tone} icon={STATUS[ins.status].icon} text={STATUS[ins.status].text} />
            </div>
            <span style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
              {ins.chips.map((c) => (
                <Badge key={c.text} tone={c.tone} icon={c.icon} size="xs">
                  {c.text}
                </Badge>
              ))}
            </span>
            {ins.note ? (
              <p style={{ ...chipShape(6), margin: "10px 0 0", padding: "8px 10px", fontSize: FONT.sm, background: ins.note.tone === "neutral" ? "var(--te-panel-bg-dark)" : TONE[ins.note.tone].bg, color: COLORS.textSoft }}>{ins.note.text}</p>
            ) : null}

            {ins.attempts.length ? (
              <>
                <div role="tablist" aria-label="Attempts" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 12 }}>
                  {ins.attempts.map((a, i) => {
                    const on = i === ins.attemptIndex;
                    return (
                      <button
                        key={i}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        className="te-wf-tap"
                        onClick={() => p.onAttempt(i)}
                        style={{ ...chipShape(6), minWidth: 28, height: 28, padding: "0 8px", display: "inline-flex", alignItems: "center", gap: 4, fontSize: FONT.sm, fontWeight: 600, cursor: "pointer", border: `1px solid ${on ? COLORS.accent : COLORS.border}`, background: on ? "var(--te-accent-soft)" : "transparent", color: on ? COLORS.text : COLORS.textDim }}
                      >
                        <span aria-hidden="true" style={{ width: 6, height: 6, background: TONE[STATUS[a.status].tone].c }} />#{a.n}
                      </button>
                    );
                  })}
                </div>
                <dl style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, margin: "12px 0 0" }}>
                  {ins.metrics.map((m) => (
                    <div key={m.k} style={{ ...chipShape(6), padding: "6px 8px", background: "var(--te-panel-bg-dark)" }}>
                      <dt style={{ fontSize: FONT.xs, color: COLORS.textMuted }}>{m.k}</dt>
                      <dd style={{ margin: "2px 0 0", fontSize: FONT.sm, fontFamily: MONO }}>{m.v}</dd>
                    </div>
                  ))}
                </dl>
                {ins.error ? <p style={{ ...chipShape(6), margin: "8px 0 0", padding: 8, fontSize: FONT.xs, fontFamily: MONO, background: "var(--te-danger-soft)", color: COLORS.danger }}>{ins.error}</p> : null}
              </>
            ) : null}

            <div style={{ display: "flex", alignItems: "center", marginTop: 16 }}>
              <b style={{ ...sectionCaption(), flex: 1, fontSize: FONT.xs }}>Output</b>
              <button
                type="button"
                aria-pressed={p.json}
                className="te-wf-tap"
                onClick={p.onJson}
                style={{ ...chipShape(6), height: 28, padding: "0 10px", border: `1px solid ${COLORS.border}`, background: p.json ? "var(--te-accent-soft)" : "transparent", color: COLORS.text, fontSize: FONT.xs, fontFamily: MONO, cursor: "pointer" }}
              >
                {"{ } JSON"}
              </button>
            </div>
            {p.json ? (
              <pre className="te-scroll" style={{ ...chipShape(6), margin: "8px 0 0", padding: 10, maxHeight: 320, overflow: "auto", fontSize: FONT.xs, fontFamily: MONO, background: "var(--te-panel-bg-dark)", color: COLORS.textSoft, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{ins.json}</pre>
            ) : null}
          </>
        ) : null}

        {!p.json || !isNode ? (
          <Sections sections={secs} copied={p.copied} onCopy={p.onCopy} retryFrom={p.retryFrom} onRetryPick={p.onRetryPick} onRetry={p.onRetry} />
        ) : null}

        {isNode ? (
          <>
            <h3 style={heading}>Transitions</h3>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
              {ins.transitions.map((t) => (
                <li key={t.seq} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: FONT.sm }}>
                  <span style={{ flex: "0 0 34px", color: COLORS.textMuted, fontFamily: MONO }}>#{t.seq}</span>
                  <span style={{ flex: "0 0 auto", color: t.incoming ? COLORS.textDim : COLORS.accent, fontFamily: MONO }}>
                    {t.incoming ? "←" : "→"} {t.other}
                  </span>
                  <span style={{ flex: 1, color: COLORS.textSoft }}>{t.reason}</span>
                </li>
              ))}
              {!ins.transitions.length ? <li style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>Not reached in this run.</li> : null}
            </ul>

            <h3 style={heading}>Activity log</h3>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              {FILTERS.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={p.logFilter === k}
                  className="te-wf-tap"
                  onClick={() => p.onLogFilter(k)}
                  style={{ ...chipShape(6), height: 28, padding: "0 9px", border: `1px solid ${COLORS.border}`, background: p.logFilter === k ? "var(--te-accent-soft)" : "transparent", color: p.logFilter === k ? COLORS.accent : COLORS.textDim, fontSize: FONT.xs, cursor: "pointer" }}
                >
                  {label}
                </button>
              ))}
              <label className="te-wf-sr" htmlFor="te-wf-logq">
                Search log
              </label>
              <input id="te-wf-logq" value={p.query} onChange={(e) => p.onQuery(e.target.value)} placeholder="Search…" style={{ ...fieldInput({ height: "28px", fontSize: FONT.xs }), flex: 1, minWidth: 90 }} />
            </div>
            <div style={{ ...chipShape(6), marginTop: 6, padding: 8, background: "var(--te-panel-bg-dark)", fontSize: FONT.xs, lineHeight: 1.55, fontFamily: MONO }}>
              {p.logs.map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                  <span style={{ flex: "0 0 auto", color: COLORS.textMuted }}>{clock(l.ts)}</span>
                  <span style={{ flex: "0 0 38px", color: LEVEL_COLOR[l.lvl] }}>{l.lvl}</span>
                  <span style={{ color: COLORS.textSoft, wordBreak: "break-word" }}>{l.text}</span>
                </div>
              ))}
              {!p.logs.length ? <span style={{ color: COLORS.textMuted }}>No lines match.</span> : null}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}
