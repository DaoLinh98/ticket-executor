"use client";

import { useState } from "react";
import { COLORS, FONT, card, fieldInput, pill, sectionCaption, tabStyle } from "@/lib/ui";
import type { AutomationRow } from "./model";

const ACTION_COLOR: Record<string, string> = {
  release: COLORS.accent,
  implement: COLORS.info,
  review: COLORS.indigo,
  watch: "var(--te-hue-purple)",
  abort: "var(--te-hue-orange)",
};

// Today's events need only the time; older ones keep the date so the day is not lost.
function when(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const OUTCOMES = ["all", "failed", "skipped", "done"] as const;

export default function SchedulerLog({ events, onOpen }: { events: AutomationRow[]; onOpen: (ticketId: string) => void }) {
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>("all");
  const [ticket, setTicket] = useState("");
  if (events.length === 0) return null;
  const tickets = [...new Set(events.map((e) => e.ticketId).filter(Boolean))];
  const shown = events.filter((e) => (outcome === "all" || e.outcome === outcome) && (!ticket || e.ticketId === ticket));
  return (
    <div style={{ minHeight: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={sectionCaption()}>SCHEDULER LOG</span>
      <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
        {OUTCOMES.map((o) => (
          <button key={o} type="button" className="te-action-btn" onClick={() => setOutcome(o)} style={tabStyle({ active: outcome === o })}>
            {o === "all" ? "All" : o[0].toUpperCase() + o.slice(1)}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <select
          aria-label="Show one ticket's events"
          value={ticket}
          onChange={(e) => setTicket(e.target.value)}
          style={{ ...fieldInput({ height: "32px", fontSize: FONT.sm }), width: "auto", padding: "0 6px" }}
        >
          <option value="">All tickets</option>
          {tickets.map((id) => <option key={id} value={id}>#{id}</option>)}
        </select>
      </div>
      <div className="te-scroll te-sprint-pane" style={{ ...card({ padding: "12px 14px" }), maxHeight: "480px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "7px" }}>
        {shown.length === 0 && <span style={{ fontSize: FONT.sm, color: COLORS.textDim }}>No event matches.</span>}
        {shown.slice(0, ticket ? 40 : 12).map((e) => {
          const color = e.outcome === "failed" ? COLORS.danger : e.outcome === "skipped" ? COLORS.warning : COLORS.success;
          return (
            <span key={e.id} style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.7 }}>
              <span title={new Date(e.createdAt).toLocaleString()} style={{ color: COLORS.text, fontWeight: 700 }}>{when(e.createdAt)}</span>
              {" · "}
              <span style={{ color: ACTION_COLOR[e.action] ?? COLORS.textSoft, fontWeight: 700 }}>{e.action}</span>{" "}
              <span style={pill({ color, size: "xs", weight: 700 })}>{e.outcome}</span>
              {e.ticketId ? (
                <>
                  {" · "}
                  <button type="button" onClick={() => onOpen(e.ticketId)} aria-label={`Open the run of #${e.ticketId}`} style={{ border: "none", background: "transparent", padding: 0, font: "inherit", color: COLORS.accent, fontWeight: 700, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "2px" }}>
                    #{e.ticketId}
                  </button>
                </>
              ) : ""}
              {e.reason ? ` · ${e.reason}` : ""}
              {e.detail ? ` — ${e.detail}` : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
