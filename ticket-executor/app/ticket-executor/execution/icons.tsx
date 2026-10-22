import type { CSSProperties } from "react";

type IconProps = { size?: number; color?: string; style?: CSSProperties };

function Svg({ size = 16, color = "currentColor", style, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: color, flex: "0 0 auto", ...style }}>
      {children}
    </svg>
  );
}

export function NodeIcon({ kind, effects, context, ...p }: IconProps & { kind: string; effects: string; context?: string }) {
  if (kind === "terminal") return <Svg {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></Svg>;
  if (kind === "check") return <Svg {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></Svg>;
  if (effects === "external") return <Svg {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 15v4a1 1 0 001 1h12a1 1 0 001-1v-4" /></Svg>;
  if (effects === "pure") return <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></Svg>;
  if (context === "resume") return <Svg {...p}><path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" /></Svg>;
  return <Svg {...p}><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" /></Svg>;
}

export function StateIcon({ tone, ...p }: IconProps & { tone: string }) {
  if (tone === "done") return <Svg {...p}><path d="M5 13l4 4L19 7" /></Svg>;
  if (tone === "failed") return <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
  if (tone === "skipped") return <Svg {...p}><path d="M10 9v6M14 9v6" /><circle cx="12" cy="12" r="9" /></Svg>;
  if (tone === "running") return <Svg {...p}><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" strokeDasharray="4 3" /></Svg>;
  return <Svg {...p}><circle cx="12" cy="12" r="8" /></Svg>;
}

export function ToolIcon({ tool, kind, ...p }: IconProps & { tool?: string; kind: string }) {
  const t = (tool ?? "").toLowerCase();
  if (kind === "cmd" || t === "bash") return <Svg {...p}><path d="M4 17l6-5-6-5M12 19h8" /></Svg>;
  if (t === "edit" || t === "write" || t === "multiedit" || t === "notebookedit") return <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></Svg>;
  if (t === "read") return <Svg {...p}><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></Svg>;
  if (t === "grep" || t === "glob" || t === "toolsearch") return <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></Svg>;
  if (t.startsWith("mcp__")) return <Svg {...p}><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 01-10 0zM12 16v5" /></Svg>;
  if (t === "structuredoutput") return <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
  return <Svg {...p}><path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" /></Svg>;
}

export function MiniIcon({ name, ...p }: IconProps & { name: "clock" | "coin" | "tokens" | "turns" | "arrow-in" | "arrow-out" | "flow" | "terminal" | "follow" | "search" | "prompt" | "brain" | "chat" | "alert" | "loop" }) {
  switch (name) {
    case "clock": return <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>;
    case "coin": return <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M14.5 9.5c-.4-.9-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2.1-.6-2.5-1.5M12 6.5v1.5M12 16v1.5" /></Svg>;
    case "tokens": return <Svg {...p}><path d="M4 7h16M4 12h16M4 17h10" /></Svg>;
    case "turns": return <Svg {...p}><path d="M20 12a8 8 0 11-2.3-5.7" /><path d="M20 4v5h-5" /></Svg>;
    case "arrow-in": return <Svg {...p}><path d="M3 12h12M10 7l5 5-5 5M20 4v16" /></Svg>;
    case "arrow-out": return <Svg {...p}><path d="M4 4v16M9 12h12M16 7l5 5-5 5" /></Svg>;
    case "flow": return <Svg {...p}><rect x="3" y="4" width="7" height="6" rx="1.5" /><rect x="14" y="14" width="7" height="6" rx="1.5" /><path d="M10 7h4a3 3 0 013 3v4" /></Svg>;
    case "terminal": return <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M12 15h5" /></Svg>;
    case "follow": return <Svg {...p}><path d="M12 5v14M5 12l7 7 7-7" /></Svg>;
    case "search": return <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></Svg>;
    case "prompt": return <Svg {...p}><path d="M4 6h16v10H9l-5 4z" /></Svg>;
    case "brain": return <Svg {...p}><path d="M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 003 3h1V4zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-3 3h-1V4z" /></Svg>;
    case "chat": return <Svg {...p}><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.4A8 8 0 1121 12z" /></Svg>;
    case "alert": return <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></Svg>;
    case "loop": return <Svg {...p}><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 01-3 3H3" /></Svg>;
  }
}
