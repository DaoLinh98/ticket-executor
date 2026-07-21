"use client";

import type { FileChange } from "@/lib/types";
import { ringBorder } from "@/lib/ui";

// Full-screen popup showing one file's unified diff from a completed run.
export default function DiffModal({ file, onClose }: { file: FileChange; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 55, background: "rgba(6,7,9,.68)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn .2s both" }} onClick={onClose}>
      <div style={{ width: "820px", maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", border: "1px solid #262B36", borderRadius: "16px", background: "#14171D", boxShadow: "0 40px 90px -30px #000", animation: "slideIn .28s both", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #1E232C", flex: "0 0 auto" }}>
          <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: "13px", fontWeight: 700, color: "#F3F5F9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.path}</span>
          <button onClick={onClose} style={{ width: "26px", height: "26px", flex: "0 0 auto", color: "#8A90A0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", ...ringBorder({ fill: "#1A1E25", duration: 4, cornerPx: 6 }) }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="te-scroll" style={{ flex: 1, overflow: "auto", padding: "14px 0", fontFamily: "var(--font-mono), monospace", fontSize: "12px", lineHeight: 1.6 }}>
          {file.diff.trim() ? (
            file.diff.split(/\r?\n/).map((line, i) => {
              const isAdd = line.startsWith("+") && !line.startsWith("+++");
              const isDel = line.startsWith("-") && !line.startsWith("---");
              const isHunk = line.startsWith("@@");
              const isMeta = line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---");
              return (
                <div
                  key={i}
                  style={{
                    padding: "1px 20px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    color: isAdd ? "#5BE8B8" : isDel ? "#FF8F8F" : isHunk ? "#9BA6E8" : isMeta ? "#5B6273" : "#C7CCD8",
                    background: isAdd ? "rgba(53,214,164,.08)" : isDel ? "rgba(255,107,107,.08)" : "transparent",
                  }}
                >
                  {line || " "}
                </div>
              );
            })
          ) : (
            <div style={{ padding: "0 20px", color: "#5B6273" }}>No diff content available for this file.</div>
          )}
        </div>
      </div>
    </div>
  );
}
