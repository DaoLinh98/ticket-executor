"use client";

import { COLORS, FONT, card, chipShape, ctaButtonStyle, pill } from "@/lib/ui";
import { IC, TONE } from "@/lib/workflow/meta";
import { FRESH_START } from "@/lib/workflow/present";
import type { Cell, Section, Tone } from "@/lib/workflow/types";
import OutputMarkdown from "./OutputMarkdown";
import { Badge, IconTile, Ico, MONO } from "./parts";

type Props = {
  sections: Section[];
  copied: boolean;
  onCopy: (questions: string[]) => void;
  retryFrom: string | null;
  onRetryPick: (id: string) => void;
};

const toneColor = (t?: Tone) => (t ? TONE[t].c : COLORS.text);

// Every titled section is a card: an icon tile in the section's tone, the title, and how many rows it holds.
function Title({ title, icon, tone, count }: { title?: string; icon?: string; tone?: Tone; count?: number }) {
  if (!title) return null;
  return (
    <h3 style={{ margin: "0 0 10px", display: "flex", alignItems: "center", gap: "8px", fontSize: FONT.base, fontWeight: 600, color: COLORS.text }}>
      <IconTile d={icon ?? IC.list} tone={tone ?? "muted"} size={24} iconSize={14} />
      <span style={{ flex: 1, minWidth: 0 }}>{title}</span>
      {count ? <span style={pill({ color: COLORS.textDim, background: "var(--te-border-subtle)", size: "xs" })}>{count}</span> : null}
    </h3>
  );
}

const boxed = (sec: Section) => sec.kind !== "copy" && sec.kind !== "retry";

const cellOf = (c: Cell) => (typeof c === "string" ? { t: c, tone: undefined, mono: false } : { t: c.t, tone: c.tone, mono: !!c.mono });

export default function Sections({ sections, copied, onCopy, retryFrom, onRetryPick }: Props) {
  return (
    <>
      {sections.map((sec, i) => (
        <section key={i} style={{ marginTop: "12px", ...(boxed(sec) ? card({ padding: "12px", background: COLORS.panelBgDark, border: COLORS.borderSubtle }) : null) }}>
          {sec.kind === "kv" ? (
            <>
              <Title title={sec.title} icon={sec.icon} tone={sec.tone} />
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", alignItems: "center", fontSize: FONT.sm }}>
                {sec.rows.map((r) => (
                  <div key={r.k} style={{ display: "contents" }}>
                    <dt style={{ color: COLORS.textMuted }}>{r.k}</dt>
                    <dd style={{ margin: 0, minWidth: 0, color: COLORS.textSoft, wordBreak: "break-word", fontFamily: r.mono ? MONO : undefined }}>
                      {r.tone ? (
                        <Badge tone={r.tone} icon={r.tone === "success" ? IC.check : r.tone === "danger" ? IC.x : r.tone === "warning" ? IC.alert : undefined} size="xs">
                          {r.v}
                        </Badge>
                      ) : (
                        r.v
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}

          {sec.kind === "list" ? (
            <>
              <Title title={sec.title} icon={sec.icon} tone={sec.tone} count={sec.items.length} />
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
                {sec.items.map((it, j) => (
                  <li key={j} style={{ display: "flex", gap: "8px", fontSize: FONT.sm, lineHeight: 1.4 }}>
                    <span style={{ flex: "0 0 16px", color: toneColor(it.tone), fontFamily: MONO }}>
                      {it.icon ? <Ico d={it.icon} size={13} sw={2.4} style={{ marginTop: 2 }} /> : null}
                      {it.mark}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ color: toneColor(it.textTone), fontFamily: it.mono ? MONO : undefined }}>{it.text}</span>
                      {it.sub ? <span style={{ display: "block", fontSize: FONT.xs, color: COLORS.textMuted, wordBreak: it.subPlain ? "break-word" : "break-all", fontFamily: it.subPlain ? undefined : MONO }}>{it.sub}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {sec.kind === "table" ? (
            <>
              <Title title={sec.title} icon={sec.icon} tone={sec.tone} count={sec.rows.length} />
              <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
                {sec.rows.map((row, r) => {
                  const [head, ...rest] = row.map(cellOf);
                  return (
                    <li key={r} style={{ ...chipShape(6), padding: "8px 10px", background: COLORS.panelBg, borderLeft: `2px solid ${head.tone ? TONE[head.tone].c : sec.tone ? TONE[sec.tone].c : COLORS.border}`, fontSize: FONT.sm, lineHeight: 1.45 }}>
                      <span style={{ display: "block", color: head.tone ? TONE[head.tone].c : COLORS.text, fontWeight: 600, wordBreak: "break-word", fontFamily: head.mono ? MONO : undefined }}>{head.t}</span>
                      {rest.length ? (
                        <dl style={{ margin: "6px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px", alignItems: "baseline" }}>
                          {rest.map((cell, c) => (
                            <div key={c} style={{ display: "contents" }}>
                              <dt style={{ fontSize: FONT.xs, color: COLORS.textMuted }}>{sec.cols[c + 1]}</dt>
                              <dd style={{ margin: 0, minWidth: 0, color: cell.tone ? TONE[cell.tone].c : COLORS.textSoft, wordBreak: "break-word", fontFamily: cell.mono ? MONO : undefined, fontSize: cell.mono ? FONT.xs : undefined }}>{cell.t}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </>
          ) : null}

          {sec.kind === "md" ? (
            <>
              <Title title={sec.title} icon={sec.icon} tone={sec.tone} />
              <OutputMarkdown text={sec.text} />
            </>
          ) : null}

          {sec.kind === "prs" ? (
            <>
              <Title title={sec.title} icon={sec.icon} tone={sec.tone} count={sec.prs.length} />
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {sec.prs.map((p) => {
                  const tone: Tone = p.draft ? "success" : "warning";
                  return (
                    <a
                      key={p.url}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ ...chipShape(8), display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", minHeight: "44px", background: COLORS.panelBg, border: `1px solid ${COLORS.border}`, textDecoration: "none", color: COLORS.text }}
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
              <Title title={sec.title} icon={sec.icon} tone={sec.tone} />
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
            <RetrySection sec={sec} picked={retryFrom ?? sec.defaultId} onPick={onRetryPick} />
          ) : null}
        </section>
      ))}
    </>
  );
}

function RetrySection({ sec, picked, onPick }: { sec: Extract<Section, { kind: "retry" }>; picked: string; onPick: (id: string) => void }) {
  const a = TONE[sec.advice.tone];
  return (
    <>
      <p style={{ ...chipShape(6), margin: "0 0 8px", padding: "8px 10px", fontSize: FONT.sm, lineHeight: 1.45, background: a.bg, color: COLORS.textSoft }}>
        <b style={{ color: a.c }}>{sec.advice.title}.</b> {sec.advice.text}
      </p>
      <div role="radiogroup" aria-label="Retry from" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {sec.options.map((o) => {
          const on = o.id === picked;
          const suggested = o.id === (sec.suggestedId ?? FRESH_START);
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
              {suggested ? <span style={pill({ color: COLORS.accent, background: "var(--te-accent-soft)", size: "xs" })}>Suggested</span> : null}
            </button>
          );
        })}
      </div>
      <span style={{ display: "block", marginTop: 6, fontSize: FONT.xs, color: COLORS.textMuted }}>Push &amp; open draft PR is external — it already left the machine and is never re-run from here.</span>
    </>
  );
}
