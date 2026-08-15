"use client";

import { useEffect, useRef, useState } from "react";
import { COLORS, FONT, toastStyle } from "@/lib/ui";

/** One notification. `id` exists so the caller can mount a fresh Toast per
 *  message (`key={toast.id}`) — that is what restarts both the slide-in and the
 *  countdown instead of letting a new message inherit the previous one's
 *  remaining time. */
export type ToastMessage = {
  id: number;
  msg: string;
  /** `warning` is for an action that succeeded but left something unusable —
   *  distinct from `error`, which means it did not happen at all. */
  kind: "success" | "error" | "warning";
  /** How long it stays up, in ms. Hovering pauses this. */
  durationMs?: number;
};

// Bottom-right transient notification with a draining progress bar. The toast
// owns its own dismissal: hovering freezes the countdown (and the bar) until the
// pointer leaves, so a long message can actually be read, and the × dismisses it
// immediately.
export default function Toast({ toast, onClose }: { toast: ToastMessage; onClose?: () => void }) {
  const tone = toastStyle(toast.kind);
  const duration = toast.durationMs ?? 7000;
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);

  useEffect(() => {
    if (!onClose || paused) return;
    const startedAt = Date.now();
    const id = setTimeout(onClose, remaining.current);
    return () => {
      clearTimeout(id);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [paused, onClose]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{ position: "fixed", overflow: "hidden", bottom: "24px", right: "24px", zIndex: 60, maxWidth: "min(560px, calc(100vw - 48px))", display: "flex", alignItems: "flex-start", gap: "11px", padding: "14px 16px 14px 18px", border: `1px solid ${tone.border}`, borderLeft: `3px solid ${tone.accent}`, borderRadius: "11px", background: "#14171D", boxShadow: "0 20px 50px -20px #000", animation: "slideIn .3s both" }}
    >
      {toast.kind === "error" ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" style={{ stroke: tone.accent, flex: "0 0 auto", marginTop: "2px" }}><path d="M6 6l12 12M18 6L6 18" style={{ strokeDasharray: 34, strokeDashoffset: 34, animation: "draw .5s .1s ease forwards" }} /></svg>
      ) : toast.kind === "warning" ? (
        // The tone has to be readable without the colour — the icon is what a
        // glance actually lands on, and a red ✕ next to "Settings saved" reads
        // as a contradiction.
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: tone.accent, flex: "0 0 auto", marginTop: "2px" }}>
          <path d="M12 3.2L1.9 20.8h20.2z" style={{ strokeDasharray: 62, strokeDashoffset: 62, animation: "draw .5s .1s ease forwards" }} />
          <path d="M12 9.6v4.4" style={{ strokeDasharray: 5, strokeDashoffset: 5, animation: "draw .3s .5s ease forwards" }} />
          <path d="M12 17.6v.01" style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: "draw .2s .7s ease forwards" }} />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" style={{ stroke: tone.accent, flex: "0 0 auto", marginTop: "2px" }}><path d="M5 13l4 4L19 7" style={{ strokeDasharray: 26, strokeDashoffset: 26, animation: "draw .5s .1s ease forwards" }} /></svg>
      )}
      <span style={{ flex: 1, minWidth: 0, fontSize: FONT.md, fontWeight: 600, color: COLORS.text, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{toast.msg}</span>
      {onClose && (
        <button
          onClick={onClose}
          title="Dismiss"
          style={{ flex: "0 0 auto", width: "20px", height: "20px", marginTop: "1px", display: "flex", alignItems: "center", justifyContent: "center", border: "none", borderRadius: "6px", background: "transparent", color: COLORS.textDim, cursor: "pointer" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      )}
      <span style={{ position: "absolute", left: 0, bottom: 0, height: "2px", width: "100%", background: tone.accent, opacity: 0.6, transformOrigin: "left", animation: `shrink ${duration}ms linear forwards`, animationPlayState: paused ? "paused" : "running" }} />
    </div>
  );
}
