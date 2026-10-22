import { COLORS, FONT, card, pill, sectionCaption } from "@/lib/ui";
import type { AutomationRow } from "./model";

const ACTION_COLOR: Record<string, string> = {
  release: COLORS.accent,
  implement: COLORS.info,
  review: COLORS.indigo,
  watch: "var(--te-hue-purple)",
  abort: "var(--te-hue-orange)",
};

export default function SchedulerLog({ events }: { events: AutomationRow[] }) {
  if (events.length === 0) return null;
  return (
    <div style={{ minHeight: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={sectionCaption()}>SCHEDULER LOG</span>
      <div className="te-scroll te-sprint-pane" style={{ ...card({ padding: "12px 14px" }), maxHeight: "480px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "7px" }}>
        {events.slice(0, 12).map((e) => {
          const color = e.outcome === "failed" ? COLORS.danger : e.outcome === "skipped" ? COLORS.warning : COLORS.success;
          return (
            <span key={e.id} style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.7 }}>
              <span style={{ color: COLORS.text, fontWeight: 700 }}>{new Date(e.createdAt).toLocaleString()}</span>
              {" · "}
              <span style={{ color: ACTION_COLOR[e.action] ?? COLORS.textSoft, fontWeight: 700 }}>{e.action}</span>{" "}
              <span style={pill({ color, size: "xs", weight: 700 })}>{e.outcome}</span>
              {e.ticketId ? <span style={{ color: COLORS.accent, fontWeight: 700 }}>{" · #" + e.ticketId}</span> : ""}
              {e.reason ? ` · ${e.reason}` : ""}
              {e.detail ? ` — ${e.detail}` : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
