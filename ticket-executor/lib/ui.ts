import type { CSSProperties } from "react";
import type { UiRunState } from "./types";

// ---- Ported verbatim from the prototype's renderVals() ----

// There is no STEPS array here any more. A run's progress list is derived from
// the graph it is walking (see lib/execution/graph/graphs.ts) and reaches the UI
// as `RunView.nodes`, so adding a node adds a step with nothing to keep in sync.
// The same goes for the old isTwoPhaseSkill / stepsForSkill / stepsIndexMap
// helpers: whether a run has a human gate is a property of its graph, not a
// hard-coded list of skill names.

const TYPES: Record<string, { c: string; bg: string }> = {
  Feature: { c: "#9B8CFF", bg: "rgba(155,140,255,.13)" },
  Bug: { c: "#FF6B6B", bg: "rgba(255,107,107,.13)" },
  Task: { c: "#5B9DFF", bg: "rgba(91,157,255,.13)" },
  Story: { c: "#35D6A4", bg: "rgba(53,214,164,.13)" },
  "User Story": { c: "#35D6A4", bg: "rgba(53,214,164,.13)" },
  Issue: { c: "#F5B341", bg: "rgba(245,179,65,.13)" },
  Epic: { c: "#FF9F45", bg: "rgba(255,159,69,.13)" },
};

// Prototype only had New/Active. Extended for real ADO states — same pill,
// only the text colour varies by state.
const STATUS_COLORS: Record<string, string> = {
  New: "#8A90A0",
  "To Do": "#8A90A0",
  Approved: "#8A90A0",
  "Ready for Dev": "#F5B341",
  "Ready for Development": "#F5B341",
  Active: "#F5B341",
  "In Progress": "#F5B341",
  Committed: "#F5B341",
  Doing: "#F5B341",
  "Code Review": "#9B8CFF",
  "In Review": "#9B8CFF",
  "Ready for QA": "#5B9DFF",
  "In QA": "#5B9DFF",
  Testing: "#5B9DFF",
  Resolved: "#35D6A4",
  Done: "#35D6A4",
  Closed: "#35D6A4",
  Completed: "#35D6A4",
  Removed: "#FF6B6B",
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "#8A90A0";
}

// A ticket can be implemented only when it is actively in the dev lane:
// "Ready for Dev" / "In Progress" (and the ADO Agile equivalent "Active").
const IMPLEMENTABLE_STATES = new Set([
  "ready for dev",
  "ready for development",
  "in progress",
  "active",
  "todo",
  "in progress",
]);

export function canImplement(status: string): boolean {
  return IMPLEMENTABLE_STATES.has((status ?? "").trim().toLowerCase());
}

// A ticket in the review lane can be code-reviewed.
// Run code-review feature disabled for now — kept for a possible future reopen.
// const REVIEWABLE_STATES = new Set(["code review", "in review"]);

export type ActionInfo = { label: string; skill: string };

// Maps the effective ticket status to the runnable action (label + skill).
// Returns null when no action applies for that status (button is gated).
export function actionInfoFor(status: string): ActionInfo | null {
  const s = (status ?? "").trim().toLowerCase();
  if (IMPLEMENTABLE_STATES.has(s))
    return { label: "Implement Ticket", skill: "implement-ticket-v3" };
  // if (REVIEWABLE_STATES.has(s)) return { label: "Review Code", skill: "senior-code-review" };
  return null;
}

// The status a ticket moves to once a given skill's run completes (simulated ADO sync).
export function nextStatusAfter(skill: string, current: string): string {
  if (skill === "implement-ticket-v2" || skill === "implement-ticket-v3") return "Code Review";
  // if (skill === "senior-code-review") return "Ready for QA";
  return current;
}

// True for either code-review-resolution skill (auto v2 or plan-review-gated v3) —
// used everywhere the UI needs to treat both the same regardless of which one ran.
export function isFixReviewSkill(skill?: string): boolean {
  return skill === "fix-code-review-v2" || skill === "fix-code-review-v3";
}

export const RUN_COLOR: Record<UiRunState, string> = {
  running: "#F5B341",
  waiting: "#9BA6E8",
  succeeded: "#35D6A4",
  failed: "#FF6B6B",
  cancelled: "#5B6273",
  none: "#5B6273",
};

export const RUN_LABEL: Record<UiRunState, string> = {
  running: "Running",
  waiting: "Waiting for you",
  succeeded: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  none: "Not started",
};

// ---- Shared design tokens ----
// Single source of truth for the palette + shape/animation primitives reused
// across TicketExecutor.tsx, SprintPicker.tsx, Combobox.tsx and Bolts.tsx.
// See UI-STYLEGUIDE.md — any new element should compose these instead of
// re-typing raw gradient/clip-path/color literals.
export const COLORS = {
  accent: "#FB7250",
  success: "#35D6A4",
  danger: "#FF6B6B",
  warning: "#F5B341",
  info: "#5B9DFF",
  indigo: "#9BA6E8",
  text: "#ECEEF3",
  /** One step below `text` — list labels and secondary button copy. Was an
   *  inline literal in several places before it was named here. */
  textSoft: "#C7CCD8",
  textDim: "#8A90A0",
  textMuted: "#6B7283",
  faint: "#5B6273",
  border: "#262B36",
  borderSubtle: "#1E232C",
  panelBg: "#111419",
  panelBgDark: "#0A0B0E",
} as const;

// Corner-cut hexagon clip-path used by every "chip" shaped element (buttons,
// tabs, search bar, settings/close buttons). Prototype used 6/7/8px corners
// interchangeably — pick one of those three, don't invent a new radius.
export function clipCorner(px: 6 | 7 | 8 = 8): string {
  return `polygon(${px}px 0,100% 0,100% calc(100% - ${px}px),calc(100% - ${px}px) 100%,0 100%,0 ${px}px)`;
}

type RingOpts = {
  /** Fill color behind the ring (the padding-box layer). */
  fill: string;
  /** "outline": 4-stop transparent→ring→highlight→ring→transparent sweep (default).
   *  "filled": 3-stop transparent→highlight→transparent — for CTA buttons whose
   *  fill itself already IS the accent color, so the ring only needs one sheen stop. */
  variant?: "outline" | "filled";
  /** Outline ring color. Ignored when variant is "filled". Default: var(--accent). */
  ring?: string;
  /** Outline mid-stop / filled sheen color. Default "#ffd8c9" (outline) or "#ffe4d8" (filled). */
  highlight?: string;
  /** spinAngle duration in seconds. Default 3.2 — don't go faster than ~1.6s or slower than ~5.5s. */
  duration?: number;
  shape?: "pill" | "clip" | "none";
  cornerPx?: 6 | 7 | 8;
  /** Extra animation(s) to run alongside the ring's spin (e.g. an entrance
   *  fadeUp), comma-joined onto the same `animation` property. Use this
   *  instead of spreading a second `{ animation: ... }` object over a
   *  ringBorder style — a plain spread's last "animation" key wins and
   *  silently kills the spin. */
  extraAnimation?: string;
  /** animation-delay for extraAnimation, paired via the same comma position
   *  (the ring itself always gets delay 0s). */
  extraAnimationDelay?: string;
};

// The one spinning conic-gradient "energy ring" border used everywhere in the
// app (buttons, tabs, pills, panels). Always compose new ring elements through
// this helper instead of re-typing the gradient stops.
export function ringBorder(opts: RingOpts): CSSProperties {
  const {
    fill,
    variant = "outline",
    ring = "var(--accent)",
    duration = 3.2,
    shape = "clip",
    cornerPx = 8,
    extraAnimation,
    extraAnimationDelay,
  } = opts;
  const highlight =
    opts.highlight ?? (variant === "filled" ? "#ffe4d8" : "#ffd8c9");
  const conic =
    variant === "filled"
      ? `conic-gradient(from var(--angle), transparent, ${highlight}, transparent 70%)`
      : `conic-gradient(from var(--angle), transparent, ${ring}, ${highlight}, ${ring}, transparent 70%)`;
  const style: CSSProperties = {
    border: "2.25px solid transparent",
    background: `linear-gradient(${fill},${fill}) padding-box, ${conic} border-box`,
    animation: extraAnimation
      ? `spinAngle ${duration}s linear infinite, ${extraAnimation}`
      : `spinAngle ${duration}s linear infinite`,
  };
  if (extraAnimation) style.animationDelay = `0s, ${extraAnimationDelay ?? "0s"}`;
  if (shape === "pill") style.borderRadius = "999px";
  else if (shape === "clip") style.clipPath = clipCorner(cornerPx);
  return style;
}

// Neutral bordered container — the "card" used for meta tiles, comment
// bubbles, acceptance-criteria rows, past-run rows, etc.
export function card(opts?: {
  padding?: string;
  radius?: string;
  border?: string;
  background?: string;
}): CSSProperties {
  const {
    padding = "11px 13px",
    radius = "10px",
    border = COLORS.border,
    background = COLORS.panelBg,
  } = opts || {};
  return {
    padding,
    borderRadius: radius,
    border: `1px solid ${border}`,
    background,
  };
}

// Color-tinted banner card (success/danger/warning/accent) — result banners,
// error/notice boxes, the "ready to implement" CTA strip.
const TINT: Record<
  "success" | "danger" | "warning" | "accent",
  { border: string; background: string }
> = {
  success: {
    border: "#24382F",
    background:
      "linear-gradient(120deg,rgba(53,214,164,.08),rgba(53,214,164,.02))",
  },
  danger: { border: "#4A2626", background: "rgba(255,107,107,.06)" },
  warning: { border: "#3A2F22", background: "rgba(245,179,65,.06)" },
  accent: {
    border: "#2A2018",
    background:
      "linear-gradient(120deg,rgba(251,114,80,.09),rgba(251,114,80,.02))",
  },
};
export function tintedCard(
  tone: keyof typeof TINT,
  opts?: { padding?: string; radius?: string },
): CSSProperties {
  const t = TINT[tone];
  const { padding = "15px 18px", radius = "12px" } = opts || {};
  return {
    padding,
    borderRadius: radius,
    border: `1px solid ${t.border}`,
    background: t.background,
  };
}

// Modal shell chrome — the dark bordered/shadowed sliding-in panel shared by
// SettingsModal, DiffModal and CommitFilesModal. Compose this instead of
// re-typing the border/radius/background/shadow/slide-in animation quad.
export function modalShellStyle(opts?: { radius?: string }): CSSProperties {
  return {
    border: `1px solid ${COLORS.border}`,
    borderRadius: opts?.radius ?? "16px",
    background: "#14171D",
    boxShadow: "0 40px 90px -30px #000",
    animation: "slideIn .28s both",
  };
}

// Animated fire-gradient wordmark text ("D-Agent" style headers/titles) shared
// by AppHeader and the dashboard header. fontSize differs by placement; the
// gradient/animation is the part that must stay identical everywhere.
export function logoText(fontSize: string): CSSProperties {
  return {
    fontFamily: "var(--font-space), sans-serif",
    fontWeight: 700,
    fontSize,
    letterSpacing: ".01em",
    background:
      "linear-gradient(90deg,var(--accent) 0%,#FFC15E 18%,#FF5F3D 36%,var(--accent) 54%,#FFC15E 72%,#FF5F3D 90%,var(--accent) 100%)",
    backgroundSize: "300% 100%",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    animation: "fireFlow 3.6s linear infinite,fireFlicker 2.2s ease-in-out infinite",
  };
}

// Form-field chrome — the small spaced uppercase caption above an input, and
// the dark inset text input itself. Shared by every settings-style form field
// (Settings page, System Check page) so field density stays uniform.
export function fieldLabel(): CSSProperties {
  return {
    fontSize: "11px",
    letterSpacing: ".1em",
    fontWeight: 600,
    color: COLORS.textDim,
  };
}

export function fieldInput(opts?: { height?: string; fontSize?: string }): CSSProperties {
  return {
    ...card({ padding: "0 13px", radius: "9px", background: "#0E1015" }),
    height: opts?.height ?? "40px",
    color: COLORS.text,
    fontFamily: "var(--font-mono), monospace",
    fontSize: opts?.fontSize ?? "13px",
    outline: "none",
  };
}

// Read-only mono code / shell-command block — the Guide page's copyable
// commands and file-content snippets. Same inset dark chrome as fieldInput,
// but multi-line and not focusable.
export function codeBlock(opts?: { padding?: string; fontSize?: string }): CSSProperties {
  return {
    ...card({ padding: opts?.padding ?? "10px 12px", radius: "9px", background: "#0E1015" }),
    color: COLORS.text,
    fontFamily: "var(--font-mono), monospace",
    fontSize: opts?.fontSize ?? "12px",
    lineHeight: 1.7,
    whiteSpace: "pre",
    overflowX: "auto",
    margin: 0,
  };
}

// Dropdown/menu panel chrome shared by SprintPicker, Combobox, and the inline
// status menu in TicketExecutor.tsx.
export function dropdownPanelStyle(opts?: {
  minWidth?: string;
  maxHeight?: string;
}): CSSProperties {
  return {
    border: `1px solid ${COLORS.border}`,
    borderRadius: "11px",
    background: "#0E1015",
    boxShadow: "0 22px 54px -24px #000",
    padding: "5px",
    ...(opts?.minWidth ? { minWidth: opts.minWidth } : {}),
    ...(opts?.maxHeight
      ? { maxHeight: opts.maxHeight, overflowY: "auto" }
      : {}),
  };
}

// Generic pill/badge factory — status pills, exec pills, branch pill, log
// status badge, filter-count badge all compose this instead of hand-rolling
// padding/radius/fontSize combos.
export function pill(opts: {
  color: string;
  background?: string;
  border?: string;
  size?: "xs" | "sm" | "md";
  weight?: number;
}): CSSProperties {
  const {
    color,
    background = "rgba(255,255,255,.04)",
    border,
    size = "sm",
    weight = 600,
  } = opts;
  const sizes: Record<"xs" | "sm" | "md", CSSProperties> = {
    xs: { fontSize: "10.5px", padding: "2px 7px" },
    sm: { fontSize: "11px", padding: "2px 9px" },
    md: { fontSize: "12px", padding: "3px 10px" },
  };
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    borderRadius: "999px",
    fontWeight: weight,
    color,
    background,
    ...sizes[size],
    ...(border ? { border: `1px solid ${border}` } : {}),
  };
}

// Action-button factory — the accent-filled primary CTA, the success/warning
// state buttons, and the outline/ghost secondary buttons all come from here.
export function ctaButtonStyle(
  variant: "primary" | "success" | "warning" | "danger" | "outline" | "ghost",
  opts?: { height?: string; cornerPx?: 6 | 7 | 8 },
): CSSProperties {
  const height = opts?.height ?? "32px";
  const cornerPx = opts?.cornerPx ?? 8;
  const base: CSSProperties = {
    position: "relative",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    gap: "7px",
    height,
    padding: "0 14px",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
    transition: "filter .18s, transform .12s, box-shadow .25s",
  };
  if (variant === "primary")
    return {
      ...base,
      color: "#0B0C10",
      ...ringBorder({ fill: COLORS.accent, variant: "filled", cornerPx }),
      animation: undefined,
    };
  if (variant === "success")
    return {
      ...base,
      color: "#5BE8B8",
      // Opaque fill (not the translucent rgba used for static success tints) — ringBorder's
      // mask only hides the spinning conic-gradient inside the padding-box when that layer
      // is fully opaque; a translucent fill lets the sweep bleed through the whole button.
      ...ringBorder({
        fill: "#162F2C",
        ring: COLORS.success,
        highlight: "#baf5e3",
        duration: 3,
        cornerPx,
      }),
    };
  if (variant === "warning")
    return {
      ...base,
      color: "#C7CCD8",
      ...ringBorder({
        fill: "#2A2E38",
        ring: COLORS.warning,
        highlight: COLORS.warning,
        duration: 1.6,
        cornerPx,
      }),
    };
  if (variant === "danger")
    return {
      ...base,
      color: "#FFB3AD",
      ...ringBorder({
        fill: "#2E1A1C",
        ring: COLORS.danger,
        highlight: "#ffd3ce",
        duration: 4.2,
        cornerPx,
      }),
    };
  if (variant === "outline")
    return {
      ...base,
      color: "#C7CCD8",
      fontWeight: 600,
      border: "1.5px solid #2A2F3A",
      background: "transparent",
      clipPath: clipCorner(opts?.cornerPx ?? 7),
      animation: undefined,
    };
  // ghost — dark fill + accent ring (the "secondary next action" button)
  return {
    ...base,
    color: "#ECEEF3",
    ...ringBorder({ fill: "#1A1E25", duration: 3.2, cornerPx }),
  };
}

export function typeBadge(type: string): CSSProperties {
  const c = TYPES[type] || TYPES.Task;
  return {
    ...pill({ color: c.c, background: c.bg, size: "xs", weight: 700 }),
    borderRadius: "6px",
    letterSpacing: ".04em",
  };
}

export function statusPill(status: string): CSSProperties {
  return pill({ color: statusColor(status), border: COLORS.border });
}

// Clickable status pill — reuses the exact same ring/background/animation as
// the active Overview tab (tabStyle in TicketExecutor.tsx); only the text is
// colored by status.
export function statusPillActive(status: string): CSSProperties {
  return {
    ...pill({ color: statusColor(status), size: "md", weight: 700 }),
    cursor: "pointer",
    outline: "none",
    ...ringBorder({ fill: "#171A21", shape: "pill" }),
  };
}

// Toast accent colors — success (default) vs error variant. Border/stroke/progress-bar
// all key off the same tone so a failure toast reads unmistakably differently.
export function toastStyle(kind: "success" | "error"): {
  border: string;
  accent: string;
} {
  return kind === "error"
    ? { border: "#4A2626", accent: COLORS.danger }
    : { border: "#24382F", accent: COLORS.success };
}

export function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function avatar(name: string): CSSProperties {
  const h = hue(name);
  return {
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "9.5px",
    fontWeight: 700,
    color: `hsl(${h} 72% 76%)`,
    background: `hsl(${h} 42% 20%)`,
  };
}

export function runDot(st: UiRunState): CSSProperties {
  const base: CSSProperties = {
    width: "9px",
    height: "9px",
    borderRadius: "50%",
    display: "inline-block",
    flex: "0 0 auto",
  };
  // "no run yet" and "cancelled" both read as an outline rather than a lit dot.
  if (st === "none" || st === "cancelled")
    return { ...base, background: "transparent", border: `1.5px solid ${RUN_COLOR[st]}` };
  return { ...base, background: RUN_COLOR[st], boxShadow: `0 0 8px ${RUN_COLOR[st]}66` };
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 4)
    .join("-");
}

export function branchOf(id: string, title: string): string {
  return "feature/" + id + "-" + slug(title);
}
