"use client";

import { useQuery } from "@tanstack/react-query";
import { COLORS, FONT, card, pill, sectionCaption } from "@/lib/ui";
import { fetchTickPreview, tickPreviewKey } from "../../queries";
import { useLiveInvalidate } from "../../useLive";

const ACTION_COLOR: Record<string, string> = { release: COLORS.accent, implement: COLORS.info, retry: COLORS.warning };

// What the scheduler's next tick will do, read from the same rules it acts on — so a ticket that is not starting
// has its reason here instead of in the log the morning after. It decides nothing.
export default function TickPreview({ planId, onOpen }: { planId: string; onOpen: (ticketId: string) => void }) {
  const q = useQuery({ queryKey: tickPreviewKey(planId), queryFn: () => fetchTickPreview(planId), staleTime: 0 });
  useLiveInvalidate("/api/my-sprint/plan/stream?plan=" + encodeURIComponent(planId), tickPreviewKey(planId));
  if (!q.data) return null;
  const { steps, held, notes, active } = q.data;

  const ticket = (id: string) => (
    <button type="button" onClick={() => onOpen(id)} aria-label={`Open the run of #${id}`} style={{ border: "none", background: "transparent", padding: 0, font: "inherit", color: COLORS.accent, fontWeight: 700, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "2px" }}>
      #{id}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={sectionCaption()}>NEXT TICK</span>
      <div style={{ ...card({ padding: "12px 14px" }), display: "flex", flexDirection: "column", gap: "7px" }}>
        {active && steps.length === 0 && held.length === 0 && notes.length === 0 ? <span style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>Nothing will start or be released.</span> : null}
        {steps.map((s) => (
          <span key={s.action + s.ticketId} style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.7 }}>
            <span style={pill({ color: ACTION_COLOR[s.action] ?? COLORS.textSoft, size: "xs", weight: 700 })}>{s.action}</span> {ticket(s.ticketId)} — {s.detail}
          </span>
        ))}
        {held.map((h) => (
          <span key={h.action + h.ticketId} style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.7 }}>
            <span style={pill({ color: COLORS.warning, size: "xs", weight: 700 })}>held</span> {ticket(h.ticketId)} · {h.action} — {h.reason}
          </span>
        ))}
        {notes.map((n) => (
          <span key={n} style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.7 }}>{n}</span>
        ))}
        {steps.length > 0 ? (
          <span style={{ fontSize: FONT.sm, color: COLORS.textDim, lineHeight: 1.7 }}>
            A free run slot and no run already on the ticket are checked when it starts. Review comments are polled separately.
          </span>
        ) : null}
      </div>
    </div>
  );
}
