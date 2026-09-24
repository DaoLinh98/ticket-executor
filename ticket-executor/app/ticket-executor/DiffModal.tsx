"use client";

import type { FileChange } from "@/lib/types";
import { FONT, modalShellStyle, ringBorder } from "@/lib/ui";
import DiffView from "./DiffView";
import { useBoltsContext } from "../BoltsContext";

// Full-screen popup showing one file's unified diff from a completed run.
export default function DiffModal({ file, onClose }: { file: FileChange; onClose: () => void }) {
  const { fireBoltFromEvent } = useBoltsContext();
  return (
    <div className="te-modal-overlay" style={{ position: "fixed", inset: 0, zIndex: 55, background: "var(--te-scrim)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn .2s both" }} onClick={onClose}>
      <div className="te-modal-shell" style={{ width: "1180px", maxWidth: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", ...modalShellStyle() }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--te-border-subtle)", flex: "0 0 auto" }}>
          <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.base, fontWeight: 700, color: "var(--te-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.path}</span>
          <button onClick={(e) => { fireBoltFromEvent(e); onClose(); }} style={{ width: "26px", height: "26px", flex: "0 0 auto", color: "var(--te-text-dim)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", ...ringBorder({ fill: "var(--te-btn-ghost-fill)", duration: 4, cornerPx: 6 }) }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <DiffView diff={file.diff} />
      </div>
    </div>
  );
}
