# UI/UX Design System Template

Single source of truth centralized in `lib/ui.ts` (helpers) and CSS tokens in `app/globals.css` (`:root`).

## 1. Core Principles (The 4 Rules)

1. **Reuse > Extend > New**: Prioritize helper reuse; extend variants/options only; never invent one-off inline styles.
2. **Token-Only**: Zero raw hex or hardcoded sizes in components.
   - Tokens are `var(--te-*)`, never string-concatenated (use `color-mix(in srgb, ${token} 33%, transparent)`).
   - SVG styling uses `style={{ fill: token }}` instead of `fill=`. Canvas/WebGL uses `resolveColor(token)`.
3. **Mobile-First Realism**: Target `390×844` portrait and `844×390` landscape first. Desktop is an expanded viewport.
4. **Touch & Ergonomics**: Minimum 40px tap targets; never hide essential interactions behind `:hover`.

## 2. Helper System (`lib/ui.ts`)

- **COLORS**: `accent`, `success`, `danger`, `warning`, `info`, `text`, `textSoft`, `textDim`, `textMuted`, `faint`, `border`, `panelBg`.
- **FONT**: Strict scale: `xs` (11.5px), `sm` (12.5px), `base` (14px), `md` (15px), `lg` (15px bold), `xl` (20px).
- **DISPLAY TEXT**: `displayText("hero" | "title" | "stat" | "heading")` using fluid `clamp()` for major headlines and KPI metrics.
- **SURFACES & SHAPES**:
  - `card(opts?)` / `tintedCard(tone)`: Neutral boxed panels or tinted status banners.
  - `SURFACE`: `app`, `inset` (code/dropdown), `field` (inputs), `raised`, `modal`.
  - `chipShape(6|7|8)` / `clipCorner()`: Signature corner-cut chamfers.
  - `ringBorder(opts)`: Spinning conic-gradient border (never directly spread over animation styles).
- **CORE COMPONENTS**:
  - Buttons: `ctaButtonStyle(variant: "primary" | "outline" | "ghost" | ...)`
  - Forms: `fieldLabel()`, `fieldInput()`, `sectionCaption()`
  - Status & Feedback: `pill()`, `statusPill()`, `LoadingRing` (the only spinner), `useBoltsContext()` (click effect).
  - Modals: `modalShellStyle()` + `modalOverlayStyle()` are always paired.

## 3. Responsive Layer (Mobile Breakpoint: ≤ 900px)

Mobile overrides live in one block at the bottom of `globals.css` (using `!important` to beat inline helpers):

| Hook Class                           | Behavior Below 900px                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------- |
| `te-sidebar` / `te-nav-scrim`        | Converts the sidebar rail into an off-canvas drawer with a scrim.                                          |
| `te-page-header` / `te-page-toolbar` | Shrinks safe padding; wraps toolbars across rows (never scrolls horizontally, avoiding clipped dropdowns). |
| `te-main`                            | Reduces padding to 14px + device bottom safe area.                                                         |
| `te-grid-2` / `te-grid-3`            | Collapses multi-column grids into a single vertical column.                                                |
| `te-split[data-pane]`                | Converts a two-column view into a single pane view with a Back button (`data-pane="list                    | detail"`). |
| `te-table-scroll`                    | Wraps dense tables in a dedicated horizontal scroll container to preserve column integrity.                |
| `te-plan-table`                      | Reflows tabular data into stacked mobile cards using `data-label` for cell headers.                        |
| `te-modal-shell`                     | Expands modals to full-screen with safe-area inset padding.                                                |
| `te-mobile-hide`                     | Drops secondary decorative chrome to keep essential workflows clear.                                       |

## 4. Hard Constraints

- Use `var(--te-app-h)` instead of `100vh` to avoid layout breaks from collapsible mobile browser address bars.
- Shared user state (settings, read status, active runs) must sync via server/DB; keep `localStorage` strictly for local UI preferences.
