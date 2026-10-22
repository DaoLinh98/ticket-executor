"use client";

import "@xyflow/react/dist/style.css";
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  getSmoothStepPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  FAIL_ID,
  FLOW_NODE_H,
  FLOW_NODE_W,
  FLOW_TERMINAL_H,
  FLOW_TERMINAL_W,
  flowLayout,
  fmtMs,
  nodeSummaries,
  type EdgeRoute,
  type EdgeStat,
  type FlowNodeDef,
  type StepTrace,
  type TransitionView,
} from "@/lib/runTrace";
import { COLORS, FONT, SHAPE, SURFACE, card, effectColor, ringBorder, stepToneColor, toneTint } from "@/lib/ui";
import LoadingRing from "../LoadingRing";
import { MiniIcon, NodeIcon, StateIcon } from "./icons";

const IDLE_EDGE = "var(--te-faint)";

const EFFECT_HINT: Record<string, string> = {
  pure: "reads only",
  local: "writes locally",
  external: "leaves the machine",
};

type StepNodeData = {
  label: string;
  kind: string;
  effects: string;
  context: string;
  side: boolean;
  tone: string;
  attempts: number;
  durationMs: number;
  costUsd: number;
  selected: boolean;
  stepId: string;
};

type TerminalNodeData = { label: string; reached: boolean; fail: boolean };

type FlowEdgeData = {
  route: EdgeRoute;
  offset: number;
  taken: EdgeStat | null;
  color: string;
  current: boolean;
  showLabel: boolean;
  onPick: (() => void) | null;
  from: string;
  to: string;
};

const HANDLE = { opacity: 0, width: 6, height: 6, minWidth: 0, minHeight: 0, border: "none", background: "transparent" };

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} id="left" style={HANDLE} />
      <Handle type="source" position={Position.Right} id="right" style={HANDLE} />
      <Handle type="target" position={Position.Top} id="top-in" style={{ ...HANDLE, left: "35%" }} />
      <Handle type="source" position={Position.Top} id="top-out" style={{ ...HANDLE, left: "65%" }} />
      <Handle type="target" position={Position.Bottom} id="bottom-in" style={{ ...HANDLE, left: "35%" }} />
      <Handle type="source" position={Position.Bottom} id="bottom-out" style={{ ...HANDLE, left: "65%" }} />
    </>
  );
}

const StepNode = memo(function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const reached = data.attempts > 0;
  const toneColor = stepToneColor(data.tone === "done" ? "succeeded" : data.tone);
  const eff = effectColor(data.effects);
  const running = data.tone === "running";
  const shell = running
    ? { ...ringBorder({ fill: SURFACE.raised, ring: COLORS.warning, highlight: COLORS.warning, duration: 2.4, shape: "none" }), borderRadius: SHAPE.radiusCard }
    : {
        ...card({ padding: "0", background: reached ? COLORS.panelBg : "transparent", border: reached ? toneTint(toneColor, 55) : COLORS.border }),
        borderStyle: !reached && data.side ? "dashed" : "solid",
      };
  return (
    <div
      style={{
        ...shell,
        position: "relative",
        width: FLOW_NODE_W,
        height: FLOW_NODE_H,
        padding: "11px 12px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: reached ? "pointer" : "default",
        opacity: reached ? 1 : data.side ? 0.5 : 0.78,
        boxShadow: data.selected ? `0 0 0 2px ${COLORS.accent}, 0 16px 36px -18px ${toneTint(COLORS.accent, 70)}` : "none",
        transition: "box-shadow .25s, opacity .25s",
      }}
    >
      <Handles />
      <div style={{ display: "flex", alignItems: "center", gap: "9px", minWidth: 0 }}>
        <span style={{ width: "26px", height: "26px", borderRadius: "7px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: toneTint(eff, reached ? 18 : 10), flex: "0 0 auto" }}>
          <NodeIcon kind={data.kind} effects={data.effects} context={data.context} size={14} color={eff} />
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: FONT.base, fontWeight: 700, color: reached ? COLORS.text : COLORS.textDim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.label}</span>
        {running ? <LoadingRing size={20} /> : reached ? <StateIcon tone={data.tone} size={15} color={toneColor} /> : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: FONT.xs, color: COLORS.textMuted, fontFamily: "var(--font-mono), monospace", whiteSpace: "nowrap", overflow: "hidden" }}>
        {reached ? (
          <>
            {data.attempts > 1 ? <span style={{ color: COLORS.warning, fontWeight: 700 }}>×{data.attempts}</span> : null}
            <span>{fmtMs(data.durationMs)}</span>
            {data.costUsd > 0 ? <span>${data.costUsd.toFixed(2)}</span> : null}
          </>
        ) : (
          <span style={{ fontFamily: "var(--te-font-ui)", color: COLORS.faint }}>{data.side ? "only when a check refuses" : EFFECT_HINT[data.effects] ?? ""}</span>
        )}
      </div>
    </div>
  );
});

const TerminalNode = memo(function TerminalNode({ data }: NodeProps<Node<TerminalNodeData>>) {
  const color = data.fail ? COLORS.danger : COLORS.success;
  return (
    <div
      style={{
        width: FLOW_TERMINAL_W,
        height: FLOW_TERMINAL_H,
        borderRadius: "999px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        fontSize: FONT.sm,
        fontWeight: 800,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        fontFamily: "var(--te-font-display)",
        color: data.reached ? color : COLORS.faint,
        background: data.reached ? toneTint(color, 16) : "transparent",
        border: `1.5px ${data.reached ? "solid" : "dashed"} ${data.reached ? toneTint(color, 70) : COLORS.border}`,
      }}
    >
      <Handles />
      <StateIcon tone={data.fail ? "failed" : "done"} size={13} color={data.reached ? color : COLORS.faint} />
      {data.label}
    </div>
  );
});

const FlowEdge = memo(function FlowEdge(props: EdgeProps<Edge<FlowEdgeData>>) {
  const { id, sourceX, sourceY, targetX, targetY, data } = props;
  const d = data!;
  const [path, labelX, labelY] =
    d.route === "straight"
      ? getBezierPath({ sourceX, sourceY, sourcePosition: Position.Right, targetX, targetY, targetPosition: Position.Left })
      : getSmoothStepPath({
          sourceX,
          sourceY,
          targetX,
          targetY,
          sourcePosition: d.route === "up" ? Position.Top : Position.Bottom,
          targetPosition: d.route === "down" ? Position.Top : Position.Bottom,
          borderRadius: 14,
          offset: d.offset,
        });
  const [open, setOpen] = useState(false);
  const lit = !!d.taken;
  const speed = d.current ? 1.1 : 2.6;
  return (
    <>
      {lit ? <path d={path} fill="none" style={{ stroke: d.color, strokeWidth: d.current ? 10 : 7, opacity: d.current ? 0.22 : 0.12, filter: "blur(3px)" }} /> : null}
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: d.color,
          strokeWidth: lit ? 2.2 : 1.4,
          strokeDasharray: lit && !d.current ? undefined : "6 6",
          animation: d.current ? "edgeFlow .55s linear infinite" : undefined,
          opacity: lit ? 1 : 0.6,
        }}
      />
      {lit
        ? [0, 1, 2].slice(0, d.current ? 3 : 1).map((i) => (
            <circle key={i} r={d.current ? 3.4 : 2.6} className="te-flow-particle" style={{ fill: d.color, filter: `drop-shadow(0 0 4px ${d.color})` }}>
              <animateMotion dur={`${speed}s`} begin={`${(i * speed) / 3}s`} repeatCount="indefinite" path={path} />
            </circle>
          ))
        : null}
      {lit && d.showLabel ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              zIndex: open ? 20 : 3,
            }}
          >
            <button
              type="button"
              aria-label={`${d.from} to ${d.to}: ${d.taken!.lastReason}`}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              style={{
                width: "24px",
                height: "24px",
                padding: 0,
                borderRadius: "999px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                position: "relative",
                color: d.color,
                background: SURFACE.inset,
                border: `1.5px solid ${toneTint(d.color, 70)}`,
              }}
            >
              <MiniIcon name="alert" size={13} color={d.color} />
              {d.taken!.count > 1 ? (
                <span style={{ position: "absolute", top: "-7px", right: "-9px", fontSize: FONT.xs, fontWeight: 700, color: COLORS.warning, background: SURFACE.inset, borderRadius: "999px", padding: "0 4px", lineHeight: "14px" }}>×{d.taken!.count}</span>
              ) : null}
            </button>
            {open ? (
              <div
                role="tooltip"
                style={{
                  position: "absolute",
                  bottom: "32px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: "max-content",
                  maxWidth: "260px",
                  padding: "9px 11px",
                  borderRadius: SHAPE.radiusCard,
                  background: SURFACE.raised,
                  border: `1px solid ${toneTint(d.color, 55)}`,
                  boxShadow: "0 12px 28px -12px rgba(0,0,0,.6)",
                  fontSize: FONT.sm,
                  color: COLORS.textSoft,
                  lineHeight: 1.45,
                  textAlign: "left",
                }}
              >
                <div style={{ fontSize: FONT.xs, fontWeight: 700, color: d.color, marginBottom: "3px" }}>
                  {d.from} → {d.to}
                  {d.taken!.count > 1 ? ` · ×${d.taken!.count}` : ""}
                </div>
                <div style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{d.taken!.lastReason}</div>
                {d.onPick ? (
                  <button type="button" onClick={d.onPick} style={{ marginTop: "6px", padding: 0, background: "none", border: "none", cursor: "pointer", fontSize: FONT.xs, fontWeight: 700, color: COLORS.accent }}>
                    View step
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

const NODE_TYPES = { step: StepNode, terminal: TerminalNode };
const EDGE_TYPES = { flow: FlowEdge };

function stepOfTransition(seq: number, transitions: TransitionView[], steps: StepTrace[]): string {
  const t = transitions.find((x) => x.seq === seq);
  if (!t) return "";
  const at = Date.parse(t.at);
  const candidates = steps.filter((s) => s.nodeId === t.fromNode && Date.parse(s.startedAt) <= at);
  return candidates[candidates.length - 1]?.id ?? "";
}

function FitOnChange({ layoutKey, box }: { layoutKey: string; box: RefObject<HTMLDivElement | null> }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const fit = () => fitView({ padding: 0.08, maxZoom: 1.15, duration: 300 });
    const id = requestAnimationFrame(fit);
    const el = box.current;
    const ro = el ? new ResizeObserver(() => fit()) : null;
    if (el && ro) ro.observe(el);
    return () => {
      cancelAnimationFrame(id);
      ro?.disconnect();
    };
  }, [layoutKey, fitView, box]);
  return null;
}

type Props = {
  defs: FlowNodeDef[];
  steps: StepTrace[];
  transitions: TransitionView[];
  selectedStepId: string;
  running: boolean;
  now: number;
  onSelectStep: (id: string) => void;
};

function FlowCanvas({ defs, steps, transitions, selectedStepId, running, now, onSelectStep, box }: Props & { box: RefObject<HTMLDivElement | null> }) {
  const layoutKey = `${defs.map((d) => `${d.id}:${d.next.join("|")}`).join(",")}#${transitions.map((t) => `${t.fromNode}>${t.toNode}`).join(",")}`;
  const layout = useMemo(() => flowLayout(defs, transitions), [layoutKey]);
  const summaries = nodeSummaries(steps, now);
  const selectedNode = steps.find((s) => s.id === selectedStepId)?.nodeId ?? "";
  const last = transitions[transitions.length - 1];
  const reached = new Set(transitions.map((t) => t.toNode));

  const nodes: Node[] = layout.nodes.map((n) => {
    if (n.terminal) {
      return {
        id: n.id,
        type: "terminal",
        position: { x: n.x, y: n.y },
        draggable: false,
        data: { label: n.label, reached: reached.has(n.id), fail: n.id === FAIL_ID } satisfies TerminalNodeData,
      };
    }
    const s = summaries.get(n.id);
    return {
      id: n.id,
      type: "step",
      position: { x: n.x, y: n.y },
      draggable: false,
      data: {
        label: s?.label || n.label,
        kind: n.kind,
        effects: n.effects,
        context: n.context,
        side: n.lane === "side",
        tone: s?.tone ?? "pending",
        attempts: s?.attempts ?? 0,
        durationMs: s?.durationMs ?? 0,
        costUsd: s?.costUsd ?? 0,
        selected: n.id === selectedNode,
        stepId: s?.latestStepId ?? "",
      } satisfies StepNodeData,
    };
  });

  const laid = new Map(layout.nodes.map((n) => [n.id, n]));

  const edges: Edge[] = layout.edges.map((e) => {
    const loop = e.route !== "straight";
    const color = !e.taken ? IDLE_EDGE : e.target === FAIL_ID ? COLORS.danger : COLORS.accent;
    const pickId = e.taken ? stepOfTransition(e.taken.lastSeq, transitions, steps) : "";
    return {
      id: e.id,
      type: "flow",
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      zIndex: e.taken ? 2 : 1,
      data: {
        route: e.route,
        offset: e.offset,
        taken: e.taken,
        color,
        current: running && !!last && last.fromNode === e.source && last.toNode === e.target,
        showLabel: loop || e.target === FAIL_ID || (e.taken?.count ?? 0) > 1,
        onPick: pickId ? () => onSelectStep(pickId) : null,
        from: laid.get(e.source)!.label,
        to: laid.get(e.target)!.label,
      } satisfies FlowEdgeData,
    };
  });

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.08, maxZoom: 1.15 }}
      minZoom={0.5}
      maxZoom={1.4}
      onNodeClick={(_, node) => {
        const stepId = (node.data as Partial<StepNodeData>).stepId;
        if (stepId) onSelectStep(stepId);
      }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      zoomOnScroll={false}
      panOnScroll={false}
      preventScrolling={false}
      zoomOnDoubleClick={false}
      proOptions={{ hideAttribution: true }}
    >
      <FitOnChange layoutKey={layoutKey} box={box} />
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}

export default function FlowMap(props: Props) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <div ref={box} className="te-flow te-flow-canvas" style={{ position: "relative", height: "280px", background: COLORS.panelBgDark }}>
      <ReactFlowProvider>
        <FlowCanvas {...props} box={box} />
      </ReactFlowProvider>
    </div>
  );
}
