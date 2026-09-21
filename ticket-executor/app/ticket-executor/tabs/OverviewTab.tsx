"use client";

import type { CSSProperties, MouseEvent } from "react";
import Combobox from "../../Combobox";
import SelectMenu from "../../SelectMenu";
import { CLAUDE_EFFORTS, CLAUDE_MODELS, modelIdForLabel, modelLabel, type ClaudeModel } from "@/lib/claudeOptions";
import type { Ticket, TicketComment } from "@/lib/types";
import { COLORS, FONT, RUN_COLOR, RUN_LABEL, avatar, card, ctaButtonStyle, initials, runDot, sectionCaption, tintedCard } from "@/lib/ui";
import { hasContent } from "@/lib/richText";
import RichText from "../RichText";
import type { Action, OverrideField, RunSummary } from "../types";
import LoadingRing from "../LoadingRing";

type Props = {
  ticket: Ticket;
  comments: TicketComment[];
  /** Vietnamese translations already in hand, keyed `<ticketId>:<index>`. A key
   *  that is absent has not been translated (or was toggled back off). */
  translations: Record<string, string>;
  translating: Record<string, boolean>;
  onTranslateComment: (key: string, html: string) => void;
  history: RunSummary[];
  onOpenRun: (ticketId: string, execId: string, e?: MouseEvent) => void;
  // resolved per-ticket config (override ?? default) + its editors
  rootRepo: string;
  project: string;
  skill: string;
  model: string;
  modelOptions: readonly ClaudeModel[];
  effort: string;
  setOverrideValue: (ticketId: string, field: OverrideField, value: string) => void;
  onProjectChange: (ticketId: string, value: string) => void;
  rootRepoOptions: string[];
  projectOptions: string[];
  skillOptions: string[];
  branch: string;
  cdCommand: string;
  command: string;
  onOpenTerminal: () => void;
  // CTA banner
  ctaTitle: string;
  ctaSub: string;
  action: Action;
  gated: boolean;
  bannerCtaStyle: CSSProperties;
  secondaryAction: { label: string; onClick: (e?: MouseEvent) => void; style: CSSProperties } | null;
  secondaryCtaButtonStyle: CSSProperties;
};

// Detail copy was sized/toned for glanceability and ended up hard to actually
// read (11px headings on #5B6273, body on #B8BDC9). Everything in this pane is
// text a developer has to read closely before starting a run, so headings and
// body both step up one size and one contrast level.
const sectionHeading: CSSProperties = {
  margin: "0 0 12px", fontFamily: "var(--font-space), sans-serif", fontSize: FONT.sm,
  fontWeight: 700, letterSpacing: ".16em", color: COLORS.textDim,
};

// Ticket detail: description, acceptance criteria, discussion, the per-run
// configuration grid, the command preview, past runs and the CTA banner.
export default function OverviewTab({
  ticket: t, comments, translations, translating, onTranslateComment, history, onOpenRun,
  rootRepo, project, skill, model, modelOptions = CLAUDE_MODELS, effort, setOverrideValue, onProjectChange,
  rootRepoOptions, projectOptions, skillOptions, branch, cdCommand, command, onOpenTerminal,
  ctaTitle, ctaSub, action, gated, bannerCtaStyle, secondaryAction, secondaryCtaButtonStyle,
}: Props) {
  const fieldLabel: CSSProperties = { fontSize: FONT.xs, letterSpacing: ".12em", color: COLORS.textDim, fontWeight: 600, marginBottom: "5px" };
  const fieldCard = card({ padding: "9px 11px" });
  // Root Repo has no default — a run can't start without it, so say so on the field.
  const rootRepoMissing = !rootRepo.trim();
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "28px", animation: "fadeUp .4s both" }}>
      {/* Description and Acceptance Criteria are rendered as the tracker's own
          rich text (already sanitized in lib/richText.ts), so the numbering,
          nesting, tables and screenshots the author wrote survive. They used to
          be flattened to plain lines — one card per line for the criteria —
          which silently dropped every sub-item and every image. */}
      <section>
        <h3 style={sectionHeading}>DESCRIPTION</h3>
        <div style={card({ padding: "15px 18px", border: COLORS.borderSubtle })}>
          {/* `undefined` is "still loading", not "empty" — saying "No description."
              while the fetch is in flight states something the app does not yet know. */}
          {t.description === undefined
            ? <p style={{ margin: 0, fontSize: FONT.md, color: COLORS.textDim }}>Loading description…</p>
            : hasContent(t.description)
              ? <RichText html={t.description} />
              : <p style={{ margin: 0, fontSize: FONT.md, color: COLORS.textDim }}>No description.</p>}
        </div>
      </section>
      {hasContent(t.criteria ?? "") && (
        <section>
          <h3 style={sectionHeading}>ACCEPTANCE CRITERIA</h3>
          {/* One panel holding the whole field, not one card per line: the criteria
              are a single numbered document to read top to bottom. */}
          <div style={card({ padding: "15px 18px", border: COLORS.borderSubtle })}>
            <RichText html={t.criteria ?? ""} />
          </div>
        </section>
      )}
      {comments.length > 0 && (
        <section>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {comments.map((cm, i) => {
              const key = `${t.id}:${i}`;
              const vi = translations[key];
              const busy = !!translating[key];
              return (
              <div key={i} style={{ display: "flex", gap: "11px", alignItems: "flex-start" }}>
                <span style={{ ...avatar(cm.author), flex: "0 0 auto", width: "28px", height: "28px", fontSize: FONT.xs }}>{initials(cm.author)}</span>
                <div style={{ flex: 1, minWidth: 0, ...card({ padding: "11px 14px", border: COLORS.borderSubtle }) }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.text }}>{cm.author}</span>
                    <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, textDecoration: "underline", textDecorationColor: "#2A2F3A" }}>commented {cm.date}</span>
                  </div>
                  <div style={{ marginTop: "5px" }}><RichText html={cm.text} /></div>
                  {/* The original is never replaced: a translation is a second
                      reading of somebody's words, and losing what they actually
                      wrote is how a misreading becomes the record. */}
                  <button
                    onClick={() => onTranslateComment(key, cm.text)}
                    disabled={busy}
                    title={vi ? "Hide the Vietnamese translation" : "Translate this comment into Vietnamese"}
                    style={{ ...ctaButtonStyle("ghost", { height: "26px", cornerPx: 6 }), marginTop: "9px", fontSize: FONT.xs, color: vi ? COLORS.accent : COLORS.textDim, opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
                  >
                    {busy ? <LoadingRing size={12} /> : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 5h10M8 3v2M10 5c0 4-3.5 8-7 9M6 9c0 2 2.5 4.5 6 5.5" />
                        <path d="M21 21l-4.5-10L12 21M13.6 17.4h5.8" />
                      </svg>
                    )}
                    {vi ? "Hide translation" : "Translate to Vietnamese"}
                  </button>
                  {vi && (
                    <div style={{ marginTop: "9px", paddingTop: "9px", borderTop: `1px solid ${COLORS.borderSubtle}` }}>
                      <div style={{ ...sectionCaption(), marginBottom: "4px" }}>VIETNAMESE</div>
                      {/* Plain text, not RichText: this string came from a model,
                          not from sanitizeHtml() at a provider, and RichText
                          deliberately does not sanitize what it is handed. */}
                      <div style={{ fontSize: FONT.md, lineHeight: 1.7, color: COLORS.textSoft, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{vi}</div>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </section>
      )}
      <section className="te-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px" }}>
        <div style={{ ...fieldCard, ...(rootRepoMissing ? { border: `1px solid ${COLORS.warning}` } : null) }}>
          <div style={fieldLabel}>
            ROOT REPO
            {rootRepoMissing && <span style={{ color: COLORS.warning, marginLeft: "6px" }}>· REQUIRED</span>}
          </div>
          <Combobox value={rootRepo} onChange={(v) => setOverrideValue(t.id, "rootRepo", v)} options={rootRepoOptions} placeholder="C:\repos\my-service" ariaLabel="Root repo" />
        </div>
        <div style={fieldCard}><div style={fieldLabel}>PROJECT</div><Combobox value={project} onChange={(v) => onProjectChange(t.id, v)} options={projectOptions} ariaLabel="Project" /></div>
        <div style={fieldCard}><div style={fieldLabel}>SKILL</div><Combobox value={skill} onChange={(v) => setOverrideValue(t.id, "skill", v)} options={skillOptions} ariaLabel="Skill" /></div>
        <div style={fieldCard}><div style={fieldLabel}>MODEL</div><SelectMenu value={modelLabel(model, modelOptions)} onChange={(v) => setOverrideValue(t.id, "model", modelIdForLabel(v, modelOptions))} options={modelOptions.map((m) => m.label)} ariaLabel="Claude model" /></div>
        <div style={fieldCard}><div style={fieldLabel}>EFFORT</div><SelectMenu value={effort} onChange={(v) => setOverrideValue(t.id, "effort", v)} options={[...CLAUDE_EFFORTS]} ariaLabel="Effort" /></div>
        <div style={{ ...fieldCard, border: `1px solid ${COLORS.borderSubtle}` }}><div style={fieldLabel}>TARGET BRANCH</div><div style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.base, color: "#9BA6E8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{branch}</div></div>
        {rootRepoMissing && (
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: "9px", alignItems: "flex-start", ...tintedCard("warning", { padding: "10px 13px", radius: "10px" }) }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" strokeWidth="2" style={{ stroke: COLORS.warning, flex: "0 0 auto", marginTop: "1px" }}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
            <span style={{ fontSize: FONT.base, color: COLORS.warning, lineHeight: 1.55 }}>
              Set <strong>ROOT REPO</strong> before running — the local git clone this ticket should be implemented in (e.g. <span style={{ fontFamily: "var(--font-mono), monospace" }}>C:\repos\my-service</span>). It is remembered per project, so you only pick it once.
            </span>
          </div>
        )}
      </section>
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h3 style={{ ...sectionHeading, flex: 1 }}>COMMAND PREVIEW</h3>
          {/* Opens on the machine hosting this app, not on the device reading
              the page — from a phone the Ask Claude tab is the equivalent. */}
          <button
            onClick={onOpenTerminal}
            disabled={rootRepoMissing}
            title={rootRepoMissing ? "Set ROOT REPO first" : "Open a terminal in the Root repo on this app's machine, with claude already running"}
            style={{ ...ctaButtonStyle("ghost", { height: "26px", cornerPx: 6 }), marginBottom: "12px", fontSize: FONT.xs, opacity: rootRepoMissing ? 0.5 : 1, cursor: rootRepoMissing ? "default" : "pointer" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="4" width="19" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" />
            </svg>
            Open Terminal
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontFamily: "var(--font-mono), monospace", fontSize: FONT.base, ...card({ padding: "15px 18px", radius: "12px", border: "#23272F", background: COLORS.panelBgDark }) }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><span style={{ color: "#5B6273" }}>$</span><span style={{ color: "#8A90A0" }}>{cdCommand}</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><span style={{ color: "var(--accent)" }}>$</span><span style={{ color: "#C7CCD8" }}>{command}</span></div>
        </div>
      </section>
      {history.length > 0 && (
        <section>
          <h3 style={sectionHeading}>PAST RUNS</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {history.map((run) => (
              <button key={run.id} onClick={(e) => onOpenRun(t.id, run.id, e)} style={{ display: "flex", alignItems: "center", gap: "11px", cursor: "pointer", textAlign: "left", transition: "border-color .18s, background .18s", ...card({ padding: "10px 13px", border: COLORS.borderSubtle }) }}>
                <span style={{ ...runDot(run.state), width: "8px", height: "8px" }} />
                <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, color: "#C7CCD8", flex: "0 0 auto" }}>{run.skill}</span>
                <span style={{ fontSize: FONT.sm, color: "#5B6273", flex: 1 }}>{new Date(run.startedAt).toLocaleString()}</span>
                <span style={{ fontSize: FONT.sm, fontWeight: 600, color: RUN_COLOR[run.state] }}>{RUN_LABEL[run.state]}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", ...tintedCard("accent", { padding: "20px 22px", radius: "14px" }) }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: FONT.lg, fontWeight: 700, color: "#F3F5F9", marginBottom: "3px" }}>{ctaTitle}</div>
          <div style={{ fontSize: FONT.base, color: "#9A9FAD" }}>{ctaSub}</div>
        </div>
        <button onClick={action.onClick} title={action.title} aria-disabled={gated} style={bannerCtaStyle}>
          {action.playIcon && <span style={{ position: "absolute", top: 0, left: "-45%", width: "45%", height: "100%", background: "linear-gradient(100deg,transparent,rgba(255,255,255,.32),transparent)", animation: "sheen 3.6s ease-in-out infinite", pointerEvents: "none" }} />}
          {action.spinner && <span style={{ position: "relative", zIndex: 1, display: "inline-flex" }}><LoadingRing size={15} /></span>}
          {action.playIcon && <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ position: "relative", zIndex: 1 }}><path d="M7 4l13 8-13 8z" /></svg>}
          <span style={{ position: "relative", zIndex: 1 }}>{action.label}</span>
        </button>
        {secondaryAction && (
          <button onClick={secondaryAction.onClick} style={secondaryCtaButtonStyle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ position: "relative", zIndex: 1 }}><path d="M7 4l13 8-13 8z" /></svg>
            <span style={{ position: "relative", zIndex: 1 }}>{secondaryAction.label}</span>
          </button>
        )}
      </div>
    </div>
  );
}
