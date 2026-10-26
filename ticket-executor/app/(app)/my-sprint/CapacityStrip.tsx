import { COLORS, FONT, card, sectionCaption, toneTint } from "@/lib/ui";
import { dayLabel, type PlannedRow } from "./model";

// The release calendar at a glance: points landing on each working day against the daily pace.
// Only the developer's own tickets count — a handed-off ticket is delivered at no capacity.
export default function CapacityStrip({ days, rows, pointsPerDay, today }: { days: string[]; rows: PlannedRow[]; pointsPerDay: number; today: string }) {
  if (days.length === 0 || pointsPerDay <= 0) return null;
  const load = new Map<string, number>();
  for (const t of rows) if (t.claim === "mine" && t.releaseDay) load.set(t.releaseDay, (load.get(t.releaseDay) ?? 0) + t.points);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={sectionCaption()}>RELEASE CAPACITY · {pointsPerDay} PT / DAY</span>
      <div style={{ ...card({ padding: "10px 12px" }), display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {days.map((d) => {
          const pts = load.get(d) ?? 0;
          const over = pts > pointsPerDay;
          const color = over ? COLORS.danger : pts === 0 ? COLORS.faint : COLORS.success;
          const [weekday, day] = dayLabel(d).split(" ");
          return (
            <span
              key={d}
              title={`${dayLabel(d)} · ${pts} of ${pointsPerDay} points`}
              style={{ flex: "1 0 52px", display: "flex", flexDirection: "column", gap: "4px", padding: "6px", borderRadius: "6px", border: `1px solid ${d === today ? COLORS.accent : COLORS.borderSubtle}`, background: over ? toneTint(COLORS.danger, 12) : "transparent" }}
            >
              <span style={{ fontSize: FONT.xs, color: COLORS.textDim, fontWeight: 600 }}>{weekday} {day}</span>
              <span style={{ fontSize: FONT.sm, fontWeight: 700, color }}>{pts}/{pointsPerDay}</span>
              <span style={{ height: "3px", borderRadius: "2px", background: COLORS.borderSubtle, overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${Math.min(100, (pts / pointsPerDay) * 100)}%`, background: color }} />
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
