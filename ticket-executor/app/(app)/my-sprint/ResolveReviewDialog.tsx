"use client";

import { ModalOverlay, ModalPanel } from "../../Modal";
import { useEffect, useState } from "react";
import { COLORS, FONT, displayText, fieldInput, modalOverlayStyle, modalShellStyle, pill } from "@/lib/ui";
import ActionButton from "./ActionButton";
import type { PlannedRow } from "./model";

type Props = {
  row: PlannedRow;
  busy: boolean;
  onConfirm: (findings: string) => void;
  onCancel: () => void;
};

export default function ResolveReviewDialog({ row, busy, onConfirm, onCancel }: Props) {
  const [findings, setFindings] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  return (
    <ModalOverlay className="te-modal-overlay" style={modalOverlayStyle({ zIndex: 60 })} onClick={() => { if (!busy) onCancel(); }}>
      <ModalPanel
        className="te-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label={`Resolve code review for #${row.ticketId}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          ...modalShellStyle(),
          width: "min(620px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={displayText("heading")}>Resolve Code Review</span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "2px" }}>
              <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, fontWeight: 700, color: "var(--accent)" }}>
                #{row.ticketId}
              </span>
              <span style={{ fontSize: FONT.base, color: COLORS.text, fontWeight: 600 }}>{row.title}</span>
            </div>
          </div>
          {row.openComments > 0 && (
            <span style={pill({ color: COLORS.warning, size: "sm" })}>
              {row.openComments} open comment{row.openComments === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {row.prUrl && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: FONT.sm, color: COLORS.textMuted }}>
            <span>Pull Request:</span>
            <a
              href={row.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: COLORS.indigo, textDecoration: "none", fontFamily: "var(--font-mono), monospace" }}
            >
              {row.prUrl}
            </a>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.textSoft, letterSpacing: ".04em" }}>
            REVIEWER FINDINGS & FEEDBACK (OPTIONAL)
          </label>
          <span style={{ fontSize: FONT.sm, color: COLORS.textDim, lineHeight: 1.5 }}>
            Paste any extra findings, feedback from the reviewer, or comments from PR/chat. D-Agent will analyze each point alongside the pull request's open threads and clear all valid findings with code fixes.
          </span>
          <textarea
            value={findings}
            onChange={(e) => setFindings(e.target.value)}
            disabled={busy}
            placeholder={
              "e.g.:\n" +
              "- Bug in OrderService: null pointer exception when discount is 0\n" +
              "- Missing unit test for negative amounts\n" +
              "- CodeRabbit comment: please rename variable x to y"
            }
            rows={6}
            style={{
              ...fieldInput(),
              minHeight: "140px",
              padding: "10px 13px",
              resize: "vertical",
              lineHeight: 1.5,
              fontFamily: "var(--font-mono), monospace",
              fontSize: FONT.sm,
            }}
          />
        </div>

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", flexWrap: "wrap", marginTop: "4px" }}>
          <ActionButton label="Cancel" variant="ghost" onClick={onCancel} disabled={busy} />
          <ActionButton
            label={busy ? "Starting..." : "Start Review Fix"}
            variant="primary"
            onClick={() => onConfirm(findings)}
            busy={busy}
          />
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
