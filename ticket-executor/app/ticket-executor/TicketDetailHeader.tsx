"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, RefObject } from "react";
import type { Ticket, UiRunState } from "@/lib/types";
import { COLORS, FONT, RUN_LABEL, avatar, dropdownPanelStyle, initials, pill, ringBorder, runDot, statusPillActive, typeBadge } from "@/lib/ui";
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
  /** Back to the ticket list. Only reachable below the responsive breakpoint,
   *  where the two panes share one screen — hidden by globals.css above it. */
  onBack: () => void;
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
  statusMenuRef, statusMenuOpen, statusMenuLoading, statusMenuOptions, onToggleStatusMenu, onSelectStatus, onBack,
  tab, setTab, tabStyle, execEnabled, planEnabled, planNeedsReview, resultEnabled, unresolvedCount, action, gated, secondaryAction,
}: Props) {
  const { fireBoltFromEvent } = useBoltsContext();
  // zIndex 2, not 1: the scrolling detail pane below is a sibling that also creates
  // a stacking context at zIndex 1, and being later in the DOM it won the tie —
  // which is what let the Overview cards paint over the open status dropdown. The
  // dropdown's own zIndex can't help, since it is trapped inside this element's
  // context. Still below AppHeader (5).
  return (
    <div className="te-detail-header" style={{ position: "relative", zIndex: 2, flex: "0 0 auto", padding: "20px 28px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "9px", flexWrap: "wrap" }}>
        <button
          type="button"
          className="te-back-btn"
          aria-label="Back to tickets"
          onClick={(e) => { fireBoltFromEvent(e); onBack(); }}
          style={{
            display: "none", alignItems: "center", justifyContent: "center", flex: "0 0 auto",
            width: "32px", height: "32px", color: COLORS.textSoft, cursor: "pointer",
            ...ringBorder({ fill: "var(--te-btn-ghost-fill)", duration: 4.2, cornerPx: 7 }),
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 6l-6 6 6 6" /></svg>
        </button>
        <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.base, fontWeight: 600, color: "var(--accent)" }}>#{t.id}</span>
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
                <div style={{ padding: "8px 10px", fontSize: FONT.sm, color: "#5B6273", maxWidth: "220px" }}>No provider statuses available for this ticket.</div>
              ) : (
                statusMenuOptions.map((s) => (
                  <button key={s} onClick={(e) => onSelectStatus(s, e)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: "8px", border: "none", cursor: "pointer", background: s === effStatus ? "rgba(251,114,80,.14)" : "transparent", color: s === effStatus ? "var(--accent)" : "#C7CCD8", fontSize: FONT.base, fontWeight: s === effStatus ? 700 : 500 }}>{s}</button>
                ))
              )}
            </div>
          )}
        </div>
        {/* On a phone the full chip is a label and a caret for one link. The
            link itself is what gets used — pasted into a chat, opened in the
            provider's own app — so the row carries just the copy, beside the
            status. The meta row's chip is hidden below the breakpoint
            (globals.css); only one of the two is ever on screen. */}
        {t.url && (
          <div className="te-open-ticket-mobile" style={{ display: "none", marginLeft: "auto" }}>
            <CopyTicketLinkButton url={t.url} />
          </div>
        )}
      </div>
      <h1 className="te-detail-title" style={{ margin: 0, fontFamily: "var(--font-space), sans-serif", fontSize: "24px", fontWeight: 700, lineHeight: 1.18, color: "#F3F5F9", maxWidth: "820px" }}>{t.title}</h1>
      <div style={{ display: "flex", alignItems: "center", gap: "18px", marginTop: "13px", fontSize: FONT.base, color: "#8A90A0", flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={avatar(t.assignee)}>{initials(t.assignee)}</span>{t.assignee}</span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7283" strokeWidth="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg><span style={{ fontFamily: "var(--font-mono), monospace", color: "#A6ADBB" }}>{projectName}</span></span>
        <span style={execPillStyle}><span style={{ ...runDot(st), width: "7px", height: "7px" }} />{RUN_LABEL[st]}</span>
        {t.url && (
          <span className="te-mobile-hide" style={{ display: "inline-flex" }}>
            <OpenTicketButton url={t.url} onOpenTicketLink={onOpenTicketLink} />
          </span>
        )}
      </div>

      <div className="te-tabbar" style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "22px", borderBottom: "1px solid #1E232C" }}>
        {/* `display: contents` — above the breakpoint these seven buttons are
            direct flex children of the bar exactly as they were. Below it the
            wrapper becomes its own scrolling row (globals.css), so the tabs
            take one line instead of three and the run buttons keep the line
            under them rather than being scrolled out of reach. */}
        <div className="te-tabbar-tabs" style={{ display: "contents" }}>
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
        <button onClick={(e) => { fireBoltFromEvent(e); setTab("ask"); }} style={tabStyle("ask", true)}>Ask Claude</button>
        </div>
        <div style={{ flex: 1 }} />
        {/* The run controls belong to the two tabs about the run itself:
            Overview, where the ticket is read and the decision to start one is
            made, and Execution, where the same button is "Running… (cancel)"
            and the log you are watching is the reason to press it. On the rest
            they were a row of chrome above content that has nothing to do with
            a run — and on a phone that row costs a third of the fold. */}
        {(tab === "overview" || tab === "execution") && (
        <div className="te-tabbar-actions" style={{ paddingBottom: "8px", display: "flex", alignItems: "center", gap: "7px" }}>
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
        )}
      </div>
    </div>
  );
}

// The phone's whole ticket-link affordance: one icon that puts the URL on the
// clipboard. No caret, no label — the desktop chip's `OpenTicketButton` covers
// the rest, and there is no room for it beside a status pill at 390px.
function CopyTicketLinkButton({ url }: { url: string }) {
  const { fireBoltFromEvent } = useBoltsContext();
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      aria-label={copied ? "Ticket link copied" : "Copy ticket link"}
      title="Copy ticket link"
      onClick={(e) => {
        fireBoltFromEvent(e);
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto",
        width: "32px", height: "32px", cursor: "pointer",
        color: copied ? COLORS.success : COLORS.indigo,
        ...ringBorder({ fill: "#1A1E33", ring: COLORS.indigo, highlight: "#d9defa", duration: 3, cornerPx: 7 }),
      }}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}

// "Open Ticket" chip plus a caret that offers the same link as a copy. Clicking
// the chip itself keeps the plain open-in-new-tab behaviour.
function OpenTicketButton({ url, onOpenTicketLink }: { url: string; onOpenTicketLink: (e: MouseEvent) => void }) {
  const { fireBoltFromEvent } = useBoltsContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const chip = ringBorder({ fill: "#1A1E33", ring: COLORS.indigo, highlight: "#d9defa", duration: 3 });

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: "0 0 auto", display: "inline-flex" }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          height: "32px",
          color: COLORS.indigo,
          // Opaque fill so the spinning conic-gradient ring stays confined to the
          // border, matching the Open PR button's chip treatment.
          ...chip,
        }}
      >
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onOpenTicketLink}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "7px",
            alignSelf: "stretch",
            padding: "0 12px 0 14px",
            textDecoration: "none",
            color: "inherit",
            fontSize: FONT.sm,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14L21 3" /></svg>
          Open Ticket
        </a>
        <span style={{ alignSelf: "stretch", width: "1px", margin: "5px 0", background: "rgba(217,222,250,.28)" }} />
        <button
          type="button"
          aria-label="Ticket link options"
          aria-expanded={menuOpen}
          onClick={(e) => { fireBoltFromEvent(e); setMenuOpen((o) => !o); }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            alignSelf: "stretch",
            width: "26px",
            padding: 0,
            border: "none",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ transform: menuOpen ? "rotate(180deg)" : "none", transition: "transform .18s" }}><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>
      {menuOpen && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 30, animation: "fadeUp .16s ease-out both", ...dropdownPanelStyle({ minWidth: "160px" }) }}>
          <button
            onClick={(e) => {
              fireBoltFromEvent(e);
              setMenuOpen(false);
              window.open(url, "_blank", "noopener");
            }}
            style={menuItemStyle}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14L21 3" /></svg>
            Open
          </button>
          <button
            onClick={(e) => {
              fireBoltFromEvent(e);
              void navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                setTimeout(() => { setCopied(false); setMenuOpen(false); }, 900);
              });
            }}
            style={menuItemStyle}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "9px",
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  borderRadius: "8px",
  border: "none",
  cursor: "pointer",
  background: "transparent",
  color: "#C7CCD8",
  fontSize: FONT.base,
  fontWeight: 500,
};
