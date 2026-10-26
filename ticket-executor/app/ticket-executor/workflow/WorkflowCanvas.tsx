"use client";

import "@xyflow/react/dist/style.css";
import { memo, useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ControlButton,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { COLORS, FONT, chipShape, ctaButtonStyle } from "@/lib/ui";
import type { Layout } from "@/lib/workflow/layout";
import { IC, STATUS, TONE } from "@/lib/workflow/meta";
import type { EdgeView, LaneView, NodeView } from "@/lib/workflow/present";
import type { Tone } from "@/lib/workflow/types";
import { Badge, Ico, IconTile, MONO, StatusBadge } from "./parts";

type CardData = { view: NodeView; selected: boolean; vertical: boolean };
type LaneData = { lane: LaneView };
type EdgeData = { view: EdgeView; onPill: (key: string) => void };

const PORT = { width: 10, height: 10, minWidth: 0, minHeight: 0, borderRadius: "50%", background: "var(--te-panel-bg-dark)", border: "2px solid var(--te-port)" } as const;

const MARKERS: (Tone | "faint")[] = ["faint", "accent", "success", "danger", "warning", "info", "indigo", "muted"];

const FRAME_COLOR: Record<NodeView["frame"], string> = {
  default: "var(--te-border)",
  pending: "transparent",
  running: "var(--te-accent)",
  danger: "var(--te-danger)",
  warning: "var(--te-warning)",
};

const FlowCard = memo(function FlowCard({ data }: NodeProps<Node<CardData>>) {
  const { view, selected, vertical } = data;
  const isTerm = view.kind === "terminal";
  const isGate = view.kind === "gate";
  const st = STATUS[view.status];
  const inPos = vertical ? Position.Top : Position.Left;
  const outPos = vertical ? Position.Bottom : Position.Right;
  const cls = view.frame === "running" ? "te-wf-running" : view.frame === "danger" ? "te-wf-glow-danger" : undefined;
  return (
    <div className={cls} style={{ position: "relative", width: "100%", height: "100%", opacity: view.opacity }}>
      <div style={{ ...chipShape(8), width: "100%", height: "100%", padding: selected ? 2 : 1, background: selected ? COLORS.accent : FRAME_COLOR[view.frame], cursor: "pointer", color: COLORS.text }}>
        <div
          style={{
            ...chipShape(8),
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: isTerm ? "center" : "space-between",
            gap: 4,
            padding: isTerm ? "6px 10px" : "9px 11px",
            background: "var(--te-node-bg)",
            border: view.frame === "pending" ? `1px dashed ${COLORS.faint}` : "none",
            boxShadow: view.topBar ? "inset 0 3px 0 var(--te-success)" : "none",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
            <IconTile d={view.kindIcon} tone={view.kindTone} size={isTerm ? 22 : 24} />
            <span style={{ flex: 1, minWidth: 0, fontSize: FONT.base, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: view.struck ? "line-through" : "none", fontFamily: isTerm ? MONO : undefined }}>{view.label}</span>
            <StatusBadge tone={st.tone} icon={st.icon} text={view.id === "publish" && view.status === "pending" ? "Pending" : st.text} size="xs" />
          </span>
          {view.chips.length ? (
            <span style={{ display: "flex", gap: 4, flexWrap: "nowrap", overflow: "hidden", width: "100%" }}>
              {view.chips.map((c, i) => (
                <Badge key={i} tone={c.tone} icon={c.icon} size="xs">
                  {c.text}
                </Badge>
              ))}
            </span>
          ) : null}
          {!isTerm && !isGate ? (
            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", fontSize: FONT.xs }}>
              <span aria-label={view.dotsAria} style={{ color: COLORS.textDim, letterSpacing: 1, fontFamily: MONO }}>
                {view.dots}
              </span>
              <span style={{ color: view.timerColor, fontFamily: MONO }}>{view.timer}</span>
            </span>
          ) : null}
          <span
            style={{
              display: isGate ? "-webkit-box" : "block",
              width: "100%",
              fontSize: FONT.sm,
              color: view.outcomeColor,
              ...(isGate ? { WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }),
            }}
          >
            {view.outcome}
          </span>
        </div>
      </div>
      {view.exits.length ? (
        <span aria-hidden="true" style={{ position: "absolute", right: 0, bottom: "100%", marginBottom: 4, display: "flex", gap: 4, pointerEvents: "none" }}>
          {view.exits.map((c, i) => (
            <Badge key={i} tone={c.tone} icon={c.icon} size="xs">
              {c.text}
            </Badge>
          ))}
        </span>
      ) : null}
      <Handle type="target" position={inPos} id="in" isConnectable={false} style={{ ...PORT, opacity: isGate ? 0 : 1 }} />
      {!isTerm ? <Handle type="source" position={outPos} id="out" isConnectable={false} style={PORT} /> : null}
    </div>
  );
});

const LaneNode = memo(function LaneNode({ data }: NodeProps<Node<LaneData>>) {
  const { lane } = data;
  const st = STATUS[lane.status];
  const tone = TONE[st.tone];
  return (
    <div aria-hidden="true" style={{ position: "relative", width: "100%", height: "100%", background: lane.active ? "var(--te-lane-bg-active)" : "var(--te-lane-bg)", border: "1px solid var(--te-lane-border)" }}>
      <span style={{ position: "absolute", left: 12, right: 12, top: 10, display: "flex", alignItems: "center", gap: 8, fontSize: FONT.sm }}>
        <b style={{ whiteSpace: "nowrap", color: COLORS.textSoft }}>{lane.title}</b>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: tone.c, fontSize: FONT.xs, whiteSpace: "nowrap" }}>
          <Ico d={st.icon} size={12} sw={2.4} />
          {st.text}
        </span>
        <span style={{ marginLeft: "auto", fontSize: FONT.xs, color: COLORS.textMuted, whiteSpace: "nowrap", fontFamily: MONO }}>{lane.meta}</span>
      </span>
      {lane.ring ? (
        <span style={{ ...chipShape(6), position: "absolute", right: 12, top: 36, display: "flex", alignItems: "center", gap: 6, padding: "3px 8px 3px 4px", background: "var(--te-warning-soft)", color: COLORS.warning, fontSize: FONT.xs, fontWeight: 600 }}>
          <svg width="22" height="22" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="14" style={{ fill: "none", stroke: "var(--te-border)", strokeWidth: 4 }} />
            <circle cx="18" cy="18" r="14" transform="rotate(-90 18 18)" style={{ fill: "none", stroke: "var(--te-warning)", strokeWidth: 4, strokeDasharray: `${(2 * Math.PI * 14 * lane.ring.fraction).toFixed(1)} ${(2 * Math.PI * 14).toFixed(1)}` }} />
          </svg>
          {lane.ring.text}
        </span>
      ) : null}
    </div>
  );
});

const RunEdge = memo(function RunEdge({ id, data }: EdgeProps<Edge<EdgeData>>) {
  const { view, onPill } = data as EdgeData;
  return (
    <>
      <BaseEdge
        id={id}
        path={view.d}
        className={view.animated ? "te-wf-edge-live" : undefined}
        markerEnd={`url(#${view.marker})`}
        style={{ fill: "none", stroke: view.color, strokeWidth: view.width, strokeDasharray: view.dashed ? "4 4" : undefined }}
      />
      {view.traversed ? (
        <>
          <path d={view.d} className="te-wf-edge-live" style={{ fill: "none", stroke: view.color, strokeWidth: view.width + 1, opacity: view.animated ? 0.9 : 0.35, strokeLinecap: "round" }} />
          {(view.animated ? [0, 1] : [0]).map((i) => (
            <circle key={i} r={view.animated ? 4 : 3} className="te-wf-particle" style={{ fill: view.color, filter: `drop-shadow(0 0 4px ${view.color})` }}>
              <animateMotion dur={view.animated ? "1.2s" : "3.2s"} begin={`-${(view.key.length % 7) * 0.4 + i * 0.6}s`} repeatCount="indefinite" path={view.d} />
            </circle>
          ))}
        </>
      ) : null}
      <EdgeLabelRenderer>
        {view.showPill ? (
          <button
            type="button"
            className="nodrag nopan te-wf-tap"
            aria-label={`${view.from} to ${view.to}, taken ${view.count} times. Show reasons`}
            onClick={() => onPill(view.key)}
            style={{ ...chipShape(6), position: "absolute", transform: `translate(-50%, -50%) translate(${view.lx}px, ${view.ly}px)`, pointerEvents: "all", height: 22, minWidth: 30, padding: "0 6px", border: `1px solid ${view.color}`, background: COLORS.panelBg, color: view.color, fontSize: FONT.xs, fontWeight: 600, fontFamily: MONO, cursor: "pointer" }}
          >
            ×{view.count}
          </button>
        ) : null}
        {view.lock ? (
          <span title="publish has run — nothing after it may loop back before it" style={{ ...chipShape(6), position: "absolute", transform: `translate(-50%, -50%) translate(${view.lx}px, ${view.ly - 28}px)`, display: "inline-flex", alignItems: "center", gap: 3, height: 20, padding: "0 6px", background: "var(--te-warning-soft)", color: COLORS.warning, fontSize: FONT.xs, fontWeight: 600 }}>
            <Ico d={IC.lock} size={11} sw={2.4} />
            locked
          </span>
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
});

const nodeTypes = { run: FlowCard, gate: FlowCard, terminal: FlowCard, lane: LaneNode };
const edgeTypes = { run: RunEdge };

type Props = {
  layout: Layout;
  nodeViews: NodeView[];
  edgeViews: EdgeView[];
  laneViews: LaneView[];
  selectedId: string;
  focusId: string;
  follow: boolean;
  vertical: boolean;
  live: boolean;
  layoutKey: string;
  edgePop: string | null;
  allPaths: boolean;
  steps: string[];
  onPick: (id: string) => void;
  onFollow: (on: boolean) => void;
  onPill: (key: string) => void;
  onAllPaths: () => void;
  onClosePop: () => void;
};

function Canvas(p: Props) {
  const rf = useReactFlow();
  const initialized = useNodesInitialized();

  const nodes = useMemo<Node[]>(() => {
    const viewById = new Map(p.nodeViews.map((v) => [v.id, v]));
    const lanes: Node[] = p.layout.lanes.map((l, i) => ({
      id: `lane:${l.id}`,
      type: "lane",
      position: { x: l.x, y: l.y },
      style: { width: l.w, height: l.h },
      initialWidth: l.w,
      initialHeight: l.h,
      measured: { width: l.w, height: l.h },
      data: { lane: p.laneViews[i] } satisfies LaneData,
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    }));
    // Nodes are rebuilt on every poll; without `measured` + `handles` React Flow drops
    // their handle bounds and hides every edge until the DOM is re-measured.
    const inPos = p.vertical ? Position.Top : Position.Left;
    const outPos = p.vertical ? Position.Bottom : Position.Right;
    const cards: Node[] = p.layout.nodes.map((n) => {
      const view = viewById.get(n.id)!;
      const at = (pos: Position) => (pos === Position.Left ? { x: -5, y: n.h / 2 - 5 } : pos === Position.Right ? { x: n.w - 5, y: n.h / 2 - 5 } : pos === Position.Top ? { x: n.w / 2 - 5, y: -5 } : { x: n.w / 2 - 5, y: n.h - 5 });
      return {
        id: n.id,
        type: n.kind === "card" ? "run" : n.kind,
        position: { x: n.x, y: n.y },
        style: { width: n.w, height: n.h },
        initialWidth: n.w,
        initialHeight: n.h,
        measured: { width: n.w, height: n.h },
        handles: [
          { id: "in", type: "target", position: inPos, width: 10, height: 10, ...at(inPos) },
          ...(n.kind === "terminal" ? [] : [{ id: "out", type: "source" as const, position: outPos, width: 10, height: 10, ...at(outPos) }]),
        ],
        data: { view, selected: n.id === p.selectedId, vertical: p.vertical } satisfies CardData,
        ariaLabel: view.aria,
        draggable: false,
        zIndex: 2,
      };
    });
    return [...lanes, ...cards];
  }, [p.layout, p.nodeViews, p.laneViews, p.selectedId, p.vertical]);

  const edges = useMemo<Edge[]>(
    () => p.edgeViews.map((v) => ({ id: v.key, type: "run", source: v.from, target: v.to, selectable: false, focusable: false, data: { view: v, onPill: p.onPill } satisfies EdgeData })),
    [p.edgeViews, p.onPill],
  );

  const focus = p.layout.nodes.find((n) => n.id === p.focusId);
  const zoom = p.live ? (p.vertical ? 0.8 : 0.78) : p.vertical ? 0.72 : 0.6;
  // A finished run frames the path it actually walked — unless that path is so long the cards would be
  // unreadable, where centring the last node at the usual zoom shows more.
  const pane = useStore((s) => (p.vertical ? s.height : s.width));
  const ran = p.live ? [] : p.layout.nodes.filter((n) => p.nodeViews.find((v) => v.id === n.id)?.status !== "pending");
  const span = (lo: (n: (typeof ran)[number]) => number, hi: (n: (typeof ran)[number]) => number) => Math.max(...ran.map(hi)) - Math.min(...ran.map(lo));
  const ranLen = ran.length ? (p.vertical ? span((n) => n.y, (n) => n.y + n.h) : span((n) => n.x, (n) => n.x + n.w)) : 0;
  const ranKey = ran.length && pane / (ranLen * 1.24) >= 0.5 ? ran.map((n) => n.id).join(",") : "";
  useEffect(() => {
    if (!initialized || !p.follow) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (ranKey) {
      void rf.fitView({ nodes: ranKey.split(",").map((id) => ({ id })), padding: 0.12, maxZoom: 1, duration: reduce ? 0 : 220 });
      return;
    }
    if (!focus) return;
    void rf.setCenter(focus.x + focus.w / 2, focus.y + focus.h / 2, { zoom, duration: reduce ? 0 : 220 });
  }, [initialized, p.follow, p.layoutKey, p.focusId, focus?.x, focus?.y, zoom, ranKey, rf]);

  const pop = p.edgePop ? p.edgeViews.find((e) => e.key === p.edgePop) : undefined;

  return (
    <>
      <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          {MARKERS.map((m) => (
            <marker key={m} id={`te-wf-m-${m}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" style={{ fill: m === "faint" ? "var(--te-edge-faint)" : `var(--te-${m})` }} />
            </marker>
          ))}
        </defs>
      </svg>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnScroll
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => {
          if (n.type !== "lane") p.onPick(n.id);
        }}
        onMoveStart={(e) => {
          if (e) p.onFollow(false);
        }}
        aria-label="Run workflow canvas. Use Tab to move between steps, Enter to inspect."
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.8} />
        <Controls position="bottom-left" showInteractive={false} onFitView={() => p.onFollow(false)}>
          <ControlButton aria-label={p.follow ? "Following live (on)" : "Follow live"} title={p.follow ? "Following live (on)" : "Follow live"} onClick={() => p.onFollow(!p.follow)} style={{ color: p.follow ? "var(--te-accent)" : undefined, background: p.follow ? "var(--te-accent-soft)" : undefined }}>
            <Ico d={IC.target} size={16} />
          </ControlButton>
          <ControlButton aria-label={p.allPaths ? "Showing all paths (on)" : "Show all paths"} title={p.allPaths ? "Showing all paths (on)" : "Show all paths"} onClick={p.onAllPaths} style={{ color: p.allPaths ? "var(--te-accent)" : undefined, background: p.allPaths ? "var(--te-accent-soft)" : undefined }}>
            <Ico d={IC.git} size={16} />
          </ControlButton>
        </Controls>
        <MiniMap
          className="te-mobile-hide"
          pannable
          zoomable
          position="bottom-right"
          maskColor="var(--te-minimap-mask)"
          nodeStrokeWidth={0}
          nodeColor={(n) => {
            if (n.type === "lane") return "var(--te-lane-border)";
            const v = (n.data as CardData).view;
            return v.status === "pending" ? "var(--te-faint)" : TONE[STATUS[v.status].tone].c;
          }}
        />
      </ReactFlow>

      {p.live && !p.follow ? (
        <button type="button" className="te-action-btn" onClick={() => p.onFollow(true)} style={{ ...ctaButtonStyle("primary"), position: "absolute", left: "50%", transform: "translateX(-50%)", top: 12, zIndex: 5 }}>
          <span aria-hidden="true" className="te-wf-blink" style={{ width: 7, height: 7, background: "currentColor" }} />
          Jump to live
        </button>
      ) : null}

      {pop ? (
        <div role="dialog" aria-label="Edge history" style={{ ...chipShape(8), position: "absolute", right: 12, top: 12, width: 280, maxWidth: "calc(100% - 24px)", zIndex: 6, background: COLORS.panelBg, border: `1px solid ${COLORS.border}`, boxShadow: "var(--te-node-shadow)", padding: "10px 12px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <b style={{ flex: 1, fontSize: FONT.sm, fontFamily: MONO }}>
              {pop.from} → {pop.to}
            </b>
            <button type="button" aria-label="Close" className="te-icon-btn" onClick={p.onClosePop} style={{ ...chipShape(6), width: 28, height: 28, border: 0, background: COLORS.panelBgDark, color: COLORS.text, cursor: "pointer" }}>
              ×
            </button>
          </span>
          <ol style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
            {pop.reasons.map((r) => (
              <li key={r.seq} style={{ display: "flex", gap: 8, padding: "4px 0", borderTop: `1px solid ${COLORS.borderSubtle}`, fontSize: FONT.sm }}>
                <span style={{ color: COLORS.textMuted, fontFamily: MONO }}>
                  #{r.seq} {r.at}
                </span>
                <span style={{ flex: 1 }}>{r.reason}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <ol className="te-wf-sr" aria-label="Steps in order">
        {p.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </>
  );
}

export default function WorkflowCanvas(p: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...p} />
    </ReactFlowProvider>
  );
}
