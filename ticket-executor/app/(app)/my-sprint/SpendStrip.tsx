import { COLORS, FONT, card, sectionCaption } from "@/lib/ui";
import type { SprintSpend } from "@/lib/sprintSpend";
import { usd } from "./model";

// What the sprint has cost and where it is heading. The estimate is the average of the tickets already
// delivered times the tickets still to run — rough, and shown as such until a ticket has been delivered.
export default function SpendStrip({ spend, budgetUsd }: { spend: SprintSpend; budgetUsd: number }) {
  if (spend.spent <= 0 && spend.remaining === 0) return null;
  const stat = (label: string, value: string, color: string = COLORS.text, title?: string) => (
    <span title={title} style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "84px" }}>
      <span style={{ fontSize: FONT.xs, color: COLORS.textDim, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: FONT.base, fontWeight: 700, color }}>{value}</span>
    </span>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={sectionCaption()}>SPEND</span>
      <div style={{ ...card({ padding: "10px 12px" }), display: "flex", flexWrap: "wrap", gap: "14px 20px" }}>
        {stat("Spent", usd(spend.spent))}
        {spend.finished > 0
          ? stat("Per delivered", usd(spend.avgPerFinished), COLORS.text, `Average over ${spend.finished} delivered ticket${spend.finished === 1 ? "" : "s"}`)
          : stat("Per delivered", "—", COLORS.textDim, "No ticket has been delivered yet")}
        {spend.remaining > 0 && spend.finished > 0
          ? stat("Likely to finish", usd(spend.projectedTotal), COLORS.text, `${spend.remaining} ticket${spend.remaining === 1 ? "" : "s"} still to run at the average`)
          : null}
        {spend.overBudget > 0 ? stat("Over budget", `${spend.overBudget} of ${usd(budgetUsd)} each`, COLORS.warning) : null}
        {spend.pointsLeft > 0 && spend.capacityLeft > 0
          ? stat("Points left", `${spend.pointsLeft} / ${spend.capacityLeft} releasable`, spend.fits ? COLORS.success : COLORS.danger, spend.fits ? "The days left release what is still to build" : "More points are left to build than the days left can release")
          : null}
      </div>
    </div>
  );
}
