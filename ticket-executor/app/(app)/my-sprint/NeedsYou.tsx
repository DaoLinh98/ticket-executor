import type { ReactNode } from "react";
import { COLORS, FONT, pill, sectionCaption, tintedCard } from "@/lib/ui";

export type AttentionItem = {
  key: string;
  ticketId: string;
  title: string;
  tone: "danger" | "warning" | "accent";
  text: string;
  action?: ReactNode;
};

export default function NeedsYou({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{ ...tintedCard("warning", { padding: "14px 16px" }), display: "flex", flexDirection: "column", gap: "10px" }}>
      <span style={sectionCaption()}>NEEDS YOU · {items.length}</span>
      {items.map((it) => (
        <div key={it.key} style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={pill({ color: COLORS[it.tone], size: "xs", weight: 700 })}>#{it.ticketId}</span>
          <span style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
            <span title={it.title} style={{ fontSize: FONT.base, color: COLORS.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {it.title}
            </span>
            <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.5 }}>{it.text}</span>
          </span>
          {it.action}
        </div>
      ))}
    </div>
  );
}
