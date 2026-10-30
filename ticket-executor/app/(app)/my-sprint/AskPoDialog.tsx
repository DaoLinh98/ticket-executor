"use client";

import { useEffect, useState } from "react";
import { COLORS, FONT, displayText, fieldInput, modalOverlayStyle, modalShellStyle } from "@/lib/ui";
import ActionButton from "./ActionButton";

// Readiness's questions for the PO, editable before they are posted on the work item. Nothing is written until
// the developer presses Post; afterwards the scheduler watches for the PO's reply and rechecks readiness itself.
export default function AskPoDialog({
  ticketId,
  questions,
  busy,
  onPost,
  onCancel,
}: {
  ticketId: string;
  questions: string[];
  busy: boolean;
  onPost: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(() => questions.map((q, i) => `${i + 1}. ${q}`).join("\n"));

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
        aria-label={`Questions for the PO on #${ticketId}`}
        onClick={(e) => e.stopPropagation()}
        style={{ ...modalShellStyle(), width: "min(560px, 100%)", maxHeight: "100%", overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}
      >
        <span style={displayText("heading")}>Ask the PO · #{ticketId}</span>
        <span style={{ fontSize: FONT.md, color: COLORS.textMuted, lineHeight: 1.6 }}>
          Readiness stopped this ticket with these questions. Edit them, then post them as a comment on the work item.
          When someone else replies there, the run checks readiness again on its own.
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          aria-label="Questions for the PO"
          style={{ ...fieldInput(), minHeight: "160px", padding: "10px 13px", resize: "vertical", lineHeight: 1.5 }}
        />
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <ActionButton label="Cancel" variant="ghost" onClick={onCancel} disabled={busy} />
          <ActionButton label="Post to ticket" variant="primary" onClick={() => onPost(body)} busy={busy} disabled={!body.trim()} />
        </div>
      </div>
    </div>
  );
}
