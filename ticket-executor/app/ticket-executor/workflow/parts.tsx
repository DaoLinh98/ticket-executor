import type { CSSProperties, ReactNode } from "react";
import { FONT, chipShape } from "@/lib/ui";
import { IC, TONE } from "@/lib/workflow/meta";
import LoadingRing from "../LoadingRing";
import type { Tone } from "@/lib/workflow/types";

export const MONO = "var(--font-mono), monospace";

export function Ico({ d, size = 14, sw = 2, style }: { d: string; size?: number; sw?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "0 0 auto", fill: "none", stroke: "currentColor", strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round", ...style }}>
      <path d={d} />
    </svg>
  );
}

export function IconTile({ d, tone, size = 24, iconSize = 14 }: { d: string; tone: Tone; size?: number; iconSize?: number }) {
  return (
    <span style={{ ...chipShape(6), flex: "0 0 auto", width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center", background: TONE[tone].bg, color: TONE[tone].c }}>
      <Ico d={d} size={iconSize} sw={1.8} />
    </span>
  );
}

/** A status glyph; a running one is the app's loading ring, like every other page. */
export function StatusIcon({ icon, size, sw = 2.6 }: { icon: string; size: number; sw?: number }) {
  return icon === IC.running ? <LoadingRing size={size + 1} /> : <Ico d={icon} size={size} sw={sw} />;
}

export function Badge({ tone, icon, children, size = "sm", mono }: { tone: Tone; icon?: string; children: ReactNode; size?: "xs" | "sm"; mono?: boolean }) {
  return (
    <span
      style={{
        ...chipShape(6),
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: size === "xs" ? "1px 6px" : "3px 8px",
        fontSize: size === "xs" ? FONT.xs : FONT.sm,
        fontWeight: 600,
        whiteSpace: "nowrap",
        fontFamily: mono ? MONO : undefined,
        background: TONE[tone].bg,
        color: TONE[tone].c,
      }}
    >
      {icon ? (
        <span style={{ display: "inline-flex" }}>
          <StatusIcon icon={icon} size={size === "xs" ? 10 : 12} />
        </span>
      ) : null}
      {children}
    </span>
  );
}

export function StatusBadge({ tone, icon, text, size }: { tone: Tone; icon: string; text: string; size?: "xs" | "sm" }) {
  return (
    <Badge tone={tone} icon={icon} size={size}>
      {text}
    </Badge>
  );
}
