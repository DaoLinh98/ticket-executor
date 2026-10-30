"use client";

import Link from "next/link";
import { COLORS, FONT, card, pill, sectionCaption, toneTint } from "@/lib/ui";
import type { PlanRowPayload } from "../../queries";
import { dayLabel, stateOf } from "../../(app)/my-sprint/model";
import { MONO } from "./parts";

const chip = { display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 999, fontSize: FONT.xs, color: COLORS.text, textDecoration: "none" } as const;

/** The ticket's place in Flow Runner: queue position, release day, state, PR — and the way back to My Sprint. */
export default function PlanRowCard({ plan }: { plan: PlanRowPayload }) {
  const row = plan.row;
  if (!row) return null;
  const state = stateOf(row, "");
  return (
    <section aria-label="Flow Runner plan" style={{ ...card({ padding: "10px 12px" }), marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <b style={{ ...sectionCaption(), flex: 1, fontSize: FONT.xs }}>Flow Runner · {plan.sprint || "active plan"}</b>
        <Link href="/my-sprint" className="te-run-pr te-wf-tap" style={chip}>
          My Sprint →
        </Link>
      </div>
      <dl style={{ margin: "8px 0 0", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "6px 12px", fontSize: FONT.sm }}>
        <dt style={{ color: COLORS.textMuted }}>State</dt>
        <dd style={{ margin: 0 }}>
          <span style={pill({ color: state.color, background: toneTint(state.color), size: "xs" })}>{state.label}</span>
        </dd>
        <dt style={{ color: COLORS.textMuted }}>Queue</dt>
        <dd style={{ margin: 0, fontFamily: MONO }}>{plan.queuePosition ? `#${plan.queuePosition} of ${plan.queueLength}` : "Not queued"}</dd>
        <dt style={{ color: COLORS.textMuted }}>Release day</dt>
        <dd style={{ margin: 0 }}>{row.releaseDay ? dayLabel(row.releaseDay) : "Not scheduled in this sprint"}</dd>
        {row.prUrl ? (
          <>
            <dt style={{ color: COLORS.textMuted }}>PR</dt>
            <dd style={{ margin: 0, minWidth: 0 }}>
              <a href={row.prUrl} target="_blank" rel="noreferrer" className="te-run-pr te-wf-tap" style={{ ...chip, display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.prUrl.replace(/^https?:\/\//, "")} ↗
              </a>
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

/** The same row as one header chip (desktop only — the phone reads the card on the Run tab). */
export function PlanRowChip({ plan }: { plan: PlanRowPayload }) {
  const row = plan.row;
  if (!row) return null;
  const state = stateOf(row, "");
  const where = plan.queuePosition ? `#${plan.queuePosition} in queue` : row.releaseDay ? `release ${dayLabel(row.releaseDay)}` : "";
  return (
    <Link href="/my-sprint" className="te-run-pr te-mobile-hide" title="Open this ticket's row on My Sprint" style={{ ...chip, flex: "0 0 auto", gap: 6, whiteSpace: "nowrap" }}>
      Flow Runner
      <span style={pill({ color: state.color, background: toneTint(state.color), size: "xs" })}>{state.label}</span>
      {where ? <span style={{ color: COLORS.textMuted }}>{where}</span> : null}
    </Link>
  );
}
