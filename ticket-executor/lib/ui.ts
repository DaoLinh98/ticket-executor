import type { CSSProperties } from "react";
import type { UiRunState } from "./types";

// ---- Ported verbatim from the prototype's renderVals() ----

// There is no STEPS array here any more. A run's progress list is derived from
// the graph it is walking (see lib/execution/graph/graphs.ts) and reaches the UI
// as `RunView.nodes`, so adding a node adds a step with nothing to keep in sync.
// The same goes for the old isTwoPhaseSkill / stepsForSkill / stepsIndexMap
// helpers: whether a run has a human gate is a property of its graph, not a
// hard-coded list of skill names.

// Hue tokens rather than literals — see app/globals.css. These are *data*
// colours (a work-item type, a ticket status), so they are themed by hue and not
// folded into the role palette: amber is both "Active" and "Running", and
// collapsing them onto one role token would lose a distinction the board reads.
const HUE = {
  purple: "var(--te-hue-purple)",
  red: "var(--te-hue-red)",
  blue: "var(--te-hue-blue)",
  green: "var(--te-hue-green)",
  amber: "var(--te-hue-amber)",
  orange: "var(--te-hue-orange)",
  neutral: "var(--te-hue-neutral)",
} as const;

const TYPES: Record<string, { c: string; bg: string }> = {
  Feature: { c: HUE.purple, bg: "var(--te-hue-purple-tint)" },
  Bug: { c: HUE.red, bg: "var(--te-hue-red-tint)" },
  Task: { c: HUE.blue, bg: "var(--te-hue-blue-tint)" },
  Story: { c: HUE.green, bg: "var(--te-hue-green-tint)" },
  "User Story": { c: HUE.green, bg: "var(--te-hue-green-tint)" },
  Issue: { c: HUE.amber, bg: "var(--te-hue-amber-tint)" },
  Epic: { c: HUE.orange, bg: "var(--te-hue-orange-tint)" },
};

// Prototype only had New/Active. Extended for real ADO states — same pill,
// only the text colour varies by state.
const STATUS_COLORS: Record<string, string> = {
  New: HUE.neutral,
  "To Do": HUE.neutral,
  Approved: HUE.neutral,
  "Ready for Dev": HUE.amber,
  "Ready for Development": HUE.amber,
  Active: HUE.amber,
  "In Progress": HUE.amber,
  Committed: HUE.amber,
  Doing: HUE.amber,
  "Code Review": HUE.purple,
  "In Review": HUE.purple,
  "Ready for QA": HUE.blue,
  "In QA": HUE.blue,
  Testing: HUE.blue,
  Resolved: HUE.green,
  Done: HUE.green,
  Closed: HUE.green,
  Completed: HUE.green,
  Removed: HUE.red,
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? HUE.neutral;
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

// A ticket in the review lane — i.e. one that plausibly has an open PR.
//
// Used to decide which tickets the review bell is worth asking the provider
// about. It is deliberately **not** the only condition: a ticket whose run
// recorded a PR URL is polled regardless of its state, because a process
// template may name the review lane something this set has never heard of, and
// a bell that silently stops ringing is worse than one that polls a little wide.
const REVIEWABLE_STATES = new Set([
  "code review",
  "in code review",
  "in review",
  "review",
  "peer review",
  "resolved",
]);

export function isReviewable(status: string): boolean {
  return REVIEWABLE_STATES.has((status ?? "").trim().toLowerCase());
}

export type ActionInfo = { label: string; skill: string };

// Maps the effective ticket status to the runnable action (label + skill).
// Returns null when no action applies for that status (button is gated).
export function actionInfoFor(status: string): ActionInfo | null {
  const s = (status ?? "").trim().toLowerCase();
  if (IMPLEMENTABLE_STATES.has(s))
    return { label: "Implement Ticket", skill: "implement-ticket-v4" };
  // if (REVIEWABLE_STATES.has(s)) return { label: "Review Code", skill: "senior-code-review" };
  return null;
}

// `nextStatusAfter` used to live here: the status a ticket moved to once a run
// finished. It is gone because that is no longer what a finished run means —
// work is handed to a reviewer on the sprint plan's release day, by
// `lib/execution/release.ts` (RELEASE_STATUS), not at the moment the agent
// stopped typing.

// True for any code-review-resolution skill, including the retired v2/v3 ones a
// past run may still carry — used everywhere the UI treats a review-fix run apart.
export function isFixReviewSkill(skill?: string): boolean {
  return !!skill?.startsWith("fix-code-review-");
}

export const RUN_COLOR: Record<UiRunState, string> = {
  running: HUE.amber,
  waiting: "var(--te-indigo)",
  succeeded: HUE.green,
  failed: HUE.red,
  cancelled: "var(--te-faint)",
  none: "var(--te-faint)",
};

export type StepTone = "pending" | "running" | "done" | "failed" | "skipped";

const STEP_TONE_COLOR: Record<StepTone, string> = {
  pending: "var(--te-faint)",
  running: "var(--te-warning)",
  done: "var(--te-success)",
  failed: "var(--te-danger)",
  skipped: "var(--te-text-muted)",
};

export function stepTone(status: string): StepTone {
  if (status === "running") return "running";
  if (status === "succeeded" || status === "done") return "done";
  if (status === "failed") return "failed";
  if (status === "abandoned" || status === "skipped") return "skipped";
  return "pending";
}

export function stepToneColor(status: string): string {
  return STEP_TONE_COLOR[stepTone(status)];
}

const EFFECT_COLOR: Record<string, string> = {
  pure: "var(--te-info)",
  local: "var(--te-indigo)",
  external: "var(--te-accent)",
};

export function effectColor(effects: string): string {
  return EFFECT_COLOR[effects] ?? "var(--te-text-muted)";
}

export function toneTint(color: string, pct = 14): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

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
/**
 * Every token is a `var()`, not a literal: the values live in `app/globals.css`
 * under `:root`, so the palette is edited in one place.
 *
 * Two consequences to respect when using these:
 *
 * 1. **They are CSS values, not colours.** Anything that needs a real hex — a
 *    WebGL/canvas/three.js colour — must resolve one at runtime with
 *    `resolveColor()` below. Handing `var(--te-accent)` to `new THREE.Color()`
 *    throws.
 * 2. **They cannot be string-manipulated.** `COLORS.warning + "55"` used to
 *    append an alpha byte to a hex; that is now `var(--te-warning)55` and paints
 *    nothing. Use `color-mix()` or a literal rgba for a tinted variant.
 *
 * SVG *presentation attributes* (`fill="…"`, `stroke="…"`) do not resolve
 * `var()` either — those sites pass the token through `style` instead, which
 * does.
 */
export const COLORS = {
  accent: "var(--te-accent)",
  success: "var(--te-success)",
  danger: "var(--te-danger)",
  warning: "var(--te-warning)",
  info: "var(--te-info)",
  indigo: "var(--te-indigo)",
  text: "var(--te-text)",
  /** One step below `text` — list labels and secondary button copy. Was an
   *  inline literal in several places before it was named here. */
  textSoft: "var(--te-text-soft)",
  textDim: "var(--te-text-dim)",
  textMuted: "var(--te-text-muted)",
  faint: "var(--te-faint)",
  border: "var(--te-border)",
  borderSubtle: "var(--te-border-subtle)",
  panelBg: "var(--te-panel-bg)",
  panelBgDark: "var(--te-panel-bg-dark)",
} as const;

/** Surfaces that were inline hex literals scattered through the helpers below.
 *  Named and themed for the same reason the palette is. */
export const SURFACE = {
  app: "var(--te-app-bg)",
  inset: "var(--te-inset-bg)",
  /** An input's fill: `inset`, brightened while focused (see globals.css). */
  field: "var(--te-field-bg, var(--te-inset-bg))",
  raised: "var(--te-raised-bg)",
  modal: "var(--te-modal-bg)",
  /** The dimmed sheet a modal panel sits on. */
  scrim: "var(--te-scrim)",
} as const;

/** Shape tokens. D-Agent chips are corner-cut hexagons, so the clip-path and
 *  the radius are always applied together. */
export const SHAPE = {
  radiusChip: "var(--te-radius-chip)",
  radiusCard: "var(--te-radius-card)",
  radiusPanel: "var(--te-radius-panel)",
  panelBlur: "var(--te-panel-blur)",
} as const;

export const MOTION = {
  easeExpo: [0.16, 1, 0.3, 1],
  easeOut: [0.25, 0.46, 0.45, 0.94],
  enter: 0.85,
  nav: 0.6,
  stagger: 0.13,
  revealMargin: "0px 0px -40px 0px",
  hover: { scale: 1.03, y: -2 },
  hoverIcon: { scale: 1.15, y: -3 },
  tap: { scale: 0.97 },
} as const;

/**
 * Resolve a `var(--…)` token to the literal the browser computed for it.
 *
 * For the handful of consumers that cannot take a CSS value at all: three.js
 * materials, canvas `fillStyle`, anything doing colour maths. Returns the
 * fallback during SSR (there is no computed style on the server) and whenever
 * the property is unset, so a caller never gets an empty string — which
 * three.js reads as black.
 */
export function resolveColor(token: string, fallback = "#FB7250"): string {
  if (typeof window === "undefined") return fallback;
  const name = token.trim().replace(/^var\(\s*/, "").replace(/\s*\)$/, "").split(",")[0].trim();
  if (!name.startsWith("--")) return token;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * The type scale. Before this existed the app used **16 different sizes** between
 * 9.5px and 15px, chosen per component, and the differences carried no meaning
 * — 12px vs 12.5px vs 13px all meant "body text". Worse, most of the scale sat
 * below 13px, which is what made the detail panes hard to read.
 *
 * Six steps, and every piece of UI text picks one:
 *
 * | Token  | Size   | Use |
 * |--------|--------|-----|
 * | `xs`   | 11.5px | pills, badges, counters — text that is nearly a graphic |
 * | `sm`   | 12.5px | field captions, timestamps, secondary meta |
 * | `base` | 13px   | default: controls, table cells, list rows, log lines |
 * | `md`   | 14px   | primary body copy — descriptions, comments, criteria |
 * | `lg`   | 15px | card titles and sub-headings |
 * | `xl`   | 20px   | page/section titles (page `h1`s stay larger, per page) |
 *
 * Never introduce a size between two steps: pick the nearer step, or add a step
 * here (and to UI-STYLEGUIDE.md) if one is genuinely missing.
 */
export const FONT = {
  xs: "11.5px",
  sm: "12.5px",
  base: "13px",
  md: "14px",
  lg: "15px",
  xl: "20px",
} as const;

// Corner-cut hexagon clip-path used by every "chip" shaped element (buttons,
// tabs, search bar, settings/close buttons). Prototype used 6/7/8px corners
// interchangeably — pick one of those three, don't invent a new radius.
export function clipCorner(px: 6 | 7 | 8 = 8): string {
  return `var(--te-clip-${px})`;
}

/** The chip shape, both halves of it. A theme that drops the corner cut has to
 *  put a radius back or every chip turns into a bare rectangle, so the two are
 *  never applied separately. */
export function chipShape(px: 6 | 7 | 8 = 8): CSSProperties {
  return { clipPath: clipCorner(px), borderRadius: SHAPE.radiusChip };
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
    // The border-box layer is overridable as a whole: `--te-ring-image` is
    // unset by default, so the spinning conic below is what paints.
    background: `linear-gradient(${fill},${fill}) padding-box, var(--te-ring-image, ${conic}) border-box`,
    animation: extraAnimation
      ? `spinAngle ${duration}s linear infinite, ${extraAnimation}`
      : `spinAngle ${duration}s linear infinite`,
  };
  if (extraAnimation)
    style.animationDelay = `0s, ${extraAnimationDelay ?? "0s"}`;
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
    radius = SHAPE.radiusCard,
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
  success: { border: "var(--te-tint-success-bd)", background: "var(--te-tint-success-bg)" },
  danger: { border: "var(--te-tint-danger-bd)", background: "var(--te-tint-danger-bg)" },
  warning: { border: "var(--te-tint-warning-bd)", background: "var(--te-tint-warning-bg)" },
  accent: { border: "var(--te-tint-accent-bd)", background: "var(--te-tint-accent-bg)" },
};
/** Just the fill from a tint, for a row that is *highlighted* rather than boxed
 *  — the notification bell's unread rows sit inside an already-bordered panel,
 *  so a second border around each one would read as a nested card.
 *  `tintedCard` is the boxed variant; both draw from the same tokens. */
export function tintFill(tone: keyof typeof TINT): string {
  return TINT[tone].background;
}

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
    background: SURFACE.modal,
    boxShadow: "0 40px 90px -30px #000",
    animation: "slideIn .5s both",
  };
}

/** The full-screen sheet a modal panel centres on: scrim, blur, and the fade-in.
 *  Pair it with `modalShellStyle()` on the panel inside. Its own `zIndex` is a
 *  parameter because a modal opened from another overlay has to sit above it. */
export function modalOverlayStyle(opts?: { zIndex?: number }): CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    zIndex: opts?.zIndex ?? 55,
    background: SURFACE.scrim,
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    animation: "fadeIn .2s both",
  };
}

// Animated fire-gradient wordmark text ("D-Agent" style headers/titles) shared
// by AppHeader and the dashboard header. fontSize differs by placement; the
// gradient/animation is the part that must stay identical everywhere.
export function logoText(fontSize: string): CSSProperties {
  return {
    fontFamily: "var(--te-font-display)",
    fontWeight: 800,
    fontSize,
    letterSpacing: ".02em",
    textTransform: "uppercase",
    background:
      "linear-gradient(90deg,var(--accent) 0%,#FFC15E 18%,#FF5F3D 36%,var(--accent) 54%,#FFC15E 72%,#FF5F3D 90%,var(--accent) 100%)",
    backgroundSize: "300% 100%",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    animation:
      "fireFlow 3.6s linear infinite,fireFlicker 2.2s ease-in-out infinite",
  };
}

const DISPLAY_SIZE = {
  hero: "clamp(48px, 14vw, 72px)",
  title: "clamp(36px, 11vw, 56px)",
  stat: "clamp(32px, 9vw, 44px)",
  heading: "clamp(20px, 5.5vw, 26px)",
} as const;

export function displayText(size: keyof typeof DISPLAY_SIZE, color: string = COLORS.text): CSSProperties {
  return {
    fontFamily: "var(--te-font-display)",
    fontWeight: 800,
    fontSize: DISPLAY_SIZE[size],
    lineHeight: size === "heading" ? 1 : 0.82,
    letterSpacing: ".01em",
    textTransform: "uppercase",
    color,
    margin: 0,
  };
}

// Form-field chrome — the small spaced uppercase caption above an input, and
// the dark inset text input itself. Shared by every settings-style form field
// (Settings page, System Check page) so field density stays uniform.
export function fieldLabel(): CSSProperties {
  return {
    fontFamily: "var(--te-font-display)",
    fontSize: FONT.md,
    letterSpacing: ".08em",
    fontWeight: 800,
    textTransform: "uppercase",
    color: COLORS.textDim,
  };
}

export function fieldInput(opts?: {
  height?: string;
  fontSize?: string;
}): CSSProperties {
  return {
    ...card({ padding: "0 13px", radius: SHAPE.radiusChip, background: SURFACE.field }),
    clipPath: clipCorner(7),
    height: opts?.height ?? "40px",
    color: COLORS.text,
    fontFamily: "var(--font-mono), monospace",
    fontSize: opts?.fontSize ?? FONT.base,
    outline: "none",
  };
}

// Read-only mono code / shell-command block — the Guide page's copyable
// commands and file-content snippets. Same inset dark chrome as fieldInput,
// but multi-line and not focusable.
export function codeBlock(opts?: {
  padding?: string;
  fontSize?: string;
}): CSSProperties {
  return {
    ...card({
      padding: opts?.padding ?? "10px 12px",
      radius: "9px",
      background: SURFACE.inset,
    }),
    color: COLORS.text,
    fontFamily: "var(--font-mono), monospace",
    fontSize: opts?.fontSize ?? FONT.base,
    lineHeight: 1.7,
    whiteSpace: "pre",
    overflowX: "auto",
    margin: 0,
  };
}

// The small spaced-uppercase caption that titles a group inside a detail pane
// ("FILES CHANGED (3)", "COMMITS"). Distinct from fieldLabel(), which sits above
// a form input and is a step larger; this one labels read-only content.
export function sectionCaption(): CSSProperties {
  return {
    fontFamily: "var(--te-font-display)",
    fontSize: FONT.base,
    letterSpacing: ".1em",
    fontWeight: 800,
    color: COLORS.faint,
    textTransform: "uppercase",
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
    background: SURFACE.inset,
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
    xs: { fontSize: FONT.xs, padding: "2px 7px" },
    sm: { fontSize: FONT.sm, padding: "2px 9px" },
    md: { fontSize: FONT.base, padding: "3px 10px" },
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
    fontSize: FONT.base,
    fontWeight: 700,
    cursor: "pointer",
    transition: "filter .18s, transform .12s, box-shadow .25s",
  };
  if (variant === "primary")
    return {
      ...base,
      color: "var(--te-btn-primary-text)",
      ...ringBorder({ fill: "var(--te-btn-primary-fill)", variant: "filled", cornerPx }),
      borderRadius: SHAPE.radiusChip,
      boxShadow: "var(--te-btn-primary-shadow)",
      animation: undefined,
    };
  if (variant === "success")
    return {
      ...base,
      color: "var(--te-btn-success-text)",
      // Opaque fill (not the translucent rgba used for static success tints) — ringBorder's
      // mask only hides the spinning conic-gradient inside the padding-box when that layer
      // is fully opaque; a translucent fill lets the sweep bleed through the whole button.
      ...ringBorder({
        fill: "var(--te-btn-success-fill)",
        ring: COLORS.success,
        highlight: "var(--te-btn-success-sheen)",
        duration: 3,
        cornerPx,
      }),
      borderRadius: SHAPE.radiusChip,
    };
  if (variant === "warning")
    return {
      ...base,
      color: "var(--te-btn-warning-text)",
      ...ringBorder({
        fill: "var(--te-btn-warning-fill)",
        ring: COLORS.warning,
        highlight: COLORS.warning,
        duration: 1.6,
        cornerPx,
      }),
      borderRadius: SHAPE.radiusChip,
    };
  if (variant === "danger")
    return {
      ...base,
      color: "var(--te-btn-danger-text)",
      ...ringBorder({
        fill: "var(--te-btn-danger-fill)",
        ring: COLORS.danger,
        highlight: "var(--te-btn-danger-sheen)",
        duration: 4.2,
        cornerPx,
      }),
      borderRadius: SHAPE.radiusChip,
    };
  if (variant === "outline")
    return {
      ...base,
      color: "var(--te-btn-outline-text)",
      fontWeight: 600,
      border: "1.5px solid var(--te-btn-outline-border)",
      background: "transparent",
      ...chipShape(opts?.cornerPx ?? 7),
      animation: undefined,
    };
  // ghost — dark fill + accent ring (the "secondary next action" button)
  return {
    ...base,
    color: "var(--te-btn-ghost-text)",
    ...ringBorder({ fill: "var(--te-btn-ghost-fill)", duration: 3.2, cornerPx }),
    borderRadius: SHAPE.radiusChip,
  };
}

// The tab-bar button used by the ticket detail pane's tabs and the Settings
// page's section tabs. Active = the outline ring over a dark fill; inactive =
// fully transparent chrome, so switching tabs only moves the ring. A disabled
// tab dims rather than disappearing — the pane exists, it just has nothing in it
// yet, and hiding it would make the bar's shape change as a run progresses.
export function tabStyle(opts: {
  active: boolean;
  enabled?: boolean;
}): CSSProperties {
  const { active, enabled = true } = opts;
  const base: CSSProperties = {
    padding: "6px 13px",
    fontSize: FONT.sm,
    fontWeight: 600,
    cursor: enabled ? "pointer" : "not-allowed",
    marginBottom: "3px",
    transition: "color .15s, transform .12s",
    opacity: enabled ? 1 : 0.5,
    ...chipShape(6),
  };
  if (active)
    return {
      ...base,
      color: "var(--te-tab-text)",
      ...ringBorder({ fill: "var(--te-tab-fill)", duration: 3.2, shape: "none" }),
      borderRadius: SHAPE.radiusChip,
    };
  return {
    ...base,
    border: "1.5px solid transparent",
    background: "transparent",
    color: enabled ? COLORS.textDim : "var(--te-tab-disabled-text)",
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
    ...ringBorder({ fill: "var(--te-tab-fill)", cornerPx: 6 }),
    borderRadius: SHAPE.radiusChip,
  };
}

// Toast accent colors — success (default) vs error variant. Border/stroke/progress-bar
// all key off the same tone so a failure toast reads unmistakably differently.
// `warning` is the third tone on purpose: it is what an action that *succeeded*
// but left something unusable looks like. Reporting one of those in the danger
// palette reads as "your change was rejected", which is the opposite of what
// happened. Border matches TINT.warning so the two agree.
export function toastStyle(kind: "success" | "error" | "warning"): {
  border: string;
  accent: string;
} {
  if (kind === "error") return { border: "var(--te-tint-danger-bd)", accent: COLORS.danger };
  if (kind === "warning") return { border: "var(--te-tint-warning-bd)", accent: COLORS.warning };
  return { border: "var(--te-tint-success-bd)", accent: COLORS.success };
}

export function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function avatar(name: string): CSSProperties {
  const h = hue(name);
  return {
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: FONT.xs,
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
    return {
      ...base,
      background: "transparent",
      border: `1.5px solid ${RUN_COLOR[st]}`,
    };
  return {
    ...base,
    background: RUN_COLOR[st],
    boxShadow: `0 0 8px ${RUN_COLOR[st]}66`,
  };
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
