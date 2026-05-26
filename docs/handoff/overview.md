# Handoff Spec: Overview (DNA) page

Route: `/`  ·  File: [src/pages/Overview.tsx](../../src/pages/Overview.tsx) (1,145 lines)
Shared tokens: [_design-tokens.md](./_design-tokens.md)
Wrapped by: [AppShell](../../src/components/AppShell.tsx) (provides max-width container, top-right time-class filter, bottom nav, inline brand wordmark)

---

## 1. Overview

The "DNA" landing page. Adapts to a 5-stage journey (`journeyStage` from `ChessDataContext`):

| Stage | Trigger | Renders |
|---|---|---|
| **S0** | `journeyStage === 0` (no games) | `ConnectScreen` — chess.com / Lichess / PGN import |
| **S1** | `journeyStage === 1` (5 onboarding games imported, analyzing) | `DecodingScreen` → `UnlockScreen` once ≥5 games analyzed |
| **S2** | `radarRevealedAt` set, `guidedWalkthroughDone === false`, not `s2Continued` | `RadarRevealScreen` (animated reveal + explainer) |
| **S5** | `radarRevealedAt && guidedWalkthroughDone` | Main DNA view (radar + tier + CTAs) |

**Stage coercion** ([Overview.tsx:62-66](../../src/pages/Overview.tsx#L62)): a `useRef` tracks the highest stage ever reached so a stale `journeyStage` recompute can't regress a returning user to S0/S1. Admin override (`adminStageOverride`, localhost + admin only) can force any stage.

**Loading**: full-screen `OrbitDnaLoader` (`fixed inset-0 z-30`) when `settingsLoading || (effectiveStage === 0 && gamesLoading)` ([Overview.tsx:336-341](../../src/pages/Overview.tsx#L336)).

---

## 2. Layout (S5 main view, top → bottom)

Renders as a two-column grid on `md+`, flex column on mobile ([Overview.tsx:466](../../src/pages/Overview.tsx#L466)).

```
┌──────────────────────────────────────────────────────────────┐
│ [Brand wordmark — from AppShell]                             │
├──────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────┐  ┌──────────────────────────┐   │
│ │  ChartGallery            │  │  (right column)          │   │
│ │   ↳ SkillRadar (SVG)     │  │  ── divider              │   │
│ │   title + subtitle       │  │  FourCtaGrid             │   │
│ │                          │  │   • Share DNA            │   │
│ │  Tier-info line          │  │   • Your Progress        │   │
│ │   ELO · → next · score (i)│  │   • Profile              │   │
│ │                          │  │   • [Primary] Replay     │   │
│ │  RadarLegend             │  │     mistakes (full-w)    │   │
│ │   ☑ Last Month (blue)    │  │                          │   │
│ │   ☑ Last Week (green)    │  │                          │   │
│ │   ☑ All Time (purple)    │  │                          │   │
│ └──────────────────────────┘  └──────────────────────────┘   │
│  Modals (root-level fixed inset-0 z-50):                     │
│   • ScoringInfoPopup                                         │
│   • PlayerCardShare                                          │
│   • DimensionInfoTooltip (anchored to clicked vertex)        │
└──────────────────────────────────────────────────────────────┘
```

Grid spec: `md:grid md:grid-cols-[3fr_2fr] md:gap-6 md:flex-none` ([Overview.tsx:466](../../src/pages/Overview.tsx#L466))
Right column on mobile: `mt-auto md:mt-0` — pushes CTAs to bottom of viewport above the bottom nav.

---

## 3. Design tokens used

See [_design-tokens.md](./_design-tokens.md) for the full palette.

| Token / class | Where | Purpose |
|---|---|---|
| `chess-bg`, `chess-surface`, `chess-text` | All cards/modals | Base layering |
| `chess-text-secondary` / `tertiary` | Subtitles, tier-info bullets, modal body | Hierarchy |
| `chess-accent` | Primary CTA, info button hover, active legend checkboxes, admin override active state | Brand action color |
| `chess-border/30` | Divider above CTAs | Subtle separation |
| `chess-text-tertiary/50` | Bullet separators in tier-info line ([Overview.tsx:495](../../src/pages/Overview.tsx#L495)) | Inline microcopy dividers |
| `tabular-nums` | Tier-info numeric spans ([Overview.tsx:485](../../src/pages/Overview.tsx#L485)) | Monospaced digits |

### Hardcoded values (not theme tokens — be deliberate before changing)
| Value | Where | Purpose |
|---|---|---|
| `#60a5fa` (blue) | Primary radar polygon | "Last Month" timeframe |
| `#4ade80` (green) | Overlay polygon | "Last Week" timeframe |
| `#c084fc` (purple) | Overlay polygon | "All Time" timeframe |
| `rgba(74,222,128,0.35)` | Primary CTA drop-shadow ([Overview.tsx:669](../../src/pages/Overview.tsx#L669)) | Green glow |
| `bg-white/[0.05]` | Modal body backgrounds | Inset surface (auto-flips in light mode) |

### Animations
- `animate-scale-in` — favicon entrance on S0 LandingScreen
- `animate-fade-in-up` — tagline / CTA / pillar reveals on S0, with inline `animationDelay` for stagger
- `animate-orbit` (per-instance custom keyframe via `useId()`) — OrbitDnaLoader satellites
- No `prefers-reduced-motion` handling in this page — browser-default behavior

---

## 4. Components

| Component | File | Key props | Notes |
|---|---|---|---|
| `OrbitDnaLoader` | `src/components/OrbitDnaLoader.tsx` | `size=96`, `caption` | Full-screen splash on cold load |
| `ConnectScreen` | `src/components/OnboardingFlow.tsx` | `isGuest`, `onSettingsChange`, `onImportComplete`, `onBack` | S0 — chess.com / Lichess / PGN |
| `DecodingScreen` | `src/components/OnboardingFlow.tsx` | `games`, `analyzedCount`, `analyzingCount`, `onUpdateSettings` | S1 — analysis progress |
| `UnlockScreen` | `src/components/OnboardingFlow.tsx` | `analyzedCount`, `totalGames`, `onUnlock` | S1 → S2 transition |
| `RadarRevealScreen` | `src/components/OnboardingFlow.tsx` | `games`, `analyses`, `onboardingTimeClass`, `onContinue` | S2 — animated reveal |
| `ChartGallery` | `src/components/ChartGallery/ChartGallery.tsx` | `games`, `analyses`, `profile`, `onDimensionClick`, `onChartChange`, `primaryLabel`, `primaryColor`, `overlays`, `primaryVisible`, `visibleOverlayIds`, `showLegend` | Wraps `SkillRadar` with title/subtitle |
| `SkillRadar` | `src/components/SkillRadar.tsx` | Same as above (forwarded) | Custom SVG. Vertices clickable → fires `onDimensionClick(id, event)` with click coords |
| `RadarLegend` | `src/components/SkillRadar.tsx` (named export) | `primaryLabel`, `primaryColor`, `primaryVisible`, `primaryDisabled`, `onTogglePrimary`, `overlays`, `visibleOverlayIds`, `disabledOverlayIds`, `onToggleOverlay` | Checkboxes; enforces ≥1 visible polygon |
| `FourCtaGrid` | local to Overview.tsx ([:588](../../src/pages/Overview.tsx#L588)) | `onShareClick`, `onSettingsClick`, `onProgressClick`, `onReplayClick` | 3-column secondary row + full-width primary |
| `CtaCard` | local to Overview.tsx ([:648](../../src/pages/Overview.tsx#L648)) | `icon`, `label`, `onClick`, `primary?`, `fullWidth?` | Primary = accent-green pill with glow; secondary = surface card with border |
| `PlayerCardShare` | `src/components/share/PlayerCardShare.tsx` | `profile`, `tier`, `playerElo`, `username`, `lichessUsername`, `onClose` | Modal — html2canvas capture of share card |
| `ScoringInfoPopup` | local ([:743](../../src/pages/Overview.tsx#L743)) | `profile`, `onClose` | Modal — overall + opponent-adjusted + 8-dimension breakdown |
| `DimensionInfoTooltip` | local ([:843](../../src/pages/Overview.tsx#L843)) | `profile`, `dimensionId`, `anchorX`, `anchorY`, `onClose` | `role="tooltip"`, anchored to clicked radar vertex; dismisses on Escape or outside click |
| `AdminStageNav` | local ([:917](../../src/pages/Overview.tsx#L917)) | `currentStage`, `autoStage`, `isOverridden`, `onSetStage`, `onUpdateSettings`, `refetchAll`, `settings` | Localhost + admin only; `fixed bottom-20 right-3` |

---

## 5. States & interactions

### Click targets
| Element | Action |
|---|---|
| Radar vertex | Open `DimensionInfoTooltip` anchored at click coords ([Overview.tsx:305-311](../../src/pages/Overview.tsx#L305)) |
| Legend checkbox | Toggle polygon visibility; last visible polygon is unclickable (enforces ≥1) |
| Tier-info (i) | Open `ScoringInfoPopup` |
| **Share DNA** | Open `PlayerCardShare` modal |
| **Your Progress** | `navigate('/games?tab=progress')` |
| **Profile** | `navigate('/settings')` |
| **Replay mistakes** *(primary)* | `navigate('/timemachine')` |

### Hover / press
- Primary CTA: `hover:brightness-110` + extra inset/drop shadow, `active:translate-y-px` (1px depress)
- Secondary CTAs: `hover:border-chess-accent/40`
- (i) info button: `hover:text-chess-accent`

### Disabled
- Legend checkbox: greyed when that timeframe's `profile.gamesUsed === 0` (added to `disabledOverlayIds`)
- Last visible polygon: toggle ignored to prevent blank chart

### Tutorial coachmark
- This page has `data-tutorial-target="dna-radar"` on the radar container ([Overview.tsx:468-481](../../src/pages/Overview.tsx#L468))
- `TutorialCoachmark` overlay (mounted in AppShell) auto-fires when `settings.tutorialStep` matches this screen
- Legacy `tutorialStepsSeen` array auto-initialized to `[]` on first mount if user has `guidedWalkthroughDone` but the array is `undefined` ([Overview.tsx:212-216](../../src/pages/Overview.tsx#L212)) — ensures coachmarks fire once per page

### Modal states
- `showScoringInfo` (boolean) — toggles `ScoringInfoPopup`
- `showShareCard` (boolean) — toggles `PlayerCardShare`
- `activeDimension` (`{id, x, y} | null`) — controls `DimensionInfoTooltip`
- All modals: backdrop click dismisses; `DimensionInfoTooltip` listener bound via `setTimeout(0)` so the opening click doesn't immediately close it ([Overview.tsx:851-852](../../src/pages/Overview.tsx#L851))

---

## 6. Responsive

Tailwind breakpoints used: `sm:` (640px) and `md:` (768px). No `lg:` overrides in this file.

| Breakpoint | Behavior |
|---|---|
| **Mobile** (< md) | Single flex column. Right column gets `mt-auto` so CTAs pin to bottom of viewport above the bottom nav. Tier-info renders centered with bullet separators. Modals open at `max-w-md`. |
| **Desktop** (≥ md, 768px+) | Two-column grid `[3fr_2fr]` with 24px gap. Right column starts at top (`md:mt-0`). Modals open at `max-w-3xl`. |
| Horizontal padding | `px-4 sm:px-6` (inherited from AppShell `<main>`) |

`AdminStageNav` is `fixed bottom-20 right-3`, offset above the bottom nav.

---

## 7. Edge cases & content limits

- **No games (S0)** → ConnectScreen takes over; no radar/tier UI
- **Onboarding mid-analysis (S1)** → `DecodingScreen` indefinitely until ≥5 games analyzed, then `UnlockScreen` is unlocked
- **No ELO yet** → tier-info skips the ELO span ([Overview.tsx:486-488](../../src/pages/Overview.tsx#L486))
- **Max tier reached** → tier-info skips the "→ X pts to next" span (`if (!next || pts <= 0) return null`)
- **`profile.gamesUsed === 0`** → radar skips the placeholder polygon; primary checkbox is disabled
- **Long usernames** → not constrained on this page (handled by AppShell where username appears)
- **Time-class filter change** (user picks bullet/blitz/rapid/daily from the floating filter) → recomputes `radarProfiles` (week/month/all) for the new class; cache key is per `(userId, selectedTimeClass)`
- **Slow analysis** (`analyzedCount < totalGameCount`) → small progress ring + `N/total` chip appears centered under the floating time-class filter (rendered by AppShell, not Overview)

---

## 8. Motion

| Element | Trigger | Animation | Duration | Easing |
|---|---|---|---|---|
| Cold-load splash | settingsLoading or gamesLoading | `OrbitDnaLoader` orbit + halo pulse | 6s / 2.4s loops | linear / ease-in-out |
| LandingScreen favicon | S0 mount | `animate-scale-in` | 0.4s | ease-out forwards |
| LandingScreen tagline / CTA / pillars | S0 mount | `animate-fade-in-up` with staggered `animationDelay` (0.1s, 0.2s) | 0.6s | ease-out forwards |
| Primary CTA | Hover | brightness shift + shadow expansion | CSS `transition-all` | default |
| Primary CTA | Press | `translate-y-px` | CSS `transition-all` | default |
| Modals (ScoringInfoPopup, PlayerCardShare, DimensionInfoTooltip) | Open | None (instant) — backdrop only | — | — |

---

## 9. Accessibility

- `OrbitDnaLoader` carries `role="status"` + `aria-label={caption}` for screen readers
- `DimensionInfoTooltip` uses `role="tooltip"`; dismissed by Escape
- (i) info button has `title="How is this calculated?"` tooltip on hover
- All interactive elements are `<button>` — semantic, keyboard-focusable
- **Color-only signals**: tier color (dimension score chips) is paired with the numeric score, so the color is reinforcement, not the only cue
- **No explicit focus trap** in modals — Escape dismiss works for tooltip but not for ScoringInfoPopup / PlayerCardShare. *Worth flagging for a future a11y pass.*

---

## 10. i18n keys (visible copy)

All copy uses `useT()` (`src/i18n/index.ts`):

| Key | Used in | English fallback |
|---|---|---|
| `overview_skill_radar` | ChartGallery title | "Skill Radar" |
| `overview_skill_radar_sub` | ChartGallery subtitle | "Your 8-dimension skill profile" |
| `tab_month` / `tab_week` / `tab_all_time` | Legend labels | "Last Month" / "Last Week" / "All Time" |
| `overview_score_title` | ScoringInfoPopup header | "How Your Score Works" |
| `overview_overall_score` / `overview_overall_desc` | ScoringInfoPopup | (overall section) |
| `overview_opponent_adjusted` / `overview_opponent_desc` | ScoringInfoPopup | (adjustment explainer) |
| `overview_got_it` | ScoringInfoPopup close | "Got it" |
| `skill_{dim.id}` | Dimension label | e.g., "Openings", "Tactics" |
| `skill_{dim.id}_what` / `_how` | Dimension descriptions | category info |
| `overview_share_dna` | CTA label | "Share DNA" |
| `overview_progress` | CTA label | "Your Progress" |
| `overview_profile` | CTA label | "Profile" |
| `overview_replay_mistakes` | Primary CTA label | "Replay your mistakes" |

S0 / S1 / S2 copy lives in `OnboardingFlow.tsx` (`s0_desc`, `s0_get_started`, `s0_reveal`, etc.).

---

## 11. Notable quirks (read these before editing)

1. **Stage coercion ref**: `useRef` retains the highest journey stage seen this session, so a stale ChessDataContext recompute can never visually regress a S5 user to S0/S1 ([Overview.tsx:62-66](../../src/pages/Overview.tsx#L62)).
2. **Two profile sources**: `radarProfiles[activeWindow]` (localStorage-cached, used for hero score + tier) vs `windowedData.profile` (live, used by `ScoringInfoPopup`). The cache prevents cold-load flash of "50" defaults; the live recompute swaps in 5–10s later. *Don't merge them without understanding the timing.*
3. **Radar cache key**: `chess-dna-radar-{userId}-{selectedTimeClass}` in localStorage, ~6 KB. Stores `{week, month, all}` triple.
4. **Three polygons, one chart**: Month is primary (blue), week + all are overlays (green + purple). Hardcoded hex per polygon — *don't tokenize without coordinating with `PlayerCardShare`, which uses the same color triple.*
5. **Legend "≥1 visible" rule**: The last visible polygon's checkbox click is ignored to keep the chart non-blank ([Overview.tsx:184-202](../../src/pages/Overview.tsx#L184)).
6. **Bulk import** runs once post-reveal: loops over `['rapid', 'blitz', 'bullet', 'daily']` skipping the onboarding class, marks `bulkImportDone: true` to prevent re-runs, uses per-class try/catch so one failure doesn't abort ([Overview.tsx:264-295](../../src/pages/Overview.tsx#L264)).
7. **Admin override patches settings**: When admin jumps to a stage, code auto-sets `radarRevealedAt`, `patternsUnlockedAt`, `guidedWalkthroughDone` so the rest of the app's stage gating matches ([Overview.tsx:963-974](../../src/pages/Overview.tsx#L963)).
8. **Tier color is dynamic, not a token**: `getTierColor(tier, theme)` returns tuned hex per (tier, theme). Don't try to map it to `chess-*` — it deliberately doesn't.
9. **Full-reset nuke** (admin only) deletes games/analyses/patterns/snapshots with 150 ms spacing to dodge Base44 rate-limit 429s ([Overview.tsx:980-1041](../../src/pages/Overview.tsx#L980)).
10. **CLAUDE.md flags this file** as widely-depended-on: 40+ derived values flow through `ChessDataContext`; all hooks must precede any conditional return.
