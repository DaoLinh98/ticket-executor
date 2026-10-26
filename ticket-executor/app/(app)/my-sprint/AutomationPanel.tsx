"use client";

import { useBoltsContext } from "../../BoltsContext";
import { COLORS, FONT, SHAPE, SURFACE, card, chipShape, ctaButtonStyle, sectionCaption, tabStyle } from "@/lib/ui";
import ActionButton from "./ActionButton";
import type { StoredPlan } from "./model";

type AutoField = "autoImplement" | "autoRelease" | "autoResolveReview" | "autoDraftQaReply";

const TOGGLES: readonly [AutoField, string, string][] = [
  ["autoImplement", "Auto-implement", "Work down the queue without waiting to be asked."],
  ["autoRelease", "Auto-release", "Hand finished work over on its release day."],
  ["autoResolveReview", "Auto-resolve review", "Answer new review comments on released work without waiting to be asked."],
  ["autoDraftQaReply", "Auto-draft QC reply", "Draft a reply when QC comments on a ticket in QA. Nothing is posted until you confirm."],
];

type Engine = StoredPlan["engine"];

const ENGINES: readonly [Engine, string, string][] = [
  ["classic", "Classic", "Run tickets on the Ticket Execution engine (skills)."],
  ["dagent", "D-Agent", "Run tickets on the D-Agent engine (subagents) — implement, review fix and QA fix. Watch them live on Workflow."],
];

export default function AutomationPanel({
  stored,
  busy,
  onBuild,
  onSetStatus,
  onToggle,
  onEngine,
  onTick,
}: {
  stored: StoredPlan | null;
  busy: ReadonlySet<string>;
  onBuild: () => void;
  onSetStatus: (status: "active" | "draft") => void;
  onToggle: (field: AutoField, on: boolean) => void;
  onEngine: (engine: Engine) => void;
  onTick: () => void;
}) {
  const { fireBoltFromEvent } = useBoltsContext();
  return (
    <div style={{ ...card({ padding: "10px 12px" }), display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px 10px", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
          <span style={{ ...sectionCaption(), color: COLORS.textMuted }}>ENGINE</span>
          <span
            role="radiogroup"
            aria-label="Run engine"
            style={{ ...card({ padding: "2px", radius: SHAPE.radiusChip, background: SURFACE.inset }), ...chipShape(7), display: "inline-flex", gap: "2px" }}
          >
            {ENGINES.map(([engine, label, hint]) => {
              const on = (stored?.engine ?? "classic") === engine;
              const enabled = !!stored && !busy.has("engine");
              return (
                <button
                  key={engine}
                  role="radio"
                  aria-checked={on}
                  className="te-action-btn"
                  onClick={(e) => { fireBoltFromEvent(e); if (stored && !on) onEngine(engine); }}
                  disabled={!enabled}
                  title={hint}
                  style={{
                    ...(on
                      ? { ...ctaButtonStyle("primary", { height: "26px", cornerPx: 6 }), padding: "0 13px", fontSize: FONT.sm }
                      : { ...tabStyle({ active: false, enabled }), height: "26px", padding: "0 13px", marginBottom: 0, display: "flex", alignItems: "center" }),
                    cursor: enabled && !on ? "pointer" : "default",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </span>
        </span>
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
