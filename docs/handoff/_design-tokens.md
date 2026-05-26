# Chess DNA — Design Tokens (shared reference)

Source: [src/index.css](../../src/index.css), [tailwind.config.js](../../tailwind.config.js).
All three page specs reference these by token name.

## Color palette

Themes flip via `[data-theme="dark"|"light"]` on `<html>`. Token values resolve through CSS custom properties; in Tailwind they're available as `bg-chess-*`, `text-chess-*`, `border-chess-*`.

| Token | Dark | Light | Used for |
|---|---|---|---|
| `chess-bg` | `#0a0f1a` | `#f5f7fa` | Page background |
| `chess-surface` | `#111827` | `#ffffff` | Cards, modals, dropdowns, dock |
| `chess-text` | `#e8edf5` | `#0f172a` | Primary text |
| `chess-text-secondary` | `#94a3b8` | `#334155` | Labels, metadata |
| `chess-text-tertiary` | `#64748b` | `#64748b` | De-emphasized, separators |
| `chess-text-disabled` | `#334155` | `#94a3b8` | Disabled controls |
| `chess-accent` | `#4ade80` (green) | `#16a34a` (green) | CTAs, active nav, ✓ states, save |
| `chess-border` | `#1e3a5f` | `#cbd5e1` | Card outlines, dividers (often used with `/30` opacity) |
| `chess-muted` | `#1e293b` | `#f1f5f9` | Inset surfaces |
| `chess-overlay` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.04)` | Hover wash on transparent surfaces |
| `chess-blunder` | `#ef4444` | `#ef4444` | Blunders, "miss", critical errors |
| `chess-mistake` | `#f59e0b` | `#f59e0b` | Mistakes, warning |
| `chess-inaccuracy` | `#eab308` | `#eab308` | Inaccuracies |
| `chess-best` | `#22c55e` | `#22c55e` | Best move |
| `chess-excellent` | `#34d399` (teal-green) | `#14b8a6` (teal) | Excellent move |
| `chess-grid-stroke` | `#1e3a5f` | `#cbd5e1` | Chart gridlines (SVG only) |
| `chess-tooltip-bg` | `#1a2332` | `#ffffff` | Recharts tooltip bg |
| `chess-tooltip-border` | `rgba(74,222,128,0.3)` | `rgba(22,163,74,0.3)` | Recharts tooltip border |

### Board piece-square colors (not theme-aware)
- `chess-light` — `#f0d9b5` (light squares)
- `chess-dark` — `#b58863` (dark squares)

### Light-mode auto-flips (already handled — do not re-implement)
`src/index.css:54-119` rewrites dark-first utilities for light mode:
- `bg-white/[0.0X]` → `rgba(0,0,0,X)`
- `text-white`, `text-white/70`, `text-white/90` → dark slate text
- `text-gray-300/400/500` → `slate-500/600/700`
- Hover variants of all the above

This means: keep using `bg-white/[0.05]`, `text-white/70`, etc. — they Just Work in both themes.

## Typography

- Font family: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` (browser-default system stack)
- Numeric: add `tabular-nums` for any aligned digit grid (scores, ratings, counts)
- No custom font sizes in the Tailwind config — use stock Tailwind scale plus arbitrary values where needed (e.g., `text-[11px]` for chip/badge text)

## Animations (Tailwind keyframes + classes)

Defined in [tailwind.config.js:29-117](../../tailwind.config.js#L29).

| Class | Duration / Loop | Used for |
|---|---|---|
| `animate-fade-in-up` | 0.6s ease-out forwards | Section reveal on mount |
| `animate-fade-in` | 0.5s ease-out forwards | Generic fade-in |
| `animate-scale-in` | 0.4s ease-out forwards | Modal/popover entrance |
| `animate-pulse-glow` | 2s ease-in-out infinite | Attention/recommendation halo |
| `animate-spin-slow` | 8s linear infinite | Decorative rotation |
| `animate-shimmer` | 2s linear infinite | Skeleton sweeps |
| `animate-dimension-reveal` | 0.8s ease-out forwards | Radar vertex pop-in |
| `animate-unlock-burst` | 0.6s ease-out forwards | Onboarding unlock celebration |
| `animate-orbit` | 6s linear infinite | OrbitDnaLoader satellites |
| `animate-count-up` | 0.4s ease-out forwards | Number ticker reveal |
| `animate-ticker-roll` | 0.6s ease-out both | Number roll-in |
| `animate-border-beam` | 2.5s linear infinite | Accent border sweep |
| `animate-aurora-drift` | 8s ease-in-out infinite | Decorative blob drift |
| `animate-word-blur-in` | 0.4s ease-out both | Per-word headline reveal |
| `animate-shimmer-sweep` | 2s ease-in-out infinite | Button hover shimmer |

CSS-only (not Tailwind classes):
- `mate-pulse` — 1.4s ease-in-out infinite (GameDetail checkmate flourish, set via inline `style`)
- `streaming-dot-pulse` — 1.1s ease-in-out infinite (3-dot streaming indicator, `.streaming-dot`)
- `neon-rotate` — 3s linear infinite (`.neon-card` border)
- `border-beam` — `.border-beam::after` 2.5s linear infinite
- `aurora-drift` — `.aurora-blob` 8s ease-in-out infinite
- `shimmer-sweep` — `.shimmer-btn::after` 2s ease-in-out infinite

## Spacing & containers

- **Page container**: `max-w-6xl mx-auto w-full` with `px-4 sm:px-6` (set by AppShell, every page inherits)
- **Vertical padding**: `pt-2 pb-20` when user has games (reserves space for bottom nav); `pb-4` for stage-0
- **Brand wordmark**: inline-flex, `w-5 h-5` favicon + uppercase wordmark, `mb-3`, hidden during active tutorial
- **Safe areas**: `env(safe-area-inset-bottom)` respected on bottom nav and guest signup banner

## App-shell chrome (every page sees these)

- **Top-right time-class filter** (`.app-time-filter`, [AppShell.tsx:207](../../src/components/AppShell.tsx#L207)) — `fixed top-3 end-3 z-50`. Hidden in focus mode.
- **Bottom nav** (`.app-bottom-nav`, [AppShell.tsx:348](../../src/components/AppShell.tsx#L348)) — `fixed bottom-0 inset-x-0 z-50`, three tabs: DNA · Analyze · Replays. Hidden in focus mode (transform translateY(110%)).
- **Active-tab pill** — `rgba(74,222,128,0.14)` background + `box-shadow: 0 0 0 1px rgba(74,222,128,0.4), 0 0 18px rgba(74,222,128,0.35)` glow
- **Guest signup banner** — floats above bottom nav at `bottom: calc(env(safe-area-inset-bottom) + 72px)` when user is in guest mode and has games

## Custom CSS components (index.css)

| Class | What it does | Defined |
|---|---|---|
| `.neon-card` | Rotating conic-gradient border + inset surface fill, 20px radius | [index.css:168](../../src/index.css#L168) |
| `.card-3d` | Hover lift (1px translate + green box-shadow + border glow), 0.25s ease | [index.css:284](../../src/index.css#L284) |
| `.border-beam` | Animated horizontal accent strip along top edge | [index.css:295](../../src/index.css#L295) |
| `.aurora-blob` | Blurred drifting decorative blob | [index.css:311](../../src/index.css#L311) |
| `.shimmer-btn` | Sliding diagonal sheen across button | [index.css:322](../../src/index.css#L322) |
| `.lamp-cone` / `.lamp-bar` | Top-edge spotlight cone + accent bar | [index.css:337](../../src/index.css#L337) |
| `.streaming-dot` | 5px pulsing dot for streaming UI | [index.css:207](../../src/index.css#L207) |
| `.scrollbar-hide` | Hide scrollbar, keep scrolling (horizontal galleries) | [index.css:150](../../src/index.css#L150) |

## Focus mode (set by GameDetail and TimeMachine challenge)

Toggle via `document.body.setAttribute('data-focus-mode', 'true')`. Effects ([index.css:219-273](../../src/index.css#L219)):

- Hides `.app-bottom-nav` (slide-out 0.2s)
- Hides `.app-time-filter` (opacity 0.2s)
- **Mobile only** (≤767px): locks `html`/`body` to `100dvh`, kills scroll, removes `<main>` padding, hides the inline brand wordmark and mobile CTA grid on the GameDetail page

## Theming
- Dark is default (`[data-theme="dark"]` on `<html>`)
- Theme switch managed by `ThemeContext` ([src/components/ThemeContext.tsx](../../src/components/ThemeContext.tsx))
- All `chess-*` tokens are theme-aware via CSS custom properties — no per-component `theme === 'dark' ? ... : ...` branching needed for color values
- Tier color (dimension scores in Overview info popups) is the exception: `getTierColor(tier, theme)` returns a tier-specific hex that's tuned per theme
