"use client";

import { useEffect, useState } from "react";
import type { CommitFile, CommitSummary } from "@/lib/types";
import { COLORS, FONT, modalShellStyle, pill, ringBorder } from "@/lib/ui";
import DiffView from "./DiffView";
import { timeAgo } from "./helpers";
import LoadingRing from "./LoadingRing";
import { useBoltsContext } from "../BoltsContext";

type Props = {
  commit: CommitSummary;
  files: CommitFile[] | null; // null = still loading
  onClose: () => void;
};

const CHANGE_COLOR: Record<CommitFile["changeType"], string> = {
  added: "var(--te-success)",
  deleted: "var(--te-danger)",
  renamed: "var(--te-indigo)",
  modified: "var(--te-warning)",
};
const CHANGE_LETTER: Record<CommitFile["changeType"], string> = {
  added: "A",
  deleted: "D",
  renamed: "R",
  modified: "M",
};

// Full-screen popup: one commit's file list on the left (GitHub/VSCode-style),
// its unified diff on the right. Reuses DiffView so highlighting matches the
// Result tab's single-file diff popup.
export default function CommitFilesModal({ commit, files, onClose }: Props) {
  const [activePath, setActivePath] = useState<string | null>(null);
  // Which of the two panes the phone is showing. A diff wraps mid-word, so
  // sharing 390px with a 280px file list left it roughly one character wide;
  // below the breakpoint the list and the diff take the screen in turn. Above
  // it nothing reads this (globals.css), and `activePath` still preselects the
  // first file so the desktop popup opens on a diff as before.
  const [mobilePane, setMobilePane] = useState<"list" | "detail">("list");
  const { fireBoltFromEvent } = useBoltsContext();

  useEffect(() => {
    setActivePath(files && files.length ? files[0].path : null);
    setMobilePane("list");
  }, [files, commit.sha]);

  const active = files?.find((f) => f.path === activePath) ?? null;

  return (
    <div className="te-modal-overlay" style={{ position: "fixed", inset: 0, zIndex: 55, background: "var(--te-scrim)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn .2s both" }} onClick={onClose}>
      <div className="te-modal-shell" style={{ width: "1280px", maxWidth: "96vw", height: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", ...modalShellStyle() }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", padding: "16px 20px", borderBottom: "1px solid var(--te-border-subtle)", flex: "0 0 auto" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: "var(--te-font-display)", fontSize: FONT.md, fontWeight: 700, color: "var(--te-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{commit.message || "(no message)"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: "9px", marginTop: "4px", fontSize: FONT.sm, color: "var(--te-text-dim)" }}>
              <span style={{ fontFamily: "var(--font-mono), monospace", ...pill({ color: "var(--te-indigo)", background: "rgba(155,166,232,.1)", border: "#2E3450", size: "xs" }) }}>{commit.shortSha}</span>
              <span>{commit.author}</span>
              {commit.date && <span>· {timeAgo(commit.date)}</span>}
            </div>
          </div>
          <button onClick={(e) => { fireBoltFromEvent(e); onClose(); }} style={{ width: "26px", height: "26px", flex: "0 0 auto", color: "var(--te-text-dim)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", ...ringBorder({ fill: "var(--te-btn-ghost-fill)", duration: 4, cornerPx: 6 }) }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>

        {files === null ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><LoadingRing size={64} /></div>
        ) : files.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--te-faint)", fontSize: FONT.base }}>No file changes found for this commit.</div>
        ) : (
          <div className="te-split" data-pane={mobilePane} style={{ flex: 1, display: "flex", minHeight: 0 }}>
            <div className="te-scroll te-pane-list" style={{ width: "280px", flex: "0 0 auto", overflowY: "auto", borderRight: "1px solid var(--te-border-subtle)", padding: "8px" }}>
              {files.map((f) => {
                const isActive = f.path === activePath;
                return (
                  <button
                    key={f.path}
                    onClick={(e) => { fireBoltFromEvent(e); setActivePath(f.path); setMobilePane("detail"); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      width: "100%",
                      textAlign: "left",
                      padding: "7px 9px",
                      borderRadius: "8px",
                      border: "none",
                      cursor: "pointer",
                      background: isActive ? "rgba(251,114,80,.1)" : "transparent",
                    }}
                  >
                    <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.xs, fontWeight: 700, flex: "0 0 auto", width: "14px", textAlign: "center", color: CHANGE_COLOR[f.changeType] }}>
                      {CHANGE_LETTER[f.changeType]}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, color: isActive ? "var(--te-text)" : "var(--te-text-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{f.path}</span>
                    <span style={{ flex: "0 0 auto", fontSize: FONT.xs, fontFamily: "var(--font-mono), monospace" }}>
                      {f.additions > 0 && <span style={{ color: "var(--te-success)" }}>+{f.additions}</span>}
                      {f.additions > 0 && f.deletions > 0 && " "}
                      {f.deletions > 0 && <span style={{ color: "var(--te-danger)" }}>-{f.deletions}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="te-pane-detail" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              {active && (
                <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: "10px", padding: "10px 20px", borderBottom: "1px solid var(--te-border-subtle)", fontFamily: "var(--font-mono), monospace", fontSize: FONT.base, color: "var(--te-text-soft)" }}>
                  <button
                    type="button"
                    className="te-back-btn"
                    aria-label="Back to file list"
                    onClick={(e) => { fireBoltFromEvent(e); setMobilePane("list"); }}
                    style={{
                      display: "none", alignItems: "center", justifyContent: "center", flex: "0 0 auto",
                      width: "28px", height: "28px", color: COLORS.textSoft, cursor: "pointer",
                      ...ringBorder({ fill: "var(--te-btn-ghost-fill)", duration: 4.2, cornerPx: 6 }),
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 6l-6 6 6 6" /></svg>
                  </button>
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{active.path}</span>
                </div>
              )}
              {active ? <DiffView diff={active.diff} /> : <div style={{ flex: 1 }} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
