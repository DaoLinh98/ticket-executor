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
  projectOptions: { id: string; name: string }[];
  selectedProject: string;
  onSelectProject: (value: string, e: { clientX: number; clientY: number }) => void;
  activeCount: number;
  bellRef: RefObject<HTMLDivElement | null>;
  bellOpen: boolean;
  onToggleBell: (e: MouseEvent) => void;
  reviewBadgeCount: number;
  reviewSummary: ReviewSummaryEntry[];
  reviewReadMap: Record<string, { seen: string; readAt: string }>;
  onOpenReview: (rv: ReviewSummaryEntry, e: MouseEvent) => void;
};

// Project picker leading icon (a small grid/folder), distinct from the sprint
// picker's green "current" dot.
const projectLeading = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8A90A0" strokeWidth="2" style={{ flex: "0 0 auto" }}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

// Top bar (Ticket Execution): brand, project + sprint pickers, active-run
// counter and the review bell. Cross-page nav / Settings / Logout live in the
// shared Sidebar.
export default function AppHeader({
  pm, sprintLabel, sprintOptions, selectedSprint, onSprintChange,
  projectOptions, selectedProject, onSelectProject, activeCount,
  bellRef, bellOpen, onToggleBell, reviewBadgeCount, reviewSummary, reviewReadMap,
  onOpenReview,
}: Props) {
  return (
    <header style={{ height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "16px", padding: "0 22px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(14,17,23,.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", position: "relative", zIndex: 5 }}>
      <span style={{ fontSize: "10px", letterSpacing: ".16em", fontWeight: 600, background: "linear-gradient(90deg,#5B6273 0%,#5B6273 30%,#FFD9BE 45%,var(--accent) 52%,#5B6273 65%,#5B6273 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "subtitleFlow 3.2s linear infinite" }}>CLAUDE CODE · {pm.short}</span>
      <SprintPicker label={selectedProject} options={projectOptions} value={selectedProject} onSelect={onSelectProject} leading={projectLeading} />
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
    </header>
  );
}
