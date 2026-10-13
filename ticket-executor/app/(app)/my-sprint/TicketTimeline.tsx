"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import LoadingRing from "../../ticket-executor/LoadingRing";
import { COLORS, FONT, displayText, modalOverlayStyle, modalShellStyle } from "@/lib/ui";
import ActionButton from "./ActionButton";
import type { AutomationRow } from "./model";

export default function TicketTimeline({ ticketId, title, onClose }: { ticketId: string; title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = useQuery({
    queryKey: ["my-sprint", "history", ticketId],
    queryFn: (): Promise<AutomationRow[]> =>
      fetch("/api/my-sprint/plan?events=" + encodeURIComponent(ticketId))
        .then((r) => r.json())
        .then((d) => (Array.isArray(d.events) ? d.events : [])),
  });
  const events = q.data ?? [];

  return (
    <div className="te-modal-overlay" style={modalOverlayStyle({ zIndex: 60 })} onClick={onClose}>
      <div
        className="te-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label={`History of #${ticketId}`}
        onClick={(e) => e.stopPropagation()}
        style={{ ...modalShellStyle(), width: "min(620px, 100%)", maxHeight: "100%", overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}
      >
        <span style={displayText("heading")}>#{ticketId} history</span>
        <span style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>{title}</span>
        {q.isPending ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "20px" }}><LoadingRing size={40} /></div>
        ) : events.length === 0 ? (
          <span style={{ fontSize: FONT.base, color: COLORS.textMuted }}>The scheduler has recorded nothing for this ticket yet.</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {events.map((e) => (
              <span key={e.id} style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.5 }}>
                <span style={{ color: COLORS.textDim }}>{new Date(e.createdAt).toLocaleString()}</span>
                {" · "}
                <span style={{ color: e.outcome === "failed" ? COLORS.danger : e.outcome === "skipped" ? COLORS.warning : COLORS.success, fontWeight: 700 }}>
                  {e.action} {e.outcome}
                </span>
                {e.reason ? ` · ${e.reason}` : ""}
                {e.detail ? ` — ${e.detail}` : ""}
              </span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <ActionButton label="Close" variant="ghost" onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
