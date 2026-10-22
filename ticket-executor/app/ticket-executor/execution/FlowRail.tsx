"use client";

import { fmtMs, nodeSummaries, type FlowNodeDef, type StepTrace } from "@/lib/runTrace";
import { COLORS, FONT, effectColor, stepToneColor, tintFill, toneTint } from "@/lib/ui";
import LoadingRing from "../LoadingRing";
import { MiniIcon, NodeIcon, StateIcon } from "./icons";

type Props = {
  defs: FlowNodeDef[];
  steps: StepTrace[];
  selectedStepId: string;
  now: number;
  onSelectStep: (id: string) => void;
};

export default function FlowRail({ defs, steps, selectedStepId, now, onSelectStep }: Props) {
  const summaries = nodeSummaries(steps, now);
  const selectedNode = steps.find((s) => s.id === selectedStepId)?.nodeId ?? "";
  return (
    <div className="te-flow-rail" style={{ display: "none", flexDirection: "column", gap: 0, padding: "12px" }}>
      {defs.map((d, i) => {
        const s = summaries.get(d.id);
        const tone = s?.tone ?? "pending";
        const color = stepToneColor(tone === "done" ? "succeeded" : tone);
        const eff = effectColor(d.effects);
        const last = i === defs.length - 1;
        const selected = d.id === selectedNode;
        return (
          <div key={d.id} style={{ display: "flex", gap: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
              <span style={{ width: "34px", height: "34px", borderRadius: "10px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: toneTint(eff, 16), border: `1px solid ${tone === "pending" ? COLORS.border : toneTint(color, 70)}` }}>
                <NodeIcon kind={d.kind} effects={d.effects} context={d.context} size={16} color={eff} />
              </span>
              {!last ? <span style={{ width: "2px", flex: 1, minHeight: "14px", margin: "4px 0", background: tone === "done" ? toneTint(COLORS.success, 60) : COLORS.border, borderRadius: "2px" }} /> : null}
            </div>
            <button
              type="button"
              disabled={!s}
              onClick={() => s && onSelectStep(s.latestStepId)}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: "40px",
                marginBottom: last ? 0 : "8px",
                padding: "6px 10px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                textAlign: "left",
                borderRadius: "9px",
                border: `1px solid ${selected ? toneTint(COLORS.accent, 70) : "transparent"}`,
                background: selected ? tintFill("accent") : "transparent",
                color: COLORS.text,
                cursor: s ? "pointer" : "default",
                transform: "none",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: FONT.base, fontWeight: 700, color: tone === "pending" ? COLORS.textMuted : COLORS.text }}>{s?.label || d.label}</div>
                <div style={{ display: "flex", gap: "9px", fontSize: FONT.xs, color: COLORS.textMuted, fontFamily: "var(--font-mono), monospace" }}>
                  {s ? (
                    <>
                      {s.attempts > 1 ? <span style={{ color: COLORS.warning, fontWeight: 700 }}>×{s.attempts}</span> : null}
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}><MiniIcon name="clock" size={11} color={COLORS.textMuted} />{fmtMs(s.durationMs)}</span>
                      {s.costUsd > 0 ? <span>${s.costUsd.toFixed(2)}</span> : null}
                    </>
                  ) : (
                    <span style={{ color: COLORS.faint }}>not reached</span>
                  )}
                </div>
              </div>
              {tone === "running" ? <LoadingRing size={22} /> : <StateIcon tone={tone} size={16} color={color} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
