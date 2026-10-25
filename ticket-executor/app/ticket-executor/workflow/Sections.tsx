"use client";

import { COLORS, FONT, chipShape, ctaButtonStyle, pill } from "@/lib/ui";
import { IC, TONE } from "@/lib/workflow/meta";
import type { Cell, Section, Tone } from "@/lib/workflow/types";
import { Ico, MONO } from "./parts";

type Props = {
  sections: Section[];
  copied: boolean;
  onCopy: (questions: string[]) => void;
  retryFrom: string | null;
  onRetryPick: (id: string) => void;
  onRetry: (label: string) => void;
};

const toneColor = (t?: Tone) => (t ? TONE[t].c : COLORS.text);

function Title({ title, icon, tone }: { title?: string; icon?: string; tone?: Tone }) {
  if (!title) return null;
  return (
    <h3 style={{ margin: "0 0 6px", display: "flex", alignItems: "center", gap: "6px", fontSize: FONT.sm, fontWeight: 600, color: tone ? TONE[tone].c : COLORS.textMuted }}>
      {icon ? <Ico d={icon} size={13} /> : null}
      {title}
    </h3>
  );
}

const cellOf = (c: Cell) => (typeof c === "string" ? { t: c, tone: undefined, mono: false } : { t: c.t, tone: c.tone, mono: !!c.mono });

export default function Sections({ sections, copied, onCopy, retryFrom, onRetryPick, onRetry }: Props) {
  return (
    <>
      {sections.map((sec, i) => (
        <section key={i} style={{ marginTop: "12px" }}>
          {sec.kind === "kv" ? (
            <>
              <Title title={sec.title} />
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: FONT.sm }}>
                {sec.rows.map((r) => (
                  <div key={r.k} style={{ display: "contents" }}>
                    <dt style={{ color: COLORS.textMuted }}>{r.k}</dt>
                    <dd style={{ margin: 0, color: toneColor(r.tone), wordBreak: "break-word", fontFamily: r.mono ? MONO : undefined }}>{r.v}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}

          {sec.kind === "list" ? (
            <>
              <Title title={sec.title} icon={sec.icon} tone={sec.tone} />
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
                {sec.items.map((it, j) => (
                  <li key={j} style={{ display: "flex", gap: "8px", fontSize: FONT.sm, lineHeight: 1.4 }}>
                    <span style={{ flex: "0 0 16px", color: toneColor(it.tone), fontFamily: MONO }}>
                      {it.icon ? <Ico d={it.icon} size={13} sw={2.4} style={{ marginTop: 2 }} /> : null}
                      {it.mark}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ color: toneColor(it.textTone), fontFamily: it.mono ? MONO : undefined }}>{it.text}</span>
                      {it.sub ? <span style={{ display: "block", fontSize: FONT.xs, color: COLORS.textMuted, wordBreak: "break-all", fontFamily: MONO }}>{it.sub}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {sec.kind === "table" ? (
            <>
              <Title title={sec.title} />
              <div className="te-scroll" style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT.sm }}>
                  <thead>
                    <tr>
                      {sec.cols.map((h) => (
                        <th key={h} scope="col" style={{ textAlign: "left", fontWeight: 600, color: COLORS.textMuted, padding: "4px 6px", borderBottom: `1px solid ${COLORS.border}` }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sec.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((raw, c) => {
                          const cell = cellOf(raw);
                          return (
                            <td key={c} style={{ verticalAlign: "top", padding: "5px 6px", borderBottom: `1px solid ${COLORS.borderSubtle}`, color: toneColor(cell.tone), wordBreak: "break-word", fontFamily: cell.mono ? MONO : undefined }}>
                              {cell.t}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {sec.kind === "md" ? (
            <>
              <Title title={sec.title} icon={sec.icon} tone={sec.tone} />
              <div style={{ ...chipShape(6), padding: "10px 12px", background: "var(--te-panel-bg-dark)", fontSize: FONT.sm, lineHeight: 1.55, whiteSpace: "pre-line", color: COLORS.textSoft }}>{sec.text}</div>
            </>
          ) : null}

          {sec.kind === "prs" ? (
            <>
              <Title title={sec.title} />
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {sec.prs.map((p) => {
                  const tone: Tone = p.draft ? "success" : "warning";
                  return (
                    <a
                      key={p.url}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ ...chipShape(8), display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", minHeight: "44px", background: "var(--te-panel-bg-dark)", border: `1px solid ${COLORS.border}`, textDecoration: "none", color: COLORS.text }}
                    >
                      <span style={{ color: TONE[tone].c, display: "inline-flex" }}>
                        <Ico d={IC.pr} size={18} sw={1.8} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <b style={{ fontSize: FONT.sm }}>
                          {p.repo} #{p.num}
                        </b>
                        <span style={{ display: "block", fontSize: FONT.xs, color: COLORS.textMuted }}>{p.meta}</span>
                      </span>
                      <span style={pill({ color: TONE[tone].c, background: TONE[tone].bg, size: "xs" })}>{p.draft ? "Draft" : "Not draft"}</span>
                    </a>
                  );
                })}
              </div>
            </>
          ) : null}

          {sec.kind === "copy" ? (
            <button type="button" className="te-action-btn" onClick={() => onCopy(sec.questions)} style={ctaButtonStyle("warning")}>
              {copied ? "Copied ✓" : "Copy questions"}
            </button>
          ) : null}

          {sec.kind === "bar" ? (
            <>
              <Title title={sec.title} />
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                {sec.bars.map((b) => (
                  <div key={b.k} style={{ display: "grid", gridTemplateColumns: "96px 1fr 56px", gap: "8px", alignItems: "center", fontSize: FONT.sm }}>
                    <span style={{ color: COLORS.textDim }}>{b.k}</span>
                    <span style={{ height: 8, background: COLORS.borderSubtle }}>
                      <span style={{ display: "block", height: 8, width: `${b.w}%`, background: `var(--te-phase-${b.phase})` }} />
                    </span>
                    <span style={{ textAlign: "right", fontFamily: MONO }}>{b.v}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {sec.kind === "retry" ? (
            <RetrySection sec={sec} picked={retryFrom ?? sec.defaultId} onPick={onRetryPick} onRetry={onRetry} />
          ) : null}
        </section>
      ))}
    </>
  );
}

function RetrySection({ sec, picked, onPick, onRetry }: { sec: Extract<Section, { kind: "retry" }>; picked: string; onPick: (id: string) => void; onRetry: (label: string) => void }) {
  const label = sec.options.find((o) => o.id === picked)?.label ?? "";
  return (
    <>
      <Title title={sec.title} icon={sec.icon} tone="accent" />
      <div role="radiogroup" aria-label="Retry from" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {sec.options.map((o) => {
          const on = o.id === picked;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!o.enabled}
              className="te-wf-tap"
              title={o.external ? "External step — it already left the machine and is never re-run from here" : o.enabled ? `Restart the run from ${o.label}` : "Not a safe restart point for this failure"}
              onClick={() => o.enabled && onPick(o.id)}
              style={{
                ...chipShape(6),
                minHeight: "30px",
                padding: "0 10px",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                fontSize: FONT.sm,
                border: `1px solid ${on ? COLORS.accent : COLORS.border}`,
                background: on ? "var(--te-accent-soft)" : "transparent",
                color: o.enabled ? COLORS.text : COLORS.textMuted,
                cursor: o.enabled ? "pointer" : "not-allowed",
              }}
            >
              {o.external ? <Ico d={IC.lock} size={11} sw={2.4} /> : null}
              {o.label}
            </button>
          );
        })}
      </div>
      <span style={{ display: "block", marginTop: 6, fontSize: FONT.xs, color: COLORS.textMuted }}>Push &amp; open draft PR is external — it already left the machine and is never re-run from here.</span>
      <button type="button" className="te-action-btn" onClick={() => onRetry(label)} style={{ ...ctaButtonStyle("primary"), marginTop: 8 }}>
        Retry from {label}
      </button>
    </>
  );
}
