"use client";

import { useMemo, useRef, type CSSProperties, type RefObject } from "react";
import type { KnowledgeChange, LogLine, UiRunState } from "@/lib/types";
import { defaultStepId, type ActivityFilter, type FlowNodeDef, type StepTrace, type TransitionView } from "@/lib/runTrace";
import { COLORS, FONT, card, tintedCard } from "@/lib/ui";
import KnowledgeChangeCard from "../KnowledgeChangeCard";
import AttemptTimeline from "../execution/AttemptTimeline";
import FlowMap from "../execution/FlowMap";
import FlowRail from "../execution/FlowRail";
import RawTerminal from "../execution/RawTerminal";
import RunHud, { type ExecView } from "../execution/RunHud";
import StepDetail from "../execution/StepDetail";
import { useNow } from "../execution/useNow";
import type { LogLineView } from "../types";

export type ExecUiState = { stepId: string; follow: boolean; view: ExecView; filter: ActivityFilter; query: string };

export const EXEC_UI_DEFAULT: ExecUiState = { stepId: "", follow: true, view: "flow", filter: "all", query: "" };

type Props = {
  defs: FlowNodeDef[];
  steps: StepTrace[];
  transitions: TransitionView[];
  logLines: LogLine[];
  terminalLines: LogLineView[];
  logRef: RefObject<HTMLDivElement | null>;
  projectName: string;
  state: UiRunState;
  statusLabel: string;
  logStatusStyle: CSSProperties;
  error?: string;
  knowledge?: KnowledgeChange | null;
  startedAt: string;
  endedAt: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  ui: ExecUiState;
  onUi: (patch: Partial<ExecUiState>) => void;
};

export default function ExecutionTab({
  defs, steps, transitions, logLines, terminalLines, logRef, projectName, state, statusLabel, logStatusStyle, error, knowledge,
  startedAt, endedAt, costUsd, inputTokens, outputTokens, ui, onUi,
}: Props) {
  const now = useNow(state === "running");
  const selectedId = ui.follow || !steps.some((s) => s.id === ui.stepId) ? defaultStepId(steps) : ui.stepId;
  const step = steps.find((s) => s.id === selectedId) ?? null;
  const def = step ? defs.find((d) => d.id === step.nodeId) ?? null : null;
  const from = step?.logFrom ?? 0;
  const to = step?.logTo ?? 0;
  const lines = useMemo(() => logLines.slice(from, to), [logLines, from, to]);
  const current = steps.find((s) => s.status === "running");
  const currentLabel = current ? current.label || defs.find((d) => d.id === current.nodeId)?.label || "" : "";
  const latestId = defaultStepId(steps);
  const select = (id: string) => onUi({ stepId: id, follow: id === latestId && state === "running" });
  const detailRef = useRef<HTMLDivElement>(null);
  const openStep = (id: string) => {
    select(id);
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", animation: "fadeUp .35s both", minWidth: 0 }}>
      {state === "failed" && error && (
        <div style={{ display: "flex", gap: "13px", alignItems: "flex-start", ...tintedCard("danger") }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" style={{ flex: "0 0 auto", marginTop: "1px", stroke: COLORS.danger }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.danger, marginBottom: "3px" }}>{steps.length ? "Execution failed" : "The run could not start"}</div>
            <div style={{ fontSize: FONT.base, color: COLORS.textSoft, lineHeight: 1.55, wordBreak: "break-word" }}>{error}</div>
          </div>
        </div>
      )}
      <div style={{ ...card({ padding: "0", background: COLORS.panelBgDark }), overflow: "hidden" }}>
      <RunHud
        state={state}
        steps={steps}
        currentLabel={currentLabel}
        startedAt={startedAt}
        endedAt={endedAt}
        costUsd={costUsd}
        inputTokens={inputTokens}
        outputTokens={outputTokens}
        now={now}
        view={ui.view}
        onView={(view) => onUi({ view })}
      />
      {ui.view === "raw" ? (
        <div style={{ padding: "12px" }}>
          <RawTerminal logLines={terminalLines} logRef={logRef} projectName={projectName} state={state} statusLabel={statusLabel} logStatusStyle={logStatusStyle} />
        </div>
      ) : (
        <>
          <FlowMap defs={defs} steps={steps} transitions={transitions} selectedStepId={selectedId} running={state === "running"} now={now} onSelectStep={openStep} />
          <FlowRail defs={defs} steps={steps} selectedStepId={selectedId} now={now} onSelectStep={openStep} />
        </>
      )}
      </div>
      {ui.view === "flow" && steps.length > 0 && (
          <div ref={detailRef} className="te-grid-2" style={{ scrollMarginTop: "12px", display: "grid", gridTemplateColumns: "minmax(250px, 300px) minmax(0, 1fr)", gap: "16px", alignItems: "start" }}>
            <AttemptTimeline
              defs={defs}
              steps={steps}
              transitions={transitions}
              selectedStepId={selectedId}
              runStartedAt={startedAt}
              runEndedAt={endedAt}
              now={now}
              onSelectStep={select}
            />
            <StepDetail
              step={step}
              def={def}
              defs={defs}
              steps={steps}
              transitions={transitions}
              lines={lines}
              now={now}
              filter={ui.filter}
              query={ui.query}
              follow={ui.follow}
              onFilter={(filter) => onUi({ filter })}
              onQuery={(query) => onUi({ query })}
              onFollow={(follow) => onUi(follow ? { follow, stepId: "" } : { follow, stepId: selectedId })}
              onSelectStep={select}
            />
          </div>
      )}
      {state === "failed" && <KnowledgeChangeCard change={knowledge} />}
    </div>
  );
}
