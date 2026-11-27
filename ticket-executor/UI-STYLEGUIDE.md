# UI Style Guide

The single UI contract for everything under `app/`. Helpers live in `lib/ui.ts`, tokens in `app/globals.css` (`:root`).
Read this file and skim `lib/ui.ts` before editing UI.

## 1. Workflow (every UI change)

1. Design the **390 × 844** layout first; desktop is the expanded case.
2. Find an existing helper or component (§3). Reuse > extend > new.
3. Build with tokens only (§2) and animate every interaction (§5).
4. `npx tsc --noEmit`, then use the screen at **390 × 844** and desktop — open, close, hover, press, switch — and confirm each moves smoothly.
5. Added or changed a helper, token or `te-*` class → update `lib/ui.ts` / `globals.css` **and this file** in the same change.

## 2. Tokens — no raw values

- **Colour**: `COLORS` (text, status, border, panel) and `SURFACE` (app, inset, field, raised, modal). No hex in components.
- **Type**: `FONT` only — pick the nearer step, never a size in between.

  | Token | Size | Use |
  |---|---|---|
  | `xs` | 11.5px | pills, badges, counters |
  | `sm` | 12.5px | captions, timestamps, meta |
  | `base` | 13px | default: controls, rows, table cells |
  | `md` | 14px | body copy |
  | `lg` | 15px | card titles |
  | `xl` | 20px | section titles |

  Large headlines and KPIs: `displayText("hero" | "title" | "stat" | "heading")`.
- **Tokens are `var(--te-*)` strings** — never concatenate (`COLORS.x + "55"` paints nothing); use
  `color-mix(in srgb, ${token} 33%, transparent)`. SVG: `style={{ fill: token }}`, not `fill=`. Canvas / three.js: `resolveColor(token)`.
- A new token goes in `:root` of `globals.css`, then (if shared) into `COLORS` / `SURFACE` / `FONT`.

## 3. Need → use

| Need | Use |
|---|---|
| Panel / tile / row box | `card()`; status banner → `tintedCard(tone)` |
| Button | `ctaButtonStyle("primary" \| "success" \| "warning" \| "danger" \| "outline" \| "ghost")` + class `te-action-btn` (icon-only: `te-icon-btn`) |
| Tag / status | `pill()`, `statusPill()`, `typeBadge()` |
| Form | `fieldLabel()`, `fieldInput()`, `sectionCaption()`; pickers `Combobox` / `SelectMenu` |
| Tabs | `tabStyle()` |
| Dropdown / popover | `dropdownPanelStyle()` on a `MenuPanel` inside `AnimatePresence` (eases in and out) |
| Pick one of a fixed list | `SelectMenu` (`variant`: `filter` / `field` / `input`; options may be `{ value, label }`) |
| Modal | `ModalOverlay` + `ModalPanel` (`app/Modal.tsx`) with `modalOverlayStyle()` + `modalShellStyle()` (always paired) + class `te-modal-shell`; render the dialog inside `AnimatePresence` with a `key` |
| Toast | `toastStyle()` on a `motion.div`, rendered inside `AnimatePresence` (see `Toast.tsx`) |
| Spinner | `LoadingRing` — the only one |
| Long secondary content | `FoldToggle` + `Collapse` (`app/Collapse.tsx`) |
| Banner / notice shown by condition | `AnimatePresence` + `Reveal` (same file) |
| Block shown by condition inside a flex/grid column with `gap` (bulk-action bar, editor card, status row) | `AnimatePresence` + `<Reveal gap={n}>` — `n` = the parent's gap in px, so the gap grows with the block and nothing jumps |
| Block that opens inside a card (translation, details) | `Collapse open={…}` |
| Code / log | `codeBlock()` |
| Tooltip | `Tooltip` |

Shape: controls use `chipShape()` / `clipCorner()` with 6, 7 or 8 px only; cards use `SHAPE.radiusCard`.
`ringBorder()` is spread only through the helpers above, never over an animation style.

## 4. Every screen handles four states
Loading (`LoadingRing`), empty (say what is missing and what to do), error (say what failed), content.
A screen is never blank and never needs a refresh to be right (see CLAUDE.md "Data fetching and live state").

## 5. Motion — every interaction animates, in and out

Nothing appears, disappears, moves or changes value instantly. Applies to menus, popovers, modals, panels, expand/collapse,
tabs, list rows added/removed/reordered, hover, press, loading → content.

**Design rule: every action gets motion, and surrounding UI eases to its new place.** When you design or change any UI,
list each action (click, select, open, close, add, remove, toggle, error, load) and name its motion before writing markup.
Anything that appears or disappears in the flow (selection bars, banners, editors, rows) animates its own height and the
layout gap with it (`Reveal gap`), so neighbours slide instead of jumping. No action ships without it.

1. **Enter and exit.** Conditionally rendered UI is wrapped in `AnimatePresence` (`motion/react`) with `initial` / `animate` /
   `exit`. A bare `{open && <Panel />}` is a bug: it pops in and vanishes.
2. **Shared motion only.** Easing from `MOTION` / `--te-ease-expo` (entering) and `--te-ease-out` (leaving, hover). Keyframes
   from `globals.css` (`popIn` menus/popovers, `fadeIn`, `fadeUp`, `slideIn` modals) — no new inline `animation` strings.
   Panel helpers (`dropdownPanelStyle`, `modalShellStyle`) already carry their enter animation; don't override it.
3. **Duration.** Hover/press 120–180ms · menus/popovers 180–220ms · modals/panels 250–350ms. Interactions stay under 400ms;
   `MOTION.enter` (850ms) is for page reveals only. Stagger ≤ 10 items, 50ms apart.
4. **Cheap properties only.** Animate `transform`, `opacity`, `filter`, colours. Never `width` / `height` / `top` / `left`;
   expand/collapse uses motion `height: "auto"` or `grid-template-rows: 0fr → 1fr`.
5. **Every clickable gives feedback**: hover (`filter`/colour transition) and press (`MOTION.tap`).
6. **No native `<select>` in new UI** — it cannot animate. Use `SelectMenu` / `Combobox`.
7. **Reduced motion is honoured**: `MotionProvider` covers `motion`; every CSS keyframe/transition has a
   `@media (prefers-reduced-motion: reduce)` fallback.
8. Don't animate high-frequency live updates (log lines, counters ticking) — only the container that appears.

## 6. Responsive (≤ 900px — the only breakpoint)

- JS twin `MOBILE_QUERY`; change both together. `useIsMobile()` is for the drawer only.
- Responsive rules live **only** in the media block at the foot of `globals.css` (`!important` beats inline helpers).
  Components opt in with a `te-*` class:

  | Class | Below 900px |
  |---|---|
  | `te-sidebar` / `te-nav-scrim` | rail becomes an off-canvas drawer |
  | `te-page-header` / `te-page-toolbar` | tighter padding; toolbar wraps, never scrolls sideways |
  | `te-main` | 14px padding + bottom safe area |
  | `te-grid-2` / `te-grid-3` | one column |
  | `te-split[data-pane="list\|detail"]` | one pane at a time + `te-back-btn` |
  | `te-table-scroll` | dense table scrolls inside its own box |
  | `te-plan-table` | rows reflow into stacked cards via `data-label` |
  | `te-modal-shell` | full screen with safe-area padding |
  | `te-mobile-hide` | drops decorative chrome |

- Tap targets ≥ 40px; nothing essential behind `:hover`.
- `var(--te-app-h)`, never `100vh`; respect `env(safe-area-inset-*)`.
- Page controls go on `PageToolbar` between header and `<main>`, never inside `<main>` (it clips dropdowns).
- State that matters is server-side; `localStorage` is for local UI preferences only.
