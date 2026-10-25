import { PHASES, TERM_ORDER } from "./meta";
import type { FlowNodeDef } from "./types";

export type Dir = "LR" | "TB";

export type LayoutKind = "card" | "gate" | "terminal";

export type LayoutNode = {
  id: string;
  def: FlowNodeDef;
  kind: LayoutKind;
  lane: string;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type LayoutLane = { id: string; x: number; y: number; w: number; h: number };

export type EdgeClass = "down" | "forward" | "loop" | "park";

export type LayoutEdge = {
  key: string;
  from: string;
  to: string;
  cls: EdgeClass;
  d: string;
  lx: number;
  ly: number;
  implicit: boolean;
};

export type Bounds = { x: number; y: number; w: number; h: number };

export type Layout = {
  lanes: LayoutLane[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  bounds: Bounds;
  happy: string[];
};

type Pair = { from: string; to: string; implicit: boolean };

type PlanItem = { d: FlowNodeDef; mi: number; ci: number; row: number };

type PlanLane = {
  l: string;
  items: PlanItem[];
  kind: LayoutKind;
  sz: { m: number; c: number; w: number; h: number };
  g: number;
  cExt: number;
  mExt: number;
};

const SPACING = {
  LR: { gapM: 56, gapC: 64, pad: 24, laneGap: 24, hdrC: 52, hdrM: 0, sGap: 16 },
  TB: { gapM: 36, gapC: 20, pad: 14, laneGap: 14, hdrC: 0, hdrM: 42, sGap: 12 },
};

const LANE_IDS = ["pre-run", ...PHASES, "unknown", "terminal"];

function sizeOf(kind: LayoutKind, LR: boolean) {
  const wh: [number, number] =
    kind === "gate" ? (LR ? [200, 96] : [176, 92]) : kind === "terminal" ? (LR ? [176, 58] : [176, 54]) : [240, 124];
  return LR ? { m: wh[0], c: wh[1], w: wh[0], h: wh[1] } : { m: wh[1], c: wh[0], w: wh[0], h: wh[1] };
}

export function layoutRun(defs: FlowNodeDef[], dir: Dir, extraPairs: [string, string][] = []): Layout {
  const LR = dir === "LR";
  const K = SPACING[dir];
  const ids = new Set(defs.map((d) => d.id));
  const byId = new Map(defs.map((d) => [d.id, d]));

  const happy: string[] = [];
  const seen = new Set<string>();
  let cur = defs.find((d) => d.phase !== "pre-run");
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    happy.push(cur.id);
    cur = byId.get(cur.next[0]);
  }
  const hIdx = new Map(happy.map((id, i) => [id, i]));

  const pairs: Pair[] = [];
  defs.forEach((d) => d.next.forEach((t) => pairs.push({ from: d.id, to: t, implicit: false })));
  extraPairs.forEach(([from, to]) => {
    if (!pairs.some((q) => q.from === from && q.to === to)) pairs.push({ from, to, implicit: true });
  });

  const termSet = new Set<string>();
  pairs.forEach((p) => {
    if (!ids.has(p.to)) termSet.add(p.to);
  });
  const terms = TERM_ORDER.filter((t) => termSet.has(t)).concat([...termSet].filter((t) => !TERM_ORDER.includes(t)));

  const byLane: Record<string, FlowNodeDef[]> = {};
  LANE_IDS.forEach((l) => {
    byLane[l] = [];
  });
  defs.forEach((d) => {
    const l = LANE_IDS.includes(d.phase) && d.phase !== "terminal" ? d.phase : "unknown";
    byLane[l].push(d);
  });
  terms.forEach((t) =>
    byLane.terminal.push({ id: t, label: t, phase: "terminal", kind: "terminal", effects: "pure", context: "", next: [] }),
  );

  const plan: PlanLane[] = [];
  LANE_IDS.forEach((l) => {
    const list = byLane[l];
    if (!list.length) return;
    const items: PlanItem[] = [];
    if (l === "pre-run" || l === "terminal") {
      const per = l === "terminal" && !LR ? 2 : 99;
      list.forEach((d, i) =>
        items.push({
          d,
          mi: per === 99 ? 0 : Math.floor(i / per),
          ci: per === 99 ? i : i % per,
          row: per === 99 ? i : Math.floor(i / per),
        }),
      );
    } else {
      const main = list.filter((d) => hIdx.has(d.id)).sort((a, b) => hIdx.get(a.id)! - hIdx.get(b.id)!);
      const off = list.filter((d) => !hIdx.has(d.id));
      main.forEach((d, i) => items.push({ d, mi: i, ci: 0, row: 0 }));
      off.forEach((d, i) =>
        items.push(main.length ? { d, mi: i + (main.length > 1 ? 1 : 0), ci: 1, row: 1 } : { d, mi: i, ci: 0, row: 0 }),
      );
    }
    const kind: LayoutKind = l === "pre-run" ? "gate" : l === "terminal" ? "terminal" : "card";
    const sz = sizeOf(kind, LR);
    const g = kind === "card" ? K.gapC : K.sGap;
    const maxCi = Math.max(...items.map((i) => i.ci));
    const maxMi = Math.max(...items.map((i) => i.mi));
    plan.push({
      l,
      items,
      kind,
      sz,
      g,
      cExt: K.hdrC + K.pad + (maxCi + 1) * sz.c + maxCi * g + K.pad,
      mExt: K.hdrM + K.pad + (maxMi + 1) * sz.m + maxMi * K.gapM + K.pad,
    });
  });
  const laneC = Math.max(0, ...plan.map((p) => p.cExt));

  const toXY = (m: number, c: number): [number, number] => (LR ? [m, c] : [c, m]);
  const lanes: LayoutLane[] = [];
  const nodes: LayoutNode[] = [];
  let m0 = 0;
  plan.forEach((p) => {
    p.items.forEach((it) => {
      const m = m0 + K.hdrM + K.pad + it.mi * (p.sz.m + K.gapM);
      const c = K.hdrC + K.pad + it.ci * (p.sz.c + p.g);
      const [x, y] = toXY(m, c);
      nodes.push({ id: it.d.id, def: it.d, kind: p.kind, lane: p.l, row: it.row, x, y, w: p.sz.w, h: p.sz.h });
    });
    const [lx, ly] = toXY(m0, 0);
    lanes.push({ id: p.l, x: lx, y: ly, w: LR ? p.mExt : laneC, h: LR ? laneC : p.mExt });
    m0 += p.mExt + K.laneGap;
  });

  const nmap = new Map(nodes.map((n) => [n.id, n]));
  const lastHappy = happy[happy.length - 1];

  const bez = (p0: number[], c1: number[], c2: number[], p3: number[]): string => {
    const a = toXY(p0[0], p0[1]);
    const b = toXY(c1[0], c1[1]);
    const c = toXY(c2[0], c2[1]);
    const d = toXY(p3[0], p3[1]);
    return `M${a[0]} ${a[1]} C${b[0]} ${b[1]} ${c[0]} ${c[1]} ${d[0]} ${d[1]}`;
  };
  const rpath = (pts: number[][], r: number): string => {
    const P = pts.map((p) => toXY(p[0], p[1]));
    let d = `M${P[0][0]} ${P[0][1]}`;
    for (let i = 1; i < P.length - 1; i++) {
      const a = P[i - 1];
      const b = P[i];
      const c = P[i + 1];
      const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
      const rr = Math.min(r, l1 / 2, l2 / 2);
      d += ` L${b[0] - ((b[0] - a[0]) / l1) * rr} ${b[1] - ((b[1] - a[1]) / l1) * rr} Q${b[0]} ${b[1]} ${b[0] + ((c[0] - b[0]) / l2) * rr} ${b[1] + ((c[1] - b[1]) / l2) * rr}`;
    }
    const L = P[P.length - 1];
    return `${d} L${L[0]} ${L[1]}`;
  };
  const frame = (n: LayoutNode) => {
    const sm = LR ? n.w : n.h;
    const sc = LR ? n.h : n.w;
    const m = LR ? n.x : n.y;
    const c = LR ? n.y : n.x;
    return { ms: m, me: m + sm, mm: m + sm / 2, cs: c, ce: c + sc, cm: c + sc / 2 };
  };

  const edges: LayoutEdge[] = [];
  // Side exits to a terminal share one rail per (side, terminal): a node drops a short
  // stub onto its rail instead of drawing its own track across the canvas.
  const isPark = (A: LayoutNode, B: LayoutNode, pr: Pair) => B.kind === "terminal" && !(pr.from === lastHappy && pr.to === A.def.next[0]);
  const rails = new Map<string, { c: number; g: number }>();
  let nOver = 0;
  let nBelow = 0;
  pairs.forEach((pr) => {
    const A = nmap.get(pr.from);
    const B = nmap.get(pr.to);
    if (!A || !B || !isPark(A, B, pr)) return;
    const above = A.row === 0 && A.lane !== "pre-run";
    const k = `${above ? "a" : "b"}:${pr.to}`;
    if (rails.has(k)) return;
    rails.set(k, { c: above ? -22 - nOver++ * 14 : laneC + 22 + nBelow++ * 14, g: rails.size });
  });
  pairs.forEach((pr) => {
    const A = nmap.get(pr.from);
    const B = nmap.get(pr.to);
    if (!A || !B) return;
    const a = frame(A);
    const b = frame(B);
    let cls: EdgeClass;
    let d: string;
    let lab: [number, number];
    if (isPark(A, B, pr)) {
      cls = "park";
      const above = A.row === 0 && A.lane !== "pre-run";
      const rail = rails.get(`${above ? "a" : "b"}:${pr.to}`)!;
      const sm = LR ? a.ms + 28 : a.mm;
      const mx = b.ms - 26 - rail.g * 8;
      d = rpath([[sm, above ? a.cs : a.ce], [sm, rail.c], [mx, rail.c], [mx, b.cm], [b.ms, b.cm]], 12);
      lab = [sm, rail.c];
    } else if (b.cs >= a.ce - 1) {
      cls = "down";
      const dy = Math.max(24, (b.cs - a.ce) / 2);
      d = bez([a.mm, a.ce], [a.mm, a.ce + dy], [b.mm, b.cs - dy], [b.mm, b.cs]);
      lab = [(a.mm + b.mm) / 2, (a.ce + b.cs) / 2];
    } else if (b.ms >= a.me - 1) {
      cls = "forward";
      const dx = Math.max(28, (b.ms - a.me) / 2);
      d = bez([a.me, a.cm], [a.me + dx, a.cm], [b.ms - dx, b.cm], [b.ms, b.cm]);
      lab = [(a.me + b.ms) / 2, (a.cm + b.cm) / 2];
    } else {
      cls = "loop";
      const cB = laneC + 22 + nBelow * 14;
      nBelow++;
      d = rpath([[a.mm + 18, a.ce], [a.mm + 18, cB], [b.mm - 18, cB], [b.mm - 18, b.ce]], 14);
      lab = [(a.mm + b.mm) / 2, cB];
    }
    const [lx, ly] = toXY(lab[0], lab[1]);
    edges.push({ key: `${pr.from}>${pr.to}`, from: pr.from, to: pr.to, cls, d, lx, ly, implicit: pr.implicit });
  });

  const cMin = -22 - nOver * 14 - 20;
  const cMax = laneC + 22 + nBelow * 14 + 20;
  const b0 = toXY(-20, cMin);
  const b1 = toXY(m0, cMax);
  const bounds: Bounds = {
    x: Math.min(b0[0], b1[0]),
    y: Math.min(b0[1], b1[1]),
    w: Math.abs(b1[0] - b0[0]),
    h: Math.abs(b1[1] - b0[1]),
  };
  return { lanes, nodes, edges, bounds, happy };
}
