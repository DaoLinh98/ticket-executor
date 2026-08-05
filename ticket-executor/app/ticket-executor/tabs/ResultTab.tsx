"use client";

import type { MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FileChange } from "@/lib/types";
import { COLORS, FONT, pill, ringBorder, tintedCard } from "@/lib/ui";
import type { ExecView, ResultSection } from "../types";
import { formatCost, formatTokenCount } from "../helpers";
import { useBoltsContext } from "../../BoltsContext";

type Props = {
  exec: ExecView;
  sections: ResultSection[];
  showSectionHeader: boolean;
  onOpenDiff: (file: FileChange) => void;
  onOpenPr: (e: MouseEvent) => void;
};

// Completion banner (branch / PR chips) plus one markdown block per completed run.
export default function ResultTab({ exec: ex, sections, showSectionHeader, onOpenDiff, onOpenPr }: Props) {
  const { fireBoltFromEvent } = useBoltsContext();
  const totalTokens = (ex.inputTokens ?? 0) + (ex.outputTokens ?? 0);
  const hasUsage = (ex.costUsd ?? 0) > 0 || totalTokens > 0;
  return (
    <div style={{ maxWidth: "800px", display: "flex", flexDirection: "column", gap: "26px", animation: "fadeUp .35s both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", ...tintedCard("success", { padding: "16px 18px", radius: "13px" }) }}>
        <span style={{ flex: "0 0 auto", width: "40px", height: "40px", borderRadius: "11px", background: "rgba(53,214,164,.14)", border: "1px solid #35D6A4", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#35D6A4" strokeWidth="2.6"><path d="M5 13l4 4L19 7" style={{ strokeDasharray: 26, strokeDashoffset: 26, animation: "draw .6s .2s ease forwards" }} /></svg></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: FONT.lg, fontWeight: 700, color: "#F3F5F9" }}>Implementation complete</div>
          <div style={{ fontSize: FONT.base, color: "#8A90A0", marginTop: "2px" }}>Finished{ex.duration ? <> in <span style={{ color: "#C7CCD8", fontWeight: 600 }}>{ex.duration}</span></> : ""} · Claude Code output below</div>
          {hasUsage && (
            <div style={{ display: "flex", gap: "7px", marginTop: "9px", flexWrap: "wrap" }}>
              {ex.duration && (
                <span style={pill({ color: COLORS.text, background: "rgba(255,255,255,.04)", border: COLORS.border, size: "sm" })}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 3.5" /></svg>
                  {ex.duration}
                </span>
              )}
              {(ex.costUsd ?? 0) > 0 && (
                <span style={pill({ color: COLORS.success, background: "rgba(53,214,164,.09)", border: "#24382F", size: "sm" })}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5c0-1.4 1.2-2 2.5-2s2.5.7 2.5 2-1.2 1.7-2.5 2-2.5.6-2.5 2 1.2 2 2.5 2 2.5-.6 2.5-2" /></svg>
                  {formatCost(ex.costUsd!)}
                </span>
              )}
              {totalTokens > 0 && (
                <span style={pill({ color: COLORS.info, background: "rgba(91,157,255,.09)", border: "#26314A", size: "sm" })}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                  {formatTokenCount(totalTokens)} tokens
                </span>
              )}
            </div>
          )}
        </div>
        {ex.branch && (
          <span
            title="Branch"
            style={{
              fontFamily: "var(--font-mono), monospace",
              maxWidth: "220px",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              ...pill({ color: COLORS.indigo, background: "rgba(155,166,232,.08)", border: "#2E3450", size: "md" }),
              gap: "6px",
              padding: "5px 10px",
              fontWeight: 400,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flex: "0 0 auto" }}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="8" r="2.5" /><path d="M6 8.5v7M18 10.5c0 3-3 3.5-6 3.5" /></svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{ex.branch}</span>
          </span>
        )}
        {ex.prUrl && (
          <a
            href={ex.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpenPr}
            style={{
              flex: "0 0 auto",
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              height: "32px",
              padding: "0 14px",
              textDecoration: "none",
              color: "#5BE8B8",
              fontSize: FONT.sm,
              fontWeight: 700,
              cursor: "pointer",
              // Opaque fill so the spinning conic-gradient stays confined to the
              // border ring, matching the subtle tab/CTA glow instead of bleeding
              // through the translucent fill as a harsh diagonal sweep.
              ...ringBorder({ fill: "#162F2C", ring: COLORS.success, highlight: "#baf5e3", duration: 3 }),
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14L21 3" /></svg>
            Open PR
          </a>
        )}
      </div>
      {sections.map((rs) => (
        <div key={rs.key}>
          {showSectionHeader && (
            <h2 style={{ margin: "0 0 10px", fontFamily: "var(--font-space), sans-serif", fontSize: FONT.base, fontWeight: 700, letterSpacing: ".06em", color: "var(--accent)", textTransform: "uppercase" }}>{rs.title}</h2>
          )}
          <div className="md-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{rs.markdown}</ReactMarkdown>
          </div>
          {rs.filesChanged.length > 0 && (
            <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ fontSize: FONT.xs, letterSpacing: ".08em", fontWeight: 700, color: "#5B6273", textTransform: "uppercase" }}>
                Files changed ({rs.filesChanged.length})
              </div>
              {rs.filesChanged.map((fc) => (
                <button
                  key={fc.path}
                  onClick={(e) => { fireBoltFromEvent(e); onOpenDiff(fc); }}
                  style={{ display: "flex", alignItems: "center", gap: "9px", width: "100%", textAlign: "left", padding: "8px 11px", borderRadius: "9px", cursor: "pointer", ...ringBorder({ fill: "#111419", duration: 4.5, cornerPx: 7 }) }}
                >
                  <span style={{
                    fontFamily: "var(--font-mono), monospace", fontSize: FONT.xs, fontWeight: 700, flex: "0 0 auto", width: "16px", textAlign: "center",
                    color: fc.changeType === "added" ? "#35D6A4" : fc.changeType === "deleted" ? "#FF6B6B" : fc.changeType === "renamed" ? "#9BA6E8" : "#F5B341",
                  }}>
                    {fc.changeType === "added" ? "A" : fc.changeType === "deleted" ? "D" : fc.changeType === "renamed" ? "R" : "M"}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.base, color: "#C7CCD8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{fc.path}</span>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5B6273" strokeWidth="2" style={{ flex: "0 0 auto" }}><path d="M9 6l6 6-6 6" /></svg>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
