"use client";

import { useEffect, useState } from "react";
import { useBoltsContext } from "../../BoltsContext";
import { COLORS, FONT, SHAPE, SURFACE, card, chipShape, ctaButtonStyle, fieldInput, fieldLabel, sectionCaption, tabStyle } from "@/lib/ui";
import ActionButton from "./ActionButton";
import type { StoredPlan } from "./model";

export type PlanSettings = { pointsPerDay: string; hoursPerDay: string; maxTicketsPerDay: string };

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

const SETTING_FIELDS: readonly [keyof PlanSettings, string, string][] = [
  ["pointsPerDay", "POINTS / DAY", "decimal"],
  ["hoursPerDay", "HOURS / DAY", "decimal"],
  ["maxTicketsPerDay", "MAX TICKETS / DAY (0 = NO LIMIT)", "numeric"],
];

export default function AutomationPanel({
  stored,
  busy,
  settings,
  onSettings,
  onBuild,
  onApplySettings,
  onSetStatus,
  onToggle,
  onEngine,
  onTick,
  onSaveReviewers,
}: {
  stored: StoredPlan | null;
  busy: ReadonlySet<string>;
  settings: PlanSettings;
  onSettings: (next: PlanSettings) => void;
  onBuild: () => void;
  onApplySettings: () => void;
  onSetStatus: (status: "active" | "draft") => void;
  onToggle: (field: AutoField, on: boolean) => void;
  onEngine: (engine: Engine) => void;
  onTick: () => void;
  onSaveReviewers: (reviewers: string[]) => void;
}) {
  const { fireBoltFromEvent } = useBoltsContext();
  const [open, setOpen] = useState(false);
  const savedReviewers = (stored?.reviewers ?? []).join(", ");
  const [reviewers, setReviewers] = useState(savedReviewers);
  useEffect(() => setReviewers(savedReviewers), [savedReviewers]);
  const parsedReviewers = reviewers.split(/[,;\n]/).map((r) => r.trim()).filter(Boolean);
  const valid = Number(settings.pointsPerDay) > 0 && Number(settings.hoursPerDay) > 0 && Number(settings.maxTicketsPerDay) >= 0;
  const settingsChanged =
    !!stored &&
    (Number(settings.pointsPerDay) !== stored.pointsPerDay ||
      Number(settings.hoursPerDay) !== stored.hoursPerDay ||
      Number(settings.maxTicketsPerDay) !== stored.maxTicketsPerDay);

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
        <button
          className="te-action-btn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{ background: "transparent", border: "none", padding: "0 2px", cursor: "pointer", ...sectionCaption(), color: COLORS.textMuted, display: "inline-flex", alignItems: "center", gap: "6px" }}
        >
          <span style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
          SETTINGS
        </button>
      </div>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", borderTop: `1px solid ${COLORS.borderSubtle}`, paddingTop: "12px" }}>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
            {SETTING_FIELDS.map(([field, label, mode]) => (
              <label key={field} style={{ display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 140px", minWidth: 0 }}>
                <span style={{ ...fieldLabel(), fontSize: FONT.sm }}>{label}</span>
                <input
                  value={settings[field]}
                  onChange={(e) => onSettings({ ...settings, [field]: e.target.value })}
                  inputMode={mode as "decimal" | "numeric"}
                  autoComplete="off"
                  style={{ ...fieldInput(), width: "100%", boxSizing: "border-box" }}
                />
              </label>
            ))}
            <ActionButton tall label="Apply & rebuild" variant="outline" onClick={onApplySettings} busy={busy.has("plan")} disabled={!settingsChanged || !valid} />
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 260px", minWidth: 0 }}>
              <span style={{ ...fieldLabel(), fontSize: FONT.sm }}>REVIEWERS (COMMA-SEPARATED)</span>
              <input
                value={reviewers}
                onChange={(e) => setReviewers(e.target.value)}
                placeholder="name@company.com, other@company.com"
                autoComplete="off"
                spellCheck={false}
                style={{ ...fieldInput(), width: "100%", boxSizing: "border-box" }}
              />
            </label>
            <ActionButton
              tall
              label="Save reviewers"
              variant="outline"
              onClick={() => onSaveReviewers(parsedReviewers)}
              busy={busy.has("reviewers")}
              disabled={!stored || parsedReviewers.join(", ") === savedReviewers}
            />
          </div>
        </div>
      )}
    </div>
  );
}
