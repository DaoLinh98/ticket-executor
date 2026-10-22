"use client";

import { AnimatePresence, motion } from "motion/react";
import type { LogLine } from "@/lib/types";
import {
  END_ID,
  FAIL_ID,
  fmtMs,
  fmtTokens,
  stepElapsed,
  transitionInto,
  transitionOutOf,
  type ActivityFilter,
  type FlowNodeDef,
  type StepTrace,
  type TransitionView,
} from "@/lib/runTrace";
import { COLORS, FONT, MOTION, card, effectColor, pill, stepTone, stepToneColor, tintedCard, toneTint } from "@/lib/ui";
import ActivityFeed from "./ActivityFeed";
import OutputCard from "./OutputCard";
import { MiniIcon, NodeIcon, StateIcon } from "./icons";

type Props = {
  step: StepTrace | null;
  def: FlowNodeDef | null;
  defs: FlowNodeDef[];
  steps: StepTrace[];
  transitions: TransitionView[];
  lines: LogLine[];
  now: number;
  filter: ActivityFilter;
  query: string;
  follow: boolean;
  onFilter: (f: ActivityFilter) => void;
  onQuery: (q: string) => void;
  onFollow: (on: boolean) => void;
  onSelectStep: (id: string) => void;
};

const EFFECT_TEXT: Record<string, string> = { pure: "reads only", local: "writes locally", external: "leaves the machine" };

const STATUS_LABEL: Record<string, string> = { running: "Running", succeeded: "Succeeded", failed: "Failed", abandoned: "Interrupted" };

function Hop({ dir, t, defs, steps, onSelectStep, fallback }: { dir: "in" | "out"; t: TransitionView | null; defs: FlowNodeDef[]; steps: StepTrace[]; onSelectStep: (id: string) => void; fallback: string }) {
  const other = t ? (dir === "in" ? t.fromNode : t.toNode) : "";
  const label = other === END_ID ? "Done" : other === FAIL_ID ? "Failed" : defs.find((d) => d.id === other)?.label ?? other;
  const color = other === FAIL_ID ? COLORS.danger : other === END_ID ? COLORS.success : COLORS.text;
  const target = t ? (dir === "in" ? [...steps].reverse().find((s) => s.nodeId === t.fromNode && Date.parse(s.startedAt) <= Date.parse(t.at)) : steps.find((s) => s.nodeId === t.toNode && Date.parse(s.startedAt) >= Date.parse(t.at))) : undefined;
  return (
    <button
      type="button"
      disabled={!target}
      onClick={() => target && onSelectStep(target.id)}
      style={{ display: "flex", alignItems: "baseline", gap: "7px", minWidth: 0, minHeight: "28px", padding: 0, border: "none", background: "transparent", textAlign: "left", cursor: target ? "pointer" : "default", transform: "none", color: COLORS.textMuted, fontSize: FONT.sm }}
    >
      <span style={{ flex: "0 0 auto", fontWeight: 600, color: COLORS.faint }}>{dir === "in" ? "From" : "To"}</span>
      {t ? (
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={{ fontWeight: 600, color, textDecoration: target ? "underline" : "none", textDecorationColor: COLORS.border, textUnderlineOffset: "3px" }}>{label}</span>
          <span> · {t.reason}</span>
        </span>
      ) : (
        <span style={{ color: COLORS.faint }}>{fallback}</span>
      )}
    </button>
  );
}

export default function StepDetail({ step, def, defs, steps, transitions, lines, now, filter, query, follow, onFilter, onQuery, onFollow, onSelectStep }: Props) {
  if (!step) {
    return (
      <div style={{ ...card({ padding: "38px 20px" }), textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
        <MiniIcon name="flow" size={30} color={COLORS.faint} />
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: COLORS.textSoft }}>Nothing has run yet</div>
        <div style={{ fontSize: FONT.md, color: COLORS.textMuted, maxWidth: "420px" }}>Start the run and every step lands here: what it was told, every command and file it touched, what it returned, and why the run moved on.</div>
      </div>
    );
  }
  const running = step.status === "running";
  const tone = stepTone(step.status);
  const color = stepToneColor(step.status);
  const eff = effectColor(def?.effects ?? step.effects);
  const into = transitionInto(step, steps, transitions);
  const out = transitionOutOf(step, steps, transitions);
  const isFirst = steps[0]?.id === step.id;
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={step.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.32, ease: MOTION.easeExpo }}
        style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 }}
      >
        <div style={{ ...card({ padding: "13px 15px" }), display: "flex", flexDirection: "column", gap: "10px", borderLeft: `3px solid ${eff}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ width: "36px", height: "36px", borderRadius: "10px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: toneTint(eff, 16), flex: "0 0 auto" }}>
              <NodeIcon kind={def?.kind ?? "agent"} effects={def?.effects ?? step.effects} context={def?.context} size={18} color={eff} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                <span style={{ fontSize: FONT.lg, fontWeight: 700, color: COLORS.text }}>{step.label || def?.label || step.nodeId}</span>
                {step.attempt > 1 ? <span style={{ fontSize: FONT.sm, color: COLORS.warning, fontWeight: 700 }}>attempt {step.attempt}</span> : null}
              </div>
              <div style={{ fontSize: FONT.xs, color: COLORS.textMuted }}>
                {def?.kind === "check" ? "Code check · no tokens" : "Agent turn"} · {EFFECT_TEXT[def?.effects ?? step.effects] ?? step.effects}
                {def?.context ? ` · ${def.context === "fresh" ? "fresh session" : "resumes the session"}` : ""}
              </div>
            </div>
            <span style={{ ...pill({ color, background: toneTint(color, 14), border: toneTint(color, 45), size: "sm" }), flex: "0 0 auto" }}>
              {running ? <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: color, animation: "pulseDot 1.2s ease-in-out infinite" }} /> : <StateIcon tone={tone} size={12} color={color} />}
              {STATUS_LABEL[step.status] ?? step.status}
            </span>
          </div>
          <div style={{ display: "flex", gap: "6px 16px", flexWrap: "wrap", fontSize: FONT.sm, color: COLORS.textDim, fontFamily: "var(--font-mono), monospace" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}><MiniIcon name="clock" size={12} color={COLORS.textMuted} />{fmtMs(stepElapsed(step, now))}</span>
            {def?.kind !== "check" ? (
              <>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}><MiniIcon name="coin" size={12} color={COLORS.textMuted} />${step.costUsd.toFixed(3)}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}><MiniIcon name="tokens" size={12} color={COLORS.textMuted} />{fmtTokens(step.inputTokens)} in · {fmtTokens(step.outputTokens)} out · {fmtTokens(step.cacheReadTokens)} cached</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}><MiniIcon name="turns" size={12} color={COLORS.textMuted} />{step.numTurns} turns</span>
              </>
            ) : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", paddingTop: "8px", borderTop: `1px solid ${COLORS.borderSubtle}` }}>
            <Hop dir="in" t={into} defs={defs} steps={steps} onSelectStep={onSelectStep} fallback={isFirst ? "the run started here" : "re-entered after an interruption"} />
            <Hop dir="out" t={out} defs={defs} steps={steps} onSelectStep={onSelectStep} fallback={running ? "decided when this step reports" : "no route taken"} />
          </div>
        </div>

        {step.errorMessage ? (
          <div style={{ ...tintedCard("danger", { padding: "11px 13px", radius: "10px" }), display: "flex", gap: "10px", alignItems: "flex-start" }}>
            <MiniIcon name="alert" size={16} color={COLORS.danger} style={{ marginTop: "2px" }} />
            <div style={{ fontSize: FONT.md, color: COLORS.textSoft, lineHeight: 1.55, wordBreak: "break-word" }}>{step.errorMessage}</div>
          </div>
        ) : null}

        <OutputCard output={step.output} running={running} />

        <ActivityFeed
          lines={lines}
          stepStartedAt={step.startedAt}
          running={running}
          filter={filter}
          query={query}
          follow={follow}
          onFilter={onFilter}
          onQuery={onQuery}
          onFollow={onFollow}
        />
      </motion.div>
    </AnimatePresence>
  );
}
