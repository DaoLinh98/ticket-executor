# UI Style Guide

ONE design system, centralized in `lib/ui.ts`. Read that file (it is short)
before writing style code. Update this doc **only** when a helper is added or its
signature changes — not after every UI edit.

## One token layer

`lib/ui.ts` holds **no colour literals**. Every token is a `var(--te-…)` whose
values live in `app/globals.css` under `:root`. Three consequences, all of which
have bitten already:

- **Tokens are CSS values, not colours.** `new THREE.Color(COLORS.accent)`
  throws. Anything wanting a real hex (WebGL, canvas) calls `resolveColor(token)`
  and re-reads it when the theme changes.
- **Tokens cannot be string-manipulated.** `COLORS.warning + "55"` is dead —
  `var(--te-warning)55` parses as nothing. Use
  `color-mix(in srgb, ${token} 33%, transparent)`.
- **SVG presentation attributes do not resolve `var()`.** `fill="…"` /
  `stroke="…"` must become `style={{ fill: … }}` / `style={{ stroke: … }}`.

Adding a colour means adding a token to `globals.css`, never a raw hex in a
component.

## The four rules

1. **Reuse before you write.** If the element looks like an existing pattern
   (button, pill, card, dropdown, tab, modal), use the helper. Don't hand-roll a
   similar-but-not-identical inline style.
2. **Extend, don't fork.** Need a new color/size/variant? Add it to the helper's
   `opts`/union in `lib/ui.ts`. Only export a new helper if the *shape* is new.
3. **No raw values.** Every color from `COLORS`, every `fontSize` from `FONT`,
   every corner cut from `clipCorner(6|7|8)`. Ring durations stay in the existing
   ~1.6s–5.5s range.
4. **Type check + look at it.** `npx tsc --noEmit`, then view the changed screen
   in the browser where practical.

## Helpers (`lib/ui.ts`)

| Helper | Use for |
|---|---|
| `COLORS` | Every color. `accent`, `success`, `danger`, `warning`, `info`, `indigo`, `text`, `textSoft`, `textDim`, `textMuted`, `faint`, `border`, `borderSubtle`, `panelBg`, `panelBgDark`. Paragraphs use `textMuted`/`textDim` — `faint` is for placeholders and disabled chrome only. |
| `FONT` | Every font size. `xs` 11.5 (pills/badges) · `sm` 12.5 (captions/meta) · `base` 14 (controls, rows, log lines) · `md` 15 (body copy) · `lg` 15 (card titles) · `xl` 20 (page titles, `logoText`). Never a size *between* two steps. |
| `SURFACE` | The three themed surfaces that used to be inline hex: `app`, `inset` (inputs/code/dropdowns), `modal`. |
| `SHAPE` | `radiusChip`, `radiusCard`, `radiusPanel`, `panelBlur` — the shape half of a theme. |
| `resolveColor(token, fallback?)` | A real hex for WebGL/canvas. Browser-only; returns the fallback during SSR. |
| `chipShape(6\|7\|8)` | The chip shape, **both** halves — clip-path *and* radius. Use this over bare `clipCorner`: a theme without corner cuts needs the radius back or the chip is a bare rectangle. |
| `clipCorner(6\|7\|8)` | Just the corner-cut clip-path token (`var(--te-clip-N)`). No 4th size. |
| `ringBorder(opts)` | The spinning conic-gradient "energy ring". `variant: "outline"` (4-stop, dark fill) vs `"filled"` (3-stop sheen, accent fill). `shape: "pill" \| "clip" \| "none"`. |
| `card(opts?)` / `tintedCard(tone, opts?)` | Neutral bordered container / color-tinted banner (`success \| danger \| warning \| accent`). |
| `modalShellStyle(opts?)` | Full-screen modal panel shell (`DiffModal`, `CommitFilesModal`). |
| `logoText(fontSize)` | The animated fire-gradient wordmark — pass only the size. |
| `fieldLabel()` / `fieldInput(opts?)` | Form input caption / dark inset input chrome. |
| `sectionCaption()` | Uppercase caption over read-only content in a detail pane. One step smaller than `fieldLabel()`. |
| `codeBlock(opts?)` | Read-only mono code / command block. |
| `dropdownPanelStyle(opts?)` | Dropdown/menu chrome. `opts.maxHeight` also sets `overflowY: auto`. |
| `pill(opts)` | Generic pill/badge. `size: "xs" \| "sm" \| "md"`. |
| `tabStyle({ active, enabled? })` | THE tab-bar button (detail tabs + Settings tabs). |
| `ctaButtonStyle(variant, opts?)` | Action buttons: `primary` \| `success` \| `warning` \| `danger` \| `outline` \| `ghost`. |
| `typeBadge`, `statusPill`, `statusPillActive`, `execDot`, `avatar` | Domain badges already composed from the above — use directly. |
| `LoadingRing` | THE only spinner. Every loading state renders it via `size`; always accent orange. Not over a `primary` fill (orange-on-orange) — use `warning`/`ghost`/`outline` or text-only there. |
| `RichText` + `.te-rich` (globals.css) | THE way to render provider rich text; styled **by selector**, never inline. HTML must already have passed `sanitizeHtml()` (`lib/richText.ts`) at the producer — `RichText` does not sanitize again. |
| `useBoltsContext()` | THE only click effect. `BoltsProvider` is mounted once in `app/layout.tsx`. Always accent orange; `{ big: true }` only for a run's primary "go" action. |

## Hard rules

- No inline `linear-gradient(...) padding-box, conic-gradient(...) border-box` — `ringBorder(...)`.
- No inline `clipPath: "polygon(...)"` — `clipCorner(px)`.
- No inline container border/background triples — `card(...)` / `tintedCard(...)`.
- No inline modal shell — `modalShellStyle(...)`. No inline wordmark — `logoText(...)`.
- No raw hex for accent/success/danger/warning/info — `COLORS.*`.
- No bespoke CSS spinner or text-only "Loading…" — `LoadingRing`.
- No bespoke click/ripple effect and no other color for it — `useBoltsContext()`.
- **Never spread a second `{ animation: ... }` over a `ringBorder(...)` style** —
  use `extraAnimation` / `extraAnimationDelay`, or the spread silently kills the
  ring's spin (this broke the dashboard panels once).
- Don't mix the two ring families: a dark-filled secondary button never uses
  `variant: "filled"`, a solid-accent CTA never uses `"outline"`.
