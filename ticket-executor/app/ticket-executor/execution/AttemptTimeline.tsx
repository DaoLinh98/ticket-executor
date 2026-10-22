"use client";

import { fmtMs, stepElapsed, transitionOutOf, type FlowNodeDef, type StepTrace, type TransitionView } from "@/lib/runTrace";
import { COLORS, FONT, SHAPE, card, effectColor, sectionCaption, stepTone, stepToneColor, tintFill, toneTint } from "@/lib/ui";
import { NodeIcon, StateIcon } from "./icons";

type Props = {
  defs: FlowNodeDef[];
  steps: StepTrace[];
  transitions: TransitionView[];
  selectedStepId: string;
  runStartedAt: string;
  runEndedAt: string | null;
  now: number;
  onSelectStep: (id: string) => void;
};

export default function AttemptTimeline({ defs, steps, transitions, selectedStepId, runStartedAt, runEndedAt, now, onSelectStep }: Props) {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const start = Date.parse(runStartedAt || steps[0]?.startedAt || new Date(now).toISOString());
  const end = runEndedAt ? Date.parse(runEndedAt) : now;
  const span = Math.max(1, end - start);
  return (
    <div style={{ ...card({ padding: "12px" }), display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "0 2px" }}>
        <span style={sectionCaption()}>Attempts ({steps.length})</span>
        <span style={{ fontSize: FONT.xs, color: COLORS.textMuted, fontFamily: "var(--font-mono), monospace" }}>{fmtMs(span)}</span>
      </div>
      {steps.length === 0 ? (
        <div style={{ fontSize: FONT.sm, color: COLORS.faint, padding: "18px 4px", textAlign: "center" }}>No step has run yet.</div>
      ) : (
        <div className="te-scroll" style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "560px", overflowY: "auto", paddingRight: "2px" }}>
          {steps.map((s, i) => {
            const def = byId.get(s.nodeId);
            const tone = stepTone(s.status);
            const color = stepToneColor(s.status);
            const elapsed = stepElapsed(s, now);
            const left = ((Date.parse(s.startedAt) - start) / span) * 100;
            const width = Math.max(1.6, (elapsed / span) * 100);
            const out = transitionOutOf(s, steps, transitions);
            const selected = s.id === selectedStepId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectStep(s.id)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  padding: "8px 10px",
                  minHeight: "40px",
                  textAlign: "left",
                  borderRadius: SHAPE.radiusCard,
                  border: `1px solid ${selected ? toneTint(COLORS.accent, 70) : "transparent"}`,
                  background: selected ? tintFill("accent") : "transparent",
                  color: COLORS.text,
                  cursor: "pointer",
                  transform: "none",
                  animation: `fadeUp .4s ${Math.min(i, 12) * 0.03}s both`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
                  <span style={{ width: "18px", fontSize: FONT.xs, color: COLORS.faint, fontFamily: "var(--font-mono), monospace", textAlign: "right" }}>{i + 1}</span>
                  <NodeIcon kind={def?.kind ?? "agent"} effects={def?.effects ?? s.effects} context={def?.context} size={14} color={effectColor(def?.effects ?? s.effects)} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: FONT.base, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.label || def?.label || s.nodeId}
                    {s.attempt > 1 ? <span style={{ color: COLORS.warning, fontWeight: 700 }}> #{s.attempt}</span> : null}
                  </span>
                  <span style={{ fontSize: FONT.xs, color: COLORS.textDim, fontFamily: "var(--font-mono), monospace" }}>{fmtMs(elapsed)}</span>
                  <StateIcon tone={tone} size={14} color={color} />
                </div>
                <div style={{ position: "relative", height: "5px", width: "100%", borderRadius: "999px", background: COLORS.borderSubtle, overflow: "hidden" }}>
                  <span
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: `${Math.min(98.4, left)}%`,
                      width: `${Math.min(100 - Math.min(98.4, left), width)}%`,
                      borderRadius: "999px",
                      background: color,
                      boxShadow: tone === "running" ? `0 0 10px ${toneTint(color, 80)}` : "none",
                      transformOrigin: "left",
                      animation: "growX .6s var(--te-ease-expo) both",
                    }}
                  />
                </div>
                {out ? (
                  <div style={{ display: "flex", gap: "6px", fontSize: FONT.xs, color: COLORS.textMuted, minWidth: 0 }}>
                    <span style={{ color: out.toNode === "FAIL" ? COLORS.danger : out.toNode === "END" ? COLORS.success : COLORS.textDim, fontWeight: 700, flex: "0 0 auto" }}>
                      → {byId.get(out.toNode)?.label ?? (out.toNode === "END" ? "Done" : out.toNode === "FAIL" ? "Failed" : out.toNode)}
                    </span>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{out.reason}</span>
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
