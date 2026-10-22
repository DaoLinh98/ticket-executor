"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { attentionNotifications } from "@/lib/notifications";
import { COLORS, FONT, ctaButtonStyle, modalOverlayStyle, modalShellStyle, pill, tintedCard } from "@/lib/ui";
import { useBoltsContext } from "../BoltsContext";
import { useNotifications } from "./NotificationsProvider";

export default function QaAttentionPopup() {
  const router = useRouter();
  const { notifications, read, markOneRead } = useNotifications();
  const { fireBoltFromEvent } = useBoltsContext();
  const items = useMemo(() => attentionNotifications(notifications, read), [notifications, read]);

  if (!items.length) return null;

  const dismiss = () => items.forEach(markOneRead);

  return (
    <div className="te-modal-overlay" style={{ ...modalOverlayStyle({ zIndex: 70 }), padding: "24px" }}>
      <div
        className="te-modal-shell"
        role="alertdialog"
        aria-modal="true"
        aria-label="QA needs your attention"
        style={{ width: "460px", maxWidth: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", ...modalShellStyle() }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--te-border-subtle)", fontFamily: "var(--te-font-display)", fontSize: FONT.lg, fontWeight: 700, color: COLORS.text }}>
          QA needs your attention
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "10px", overflowY: "auto" }}>
          {items.map((n) => {
            const failed = n.kind === "ticket.qa-failed";
            return (
              <div key={`${n.kind}::${n.refId}`} style={tintedCard(failed ? "danger" : "accent", { padding: "11px 13px", radius: "10px" })}>
                <span style={pill({ color: failed ? COLORS.danger : COLORS.accent, size: "xs", weight: 700 })}>{failed ? "NEEDS FIX" : "QC REPLY"}</span>
                <div style={{ marginTop: "6px", fontSize: FONT.md, color: COLORS.text }}>{n.summary}</div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--te-border-subtle)", display: "flex", justifyContent: "flex-end", gap: "9px", flexWrap: "wrap" }}>
          <button className="te-action-btn" style={ctaButtonStyle("outline")} onClick={(e) => { fireBoltFromEvent(e); dismiss(); }}>
            Later
          </button>
          <button
            className="te-action-btn"
            style={ctaButtonStyle("primary")}
            onClick={(e) => { fireBoltFromEvent(e); dismiss(); router.push("/my-sprint"); }}
          >
            Open Flow Runner
          </button>
        </div>
      </div>
    </div>
  );
}
