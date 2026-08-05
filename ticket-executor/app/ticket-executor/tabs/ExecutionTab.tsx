"use client";

import type { CSSProperties, RefObject } from "react";
import type { UiRunState } from "@/lib/types";
import { FONT, ringBorder, tintedCard } from "@/lib/ui";
import type { LogLineView, StepView } from "../types";

type Props = {
  steps: StepView[];
  logLines: LogLineView[];
  logRef: RefObject<HTMLDivElement | null>;
  projectName: string;
  state: UiRunState;
  statusLabel: string;
  logStatusStyle: CSSProperties;
  error?: string;
};

// The 7-step workflow timeline plus the live claude-code terminal.
export default function ExecutionTab({
  steps, logLines, logRef, projectName, state, statusLabel, logStatusStyle, error,
}: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", animation: "fadeUp .35s both" }}>
      <div style={{ display: "flex", gap: "26px", alignItems: "flex-start" }}>
        <div style={{ flex: "0 0 236px", paddingTop: "4px" }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: "13px", alignItems: "flex-start" }}>
              <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={s.dotStyle}>
                  {s.showCheck && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2"><path d="M5 13l4 4L19 7" /></svg>}
                  {s.showSpinner && <><span style={{ position: "absolute", inset: "-5px", borderRadius: "50%", border: "1px solid rgba(245,179,65,.55)", animation: "ringPulse 1.7s ease-out infinite" }} /><span style={{ position: "absolute", inset: "-5px", borderRadius: "50%", border: "1px solid rgba(245,179,65,.4)", animation: "ringPulse 1.7s ease-out .85s infinite" }} /><span style={{ width: "11px", height: "11px", borderRadius: "50%", border: "2px solid rgba(245,179,65,.3)", borderTopColor: "#F5B341", display: "inline-block", animation: "spin .7s linear infinite" }} /></>}
                  {s.showX && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2"><path d="M6 6l12 12M18 6L6 18" /></svg>}
                  {s.showNum && s.num}
                </span>
                <span style={s.connectorStyle} />
              </div>
              <span style={s.labelStyle}>{s.label}</span>
            </div>
          ))}
        </div>
        <div style={{ position: "relative", flex: 1, minWidth: 0, borderRadius: "13px", overflow: "hidden", boxShadow: "0 24px 60px -34px #000", ...ringBorder({ fill: "#0A0B0E", duration: 5.5, shape: "none" }) }}>
          <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg,rgba(255,255,255,.016) 0px,rgba(255,255,255,.016) 1px,transparent 1px,transparent 3px)" }} />
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "1px", zIndex: 0, pointerEvents: "none", background: "linear-gradient(90deg,transparent,var(--accent),transparent)", opacity: 0.55 }} />
          <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "10px", padding: "11px 15px", borderBottom: "1px solid #1A1E25", background: "#0E1015" }}>
            <span style={{ display: "flex", gap: "6px" }}><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#3A3030" }} /><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#3A3830" }} /><span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#2F3A32" }} /></span>
            <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, color: "#6B7283", marginLeft: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>claude-code — {projectName}</span>
            <div style={{ flex: 1 }} />
            <span style={logStatusStyle}>{statusLabel}</span>
          </div>
          <div ref={logRef} className="te-scroll" style={{ position: "relative", zIndex: 1, height: "430px", overflowY: "auto", padding: "14px 17px", fontFamily: "var(--font-mono), monospace", fontSize: FONT.base, lineHeight: 1.75 }}>
            {logLines.length === 0 && <div style={{ color: "#5B6273" }}>Waiting for output…</div>}
            {logLines.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: "12px" }}>
                <span style={l.style}>{l.text}</span>
              </div>
            ))}
            {state === "running" && <span style={{ display: "inline-block", width: "8px", height: "15px", background: "var(--accent)", verticalAlign: "text-bottom", animation: "blink 1s step-end infinite", marginLeft: "0" }} />}
          </div>
        </div>
      </div>
      {state === "failed" && error && (
        <div style={{ display: "flex", gap: "13px", alignItems: "flex-start", ...tintedCard("danger") }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth="2" style={{ flex: "0 0 auto", marginTop: "1px" }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
          <div><div style={{ fontSize: FONT.md, fontWeight: 700, color: "#FF8F8F", marginBottom: "3px" }}>Execution failed</div><div style={{ fontSize: FONT.base, color: "#C7A8A8", lineHeight: 1.55 }}>{error}</div></div>
        </div>
      )}
    </div>
  );
}
