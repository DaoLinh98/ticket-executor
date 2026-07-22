"use client";

import type { MouseEvent, RefObject } from "react";
import SprintPicker, { type IterationOption } from "../SprintPicker";
import type { ProviderMeta } from "@/lib/providers";
import type { ReviewSummaryEntry } from "@/lib/types";
import { dropdownPanelStyle, ringBorder } from "@/lib/ui";
import { reviewFingerprint, timeAgo } from "./helpers";

type Props = {
  pm: ProviderMeta;
  sprintLabel: string;
  sprintOptions: IterationOption[];
  selectedSprint: string;
  onSprintChange: (value: string, e: { clientX: number; clientY: number }) => void;
  activeCount: number;
  bellRef: RefObject<HTMLDivElement | null>;
  bellOpen: boolean;
  onToggleBell: (e: MouseEvent) => void;
  reviewBadgeCount: number;
  reviewSummary: ReviewSummaryEntry[];
  reviewReadMap: Record<string, { seen: string; readAt: string }>;
  onOpenReview: (rv: ReviewSummaryEntry, e: MouseEvent) => void;
  onOpenSettings: (e?: MouseEvent) => void;
  onLogout: () => void;
};

// Top bar: brand, sprint picker, active-run counter, review bell, Settings.
export default function AppHeader({
  pm, sprintLabel, sprintOptions, selectedSprint, onSprintChange, activeCount,
  bellRef, bellOpen, onToggleBell, reviewBadgeCount, reviewSummary, reviewReadMap,
  onOpenReview, onOpenSettings, onLogout,
}: Props) {
  return (
    <header style={{ height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "16px", padding: "0 22px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(14,17,23,.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", position: "relative", zIndex: 5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ width: "34px", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 22px -8px var(--accent)", ...ringBorder({ fill: "var(--accent)", variant: "filled", duration: 3.4 }) }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M8 5l8 7-8 7" stroke="#0B0C10" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
          <span style={{ fontFamily: "var(--font-space), sans-serif", fontWeight: 700, fontSize: "16px", letterSpacing: ".01em", background: "linear-gradient(90deg,var(--accent) 0%,#FFC15E 18%,#FF5F3D 36%,var(--accent) 54%,#FFC15E 72%,#FF5F3D 90%,var(--accent) 100%)", backgroundSize: "300% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "fireFlow 3.6s linear infinite,fireFlicker 2.2s ease-in-out infinite" }}>D-Agent</span>
          <span style={{ fontSize: "10px", letterSpacing: ".16em", fontWeight: 600, marginTop: "4px", background: "linear-gradient(90deg,#5B6273 0%,#5B6273 30%,#FFD9BE 45%,var(--accent) 52%,#5B6273 65%,#5B6273 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "subtitleFlow 3.2s linear infinite" }}>CLAUDE CODE · {pm.short}</span>
        </div>
      </div>
      <SprintPicker label={sprintLabel} options={sprintOptions} value={selectedSprint} onSelect={onSprintChange} />
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: "7px", height: "30px", padding: "0 13px", fontSize: "12.5px", color: "#8A90A0", whiteSpace: "nowrap", ...ringBorder({ fill: "#14171D", shape: "pill", duration: 3.4 }) }}>
        <span style={{ fontFamily: "var(--font-mono), monospace", color: "#C7CCD8", fontWeight: 600 }}>{activeCount}</span> active runs
      </div>
      <div ref={bellRef} style={{ position: "relative" }}>
        <button
          onClick={onToggleBell}
          title="Unresolved review comments"
          style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: "30px", height: "30px", color: reviewBadgeCount > 0 ? "var(--accent)" : "#8A90A0", cursor: "pointer", transition: "filter .15s,transform .12s", ...ringBorder({ fill: reviewBadgeCount > 0 ? "rgba(251,114,80,.14)" : "#14171D", duration: 3.4, cornerPx: 7 }) }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
          {reviewBadgeCount > 0 && (
            <span style={{ position: "absolute", top: "-4px", right: "-4px", minWidth: "15px", height: "15px", padding: "0 3px", borderRadius: "999px", background: "var(--accent)", color: "#0B0C10", fontSize: "9.5px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{reviewBadgeCount}</span>
          )}
        </button>
        {bellOpen && (
          <div className="te-scroll" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: "340px", animation: "fadeUp .16s ease-out both", ...dropdownPanelStyle({ maxHeight: "360px" }) }}>
            {reviewSummary.length === 0 && (
              <div style={{ padding: "16px 12px", fontSize: "12.5px", color: "#5B6273", textAlign: "center" }}>No unresolved review comments.</div>
            )}
            {reviewSummary.map((rv) => {
              const readEntry = reviewReadMap[rv.ticketId];
              const isUnread = readEntry?.seen !== reviewFingerprint(rv);
              return (
                <button
                  key={rv.ticketId}
                  onClick={(e) => onOpenReview(rv, e)}
                  style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%", textAlign: "left", padding: "10px 11px", borderRadius: "9px", border: "none", cursor: "pointer", background: isUnread ? "rgba(251,114,80,.08)" : "transparent", marginBottom: "2px" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: isUnread ? "var(--accent)" : "transparent", flex: "0 0 auto" }} />
                    <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "12px", fontWeight: 700, color: isUnread ? "var(--accent)" : "#6B7283" }}>#{rv.ticketId}</span>
                    <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "12px", fontWeight: 700, color: isUnread ? "#E4E7EE" : "#6B7283" }}>PR #{rv.prId}</span>
                  </div>
                  <div style={{ fontSize: "12px", color: isUnread ? "#9A9FAD" : "#5B6273", lineHeight: 1.5, paddingLeft: "13px" }}>
                    {rv.reviewer} left {rv.unresolvedCount} review comment{rv.unresolvedCount === 1 ? "" : "s"} — {rv.prTitle}
                  </div>
                  <div style={{ fontSize: "11px", color: "#5B6273", lineHeight: 1.4, paddingLeft: "13px" }}>
                    {isUnread ? rv.latestAt : `Read ${timeAgo(readEntry!.readAt)}`}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <button onClick={onOpenSettings} style={{ display: "flex", alignItems: "center", gap: "7px", height: "30px", padding: "0 13px 0 11px", color: "#C7CCD8", fontSize: "12px", fontWeight: 600, cursor: "pointer", transition: "filter .15s,transform .12s", ...ringBorder({ fill: "#14171D", duration: 3.4, cornerPx: 7 }) }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        Settings
      </button>
      <button onClick={onLogout} title="Log out" aria-label="Log out" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "30px", height: "30px", color: "#8A90A0", cursor: "pointer", transition: "filter .15s,transform .12s", ...ringBorder({ fill: "#14171D", duration: 3.4, cornerPx: 7 }) }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
      </button>
    </header>
  );
}
