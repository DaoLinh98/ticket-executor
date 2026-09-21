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
| `tintFill(tone)` | Just the tint's fill, for a row highlighted rather than boxed (a list row inside an already-bordered panel). |
| `modalShellStyle(opts?)` | Full-screen modal panel shell (`DiffModal`, `CommitFilesModal`). |
| `modalOverlayStyle(opts?)` | The scrim + blur + fade-in sheet a modal panel centres on. Pair with `modalShellStyle()`. |
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
- No inline modal shell — `modalShellStyle(...)`, on a `modalOverlayStyle(...)` sheet. No inline wordmark — `logoText(...)`.
- No raw hex for accent/success/danger/warning/info — `COLORS.*`.
- No bespoke CSS spinner or text-only "Loading…" — `LoadingRing`.
- No bespoke click/ripple effect and no other color for it — `useBoltsContext()`.
- **Never spread a second `{ animation: ... }` over a `ringBorder(...)` style** —
  use `extraAnimation` / `extraAnimationDelay`, or the spread silently kills the
  ring's spin (this broke the dashboard panels once).
- Don't mix the two ring families: a dark-filled secondary button never uses
  `variant: "filled"`, a solid-accent CTA never uses `"outline"`.

## The responsive layer

Every component here styles itself with inline style objects, and an inline
style cannot carry a media query. So the phone layout lives in **one CSS block
at the foot of `app/globals.css`**, and components only contribute a class as a
hook. Rules:

- **One breakpoint: `max-width: 900px`.** It catches phone portrait (390/402px),
  phone landscape (844/874px wide but 390px *tall*) and tablet portrait. Its JS
  twin is `MOBILE_QUERY` in `app/(app)/MobileNav.tsx` — change both or neither.
- **`!important` is expected in that block and only there.** It is the only way
  to beat an inline style. Nothing outside the media query uses it.
- **Full-height shells use `var(--te-app-h)`, never `100vh`.** On iOS `100vh` is
  the height with the URL bar *collapsed*, so a `100vh` shell hides its own
  bottom row. The token resolves to `100dvh` where supported.
- **Structure CSS cannot change goes through a data attribute, not a JS media
  query.** `TicketExecutor` marks which pane the phone is showing with
  `data-pane` on `.te-split` and the CSS hides the other one, so the desktop
  render is byte-identical and there is no viewport guess at hydration.
  `useIsMobile()` exists for the two things CSS genuinely cannot do: a drawer
  that must not also be a collapsed rail, and closing it on navigation.
- **Safe areas come from `viewportFit: "cover"`** (the `viewport` export in
  `app/layout.tsx`); without it `env(safe-area-inset-*)` is always 0.

| Hook | Effect below 900px |
|---|---|
| `te-sidebar` + `data-mobile-open` / `te-nav-scrim` | The nav rail becomes an off-canvas drawer over a scrim. |
| `te-nav-toggle` (`MobileNavToggle`) | The drawer's trigger — hidden above the breakpoint. In `PageHeading`, plus Home, which has no header. |
| `te-page-header` / `te-page-kicker` | Header shrinks to safe-area padding; the kicker line drops. |
| `te-page-toolbar` | Control strips wrap onto more rows. They must never scroll — a scroll container clips the dropdowns they hold. Pages size their own controls with `clamp()` so two fit per row. |
| `te-tabs-scroll` | Tab rows scroll sideways. Safe here only because a tab opens no dropdown. |
| `te-notif-panel` | The bell's panel pins to the viewport — 372px cannot hang off an element 300px into a 390px screen. |
| `te-main` | Scroll-region padding drops to 14px + bottom safe area. |
| `te-grid-2` / `te-grid-3` | Fixed-column grids collapse to one column (`auto-fit` grids already do). |
| `te-table-scroll` + `te-table-body` | A real table scrolls sideways at its full width rather than reflowing. |
| `te-split[data-pane]` / `te-pane-list` / `te-pane-detail` / `te-back-btn` | A two-pane screen shows one pane at a time, with a Back control. Used by Ticket Execution (rail + detail) and by the commit popup (file list + diff). |
| `te-diffview` | A diff's side padding drops to 12px — it wraps mid-word, so every pixel is a character. |
| `te-modal-shell` / `te-modal-overlay` | Modals go full-screen, inset-padded. |
| `te-picker-label` | A picker's label truncates **in a header only** — the toolbar scrolls instead. |
