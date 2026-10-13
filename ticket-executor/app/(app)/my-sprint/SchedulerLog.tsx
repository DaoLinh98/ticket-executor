import { COLORS, FONT, card, sectionCaption } from "@/lib/ui";
import type { AutomationRow } from "./model";

export default function SchedulerLog({ events }: { events: AutomationRow[] }) {
  if (events.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={sectionCaption()}>SCHEDULER LOG</span>
      <div style={{ ...card({ padding: "12px 14px" }), display: "flex", flexDirection: "column", gap: "7px" }}>
        {events.slice(0, 12).map((e) => (
          <span key={e.id} style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.5 }}>
            <span style={{ color: COLORS.textDim }}>{new Date(e.createdAt).toLocaleString()}</span>
            {" · "}
            <span style={{ color: e.outcome === "failed" ? COLORS.danger : e.outcome === "skipped" ? COLORS.warning : COLORS.success, fontWeight: 700 }}>
              {e.action} {e.outcome}
            </span>
            {e.ticketId ? ` · #${e.ticketId}` : ""}
            {e.reason ? ` · ${e.reason}` : ""}
            {e.detail ? ` — ${e.detail}` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
