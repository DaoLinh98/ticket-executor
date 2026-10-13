"use client";

import { useEffect, type ReactNode } from "react";
import { COLORS, FONT, displayText, modalOverlayStyle, modalShellStyle } from "@/lib/ui";
import ActionButton from "./ActionButton";

export default function ConfirmDialog({
  title,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="te-modal-overlay" style={modalOverlayStyle({ zIndex: 60 })} onClick={onCancel}>
      <div
        className="te-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ ...modalShellStyle(), width: "min(520px, 100%)", maxHeight: "100%", overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}
      >
        <span style={displayText("heading")}>{title}</span>
        <div style={{ fontSize: FONT.md, color: COLORS.textMuted, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: "8px" }}>
          {children}
        </div>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <ActionButton label="Cancel" variant="ghost" onClick={onCancel} disabled={busy} />
          <ActionButton label={confirmLabel} variant="primary" onClick={onConfirm} busy={busy} />
        </div>
      </div>
    </div>
  );
}
