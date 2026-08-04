"use client";

import type { CSSProperties, MouseEvent, RefObject } from "react";
import type { Ticket, UiRunState } from "@/lib/types";
import { COLORS, RUN_LABEL, avatar, dropdownPanelStyle, runDot, initials, pill, ringBorder, statusPillActive, typeBadge } from "@/lib/ui";
import type { Action, TabId } from "./types";
import LoadingRing from "./LoadingRing";
import { useBoltsContext } from "../BoltsContext";

type Props = {
  ticket: Ticket;
  effStatus: string;
  projectName: string;
  state: UiRunState;
  execPillStyle: CSSProperties;
  onOpenTicketLink: (e: MouseEvent) => void;
  // status dropdown
  statusMenuRef: RefObject<HTMLDivElement | null>;
  statusMenuOpen: boolean;
  statusMenuLoading: boolean;
  statusMenuOptions: string[];
  onToggleStatusMenu: () => void;
  onSelectStatus: (status: string, e?: MouseEvent) => void;
  // tabs
  tab: TabId;
  setTab: (tab: TabId) => void;
  tabStyle: (name: string, enabled: boolean) => CSSProperties;
  execEnabled: boolean;
  planEnabled: boolean;
  planNeedsReview: boolean;
  resultEnabled: boolean;
  unresolvedCount: number;
  // CTA
  action: Action;
  gated: boolean;
  secondaryAction: { label: string; onClick: (e?: MouseEvent) => void; style: CSSProperties } | null;
};

// Ticket identity block (id / type / status menu / title / meta) and the tab bar
// with its primary + secondary run buttons.
export default function TicketDetailHeader({
  ticket: t, effStatus, projectName, state: st, execPillStyle, onOpenTicketLink,
  statusMenuRef, statusMenuOpen, statusMenuLoading, statusMenuOptions, onToggleStatusMenu, onSelectStatus,
  tab, setTab, tabStyle, execEnabled, planEnabled, planNeedsReview, resultEnabled, unresolvedCount, action, gated, secondaryAction,
}: Props) {
  const { fireBoltFromEvent } = useBoltsContext();
  return (
    <div style={{ position: "relative", zIndex: 1, flex: "0 0 auto", padding: "20px 28px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "9px" }}>
        <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "13px", fontWeight: 600, color: "var(--accent)" }}>#{t.id}</span>
        <span style={typeBadge(t.type)}>{t.type}</span>
        <div ref={statusMenuRef} style={{ position: "relative" }}>
          <button onClick={(e) => { fireBoltFromEvent(e); onToggleStatusMenu(); }} style={statusPillActive(effStatus)}>
            {effStatus}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ transform: statusMenuOpen ? "rotate(180deg)" : "none", transition: "transform .18s" }}><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {statusMenuOpen && (
            <div className="te-scroll" style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 30, animation: "fadeUp .16s ease-out both", ...dropdownPanelStyle({ minWidth: "190px", maxHeight: "280px" }) }}>
              {statusMenuLoading ? (
                <div style={{ padding: "10px", display: "flex", justifyContent: "center" }}><LoadingRing size={20} /></div>
              ) : statusMenuOptions.length === 0 ? (
                <div style={{ padding: "8px 10px", fontSize: "12px", color: "#5B6273", maxWidth: "220px" }}>No provider statuses available for this ticket.</div>
              ) : (
                statusMenuOptions.map((s) => (
                  <button key={s} onClick={(e) => onSelectStatus(s, e)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: "8px", border: "none", cursor: "pointer", background: s === effStatus ? "rgba(251,114,80,.14)" : "transparent", color: s === effStatus ? "var(--accent)" : "#C7CCD8", fontSize: "12.5px", fontWeight: s === effStatus ? 700 : 500 }}>{s}</button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      <h1 style={{ margin: 0, fontFamily: "var(--font-space), sans-serif", fontSize: "24px", fontWeight: 700, lineHeight: 1.18, color: "#F3F5F9", maxWidth: "820px" }}>{t.title}</h1>
      <div style={{ display: "flex", alignItems: "center", gap: "18px", marginTop: "13px", fontSize: "12.5px", color: "#8A90A0", flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={avatar(t.assignee)}>{initials(t.assignee)}</span>{t.assignee}</span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7283" strokeWidth="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg><span style={{ fontFamily: "var(--font-mono), monospace", color: "#A6ADBB" }}>{projectName}</span></span>
        <span style={execPillStyle}><span style={{ ...runDot(st), width: "7px", height: "7px" }} />{RUN_LABEL[st]}</span>
        {t.url && (
          <a
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpenTicketLink}
            style={{
              flex: "0 0 auto",
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              height: "32px",
              padding: "0 14px",
              textDecoration: "none",
              color: COLORS.indigo,
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
              // Opaque fill so the spinning conic-gradient ring stays confined to the
              // border, matching the Open PR button's chip treatment.
              ...ringBorder({ fill: "#1A1E33", ring: COLORS.indigo, highlight: "#d9defa", duration: 3 }),
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14L21 3" /></svg>
            Open Ticket
          </a>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "22px", borderBottom: "1px solid #1E232C" }}>
        <button onClick={(e) => { fireBoltFromEvent(e); setTab("overview"); }} style={tabStyle("overview", true)}>Overview</button>
        <button onClick={(e) => { if (execEnabled) { fireBoltFromEvent(e); setTab("execution"); } }} style={tabStyle("execution", execEnabled)}>Execution</button>
        {planEnabled && (
          <button onClick={(e) => { fireBoltFromEvent(e); setTab("plan"); }} style={{ ...tabStyle("plan", true), display: "flex", alignItems: "center", gap: "6px" }}>
            Plan
            {planNeedsReview && <span style={{ ...pill({ color: "#0B0C10", background: COLORS.indigo, size: "xs", weight: 700 }), padding: "1px 6px" }}>review</span>}
          </button>
        )}
        <button onClick={(e) => { fireBoltFromEvent(e); setTab("resolve-review"); }} style={{ ...tabStyle("resolve-review", true), display: "flex", alignItems: "center", gap: "6px" }}>
          Resolve Review
          {unresolvedCount > 0 && (
            <span style={{ ...pill({ color: "#0B0C10", background: "var(--accent)", size: "xs", weight: 700 }), padding: "1px 6px" }}>{unresolvedCount}</span>
          )}
        </button>
        <button onClick={(e) => { fireBoltFromEvent(e); setTab("commits"); }} style={tabStyle("commits", true)}>Commits</button>
        <button onClick={(e) => { if (resultEnabled) { fireBoltFromEvent(e); setTab("result"); } }} style={tabStyle("result", resultEnabled)}>Result</button>
        <div style={{ flex: 1 }} />
        <div style={{ paddingBottom: "8px", display: "flex", alignItems: "center", gap: "7px" }}>
          <button onClick={action.onClick} title={action.title} aria-disabled={gated} style={action.style}>
            {action.playIcon && <span style={{ position: "absolute", top: 0, left: "-45%", width: "45%", height: "100%", background: "linear-gradient(100deg,transparent,rgba(255,255,255,.32),transparent)", animation: "sheen 3.6s ease-in-out infinite", pointerEvents: "none" }} />}
            {action.spinner && <span style={{ position: "relative", zIndex: 1, display: "inline-flex" }}><LoadingRing size={14} /></span>}
            {action.playIcon && <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ position: "relative", zIndex: 1 }}><path d="M7 4l13 8-13 8z" /></svg>}
            <span style={{ position: "relative", zIndex: 1 }}>{action.label}</span>
          </button>
          {secondaryAction && (
            <button onClick={secondaryAction.onClick} style={secondaryAction.style}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ position: "relative", zIndex: 1 }}><path d="M7 4l13 8-13 8z" /></svg>
              <span style={{ position: "relative", zIndex: 1 }}>{secondaryAction.label}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
