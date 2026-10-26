"use client";

import { useBoltsContext } from "../../BoltsContext";
import { COLORS, FONT, card, ctaButtonStyle, sectionCaption } from "@/lib/ui";
import ActionButton from "./ActionButton";
import type { StoredPlan } from "./model";

type AutoField = "autoImplement" | "autoRelease" | "autoResolveReview" | "autoDraftQaReply";

const TOGGLES: readonly [AutoField, string, string][] = [
  ["autoImplement", "Auto-implement", "Work down the queue without waiting to be asked."],
  ["autoRelease", "Auto-release", "Hand finished work over on its release day."],
  ["autoResolveReview", "Auto-resolve review", "Answer new review comments on released work without waiting to be asked."],
  ["autoDraftQaReply", "Auto-analyse QC feedback", "When QC comments, fails a ticket or sends it back, check the feedback against the code and propose a reply or a fix. Nothing is posted or changed until you decide."],
];

export default function AutomationPanel({
  stored,
  busy,
  onBuild,
  onSetStatus,
  onToggle,
  onTick,
}: {
  stored: StoredPlan | null;
  busy: ReadonlySet<string>;
  onBuild: () => void;
  onSetStatus: (status: "active" | "draft") => void;
  onToggle: (field: AutoField, on: boolean) => void;
  onTick: () => void;
}) {
  const { fireBoltFromEvent } = useBoltsContext();
  return (
    <div style={{ ...card({ padding: "10px 12px" }), display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px 10px", flexWrap: "wrap" }}>
        <div style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          <ActionButton compact label={stored ? "Rebuild plan" : "Build plan"} variant="primary" onClick={onBuild} busy={busy.has("plan")} />
          {stored && stored.status !== "active" && (
            <ActionButton compact label="Activate" variant="success" onClick={() => onSetStatus("active")} busy={busy.has("activate")} />
          )}
          {stored?.status === "active" && (
            <ActionButton compact label="Pause" variant="warning" onClick={() => onSetStatus("draft")} busy={busy.has("activate")} />
          )}
          {stored?.status === "active" && <ActionButton compact label="Run now" variant="outline" onClick={onTick} busy={busy.has("tick")} />}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
        <span style={{ ...sectionCaption(), color: COLORS.textMuted, marginRight: "2px" }}>AUTO</span>
        {TOGGLES.map(([field, label, hint]) => {
          const on = !!stored?.[field];
          return (
            <button
              key={field}
              className="te-action-btn"
              aria-pressed={on}
              onClick={(e) => { fireBoltFromEvent(e); if (stored) onToggle(field, !on); }}
              disabled={!stored}
              title={`${hint} (${on ? "on" : "off"})`}
              style={{
                ...ctaButtonStyle(on ? "success" : "outline", { height: "26px", cornerPx: 7 }),
                padding: "0 10px",
                gap: "6px",
                fontSize: FONT.sm,
                ...(on ? {} : { color: COLORS.textDim }),
                cursor: stored ? "pointer" : "default",
              }}
            >
              <span aria-hidden style={{ width: "7px", height: "7px", borderRadius: "50%", flex: "0 0 auto", background: on ? COLORS.success : "transparent", border: `1.5px solid ${on ? COLORS.success : COLORS.faint}` }} />
              {label}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
      </div>
    </div>
  );
}
