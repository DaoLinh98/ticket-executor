"use client";

import { useCallback, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { COLORS } from "@/lib/ui";

type Bolt = { id: string; d: string; d2: string | null; big: boolean };
type Flash = { id: string; x: number; y: number };

const ACCENT = COLORS.accent;
// The accent at two alphas. These used to be `${ACCENT}55` / `${ACCENT}18` —
// appending an alpha byte to a hex, which stopped working the moment the palette
// became CSS custom properties (`var(--te-accent)55` parses as nothing).
const ACCENT_A33 = `color-mix(in srgb, ${ACCENT} 33%, transparent)`;
const ACCENT_A09 = `color-mix(in srgb, ${ACCENT} 9%, transparent)`;

function zigzagPath(x1: number, y1: number, x2: number, y2: number, segs: number, jitter: number) {
  const pts: [number, number][] = [[x1, y1]];
  for (let i = 1; i < segs; i++) {
    const f = i / segs;
    const x = x1 + (x2 - x1) * f + (Math.random() - 0.5) * jitter;
    const y = y1 + (y2 - y1) * f + (Math.random() - 0.5) * jitter * 0.55;
    pts.push([x, y]);
  }
  pts.push([x2, y2]);
  return "M " + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L ");
}

export function useBolts() {
  const [bolts, setBolts] = useState<Bolt[]>([]);
  const [flashes, setFlashes] = useState<Flash[]>([]);
  const seq = useRef(0);

  const fireBolt = useCallback(
    (x: number, y: number, opts?: { big?: boolean }) => {
      opts = opts || {};
      const id = "b" + ++seq.current;
      const big = !!opts.big;
      const originX = x + (Math.random() - 0.5) * 160;
      const originY = -40;
      const d = zigzagPath(originX, originY, x, y, big ? 8 : 6, big ? 60 : 44);
      let d2: string | null = null;
      if (Math.random() > 0.3) {
        const f = 0.35 + Math.random() * 0.3;
        const bx = originX + (x - originX) * f,
          by = originY + (y - originY) * f;
        d2 = zigzagPath(bx, by, bx + (Math.random() - 0.5) * 170, by + 70 + Math.random() * 90, 4, 34);
      }
      const bolt: Bolt = { id, d, d2, big };
      setBolts((s) => [...s, bolt]);
      const dur = big ? 640 : 440;
      setTimeout(() => setBolts((s) => s.filter((b) => b.id !== id)), dur);
      if (big) {
        const fid = id + "f";
        setFlashes((s) => [...s, { id: fid, x, y }]);
        setTimeout(() => setFlashes((s) => s.filter((f) => f.id !== fid)), 500);
      }
    },
    []
  );

  const fireBoltFromEvent = useCallback(
    (e?: { clientX?: number; clientY?: number }, opts?: { big?: boolean }) => {
      const x = e && typeof e.clientX === "number" ? e.clientX : window.innerWidth / 2;
      const y = e && typeof e.clientY === "number" ? e.clientY : window.innerHeight / 3;
      fireBolt(x, y, opts);
    },
    [fireBolt]
  );

  const statusBoltAnchor = useCallback(
    () => ({ x: window.innerWidth * (0.56 + Math.random() * 0.14), y: 190 + Math.random() * 230 }),
    []
  );

  return { bolts, flashes, fireBolt, fireBoltFromEvent, statusBoltAnchor };
}

export function BoltLayer({ bolts, flashes }: { bolts: Bolt[]; flashes: Flash[] }) {
  return (
    <>
      {flashes.map((f) => (
        <div
          key={f.id}
          style={{
            position: "fixed",
            left: f.x - 260 + "px",
            top: f.y - 260 + "px",
            width: "520px",
            height: "520px",
            borderRadius: "50%",
            pointerEvents: "none",
            zIndex: 94,
            background: `radial-gradient(circle, ${ACCENT_A33} 0%, ${ACCENT_A09} 40%, transparent 72%)`,
            animation: "boltFlash 520ms ease-out forwards",
          }}
        />
      ))}
      <svg
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 95,
          pointerEvents: "none",
          overflow: "visible",
        }}
      >
        {bolts.map((bolt) => {
          const mainStyle: CSSProperties = {
            fill: "none",
            stroke: ACCENT,
            strokeWidth: bolt.big ? 3.6 : 2.1,
            strokeLinecap: "round",
            filter: `drop-shadow(0 0 6px ${ACCENT}) drop-shadow(0 0 18px ${ACCENT})`,
            animation: bolt.big
              ? "boltFlicker 620ms ease-out forwards"
              : "boltFlicker 420ms ease-out forwards",
            opacity: 0,
          };
          const branchStyle: CSSProperties = {
            fill: "none",
            stroke: ACCENT,
            strokeWidth: 1.5,
            strokeLinecap: "round",
            opacity: 0,
            filter: `drop-shadow(0 0 5px ${ACCENT})`,
            animation: "boltFlicker 360ms ease-out forwards",
            animationDelay: "30ms",
          };
          return (
            <g key={bolt.id}>
              <path d={bolt.d} style={mainStyle} />
              {bolt.d2 && <path d={bolt.d2} style={branchStyle} />}
            </g>
          );
        })}
      </svg>
    </>
  );
}
