"use client";

import { useEffect, useState } from "react";
import type { CommitFile, CommitSummary } from "@/lib/types";
import { modalShellStyle, pill, ringBorder } from "@/lib/ui";
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
  added: "#35D6A4",
  deleted: "#FF6B6B",
  renamed: "#9BA6E8",
  modified: "#F5B341",
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
  const { fireBoltFromEvent } = useBoltsContext();

  useEffect(() => {
    setActivePath(files && files.length ? files[0].path : null);
  }, [files, commit.sha]);

  const active = files?.find((f) => f.path === activePath) ?? null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 55, background: "rgba(6,7,9,.68)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn .2s both" }} onClick={onClose}>
      <div style={{ width: "1280px", maxWidth: "96vw", height: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", ...modalShellStyle() }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", padding: "16px 20px", borderBottom: "1px solid #1E232C", flex: "0 0 auto" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: "14px", fontWeight: 700, color: "#F3F5F9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{commit.message || "(no message)"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: "9px", marginTop: "4px", fontSize: "12px", color: "#8A90A0" }}>
              <span style={{ fontFamily: "var(--font-mono), monospace", ...pill({ color: "#9BA6E8", background: "rgba(155,166,232,.1)", border: "#2E3450", size: "xs" }) }}>{commit.shortSha}</span>
              <span>{commit.author}</span>
              {commit.date && <span>· {timeAgo(commit.date)}</span>}
            </div>
          </div>
          <button onClick={(e) => { fireBoltFromEvent(e); onClose(); }} style={{ width: "26px", height: "26px", flex: "0 0 auto", color: "#8A90A0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", ...ringBorder({ fill: "#1A1E25", duration: 4, cornerPx: 6 }) }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>

        {files === null ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><LoadingRing size={64} /></div>
        ) : files.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#5B6273", fontSize: "13px" }}>No file changes found for this commit.</div>
        ) : (
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
            <div className="te-scroll" style={{ width: "280px", flex: "0 0 auto", overflowY: "auto", borderRight: "1px solid #1E232C", padding: "8px" }}>
              {files.map((f) => {
                const isActive = f.path === activePath;
                return (
                  <button
                    key={f.path}
                    onClick={(e) => { fireBoltFromEvent(e); setActivePath(f.path); }}
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
                    <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "10.5px", fontWeight: 700, flex: "0 0 auto", width: "14px", textAlign: "center", color: CHANGE_COLOR[f.changeType] }}>
                      {CHANGE_LETTER[f.changeType]}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "12px", color: isActive ? "#F3F5F9" : "#C7CCD8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{f.path}</span>
                    <span style={{ flex: "0 0 auto", fontSize: "10.5px", fontFamily: "var(--font-mono), monospace" }}>
                      {f.additions > 0 && <span style={{ color: "#35D6A4" }}>+{f.additions}</span>}
                      {f.additions > 0 && f.deletions > 0 && " "}
                      {f.deletions > 0 && <span style={{ color: "#FF6B6B" }}>-{f.deletions}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              {active && (
                <div style={{ flex: "0 0 auto", padding: "10px 20px", borderBottom: "1px solid #1E232C", fontFamily: "var(--font-mono), monospace", fontSize: "12.5px", color: "#C7CCD8" }}>
                  {active.path}
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
