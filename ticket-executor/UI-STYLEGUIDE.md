# UI Style Guide

ONE design system, centralized in `lib/ui.ts`. Read that file (it is short) before
writing style code. Update this doc **only** when a helper or a `te-*` hook is added
or changes signature — not after every UI edit.

## One token layer

`lib/ui.ts` holds **no colour literals**: every token is a `var(--te-…)` whose value
lives in `app/globals.css` under `:root`. Adding a colour means adding a token there,
never a hex in a component. Three consequences, all of which have bitten:

- **Tokens are CSS values, not colours.** `new THREE.Color(COLORS.accent)` throws —
  WebGL/canvas call `resolveColor(token)` and re-read it when the theme changes.
- **Tokens cannot be string-manipulated.** `COLORS.warning + "55"` is dead; use
  `color-mix(in srgb, ${token} 33%, transparent)`.
- **SVG presentation attributes do not resolve `var()`.** `fill=` / `stroke=` must
  become `style={{ fill: … }}` / `style={{ stroke: … }}`.

## The four rules

1. **Reuse before you write.** If it looks like an existing pattern (button, pill,
   card, dropdown, tab, modal), use the helper — no similar-but-not-identical inline
   style.
2. **Extend, don't fork.** A new colour/size/variant goes into the helper's
   `opts`/union in `lib/ui.ts`. Export a new helper only if the *shape* is new.
3. **No raw values.** Colour from `COLORS`, size from `FONT`, corner cut from
   `clipCorner(6|7|8)`, ring durations inside the existing ~1.6s–5.5s range.
4. **Type check + look at it**, on a phone width as well as desktop (see *The
   responsive layer*).

## Helpers (`lib/ui.ts`)

| Helper | Use for |
|---|---|
| `COLORS` | Every colour: `accent`, `success`, `danger`, `warning`, `info`, `indigo`, `text`, `textSoft`, `textDim`, `textMuted`, `faint`, `border`, `borderSubtle`, `panelBg`, `panelBgDark`. Paragraphs use `textMuted`/`textDim`; `faint` is placeholders and disabled chrome only. |
| `FONT` | Every font size. `xs` 11.5 (pills) · `sm` 12.5 (captions/meta) · `base` 14 (controls, rows, log) · `md` 15 (body) · `lg` 15 (card titles) · `xl` 20 (page titles). Never a size *between* two steps. |
| `SURFACE` | Themed surfaces: `app`, `inset` (code/dropdowns), `field` (inputs — brightens on focus via `--te-field-bg`), `raised` (opaque ring/chip fill), `modal`. |
| `MOTION` | Easing (`easeExpo`, `easeOut`), durations, stagger, reveal margin and hover/tap presets for `motion/react`. CSS twins: `--te-ease-expo`, `--te-ease-out`. |
| `SHAPE` | `radiusChip`, `radiusCard`, `radiusPanel`, `panelBlur`. |
| `resolveColor(token, fallback?)` | A real hex for WebGL/canvas. Browser-only; returns the fallback during SSR. |
| `chipShape(6\|7\|8)` | The chip shape, **both** halves — clip-path *and* radius. Prefer over bare `clipCorner`. |
| `clipCorner(6\|7\|8)` | Just the corner-cut clip-path token. No 4th size. |
| `ringBorder(opts)` | The spinning conic-gradient "energy ring". `variant: "outline"` (dark fill) vs `"filled"` (accent fill); `shape: "pill" \| "clip" \| "none"`. |
| `card(opts?)` / `tintedCard(tone, opts?)` | Neutral bordered container / tinted banner (`success \| danger \| warning \| accent`). |
| `tintFill(tone)` | Just the tint's fill, for a row highlighted rather than boxed. |
| `modalShellStyle(opts?)` / `modalOverlayStyle(opts?)` | Modal panel shell, and the scrim + blur sheet it centres on. Always paired. |
| `logoText(fontSize)` | The animated fire-gradient wordmark — pass only the size. Uppercase Barlow. |
| `displayText(size, color?)` | Barlow Condensed 800 uppercase for headlines and big numbers: `hero` (Home) · `title` · `stat` (KPI values) · `heading` (card/section names). The only fluid `clamp()` sizes; body text stays on `FONT`. |
| `fieldLabel()` / `fieldInput(opts?)` | Form caption / dark inset input chrome. |
| `sectionCaption()` | Uppercase caption over read-only content; one step smaller than `fieldLabel()`. |
| `codeBlock(opts?)` | Read-only mono code / command block. |
| `dropdownPanelStyle(opts?)` | Dropdown/menu chrome. `opts.maxHeight` also sets `overflowY: auto`. |
| `pill(opts)` | Generic pill/badge. `size: "xs" \| "sm" \| "md"`. |
| `tabStyle({ active, enabled? })` | THE tab-bar button (detail tabs + Settings tabs). |
| `ctaButtonStyle(variant, opts?)` | Action buttons: `primary \| success \| warning \| danger \| outline \| ghost`. |
| `typeBadge`, `statusPill`, `statusPillActive`, `execDot`, `avatar` | Domain badges already composed from the above — use directly. |
| `toneTint(token, pct?)` | A token mixed into transparency (`color-mix`), for tinted fills and borders of a token that has no tint of its own. |
| `LoadingRing` | THE only spinner, always accent orange. Not over a `primary` fill (orange-on-orange) — use `warning`/`ghost`/`outline` or text-only there. |
| `RichText` + `.te-rich` | THE way to render provider rich text, styled by selector, never inline. The HTML must already have passed `sanitizeHtml()` at the producer. |
| `Tooltip` (`app/Tooltip.tsx`) | Mounted once in `app/layout.tsx`: turns every `title=` into a fading tooltip — keep using plain `title`, never a native-only popup or a bespoke tooltip. Hidden on touch. |
| `useBoltsContext()` | THE only click effect (`BoltsProvider` is mounted once in `app/layout.tsx`). Always accent orange; `{ big: true }` only for a run's primary "go" action. |

## Hard rules

- No inline ring gradient, clip-path polygon, container border/background triple,
  modal shell or wordmark — `ringBorder`, `clipCorner`, `card`/`tintedCard`,
  `modalShellStyle` + `modalOverlayStyle`, `logoText`.
- No raw hex for accent/success/danger/warning/info — `COLORS.*`.
- No bespoke spinner or text-only "Loading…" — `LoadingRing`. No bespoke click/ripple
  effect and no other colour for it — `useBoltsContext()`.
- **Never spread a second `{ animation: … }` over a `ringBorder(...)` style** — use
  `extraAnimation` / `extraAnimationDelay`, or the spin dies silently.
- Don't mix the ring families: a dark-filled secondary button never uses
  `variant: "filled"`, a solid-accent CTA never uses `"outline"`.

## The responsive layer — mobile first

**The phone is the primary target; the desktop is the same screen with more room.**
This app is driven from a phone as often as from the machine it runs on, so decide the
390px layout first and verify at **390 × 844** *and* landscape (844 × 390 — a short
viewport, which is what breaks full-height shells).

Components style themselves with inline objects, and an inline style cannot carry a
media query, so the phone layout lives in **one CSS block at the foot of
`app/globals.css`** and components only contribute a class as a hook.

- **One breakpoint: `max-width: 900px`** (phone portrait, phone landscape, tablet
  portrait). Its JS twin is `MOBILE_QUERY` in `app/(app)/MobileNav.tsx` — change both
  or neither.
- **`!important` is expected in that block and only there.** It is the only way to
  beat an inline style.
- **Full-height shells use `var(--te-app-h)`, never `100vh`** (on iOS `100vh` is the
  height with the URL bar collapsed, so the shell hides its own bottom row). Safe
  areas need `viewportFit: "cover"`, already set in `app/layout.tsx`.
- **Structure CSS cannot change goes through a data attribute, not a JS media query**
  (`data-pane` on `.te-split`), so the desktop render is byte-identical and nothing
  guesses the viewport at hydration. `useIsMobile()` is only for the drawer — which
  must not also be a collapsed rail — and closing it on navigation.
- **No hover-only affordance, tap targets ≥ 40px.** An action revealed on `:hover` or
  a tooltip carrying the real label does not exist on a phone.
- **A dropdown's owner must not sit in a scroll container** — hence `PageToolbar`, and
  hence `te-page-toolbar` wraps instead of scrolling.
- **Per-device state is a bug, not a cache.** Anything the user expects to be the same
  fact on phone and laptop (read notifications, plan, settings) is read from and
  written to the server; `localStorage` is for local preferences only.

| Hook | Effect below 900px |
|---|---|
| `te-sidebar` + `data-mobile-open` / `te-nav-scrim` | The nav rail becomes an off-canvas drawer over a scrim. |
| `te-nav-toggle` (`MobileNavToggle`) | The drawer's trigger — hidden above the breakpoint. In `PageHeading`, plus Home. |
| `te-page-header` / `te-page-kicker` | Header shrinks to safe-area padding; the kicker line drops. |
| `te-page-tile` / `te-page-title` | `PageHeading`'s glyph tile and page name shrink (26px / 16px). |
| `te-page-heading` / `te-org-badge` | The page title stays whole; the organization chip shrinks to its initials — `te-picker-short` replaces `te-picker-label`. Nothing on this chain may take `overflow: hidden`: it clips the open dropdown. |
| `te-mobile-hide` | The element is dropped: read-only chrome, or something a second hook renders elsewhere. |
| `te-page-toolbar` | Control strips wrap onto more rows — never scroll, which would clip their dropdowns. Pages size controls with `clamp()` so two fit per row. |
| `te-tabs-scroll` | Tab rows scroll sideways (safe only because a tab opens no dropdown). |
| `te-notif-panel` | The bell's panel pins to the viewport, capped at half the screen and scrolling inside itself. |
| `te-main` | Scroll-region padding drops to 14px + bottom safe area. |
| `te-grid-2` / `te-grid-3` | Fixed-column grids collapse to one column. |
| `te-table-scroll` + `te-table-body` | A real table scrolls sideways at full width rather than reflowing. |
| `te-plan-table` / `te-plan-head` / `te-plan-row` / `te-plan-ticket` / `te-plan-cell[data-label]` / `te-plan-actions` | The Flow Runner plan table and the Run History table reflow into a card per row: the header row is dropped, the ticket takes a full row, each cell becomes a labelled chip (the label is its `data-label`), and the actions wrap on their own row. |
| `te-run-row` / `te-run-title` / `te-run-pr` | All widths: a row that opens something gets an accent wash + left rail on hover, focus and press (its `te-run-title` turns accent); a link chip inside it (`te-run-pr`) fills with the accent on hover. Hover-varying fill/border live in the class, never inline. |
| `te-legend-rail` | Flow Runner's collapsed action legend lays its caption flat instead of as a vertical rail. |
| `te-action-btn` / `te-icon-btn` | Buttons and icon buttons reach the 40px tap target. |
| `te-split[data-pane]` / `te-pane-list` / `te-pane-detail` / `te-back-btn` | A two-pane screen shows one pane at a time with a Back control (Ticket Execution, the commit popup). |
| `te-tabbar-tabs` | The detail tabs become one sideways-scrolling row (`display: contents` above the breakpoint), leaving the run buttons their own row. |
| `te-open-ticket-mobile` | The detail header's Open Ticket chip is replaced by a copy-link icon beside the status (the meta-row chip carries `te-mobile-hide`). |
| `te-ask-log` / `te-ask-input` | The Ask Claude transcript takes a share of the viewport rather than a fixed 420px; the prompt drops to 14px mono — the one field that overrides the 16px anti-zoom rule. |
| `te-diffview` | A diff's side padding drops to 12px — it wraps mid-word, so every pixel is a character. |
| `te-modal-shell` / `te-modal-overlay` | Modals go full-screen, inset-padded. |
| `te-flow` | Scope for the react-flow canvas: maps its `--xy-*` chrome onto the app's tokens (all widths). |
| `te-wf-md` / `te-wf-md-h` | All widths: an agent's markdown output in the workflow inspector (`OutputMarkdown`, over `te-rich`) — compact type, each heading an icon row picked by `headingMeta()` (`lib/workflow/meta.ts`). |
| `te-activity` | A step's activity feed takes a share of the viewport rather than a fixed 520px. |
| `te-exec-hud` | The run summary strip tightens its gaps so its metrics wrap two per row. |
| `te-picker-label` / `te-picker-short` | A picker's label truncates **in a header only** — the toolbar wraps instead. A picker given `shortLabel` swaps to it below the breakpoint. |

Adding a component: reuse a hook above before inventing a class; a two-pane screen is
`te-split[data-pane]`, not a `useIsMobile()` branch; anything genuinely new adds its
hook **and** its row here in the same change.
