import { useState, type ReactNode } from "react";
import { COLORS, FONT, pill, sectionCaption, tintedCard } from "@/lib/ui";

export type AttentionItem = {
  key: string;
  ticketId: string;
  title: string;
  tone: "danger" | "warning" | "accent";
  text: string;
  action?: ReactNode;
};

// The pill's colour is the only sign of urgency, so a screen reader is told the same thing in words.
const TONE_WORD = { danger: "Urgent", warning: "Needs a decision", accent: "Action available" } as const;

export default function NeedsYou({ items }: { items: AttentionItem[] }) {
  const [hidden, setHidden] = useState(false);
  if (items.length === 0 || hidden) return null;
  return (
    <section aria-label={`Needs you, ${items.length} ${items.length === 1 ? "item" : "items"}`} style={{ ...tintedCard("warning", { padding: "14px 16px" }), display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <span style={sectionCaption()}>NEEDS YOU · {items.length}</span>
        <button
          type="button"
          className="te-icon-btn"
          aria-label="Hide needs you"
          title="Hide until the page is refreshed"
          onClick={() => setHidden(true)}
          style={{ width: "24px", height: "24px", display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: COLORS.textMuted, cursor: "pointer", padding: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div role="list" style={{ display: "contents" }}>
      {items.map((it) => (
        <div key={it.key} role="listitem" style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span aria-label={`${TONE_WORD[it.tone]}: ticket ${it.ticketId}`} style={pill({ color: COLORS[it.tone], size: "xs", weight: 700 })}>#{it.ticketId}</span>
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
    </section>
  );
}
