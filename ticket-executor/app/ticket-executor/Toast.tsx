"use client";

import { toastStyle } from "@/lib/ui";

// Bottom-right transient notification with a draining progress bar.
export default function Toast({ toast }: { toast: { msg: string; kind: "success" | "error" } }) {
  const tone = toastStyle(toast.kind);
  return (
    <div style={{ position: "fixed", overflow: "hidden", bottom: "24px", right: "24px", zIndex: 60, display: "flex", alignItems: "center", gap: "11px", padding: "14px 18px", border: `1px solid ${tone.border}`, borderLeft: `3px solid ${tone.accent}`, borderRadius: "11px", background: "#14171D", boxShadow: "0 20px 50px -20px #000", animation: "slideIn .3s both" }}>
      {toast.kind === "error" ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={tone.accent} strokeWidth="2.6"><path d="M6 6l12 12M18 6L6 18" style={{ strokeDasharray: 34, strokeDashoffset: 34, animation: "draw .5s .1s ease forwards" }} /></svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={tone.accent} strokeWidth="2.6"><path d="M5 13l4 4L19 7" style={{ strokeDasharray: 26, strokeDashoffset: 26, animation: "draw .5s .1s ease forwards" }} /></svg>
      )}
      <span style={{ fontSize: "13.5px", fontWeight: 600, color: "#ECEEF3" }}>{toast.msg}</span>
      <span style={{ position: "absolute", left: 0, bottom: 0, height: "2px", width: "100%", background: tone.accent, opacity: 0.6, transformOrigin: "left", animation: "shrink 4s linear forwards" }} />
    </div>
  );
}
