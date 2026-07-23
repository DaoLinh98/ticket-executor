"use client";

import type { FileChange } from "@/lib/types";
import { modalShellStyle, ringBorder } from "@/lib/ui";
import DiffView from "./DiffView";
import { useBoltsContext } from "../BoltsContext";

// Full-screen popup showing one file's unified diff from a completed run.
export default function DiffModal({ file, onClose }: { file: FileChange; onClose: () => void }) {
  const { fireBoltFromEvent } = useBoltsContext();
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 55, background: "rgba(6,7,9,.68)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn .2s both" }} onClick={onClose}>
      <div style={{ width: "1180px", maxWidth: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", ...modalShellStyle() }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #1E232C", flex: "0 0 auto" }}>
          <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "13px", fontWeight: 700, color: "#F3F5F9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.path}</span>
          <button onClick={(e) => { fireBoltFromEvent(e); onClose(); }} style={{ width: "26px", height: "26px", flex: "0 0 auto", color: "#8A90A0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", ...ringBorder({ fill: "#1A1E25", duration: 4, cornerPx: 6 }) }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <DiffView diff={file.diff} />
      </div>
    </div>
  );
}
