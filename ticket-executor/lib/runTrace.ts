import type { LogLine } from "./types";

export type StepStatus = "running" | "succeeded" | "failed" | "abandoned";

export type StepTrace = {
  id: string;
  nodeId: string;
  label: string;
  attempt: number;
  status: StepStatus;
  effects: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  numTurns: number;
  errorMessage: string;
  output: Record<string, unknown>;
  logFrom: number;
  logTo: number;
};

export type TransitionView = { seq: number; fromNode: string; toNode: string; reason: string; at: string };

export type FlowNodeDef = { id: string; label: string; kind: string; effects: string; context: string; next: string[] };

export const END_ID = "END";
export const FAIL_ID = "FAIL";

export function logRanges(froms: (number | undefined)[], total: number): { from: number; to: number }[] {
  const resolved: number[] = [];
  for (let i = 0; i < froms.length; i++) {
    const prev = i ? resolved[i - 1] : 0;
    const f = froms[i];
    resolved.push(typeof f === "number" && f >= prev ? Math.min(f, total) : prev);
  }
  return resolved.map((from, i) => ({ from, to: i + 1 < resolved.length ? resolved[i + 1] : total }));
}

export function cumulativeStarts(lengths: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const n of lengths) {
    out.push(acc);
    acc += n;
  }
  return out;
}

export type ActivityItem =
  | { type: "tool"; key: string; line: LogLine; result: LogLine | null }
  | { type: "message"; key: string; lines: LogLine[] }
  | { type: "thinking"; key: string; line: LogLine }
  | { type: "prompt"; key: string; line: LogLine }
  | { type: "event"; key: string; line: LogLine };

export type ActivityFilter = "all" | "tools" | "messages" | "errors";

const EVENT_KINDS = new Set(["step", "err", "fail", "done", "ok", "diff"]);

export function groupActivity(lines: LogLine[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  const toolAt = new Map<string, number>();
  lines.forEach((line, i) => {
    const key = `l${i}`;
    if (line.kind === "result") {
      const at = line.ref ? toolAt.get(line.ref) : undefined;
      const host = at === undefined ? undefined : items[at];
      if (host && host.type === "tool" && !host.result) {
        host.result = line;
        return;
      }
      items.push({ type: "event", key, line });
      return;
    }
    if (line.kind === "muted") {
      const last = items[items.length - 1];
      if (last && last.type === "message") last.lines.push(line);
      else items.push({ type: "message", key, lines: [line] });
      return;
    }
    if (line.kind === "cmd" && line.text.startsWith("▸ ")) {
      items.push({ type: "prompt", key, line });
      return;
    }
    if (line.kind === "thinking") {
      items.push({ type: "thinking", key, line });
      return;
    }
    if ((line.kind === "cmd" || line.kind === "file") && (line.tool || line.ref || line.text.startsWith("$ ") || line.text.startsWith("✎ ") || line.text.startsWith("⇢ "))) {
      if (line.ref) toolAt.set(line.ref, items.length);
      items.push({ type: "tool", key, line, result: null });
      return;
    }
    if (EVENT_KINDS.has(line.kind)) {
      items.push({ type: "event", key, line });
      return;
    }
    const last = items[items.length - 1];
    if (last && last.type === "message") last.lines.push(line);
    else items.push({ type: "message", key, lines: [line] });
  });
  return items;
}

function itemText(item: ActivityItem): string {
  if (item.type === "message") return item.lines.map((l) => l.text).join("\n");
  if (item.type === "tool") return `${item.line.text}\n${item.line.detail ?? ""}\n${item.result?.detail ?? ""}`;
  return `${item.line.text}\n${item.line.detail ?? ""}`;
}

export function isErrorItem(item: ActivityItem): boolean {
  if (item.type === "tool") return !!item.result?.isError;
  if (item.type === "event") return item.line.kind === "err" || item.line.kind === "fail" || !!item.line.isError;
  return false;
}

export function filterActivity(items: ActivityItem[], filter: ActivityFilter, query: string): ActivityItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter === "tools" && item.type !== "tool") return false;
    if (filter === "messages" && item.type !== "message" && item.type !== "thinking") return false;
    if (filter === "errors" && !isErrorItem(item)) return false;
    return !q || itemText(item).toLowerCase().includes(q);
  });
}

export type ActivityStats = { tools: number; commands: number; edits: number; messages: number; errors: number };

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function activityStats(items: ActivityItem[]): ActivityStats {
  const s: ActivityStats = { tools: 0, commands: 0, edits: 0, messages: 0, errors: 0 };
  for (const item of items) {
    if (item.type === "tool") {
      s.tools += 1;
      if (item.line.kind === "cmd") s.commands += 1;
      if (item.line.tool && EDIT_TOOLS.has(item.line.tool)) s.edits += 1;
    } else if (item.type === "message") s.messages += 1;
    if (isErrorItem(item)) s.errors += 1;
  }
  return s;
}

export type EdgeStat = { count: number; lastReason: string; lastSeq: number };

export function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

export function edgeStats(transitions: TransitionView[]): Map<string, EdgeStat> {
  const m = new Map<string, EdgeStat>();
  for (const t of transitions) {
    const k = edgeKey(t.fromNode, t.toNode);
    const prev = m.get(k);
    m.set(k, { count: (prev?.count ?? 0) + 1, lastReason: t.reason, lastSeq: t.seq });
  }
  return m;
}

export type OutputKind = "review" | "gate" | "delivery" | "publish" | "lesson" | "unknown";

export function outputKind(output: Record<string, unknown>): OutputKind {
  if (typeof output.verdict === "string") return "review";
  if (typeof output.passed === "boolean") return "gate";
  if (typeof output.recorded === "boolean") return "lesson";
  if (typeof output.pushed === "boolean" || Array.isArray(output.prs)) return "publish";
  if (typeof output.committed === "boolean" || typeof output.outcome === "string") return "delivery";
  return "unknown";
}

export function transitionOutOf(step: StepTrace, steps: StepTrace[], transitions: TransitionView[]): TransitionView | null {
  const idx = steps.findIndex((s) => s.id === step.id);
  const start = Date.parse(step.startedAt);
  const nextStart = idx >= 0 && idx + 1 < steps.length ? Date.parse(steps[idx + 1].startedAt) : Infinity;
  return transitions.find((t) => t.fromNode === step.nodeId && Date.parse(t.at) >= start && Date.parse(t.at) <= nextStart) ?? null;
}

export function transitionInto(step: StepTrace, steps: StepTrace[], transitions: TransitionView[]): TransitionView | null {
  const idx = steps.findIndex((s) => s.id === step.id);
  for (let i = idx - 1; i >= 0; i--) {
    const out = transitionOutOf(steps[i], steps, transitions);
    if (out) return out.toNode === step.nodeId ? out : null;
  }
  return null;
}

export function defaultStepId(steps: StepTrace[]): string {
  const running = [...steps].reverse().find((s) => s.status === "running");
  return (running ?? steps[steps.length - 1])?.id ?? "";
}

export type NodeRunState = "pending" | "running" | "done" | "failed" | "skipped";

export function nodeRunState(nodeId: string, steps: StepTrace[]): NodeRunState {
  const mine = steps.filter((s) => s.nodeId === nodeId);
  const last = mine[mine.length - 1];
  if (!last) return "pending";
  if (last.status === "running") return "running";
  if (last.status === "succeeded") return "done";
  return "failed";
}

export type NodeSummary = {
  attempts: number;
  durationMs: number;
  costUsd: number;
  tone: NodeRunState;
  latestStepId: string;
  label: string;
  runningSince: string;
};

export function nodeSummaries(steps: StepTrace[], now: number): Map<string, NodeSummary> {
  const m = new Map<string, NodeSummary>();
  for (const s of steps) {
    const prev = m.get(s.nodeId);
    m.set(s.nodeId, {
      attempts: (prev?.attempts ?? 0) + 1,
      durationMs: (prev?.durationMs ?? 0) + stepElapsed(s, now),
      costUsd: (prev?.costUsd ?? 0) + s.costUsd,
      tone: s.status === "running" ? "running" : s.status === "succeeded" ? "done" : s.status === "abandoned" ? "skipped" : "failed",
      latestStepId: s.id,
      label: s.label,
      runningSince: s.status === "running" ? s.startedAt : "",
    });
  }
  return m;
}

export type LaidNode = {
  id: string;
  label: string;
  kind: string;
  effects: string;
  context: string;
  terminal: boolean;
  lane: "main" | "side";
  x: number;
  y: number;
};

export type EdgeRoute = "straight" | "down" | "up" | "under";

export type LaidEdge = {
  id: string;
  source: string;
  target: string;
  route: EdgeRoute;
  sourceHandle: string;
  targetHandle: string;
  offset: number;
  taken: EdgeStat | null;
};

export type FlowLayout = { nodes: LaidNode[]; edges: LaidEdge[]; width: number; height: number };

export const FLOW_NODE_W = 188;
export const FLOW_NODE_H = 74;
export const FLOW_TERMINAL_W = 96;
export const FLOW_TERMINAL_H = 40;
const COL_GAP = 62;
const ROW_GAP = 64;

export function mainPath(defs: FlowNodeDef[]): string[] {
  const ids = new Set(defs.map((d) => d.id));
  const byId = new Map(defs.map((d) => [d.id, d]));
  const path: string[] = [];
  let cur: string | undefined = defs[0]?.id;
  while (cur && !path.includes(cur)) {
    path.push(cur);
    cur = byId.get(cur)?.next.find((t) => ids.has(t) && !path.includes(t));
  }
  return path;
}

export function flowLayout(defs: FlowNodeDef[], transitions: TransitionView[]): FlowLayout {
  const stats = edgeStats(transitions);
  const byId = new Map(defs.map((d) => [d.id, d]));
  const main = mainPath(defs);
  const declaresEnd = defs.some((d) => d.next.includes(END_ID));
  const reachedFail = transitions.some((t) => t.toNode === FAIL_ID);
  const pitch = FLOW_NODE_W + COL_GAP;
  const sideY = FLOW_NODE_H + ROW_GAP;

  const pos = new Map<string, LaidNode>();
  main.forEach((id, i) => {
    const d = byId.get(id)!;
    pos.set(id, { id, label: d.label, kind: d.kind, effects: d.effects, context: d.context, terminal: false, lane: "main", x: i * pitch, y: 0 });
  });
  if (declaresEnd) {
    pos.set(END_ID, {
      id: END_ID, label: "Done", kind: "terminal", effects: "", context: "", terminal: true, lane: "main",
      x: main.length * pitch, y: (FLOW_NODE_H - FLOW_TERMINAL_H) / 2,
    });
  }

  const linked = (a: string, b: string) => !!byId.get(a)?.next.includes(b) || !!byId.get(b)?.next.includes(a);
  const side = defs
    .filter((d) => !main.includes(d.id))
    .map((d) => {
      const anchors = main.filter((m) => linked(m, d.id)).map((m) => pos.get(m)!.x);
      return { d, want: anchors.length ? anchors.reduce((a, b) => a + b, 0) / anchors.length : main.length * pitch };
    })
    .sort((a, b) => a.want - b.want);
  let floor = -Infinity;
  for (const { d, want } of side) {
    const x = Math.max(want, floor);
    floor = x + pitch;
    pos.set(d.id, { id: d.id, label: d.label, kind: d.kind, effects: d.effects, context: d.context, terminal: false, lane: "side", x, y: sideY });
  }
  if (reachedFail) {
    const x = Math.max(floor, (main.length - 1) * pitch + (FLOW_NODE_W - FLOW_TERMINAL_W) / 2);
    pos.set(FAIL_ID, {
      id: FAIL_ID, label: "Failed", kind: "terminal", effects: "", context: "", terminal: true, lane: "side",
      x, y: sideY + (FLOW_NODE_H - FLOW_TERMINAL_H) / 2,
    });
  }

  const pairs: { source: string; target: string }[] = [];
  const seen = new Set<string>();
  const add = (source: string, target: string) => {
    const k = edgeKey(source, target);
    if (source === target || seen.has(k) || !pos.has(source) || !pos.has(target)) return;
    seen.add(k);
    pairs.push({ source, target });
  };
  main.forEach((id, i) => add(id, main[i + 1] ?? (declaresEnd && byId.get(id)?.next.includes(END_ID) ? END_ID : "")));
  for (const { d } of side) {
    const from = [...main].reverse().find((m) => byId.get(m)?.next.includes(d.id));
    if (from) add(from, d.id);
    const back = d.next.find((t) => main.includes(t));
    if (back) add(d.id, back);
  }
  for (const t of transitions) add(t.fromNode, t.toNode);

  const underCount = new Map<string, number>();
  const edges: LaidEdge[] = pairs.map(({ source, target }) => {
    const s = pos.get(source)!;
    const t = pos.get(target)!;
    let route: EdgeRoute;
    if (s.lane === t.lane) route = t.x > s.x ? "straight" : "under";
    else route = s.lane === "main" ? "down" : "up";
    const lane = route === "under" ? underCount.get(target) ?? 0 : 0;
    if (route === "under") underCount.set(target, lane + 1);
    const handles: Record<EdgeRoute, [string, string]> = {
      straight: ["right", "left"],
      down: ["bottom-out", "top-in"],
      up: ["top-out", "bottom-in"],
      under: ["bottom-out", "bottom-in"],
    };
    const [sourceHandle, targetHandle] = handles[route];
    return { id: edgeKey(source, target), source, target, route, sourceHandle, targetHandle, offset: 22 + lane * 14, taken: stats.get(edgeKey(source, target)) ?? null };
  });

  const nodes = [...pos.values()];
  const width = Math.max(...nodes.map((n) => n.x + (n.terminal ? FLOW_TERMINAL_W : FLOW_NODE_W)));
  const height = Math.max(...nodes.map((n) => n.y + (n.terminal ? FLOW_TERMINAL_H : FLOW_NODE_H)));
  return { nodes, edges, width, height };
}

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return ms < 1000 ? `${ms}ms` : `${s}s`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function stepElapsed(step: StepTrace, now: number): number {
  if (step.status !== "running") return step.durationMs || (step.endedAt ? Date.parse(step.endedAt) - Date.parse(step.startedAt) : 0);
  return Math.max(0, now - Date.parse(step.startedAt));
}
