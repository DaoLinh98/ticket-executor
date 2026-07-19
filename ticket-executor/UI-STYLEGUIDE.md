# UI Style Guide — Ticket Executor

This app has ONE design system, centralized in `lib/ui.ts`. Every visual element —
buttons, pills, cards, dropdown panels, the spinning conic-gradient "energy
ring" — must be composed from the helpers below. **Never re-type a raw hex
color, gradient string, or clip-path polygon inline** if an equivalent helper
already exists. This is what keeps `TicketExecutor.tsx`, `SprintPicker.tsx` and
`Combobox.tsx` visually consistent instead of drifting apart one inline style
at a time.

## Before touching any UI code

1. Read `lib/ui.ts` in full — it's short. Know what already exists.
2. If the element you're building looks like an existing pattern (a button, a
   pill, a bordered card, a dropdown menu), use the matching helper below.
   Do NOT hand-roll a similar-but-not-identical inline style object.
3. If no helper fits, ask: is this a genuinely new visual pattern, or a
   one-off variation of an existing one? Prefer adding an `opts` parameter to
   the existing helper (e.g. a new color/size) over writing new inline CSS.
   Only create a new exported helper in `lib/ui.ts` if the shape itself is new.
4. Never invent a new color. Pull from `COLORS` (`lib/ui.ts`). If you need a
   shade that isn't in `COLORS`, add it there — don't drop a new hex literal
   into a component file.
5. Never invent a new corner-cut radius, ring duration, or gradient stop
   layout ad hoc. Reuse the values below; they were deliberately unified
   across the app (see git history — this used to be 20+ near-duplicate
   variants before consolidation).

## The helpers (`lib/ui.ts`)

| Helper | Use for |
|---|---|
| `COLORS` | Every color reference. `accent`, `success`, `danger`, `warning`, `info`, `indigo`, `text`, `textDim`, `textMuted`, `faint`, `border`, `borderSubtle`, `panelBg`, `panelBgDark`. |
| `clipCorner(px: 6\|7\|8)` | The corner-cut hexagon clip-path for any "chip" shaped element (buttons, tabs, search bar, settings/close buttons). Only 6, 7, or 8px — don't add a 4th size. |
| `ringBorder(opts)` | The spinning conic-gradient "energy ring" border/background/animation. `variant: "outline"` (4-stop, for dark-filled elements with an accent ring) vs `"filled"` (3-stop sheen, for CTA buttons whose fill IS the accent color). `shape: "pill" \| "clip" \| "none"`. Default duration 3.2s — keep new elements in the ~1.6s–5.5s range that's already in use, don't invent a new pace. |
| `card(opts?)` | Neutral bordered container — meta tiles, comment bubbles, acceptance-criteria rows, past-run rows. |
| `tintedCard(tone, opts?)` | Color-tinted banner card. `tone: "success" \| "danger" \| "warning" \| "accent"` — result banners, error/notice boxes, the "ready to implement" CTA strip. |
| `dropdownPanelStyle(opts?)` | Dropdown/menu panel chrome — used by `SprintPicker`, `Combobox`, and the inline status menu. |
| `pill(opts)` | Generic pill/badge shape — status pills, exec pills, branch pill, log status badge, filter-count badge, "CURRENT" badge. `size: "xs" \| "sm" \| "md"`. |
| `ctaButtonStyle(variant, opts?)` | Full action-button style. `variant: "primary"` (accent-filled CTA) \| `"success"` (green ring — Show Result / Open PR) \| `"warning"` (amber ring — Running/cancel) \| `"outline"` (plain bordered secondary — Test connection / Cancel) \| `"ghost"` (dark-fill + accent-ring secondary — the "next action" button). |
| `typeBadge`, `statusPill`, `statusPillActive`, `execDot`, `avatar` | Domain-specific badges already composed from the primitives above — use these directly for ticket type/status/exec-state/assignee, don't rebuild them. |

## Two ring "families" — don't blur them

- **Outline family** (`ringBorder({ variant: "outline" })`): dark fill +
  4-stop accent ring. Used for anything that isn't a primary CTA — tabs,
  search bar, filter toggle, settings button, secondary "ghost" buttons,
  status pills, dropdown triggers.
- **Filled family** (`ringBorder({ variant: "filled" })`): the fill itself is
  already `COLORS.accent` (or a state color like success/warning), and the
  ring is just a single sheen stop. Used only for primary/state CTA buttons
  (`ctaButtonStyle("primary" | "success" | "warning")`).

Don't mix them — a dark-filled secondary button should never use the
"filled" 3-stop variant, and a solid-accent CTA should never use the 4-stop
"outline" variant (it would double the ring color against the fill).

## Hard rules

- No inline `background: "linear-gradient(...) padding-box, conic-gradient(...) border-box"` — always `ringBorder(...)`.
- No inline `clipPath: "polygon(...)"` — always `clipCorner(px)`.
- No inline `border: "1px solid #262B36"` / `#1E232C` / `#23272F` style triples for containers — always `card(...)` or `tintedCard(...)`.
- No raw hex for accent/success/danger/warning/info — always `COLORS.*`.
- When adding a new button/pill/card variant, extend the relevant factory's
  `opts`/variant union in `lib/ui.ts` rather than writing a new inline style
  block in a component file.
- Keep this file's helper table in sync with `lib/ui.ts` whenever a helper's
  signature changes.
