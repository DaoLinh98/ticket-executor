"use client";

import { KNOWLEDGE_MAX_LINES, type KnowledgeChange } from "@/lib/types";
import { COLORS, FONT, card, sectionCaption, tintedCard } from "@/lib/ui";

export default function KnowledgeChangeCard({ change }: { change?: KnowledgeChange | null }) {
  if (!change) return null;
  const rows = [
    ...change.removed.map((text) => ({ sign: "−", text, color: COLORS.danger })),
    ...change.added.map((text) => ({ sign: "+", text, color: COLORS.success })),
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
      <div style={sectionCaption()}>
        Project memory updated (+{change.added.length} / −{change.removed.length})
      </div>
      <div style={card()}>
        <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.xs, color: COLORS.textMuted, wordBreak: "break-all", marginBottom: rows.length ? "8px" : 0 }}>
          {change.file}
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: "8px", fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, lineHeight: 1.6 }}>
            <span style={{ flex: "0 0 auto", color: r.color, fontWeight: 700 }}>{r.sign}</span>
            <span style={{ color: COLORS.text, whiteSpace: "pre-wrap", wordBreak: "break-word", minWidth: 0 }}>{r.text}</span>
          </div>
        ))}
      </div>
      {change.lines > KNOWLEDGE_MAX_LINES && (
        <div style={{ fontSize: FONT.sm, color: COLORS.text, ...tintedCard("warning") }}>
          KNOWLEDGE.md is {change.lines} lines, over the {KNOWLEDGE_MAX_LINES} every run reads. Merge or remove outdated entries.
        </div>
      )}
    </div>
  );
}
