"use client";

import { fmtMs, fmtTokens, type StepTrace } from "@/lib/runTrace";
import type { UiRunState } from "@/lib/types";
import { COLORS, FONT, RUN_COLOR, RUN_LABEL, runDot, sectionCaption, tabStyle } from "@/lib/ui";
import { MiniIcon } from "./icons";

export type ExecView = "flow" | "raw";

type Props = {
  state: UiRunState;
  steps: StepTrace[];
  currentLabel: string;
  startedAt: string;
  endedAt: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  now: number;
  view: ExecView;
  onView: (v: ExecView) => void;
};

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: "6px", whiteSpace: "nowrap" }}>
      <span style={{ fontSize: FONT.xs, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</span>
      <span style={{ fontSize: FONT.base, fontWeight: 700, color: color ?? COLORS.text, fontFamily: "var(--font-mono), monospace" }}>{value}</span>
    </span>
  );
}

export default function RunHud({ state, steps, currentLabel, startedAt, endedAt, costUsd, inputTokens, outputTokens, now, view, onView }: Props) {
  const hasRun = steps.length > 0;
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const elapsed = Number.isFinite(start) ? (endedAt ? Date.parse(endedAt) : now) - start : 0;
  const loops = steps.filter((s) => s.attempt > 1).length;
  const runColor = RUN_COLOR[state];
  return (
    <div className="te-exec-hud" style={{ display: "flex", alignItems: "center", gap: "10px 20px", flexWrap: "wrap", padding: "11px 14px", borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "9px", minWidth: 0 }}>
        <span style={sectionCaption()}>Workflow</span>
        {state !== "none" ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "7px", fontSize: FONT.base, fontWeight: 700, color: runColor, whiteSpace: "nowrap" }}>
            <span style={{ ...runDot(state), animation: state === "running" ? "pulseDot 1.3s ease-in-out infinite" : undefined }} />
            {RUN_LABEL[state]}
            {state === "running" && currentLabel ? <span style={{ color: COLORS.textMuted, fontWeight: 500 }}>· {currentLabel}</span> : null}
          </span>
        ) : (
          <span style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>The steps this ticket will walk</span>
        )}
      </span>
      {hasRun ? (
        <>
          <Metric label="Time" value={fmtMs(Math.max(0, elapsed))} />
          <Metric label="Cost" value={`$${costUsd.toFixed(2)}`} />
          <Metric label="Tokens" value={`${fmtTokens(inputTokens)} / ${fmtTokens(outputTokens)}`} />
          {loops ? <Metric label="Re-entries" value={String(loops)} color={COLORS.warning} /> : null}
        </>
      ) : null}
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", gap: "4px" }}>
        <button type="button" className="te-action-btn" onClick={() => onView("flow")} style={{ ...tabStyle({ active: view === "flow" }), display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: 0 }}>
          <MiniIcon name="flow" size={13} />Flow
        </button>
        <button type="button" className="te-action-btn" onClick={() => onView("raw")} style={{ ...tabStyle({ active: view === "raw" }), display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: 0 }}>
          <MiniIcon name="terminal" size={13} />Terminal
        </button>
      </div>
    </div>
  );
}
