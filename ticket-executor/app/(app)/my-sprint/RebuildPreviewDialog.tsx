"use client";

import { COLORS, FONT, sectionCaption } from "@/lib/ui";
import ConfirmDialog from "./ConfirmDialog";
import { dayLabel, type RebuildPreview } from "./model";

export default function RebuildPreviewDialog({
  preview,
  busy,
  onConfirm,
  onCancel,
}: {
  preview: RebuildPreview;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const name = (id: string) => `#${id} · ${preview.titles[id] ?? ""}`;
  const group = (title: string, lines: string[]) =>
    lines.length === 0 ? null : (
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={sectionCaption()}>{title} · {lines.length}</span>
        {lines.map((l) => (
          <span key={l} style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.5 }}>{l}</span>
        ))}
      </div>
    );

  return (
    <ConfirmDialog title="Rebuild the plan?" confirmLabel="Rebuild" busy={busy} onConfirm={onConfirm} onCancel={onCancel}>
      <span>Only tickets that have not started are re-ordered and re-dated. Work already run or released keeps its record.</span>
      {group("NEW IN THE PLAN", preview.added.map(name))}
      {group("QUEUE POSITION CHANGES", preview.moved.map((m) => `${name(m.ticketId)} — ${m.from || "—"} → ${m.to || "—"}`))}
      {group("RELEASE DAY CHANGES", preview.redated.map((m) => `${name(m.ticketId)} — ${dayLabel(m.from)} → ${dayLabel(m.to)}`))}
      {group("CLAIM CHANGES", preview.claimChanged.map((m) => `${name(m.ticketId)} — ${m.from} → ${m.to}`))}
      {preview.overflowPoints > 0 && (
        <span style={{ color: COLORS.danger, fontWeight: 600 }}>
          {preview.overflowPoints} points would have no release day left in this sprint.
        </span>
      )}
    </ConfirmDialog>
  );
}
