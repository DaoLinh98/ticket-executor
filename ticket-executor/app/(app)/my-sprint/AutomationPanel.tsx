"use client";

import { useEffect, useState } from "react";
import { useBoltsContext } from "../../BoltsContext";
import { COLORS, FONT, card, ctaButtonStyle, fieldInput, fieldLabel, sectionCaption } from "@/lib/ui";
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
  onTick,
  onSaveReviewers,
}: {
  stored: StoredPlan | null;
  busy: string;
  settings: PlanSettings;
  onSettings: (next: PlanSettings) => void;
  onBuild: () => void;
  onApplySettings: () => void;
  onSetStatus: (status: "active" | "draft") => void;
  onToggle: (field: AutoField, on: boolean) => void;
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

  return (
    <div style={{ ...card({ padding: "16px" }), display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={sectionCaption()}>PLAN &amp; AUTOMATION</span>
        <div style={{ flex: 1 }} />
        <ActionButton label={stored ? "Rebuild plan" : "Build plan"} variant="primary" onClick={onBuild} busy={busy === "plan"} />
        {stored && stored.status !== "active" && (
          <ActionButton label="Activate" variant="success" onClick={() => onSetStatus("active")} busy={busy === "activate"} />
        )}
        {stored?.status === "active" && (
          <ActionButton label="Pause" variant="warning" onClick={() => onSetStatus("draft")} busy={busy === "activate"} />
        )}
        {stored?.status === "active" && <ActionButton label="Run now" variant="outline" onClick={onTick} busy={busy === "tick"} />}
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {TOGGLES.map(([field, label, hint]) => {
          const on = !!stored?.[field];
          return (
            <button
              key={field}
              className="te-action-btn"
              onClick={(e) => { fireBoltFromEvent(e); if (stored) onToggle(field, !on); }}
              disabled={!stored}
              title={hint}
              style={{ ...ctaButtonStyle(on ? "success" : "ghost", { height: "30px", cornerPx: 7 }), cursor: stored ? "pointer" : "default" }}
            >
              {label} {on ? "ON" : "OFF"}
            </button>
          );
        })}
      </div>

      <span style={{ fontSize: FONT.sm, color: COLORS.textDim, lineHeight: 1.6 }}>
        The three are separate on purpose: working ahead is private and cheap to undo, releasing notifies a
        reviewer and moves the work item, and resolving a review writes replies under your name on a pull
        request somebody is already reading. Nothing is scheduled from a draft plan.
      </span>

      <button
        className="te-action-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ alignSelf: "flex-start", background: "transparent", border: "none", padding: "0 2px", cursor: "pointer", ...sectionCaption(), color: COLORS.textMuted, display: "inline-flex", alignItems: "center", gap: "6px" }}
      >
        <span style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
        PLAN SETTINGS
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", alignItems: "flex-end" }}>
            {SETTING_FIELDS.map(([field, label, mode]) => (
              <label key={field} style={{ display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 150px", maxWidth: "220px" }}>
                <span style={fieldLabel()}>{label}</span>
                <input
                  value={settings[field]}
                  onChange={(e) => onSettings({ ...settings, [field]: e.target.value })}
                  inputMode={mode as "decimal" | "numeric"}
                  autoComplete="off"
                  style={{ ...fieldInput(), width: "100%", boxSizing: "border-box" }}
                />
              </label>
            ))}
            <ActionButton label="Apply & rebuild" variant="outline" onClick={onApplySettings} busy={busy === "plan"} disabled={!stored || !valid} />
          </div>

          <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 280px", maxWidth: "520px" }}>
              <span style={fieldLabel()}>REVIEWERS (COMMA-SEPARATED)</span>
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
              label="Save reviewers"
              variant="outline"
              onClick={() => onSaveReviewers(parsedReviewers)}
              busy={busy === "reviewers"}
              disabled={!stored || parsedReviewers.join(", ") === savedReviewers}
            />
          </div>
        </div>
      )}
    </div>
  );
}
