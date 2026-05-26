# Handoff Spec: TimeMachine (Replays) page

Route: `/timemachine`  ·  Nav label: **Replays**  ·  File: [src/pages/TimeMachine.tsx](../../src/pages/TimeMachine.tsx) (3,946 lines)
Shared tokens: [_design-tokens.md](./_design-tokens.md)
Sets **focus mode** while a challenge is active → hides bottom nav and floating time-class filter

⚠️ **Two distinct modes** in one route:
- **Index mode** — list of replay positions to pick from
- **Challenge mode** — single-position practice with phase state machine

---

## 1. Overview

A **challenge-based learning interface**. Each replay is a position from one of the user's analyzed games where Stockfish flagged a mistake (≥50 cp loss, <5000 cp outliers, [:916-921](../../src/pages/TimeMachine.tsx#L916)). The user re-plays the position to find a better move; the next 2 moves may continue against a bot.

### Conceptual model
- **Least-played-first** ([:1331-1342](../../src/pages/TimeMachine.tsx#L1331)): uncompleted positions (count = 0) served first, then 1×, 2×, etc. Cycle restarts once everything's been played once but still respects lowest count first.
- **Row-based progression — "Hybrid Salvage (C)"** ([:825-828](../../src/pages/TimeMachine.tsx#L825)): challenges grouped into rows of `ROW_SIZE = 6`. Milestone screens at 3 (halfway) and 6 (row complete) pause the flow for a celebration.
- **Play count tracked** in localStorage; legacy `checked` map auto-migrated to numeric `plays` map ([:491-525](../../src/pages/TimeMachine.tsx#L491)).

### Entry points
| Source | How it lands here |
|---|---|
| Bottom nav "Replays" tab | `/timemachine` (index mode) |
| Overview "Replay your mistakes" CTA | `/timemachine` (index mode) |
| GameDetail "Practice" CTA | `/timemachine?game=…` with `state.returnTo` for back navigation |
| Deep link to a specific position | `/timemachine?game=X&move=Y` → auto-starts challenge ([:1083-1100](../../src/pages/TimeMachine.tsx#L1083)) |
| Tutorial auto-start | `state.directChallenge` + `autoStart=true` ([:1106-1131](../../src/pages/TimeMachine.tsx#L1106)) |

---

## 2. Mode switching

| Render trigger | Mode |
|---|---|
| No active challenge | Index (grid of replays) |
| `challengeItem && challengeConfig` exist | Challenge — focus mode on, chrome hidden |
| `rowMilestone === 'halfway' \| 'complete'` | Milestone screen (interrupts challenge flow) |

**Index → Challenge**: click a position card ([:3208](../../src/pages/TimeMachine.tsx#L3208)) or `startChallenge()` programmatically.
**Challenge → Index**: back button ([:2303-2317](../../src/pages/TimeMachine.tsx#L2303)) — *always* exits to wherever the user came from (uses `state.returnTo` if set, else `navigate(-1)`).
**Challenge ↔ Milestone**: `advanceAfterChallenge()` pauses on milestone screen at row thresholds; Continue button on milestone fires `continueFromMilestone()`.

---

## 3. Layout — INDEX mode

```
┌─────────────────────────────────────────────────────┐
│ [▶ Replays] (brand icon + h1)                       │
│  Tagline … (i)                                      │
├─────────────────────────────────────────────────────┤
│ [For you (N)]  [Following (M)]   ← SourceTabs       │
├─────────────────────────────────────────────────────┤
│ Following-only: FollowingManager (carousel + input) │
├─────────────────────────────────────────────────────┤
│ Bot mode: Vs [Engine | Opponent] (i)                │
├─────────────────────────────────────────────────────┤
│ Following-only: [People ▾] [Pattern ▾] [Skill ▾]   │
├─────────────────────────────────────────────────────┤
│ Yours-only — Pattern impact:                        │
│ ┌────────────────────────────────────────┐          │
│ │ WORST PATTERN  (red ring)               │         │
│ │ Start with {pattern}                    │         │
│ │ Cost X rating pts · Y games · [Start ▶] │         │
│ └────────────────────────────────────────┘          │
│ #1 Hanging piece     [HIGH]  [○ ring]   ▶          │
│ #2 Missed fork       [MED]   [○ ring]   ▶          │
│ … etc                                               │
├─────────────────────────────────────────────────────┤
│ "N positions"  (+ time-class label if filter set)   │
├─────────────────────────────────────────────────────┤
│ ┌──────────┐  ┌──────────┐                          │
│ │ Position │  │ Position │   ← 1-col mobile         │
│ │  board   │  │  board   │     2-col md+            │
│ │ chips    │  │ chips    │                          │
│ │ ▶ play   │  │ ✓ ×2     │                          │
│ └──────────┘  └──────────┘                          │
│ ... (more)                                           │
├─────────────────────────────────────────────────────┤
│ [Load more (N remaining)]                           │
└─────────────────────────────────────────────────────┘
                              ┌─ floating pill ─┐
                              │ ▶ N challenges  │ (sticky right;
                              └─────────────────┘  fades on scroll)
```

Section list (render order, [:3199-3327](../../src/pages/TimeMachine.tsx#L3199)):
1. **Brand header** — `ReplayBrandIcon` + h1 "Replays" + tagline + info button
2. **`SourceTabs`** — `For you (N)` / `Following (M)` segmented control with count badges
3. **`FollowingManager`** *(Following tab only)* — suggested top players + opponents carousel + free-form username input (max 5 friends + 6 top players)
4. **Bot-mode toggle** — `Engine` / `Opponent` with info popover, persisted to localStorage
5. **Filter chips** *(Following tab only)* — `FilterChip` dropdowns: People, Pattern, Skill
6. **Game filter chip** — shows `vs opponent · date` + ✕ when `gameFilter` is set
7. **Pattern impact section** *(Yours tab only)* — worst-pattern hero card + numbered pattern rows with impact rings
8. **Result count line** — "N positions"
9. **Position grid** — 1-col mobile / 2-col md+; each card = mini board + play overlay + chips
10. **Load more** button — when `hasMore`
11. **Floating "N challenges below" pill** — sticky right, fades when scrolled past baseline

---

## 4. Layout — CHALLENGE mode

```
┌─────────────────────────────────────────────────────┐
│ ←  [✓·✓·×·●·○·○]  Position M of 6  ← RunProgress    │
├─────────────────────────────────────────────────────┤
│ 🟢 Fork  ×2  vs Opponent (1450)  ⚪ You: White      │
├─────────────────────────────────────────────────────┤
│ Mobile column / Desktop row:                        │
│ ┌────────────────────────┐  ┌──────────────────┐    │
│ │  ThemedChessboard      │  │ Game context     │    │
│ │   (with overlays:      │  │  opponent name   │    │
│ │    SAVED/MISS, game-   │  │  rating, time    │    │
│ │    over, square hili,  │  │  "View full game"│    │
│ │    legal-move dots,    │  │ ─────────────    │    │
│ │    arrows)             │  │ Status panel     │    │
│ └────────────────────────┘  │   (per phase)    │    │
│ Status panel (mobile mt-auto)│ AI explanation  │    │
│ Action row:                  │ Hint panel       │    │
│  Phase-specific buttons      │                  │    │
│                              └──────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### Sections in render order
1. **Header row** ([:2301-2396](../../src/pages/TimeMachine.tsx#L2301)) — `← Back` + `RunProgress` (6 dots showing ✓/✗/current)
2. **Game chip** ([:2344-2395](../../src/pages/TimeMachine.tsx#L2344)) — pulsing green dot + pattern label + `×N` replay chip + opponent + rating + player-color pill
3. **Board** ([:2401-2522](../../src/pages/TimeMachine.tsx#L2401))
   - Centered, shadowed, full-bleed on mobile (`ml-[calc(50%-50vw)]` trick)
   - Overlays: `✓ SAVED` (green) / `✗ MISS` (red) top-right when scored; game-over badge bottom-center; selection tint; legal-move dots; user-move glow (green ≥90, red <90); colored arrows
4. **Status panel** ([:2108-2289](../../src/pages/TimeMachine.tsx#L2108)) — content varies per phase (see Phase table)
5. **Action row** ([:2546-2748](../../src/pages/TimeMachine.tsx#L2546)) — phase-specific buttons (see Phase table)
6. **Desktop sidebar** ([:2751-2766](../../src/pages/TimeMachine.tsx#L2751)) — game context card + status panel (mobile shows the same info stacked instead)

---

## 5. Challenge phases (state machine)

Phase managed by the `useTimeMachineChallenge` hook. All phase transitions log + play sounds inside the hook.

| Phase | What it does | Status panel | Action row |
|---|---|---|---|
| `leadup` | Auto-plays 3 moves before the critical position (800 ms each, [:1209-1218](../../src/pages/TimeMachine.tsx#L1209)) | "Rewinding to move {n}…" | Replay · ◀ ▶ (forward disabled past critical) |
| `showMistake` | Brief 1.2s pause showing the original blunder before undoing it ([:1220-1228](../../src/pages/TimeMachine.tsx#L1220)) | Same as critical | Replay · ◀ ▶ |
| `critical` | Player's turn to find a better move | "Find a better move · originally played {move}". Hint panel (if active) | Replay · ◀ ▶ · **Hint** · **Reveal answer** |
| `evaluating` | Stockfish scoring the user's move | Spinner + "Analyzing your move…" | (no input) |
| `scored` | Move score 0–100 + AI explanation | Move progress badge (`MOVE n OF 3`) + AI explanation tabs (move + best move) | ↻ Try again · `Next →` *(move 3 only)* |
| `continuation` | Moves 2–3 vs bot | "Opponent thinking…" if bot's turn; otherwise prompt user | ↻ Retry · Hint · Reveal answer |
| `complete` | All 3 moves played OR game ended early (mate/stalemate) | Final move progress + result badges + AI explanation | ↻ Try again · `Next →` |

### Phase auto-advance rules
- Leadup → showMistake → critical: auto, unless user grabs control via `◀ ▶` (sets `userTookLeadupControlRef = true`, disables auto-advance)
- Scored (moves 1–2) → next continuation: auto after 500 ms ([:1309-1317](../../src/pages/TimeMachine.tsx#L1309))
- Scored (move 3) → milestone or next challenge: **manual** (user must click `Next →`) — prevents getting swept too fast

### Move scoring
- 100 → "Perfect" + celebration sound
- 90–99 → "Excellent"
- 70–89 → "Good"
- 50–69 → "Okay"
- < 50 → "Keep trying"
- Same SAN as original blunder → always "incorrect" sound regardless of score

### Reveal answer ≠ correct
Clicking the red "Reveal answer" pill jumps to scored with `moveScore = 0` and `showAnswer = true`. AI explanation loads so the user sees the best move, but **no sound plays** ([:2249, 1849](../../src/pages/TimeMachine.tsx#L2249)) — the user gave up, not solved it.

---

## 6. Design tokens

See [_design-tokens.md](./_design-tokens.md) for the full palette.

| Token | Where | Purpose |
|---|---|---|
| `chess-accent` | Pulsing game-chip dot, SAVED badge, primary CTAs, active legend | Brand green |
| `chess-blunder` | MISS badge, "Reveal answer" pill, HIGH impact ring | Red severity |
| `chess-mistake` | MEDIUM impact ring, attempt counter at high counts | Amber |
| `chess-inaccuracy` | LOW impact ring | Yellow |
| `chess-best` | Perfect-score celebration, best-move arrow base | Green confirmation |
| `chess-surface` / `chess-border/30` | Cards, status panel, modal surfaces | Layering |
| `chess-text-secondary` / `tertiary` | Labels, captions, milestone subtitles | Hierarchy |
| `chess-light` / `chess-dark` | Board squares | (via ThemedChessboard) |

### Hardcoded values
| Value | Where | Purpose |
|---|---|---|
| `rgb(10,15,26)` | `--chess-bg` fallback inline ([:2614](../../src/pages/TimeMachine.tsx#L2614)) | Mate-flourish backdrop |
| `radial-gradient(circle at 50% 20%, rgba(74,222,128,0.13), transparent 55%)` | Milestone celebration backgrounds ([:1474-1476, 1559-1560](../../src/pages/TimeMachine.tsx#L1474)) | Halfway/complete glow |
| Arrow colors (green/blue/red/orange `rgba(...)`) | Board arrow overlays ([:1920-1982](../../src/pages/TimeMachine.tsx#L1920)) | Best-move, preview, leadup-next, scored-result |
| Linear-gradient + box-shadow | Square selection tint + user-move glow ([:1997-2045](../../src/pages/TimeMachine.tsx#L1997)) | Board feedback |

### Custom animations
- `cBlink` keyframe — pulsing green dot on game chip ([:3392](../../src/pages/TimeMachine.tsx#L3392))
- `animate-spin` — Stockfish loading, hint loading
- `animate-pulse` — skeleton bars in AI explanation panel
- `animationDuration={phase === 'scored' ? 0 : 200}` on board — pieces don't tween in scored phase ([:2519](../../src/pages/TimeMachine.tsx#L2519))

---

## 7. Components

| Component | File / location | Key props | Notes |
|---|---|---|---|
| `ThemedChessboard` | `src/components/ThemedChessboard.tsx` | `position`, `boardOrientation`, `boardWidth`, `arePiecesDraggable`, `onSquareClick`, `onPieceDrop`, `customSquareStyles`, `customArrows`, `animationDuration` | Reused across leadup (non-draggable), critical (draggable), card preview (non-draggable) |
| `PlayerAvatar` | `src/components/PlayerAvatar.tsx` | `username`, `size` | 64px in following suggestions |
| `ExplanationText` | `src/components/ExplanationText.tsx` | `text`, `onSquareClick`, `isBestMove`, `onTabChange` | AI explanation with inline square links + tabs |
| `RunProgress` | local ([:3375](../../src/pages/TimeMachine.tsx#L3375)) | `results` (RowResult[]), `current`, `total=6` | 6-dot progress; current dot has ring |
| `AISays` | local ([:3419](../../src/pages/TimeMachine.tsx#L3419)) | `tone` (`'neutral'\|'cautious'\|'proud'\|'info'\|'hint'`), `children`, `onDismiss` | DNA helix icon + message box, border colored per tone |
| `InfoPopup` | local ([:3492](../../src/pages/TimeMachine.tsx#L3492)) | `title`, `body`, `onClose` | Centered modal, 70% black overlay, click-outside closes |
| `PatternIcon` | local ([:89](../../src/pages/TimeMachine.tsx#L89)) | `theme` | 17 line-art SVG icons (fork/pin/skewer/etc.) |
| `ImpactRing` | local ([:3597](../../src/pages/TimeMachine.tsx#L3597)) | `tier` (`'high'\|'medium'\|'low'`) | 62×62 SVG, red 85% / amber 55% / green 25% fills |
| `FilterChip` | local ([:3634](../../src/pages/TimeMachine.tsx#L3634)) | `label`, `value`, `icon`, `options`, `onChange` | Popover listbox, Escape or click-outside closes |
| `SourceTabs` | local ([:3543](../../src/pages/TimeMachine.tsx#L3543)) | `active`, `onChange`, `forYouCount`, `followingCount` | Segmented buttons with count badges + green underline on active |
| `FollowingManager` | local ([:3774](../../src/pages/TimeMachine.tsx#L3774)) | `friends`, `followedTop`, `pendingUsernames`, `suggestions`, handlers | Carousel + free-form input; validates against chess.com before importing |
| `RankingTable` | local ([:273](../../src/pages/TimeMachine.tsx#L273)) | `title`, `moves`, `loading`, `selectedUci`, `onSelect`, `showPv` | Top 5 alternative moves; mobile = horizontal gallery, desktop = full table |
| Promotion picker | inline ([:2408-2439](../../src/pages/TimeMachine.tsx#L2408)) | shown on `pendingPromotion` | Q/R/B/N grid; click-outside cancels |

---

## 8. Interactions

### Index mode
- **Click a position card** → `startChallenge(item)` ([:3208](../../src/pages/TimeMachine.tsx#L3208)). Sets `challengeItem` + `challengeConfig`, updates search params, enters `leadup`.
- **`SourceTabs`** → switches between "For you" (your games) and "Following" (friends + top players)
- **`FilterChip` dropdowns** (Following tab) → people / pattern / skill filters
- **`FollowingManager` add player** → validates against chess.com API ([:3837-3843](../../src/pages/TimeMachine.tsx#L3837)) then triggers import
- **Bot-mode toggle** → updates `botMode` + persists to localStorage
- **Pattern row click** → sets `patternFilter` (filters position grid); rotates arrow icon 90°
- **Worst-pattern hero "Start playing"** → starts first position in that pattern

### Challenge mode — leadup
- **◀ / ▶** ([:1189-1202](../../src/pages/TimeMachine.tsx#L1189)) → `stepBackLeadup()` / `advanceLeadup()`. Sets `userTookLeadupControlRef = true` (disables auto-advance).
- **Replay** ([:2556-2565](../../src/pages/TimeMachine.tsx#L2556)) → `onLeadupReplay()` → resets the auto-advance flag and restarts.

### Challenge mode — critical
- **Player moves** ([:2503-2514](../../src/pages/TimeMachine.tsx#L2503)) → `onSquareClick` (tap-to-select) / `onPieceDrop` (drag). Hook validates, plays sound, enters `evaluating`.
- **Pawn promotion** → `pendingPromotion` set → modal appears ([:2408-2439](../../src/pages/TimeMachine.tsx#L2408)). Click Q/R/B/N → `completePromotion(piece)`. Click outside → `cancelPromotion()`.
- **Hint** ([:2631-2641](../../src/pages/TimeMachine.tsx#L2631)) → async `requestHint()`. Sets `hintLoading`, fetches AI hint, displays in dismissible AISays panel.
- **Reveal answer** (red pill, [:2643-2648](../../src/pages/TimeMachine.tsx#L2643)) → `revealWithExplanation()`. Jumps to scored, no sound, shows best move in AI panel.

### Challenge mode — scored / complete
- **↻ Try again** → `retry()`. Rewinds to critical, increments `attempts` counter.
- **`Next →`** (move 3 only on scored; both on complete) → `advanceAfterChallenge()`. May pause on milestone.

### Back button (any phase)
- Clears challenge state + search params + row state
- If `returnTo` set (from GameDetail "Practice" entry), navigates there with `moveIndex` state
- Else: browser history `navigate(-1)`

### Opponent dropdown / Bot-mode
- **Engine** → full-strength Stockfish for continuation moves
- **Opponent** → replays the actual opponent's move *while on-script*, falls through to Stockfish throttled to opponent's rating once the user deviates ([:2978](../../src/pages/TimeMachine.tsx#L2978))

---

## 9. States

### Index-mode states
- `allPositions.length === 0 && sourceTab === 'yours'` → early-return empty state ([:1446-1464](../../src/pages/TimeMachine.tsx#L1446))
- `replays.length === 0 && loading` → spinner ([:570-595](../../src/pages/TimeMachine.tsx#L570))
- `pendingNonSelfImports` (Set of usernames) → spinner on friend/top-player cards during import
- Filter states: `categoryFilter`, `patternFilter`, `sourceTab`, `gameFilter`, `peopleFilter`, `timeClassFilter`

### Challenge-mode states
- Phase: `leadup | showMistake | critical | evaluating | scored | continuation | complete`
- `rowMilestone`: `null | 'halfway' | 'complete'`
- `hint`: `null | string` (with `hintLoading: boolean`)
- `attempts`: number — increments each `retry()`
- `selectedSquare` / `legalMoves` / `pendingPromotion` — board interaction
- `selectedRowUci` / `previewUci` / `pvStep` — ranking table preview
- `aiExplanationLoading` / `rankingLoading` — async fetches

### Row state
- `rowResults` — `('win' | 'loss')[]` for current row (≤6)
- `rowEntries` — extended `{item, result, firstScore}[]`

### Persistent state (localStorage)
- `playCounts` — `Map<challengeKey, number>` ([:491-525](../../src/pages/TimeMachine.tsx#L491))
- `botMode` — `'engine' | 'opponent'` ([:798-807](../../src/pages/TimeMachine.tsx#L798))
- Following + filter persistence

---

## 10. Responsive

| Element | Mobile | Desktop |
|---|---|---|
| Position grid | 1 column | 2 columns ([:3199](../../src/pages/TimeMachine.tsx#L3199)) |
| Challenge layout | Flex column, full-width | 60/40 row split (board left, sidebar right, [:2399](../../src/pages/TimeMachine.tsx#L2399)) |
| Board | Full-bleed via `ml-[calc(50%-50vw)]` ([:2448-2449](../../src/pages/TimeMachine.tsx#L2448)) | Sized by container; `useResponsiveBoardSize(700)` |
| Status panel | Pushed to bottom via `mt-auto` ([:2531](../../src/pages/TimeMachine.tsx#L2531)) | Moves into right sidebar ([:2765](../../src/pages/TimeMachine.tsx#L2765)) |
| Action row | Stacked rows below board | Same below board area |
| RankingTable | Horizontal gallery (h-scroll) | Full table |
| Card grid boards | `cardBoardSize` re-computed on resize ([:776-791](../../src/pages/TimeMachine.tsx#L776)) | Fit grid column |

---

## 11. Motion

| Element | Trigger | Animation | Duration |
|---|---|---|---|
| Game-chip dot | Always (challenge mode) | `cBlink` pulse | Custom keyframe |
| Leadup moves | Auto-advance | Board piece tween, 200 ms each, 800 ms between moves | 200 ms / 800 ms |
| Show-mistake | After leadup ends on critical | 1200 ms pause, then `undoMistake()` | 1200 ms |
| Scored → continuation (moves 1–2) | Auto after scoring | 500 ms delay | 500 ms |
| Spinners | Stockfish / hint loading | `animate-spin` | 1s loop |
| Skeleton bars | AI explanation loading | `animate-pulse` | 2s loop |
| Pieces in scored phase | After move evaluated | NO animation (`animationDuration={0}`) | 0 |
| Pattern-pill scroll fade | Scroll past baseline | Opacity transition | 200 ms |
| Filter-pill smooth scroll | Click | `scrollIntoView({behavior: 'smooth'})` | — |
| Milestone screens | Halfway / complete | Radial-gradient glow background | — |

---

## 12. Edge cases

- **No replays yet** → empty state ([:1446-1464](../../src/pages/TimeMachine.tsx#L1446)) explains analysis is still running or no analyzed games exist
- **Slow analysis** → spinner held until at least one analysis completes ([:596-603](../../src/pages/TimeMachine.tsx#L596))
- **Game ended before move 3** (early checkmate/stalemate) → `moveScores.length < 3`. Complete phase renders the game-over badge ([:2074-2082](../../src/pages/TimeMachine.tsx#L2074)). Total clamped to 3 for display ([:2220](../../src/pages/TimeMachine.tsx#L2220)).
- **User navigates away mid-challenge** → search params + challenge state cleared ([:1067, 2310-2316](../../src/pages/TimeMachine.tsx#L1067)). Returning via deep-link auto-starts the same position ([:1083-1100](../../src/pages/TimeMachine.tsx#L1083)).
- **Long pattern names** → `truncate` on the chip ([:3255](../../src/pages/TimeMachine.tsx#L3255))
- **Long player names** → `truncate` on the card ([:3271](../../src/pages/TimeMachine.tsx#L3271))
- **Player-color mis-stored** ([:872-899](../../src/pages/TimeMachine.tsx#L872)) → 3-tier fallback: (1) username match against `myUsername`, (2) opponent.username matches → user is in opponent record (logs ERROR), (3) stored playerColor. `[TM COLOR DEBUG]` prefix for diagnostics.
- **Hybrid Salvage row tracking** ([:825-828](../../src/pages/TimeMachine.tsx#L825)) → row resets when `rowResults.length === ROW_SIZE` ([:1375-1376](../../src/pages/TimeMachine.tsx#L1375)), variety reset on "Next row" via clearing played keys ([:1399-1400](../../src/pages/TimeMachine.tsx#L1399))
- **Multiple positions with same play count** → stable sort preserves the original `allPositions` order (pattern-frequency first) within ties

---

## 13. Accessibility

- `aria-label` on key icon-only controls: `t('tm_back')`, `t('tm_step_back')`, `t('tm_step_forward')`, `"Promote to {q|r|b|n}"`, `"Replay opponent"`, `"More info"`, `"Dismiss"`
- AI loading: `aria-busy="true" aria-live="polite"` on skeleton ([:2256](../../src/pages/TimeMachine.tsx#L2256))
- Escape closes info popovers ([:2660](../../src/pages/TimeMachine.tsx#L2660))
- Click-outside closes filter / bot-info popovers ([:2656-2658, 2964-2981](../../src/pages/TimeMachine.tsx#L2656))
- Enter submits username input in `FollowingManager` ([:3920](../../src/pages/TimeMachine.tsx#L3920))
- Modal overlays manage focus via click-outside handlers
- Promotion picker is a modal with explicit `aria-label` per piece button

---

## 14. i18n keys

### Brand / explainer
| Key | English fallback |
|---|---|
| `nav_timemachine` | Replays |
| `tm_title` | (info popup title) |
| `tm_desc` | (long description) |
| `tm_tagline` | (one-liner under title) |

### Phase labels
| Key | English fallback |
|---|---|
| `tm_leadup_rewinding` | Rewinding to move {move}… |
| `tm_find_better_move` | Find a better move |
| `tm_originally_played` | You originally played {move} |
| `tm_originally_played_by` | {name} originally played {move} |
| `tm_hint_thinking` | Thinking of a hint… |
| `tm_opponent_thinking` | Opponent thinking… |

### Move progress
| Key | English fallback |
|---|---|
| `tm_move_progress` | MOVE {n} OF {total} |
| `tm_perfect` | Perfect |
| `tm_excellent` | Excellent |
| `tm_good` | Good |
| `tm_okay` | Okay |
| `tm_keep_trying` | Keep trying |

### Action buttons
| Key | English fallback |
|---|---|
| `detail_replay` | Replay (shared with GameDetail) |
| `tm_step_back` / `tm_step_forward` | ◀ / ▶ |
| `tm_hint` | Hint |
| `tm_skip` | Skip (= "Reveal answer") |
| `tm_try_again` | Try again |
| `tm_next` | Next |
| `tm_back` | Back |

### Badges
| Key | English fallback |
|---|---|
| `tm_badge_best` | Best (🥇) |
| `tm_badge_you` | You (👤) |

### Row & milestone
| Key | English fallback |
|---|---|
| `tm_row_position` | POSITION {current} OF {total} |
| `tm_checkmate` / `tm_stalemate` / `tm_draw` / `tm_game_over` | (terminal-position labels) |

### Pattern impact
| Key | English fallback |
|---|---|
| `tm_worst_pattern_label` | WORST PATTERN |
| `tm_start_with` | Start with {pattern} |
| `tm_worst_pattern_desc_one` / `_other` | Cost {points} rating points… {count} games… |
| `tm_start_playing` | Start playing |
| `tm_replays_count` | {count} replays |
| `tm_patterns_intro` | Pattern breakdown |
| `tm_show_all_patterns` | Show all patterns |
| `tm_positions` | {count} positions |

### Filters
- `category_all`, `category_tactics`, `category_defense`, `category_openings`, `category_endgame`, `category_positional`, `category_calculation`, `category_time`, `category_resilience`

### Hardcoded (consider extracting)
- Opponent dropdown: `"Player vs Stockfish"`, `"You (White|Black)"`

---

## 15. Notable quirks (read before editing)

1. **Two different names**: route is `/timemachine`, internal hook is `useTimeMachineChallenge`, but the user-facing label is **"Replays"** (`nav_timemachine`). Don't rename one without the others.
2. **`ROW_SIZE = 6` is hardcoded** ([:3361](../../src/pages/TimeMachine.tsx#L3361)). Used for halfway-checkpoint math at 3, row-complete at 6, `RunProgress` total dots, "N of 6" displays. Changing it ripples across the file.
3. **Auto-advance on move 3 is intentional null** ([:1303-1317](../../src/pages/TimeMachine.tsx#L1303)) — moves 1–2 advance after 500 ms, move 3 stops and waits for the user to click `Next →`. Prevents users from being swept through the row without registering the result.
4. **Reveal answer plays no sound** ([:2249, 1849](../../src/pages/TimeMachine.tsx#L2249)) — user gave up, not solved it. AI explanation still loads to show the best move.
5. **Opponent vs Engine bot-mode nuance**: "Opponent" replays the actual game move while the user stays on-script, falls through to Stockfish at the opponent's rating once they deviate. "Engine" is always full-strength.
6. **Hybrid Salvage (C)** is the internal name for the current row-based design ([:1356-1358](../../src/pages/TimeMachine.tsx#L1356)) — replaced earlier category-sorting + impact-pills designs. Doc/code references to "salvage" or "hybrid" all point to this.
7. **Least-played stable sort** ([:1331-1342](../../src/pages/TimeMachine.tsx#L1331)) — within tied play counts, original pattern-frequency order is preserved (`Array.prototype.sort()` is stable in modern JS).
8. **Player-color derivation** ([:872-899](../../src/pages/TimeMachine.tsx#L872)) has ~30 console.log statements with `[TM COLOR DEBUG]` prefix — keep them; they've caught real bugs where game records were stored with user in `opponent` field.
9. **`returnTo` smart navigation** ([:2303-2317](../../src/pages/TimeMachine.tsx#L2303)) — challenge back-button always exits to wherever the user came from. GameDetail's Practice CTA sets `returnTo: '/games/:id'`; index entry leaves it null so back uses `navigate(-1)`.
10. **Play-count migration** ([:491-525](../../src/pages/TimeMachine.tsx#L491)) — legacy `checked` (boolean) keys auto-migrate to numeric `plays` on read. Both fields persist for back-compat; only `plays` is actively written.
11. **Pattern impact formula** ([:3037-3042](../../src/pages/TimeMachine.tsx#L3037)) — `impactScore = median(cp) × count × (lossRate / 100)`. Thresholds: HIGH ≥4000, MEDIUM ≥1200, LOW <1200.
12. **Focus mode is dynamic here** (unlike GameDetail). Set when challenge starts, removed when it ends ([:1230-1239](../../src/pages/TimeMachine.tsx#L1230)). Index mode keeps the bottom nav + time-class filter visible.
