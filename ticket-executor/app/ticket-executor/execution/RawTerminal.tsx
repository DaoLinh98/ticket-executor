"use client";

import type { CSSProperties, RefObject } from "react";
import type { UiRunState } from "@/lib/types";
import { FONT, ringBorder } from "@/lib/ui";
import type { LogLineView } from "../types";

type Props = {
  logLines: LogLineView[];
  logRef: RefObject<HTMLDivElement | null>;
  projectName: string;
  state: UiRunState;
  statusLabel: string;
  logStatusStyle: CSSProperties;
};

export default function RawTerminal({ logLines, logRef, projectName, state, statusLabel, logStatusStyle }: Props) {
  return (
    <div style={{ position: "relative", minWidth: 0, borderRadius: "13px", overflow: "hidden", boxShadow: "0 24px 60px -34px #000", ...ringBorder({ fill: "var(--te-panel-bg-dark)", duration: 5.5, shape: "none" }) }}>
      <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg,rgba(255,255,255,.016) 0px,rgba(255,255,255,.016) 1px,transparent 1px,transparent 3px)" }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "1px", zIndex: 0, pointerEvents: "none", background: "linear-gradient(90deg,transparent,var(--accent),transparent)", opacity: 0.55 }} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "10px", padding: "11px 15px", borderBottom: "1px solid var(--te-btn-ghost-fill)", background: "var(--te-inset-bg)" }}>
        <span style={{ display: "flex", gap: "6px" }}><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#3A3030" }} /><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#3A3830" }} /><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#2F3A32" }} /></span>
        <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, color: "var(--te-text-muted)", marginLeft: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>claude-code — {projectName}</span>
        <div style={{ flex: 1 }} />
        <span style={logStatusStyle}>{statusLabel}</span>
      </div>
      <div ref={logRef} className="te-scroll" style={{ position: "relative", zIndex: 1, height: "560px", overflowY: "auto", padding: "14px 17px", fontFamily: "var(--font-mono), monospace", fontSize: FONT.base, lineHeight: 1.75 }}>
        {logLines.length === 0 && <div style={{ color: "var(--te-faint)" }}>Waiting for output…</div>}
        {logLines.map((l) => (
          <div key={l.num} style={{ display: "flex", gap: "12px" }}>
            <span style={l.style}>{l.text}</span>
          </div>
        ))}
        {state === "running" && <span style={{ display: "inline-block", width: "8px", height: "15px", background: "var(--accent)", verticalAlign: "text-bottom", animation: "blink 1s step-end infinite", marginLeft: "0" }} />}
      </div>
    </div>
  );
}
