"use client";

import type { CSSProperties, MouseEvent } from "react";
import Combobox from "../../Combobox";
import SelectMenu from "../../SelectMenu";
import { CLAUDE_EFFORTS, CLAUDE_MODELS, modelIdForLabel, modelLabel } from "@/lib/claudeOptions";
import type { Ticket, TicketComment } from "@/lib/types";
import { COLORS, EXEC_COLOR, EXEC_LABEL, avatar, card, execDot, initials, tintedCard } from "@/lib/ui";
import { renderCommentBody } from "../helpers";
import type { Action, OverrideField, RunSummary } from "../types";
import LoadingRing from "../LoadingRing";

type Props = {
  ticket: Ticket;
  comments: TicketComment[];
  history: RunSummary[];
  onOpenRun: (ticketId: string, execId: string, e?: MouseEvent) => void;
  // resolved per-ticket config (override ?? default) + its editors
  rootRepo: string;
  project: string;
  skill: string;
  model: string;
  effort: string;
  setOverrideValue: (ticketId: string, field: OverrideField, value: string) => void;
  onProjectChange: (ticketId: string, value: string) => void;
  rootRepoOptions: string[];
  projectOptions: string[];
  skillOptions: string[];
  branch: string;
  cdCommand: string;
  command: string;
  // CTA banner
  ctaTitle: string;
  ctaSub: string;
  action: Action;
  gated: boolean;
  bannerCtaStyle: CSSProperties;
  secondaryAction: { label: string; onClick: (e?: MouseEvent) => void; style: CSSProperties } | null;
  secondaryCtaButtonStyle: CSSProperties;
};

const sectionHeading: CSSProperties = {
  margin: "0 0 12px", fontFamily: "var(--font-space), sans-serif", fontSize: "11px",
  fontWeight: 700, letterSpacing: ".16em", color: "#5B6273",
};

// Ticket detail: description, acceptance criteria, discussion, the per-run
// configuration grid, the command preview, past runs and the CTA banner.
export default function OverviewTab({
  ticket: t, comments, history, onOpenRun,
  rootRepo, project, skill, model, effort, setOverrideValue, onProjectChange,
  rootRepoOptions, projectOptions, skillOptions, branch, cdCommand, command,
  ctaTitle, ctaSub, action, gated, bannerCtaStyle, secondaryAction, secondaryCtaButtonStyle,
}: Props) {
  const fieldLabel: CSSProperties = { fontSize: "10px", letterSpacing: ".12em", color: "#5B6273", fontWeight: 600, marginBottom: "5px" };
  const fieldCard = card({ padding: "9px 11px" });
  return (
    <div style={{ maxWidth: "780px", display: "flex", flexDirection: "column", gap: "28px", animation: "fadeUp .4s both" }}>
      <section>
        <h3 style={sectionHeading}>DESCRIPTION</h3>
        <p style={{ margin: 0, fontSize: "14.5px", lineHeight: 1.75, color: "#B8BDC9", whiteSpace: "pre-wrap" }}>{t.description || "No description."}</p>
      </section>
      {t.criteria.length > 0 && (
        <section>
          <h3 style={sectionHeading}>ACCEPTANCE CRITERIA</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {t.criteria.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start", ...card({ padding: "12px 14px", border: COLORS.borderSubtle }) }}>
                <span style={{ flex: "0 0 auto", width: "18px", height: "18px", borderRadius: "6px", border: "1.5px solid #2E3644", display: "flex", alignItems: "center", justifyContent: "center", marginTop: "1px" }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#5B6273" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg></span>
                <span style={{ fontSize: "13.5px", color: "#C7CCD8", lineHeight: 1.5 }}>{c}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {comments.length > 0 && (
        <section>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {comments.map((cm, i) => (
              <div key={i} style={{ display: "flex", gap: "11px", alignItems: "flex-start" }}>
                <span style={{ ...avatar(cm.author), flex: "0 0 auto", width: "28px", height: "28px", fontSize: "11px" }}>{initials(cm.author)}</span>
                <div style={{ flex: 1, minWidth: 0, ...card({ padding: "11px 14px", border: COLORS.borderSubtle }) }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#E4E7EE" }}>{cm.author}</span>
                    <span style={{ fontSize: "11.5px", color: "#6B7283", textDecoration: "underline", textDecorationColor: "#2A2F3A" }}>commented {cm.date}</span>
                  </div>
                  <div style={{ fontSize: "13.5px", lineHeight: 1.65, color: "#C7CCD8", marginTop: "5px" }}>{renderCommentBody(cm.text)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px" }}>
        <div style={fieldCard}><div style={fieldLabel}>ROOT REPO</div><Combobox value={rootRepo} onChange={(v) => setOverrideValue(t.id, "rootRepo", v)} options={rootRepoOptions} ariaLabel="Root repo" /></div>
        <div style={fieldCard}><div style={fieldLabel}>PROJECT</div><Combobox value={project} onChange={(v) => onProjectChange(t.id, v)} options={projectOptions} ariaLabel="Project" /></div>
        <div style={fieldCard}><div style={fieldLabel}>SKILL</div><Combobox value={skill} onChange={(v) => setOverrideValue(t.id, "skill", v)} options={skillOptions} ariaLabel="Skill" /></div>
        <div style={fieldCard}><div style={fieldLabel}>MODEL</div><SelectMenu value={modelLabel(model)} onChange={(v) => setOverrideValue(t.id, "model", modelIdForLabel(v))} options={CLAUDE_MODELS.map((m) => m.label)} ariaLabel="Claude model" /></div>
        <div style={fieldCard}><div style={fieldLabel}>EFFORT</div><SelectMenu value={effort} onChange={(v) => setOverrideValue(t.id, "effort", v)} options={[...CLAUDE_EFFORTS]} ariaLabel="Effort" /></div>
        <div style={{ ...fieldCard, border: `1px solid ${COLORS.borderSubtle}` }}><div style={fieldLabel}>TARGET BRANCH</div><div style={{ fontFamily: "var(--font-mono), monospace", fontSize: "12.5px", color: "#9BA6E8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{branch}</div></div>
      </section>
      <section>
        <h3 style={sectionHeading}>COMMAND PREVIEW</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontFamily: "var(--font-mono), monospace", fontSize: "13px", ...card({ padding: "15px 18px", radius: "12px", border: "#23272F", background: COLORS.panelBgDark }) }}>
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
                <span style={{ ...execDot(run.status), width: "8px", height: "8px" }} />
                <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "12px", color: "#C7CCD8", flex: "0 0 auto" }}>{run.skillName}</span>
                <span style={{ fontSize: "12px", color: "#5B6273", flex: 1 }}>{new Date(run.startedAt).toLocaleString()}</span>
                <span style={{ fontSize: "11.5px", fontWeight: 600, color: EXEC_COLOR[run.status] }}>{EXEC_LABEL[run.status]}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", ...tintedCard("accent", { padding: "20px 22px", radius: "14px" }) }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: "15px", fontWeight: 700, color: "#F3F5F9", marginBottom: "3px" }}>{ctaTitle}</div>
          <div style={{ fontSize: "13px", color: "#9A9FAD" }}>{ctaSub}</div>
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
