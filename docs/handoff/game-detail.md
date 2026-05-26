# Handoff Spec: GameDetail page

Route: `/games/:gameId`  ·  File: [src/pages/GameDetail.tsx](../../src/pages/GameDetail.tsx) (2,104 lines)
Shared tokens: [_design-tokens.md](./_design-tokens.md)
Sets **focus mode** on mount → hides bottom nav and floating time-class filter; locks viewport on mobile

---

## 1. Overview

Per-game review screen: board, evaluation bar, move list, key moments, opening patterns, AI commentary. Built around `MoveAnalysis[]` produced by the analysis pipeline (Stockfish 17 WASM, depth 18).

**Entry points**
| From | URL pattern |
|---|---|
| `/games` list | `/games/:gameId` |
| Overview "Replay your mistakes" → into a flagged game | `/games/:gameId?move=N` (resolves by `moveNumber + playerColor`, [GameDetail.tsx:87-99](../../src/pages/GameDetail.tsx#L87)) |
| Patterns flow → trap deep link | `/games/:gameId?trap=<trapId>` (auto-selects trap in Patterns tab, [GameDetail.tsx:519-530](../../src/pages/GameDetail.tsx#L519)) |

**Loading / error**
- `gameLoading || analysisLoading` → spinner ([:1003-1010](../../src/pages/GameDetail.tsx#L1003))
- `!game` → "Not found" + back ([:1012-1021](../../src/pages/GameDetail.tsx#L1012))
- `game.analysisStatus === 'analyzing'` → "Analyzing" with `animate-pulse` ([:1272-1275](../../src/pages/GameDetail.tsx#L1272))

⚠️ **Hook ordering** ([CLAUDE.md](../../CLAUDE.md)): all `useState/useEffect/useMemo/useCallback` MUST precede the conditional `return` blocks (~line 1003). Adding a hook below those returns will throw React error #300/#310.

---

## 2. Layout

### Mobile (< md)
```
┌────────────────────────────────────────┐
│ [Floating ← back btn]  (header hidden  │
│                         when inMoveView)│
├────────────────────────────────────────┤
│ ┌────────────────────────┐ ┌───┐       │  Board edge-to-edge
│ │   ThemedChessboard     │ │Ev │       │  (ml-[calc(50%-50vw)]
│ │   (full bleed)         │ │Bar│       │   trick)
│ └────────────────────────┘ └───┘       │
├────────────────────────────────────────┤
│  AI insight panel (flex-1, scrolls)    │  height = 100dvh
│                                        │           - boardWidth
│                                        │           - headerReserve
├────────────────────────────────────────┤
│  ─ Dock (fixed bottom, pt-2, pb-safe)─ │
│  [Stats] [Key Moments] [Patterns] tabs │
│  Chip gallery (horizontal scroll)      │
│  ◄◄  ◄  Move list (h-scroll)  ►  ►►   │
└────────────────────────────────────────┘
```

### Desktop (≥ md)
```
┌──────────────────────────────────────────────────────────────────┐
│ Header: ← Back  |  vs Opponent (avatar) · Win · ECO · Termination│
├──────────────────────────────────────────────────────────────────┤
│ ┌────────────────┐  ┌────────────────────────┐                   │
│ │ Sidebar (2fr)  │  │ Board area (3fr)       │                   │
│ │  ─ Insights ─  │  │  ┌────────────┐ ┌─┐    │  flex gap-14      │
│ │   tabs (vert)  │  │  │   Board    │ │E│    │  md:items-stretch │
│ │  Chip rail     │  │  │            │ │v│    │                   │
│ │  ─ MoveInsight │  │  └────────────┘ └─┘    │                   │
│ │    Panel ─     │  │  AI ExplanationText    │                   │
│ │  (always       │  │   (under board)        │                   │
│ │   rendered)    │  │                        │                   │
│ │  ─ mt-auto ─   │  │                        │                   │
│ │  Practice CTA  │  │                        │                   │
│ │  Compare CTA   │  │                        │                   │
│ │  Share CTA     │  │                        │                   │
│ └────────────────┘  └────────────────────────┘                   │
└──────────────────────────────────────────────────────────────────┘
```

Mobile-only 3-column CTA grid (Practice / Compare / Share) below the board area: `grid grid-cols-3 md:hidden` ([:1556](../../src/pages/GameDetail.tsx#L1556)).

---

## 3. Focus mode (this page sets it)

```js
document.body.setAttribute('data-focus-mode', 'true')  // on mount
document.body.removeAttribute('data-focus-mode')        // on unmount
```
([:705-707](../../src/pages/GameDetail.tsx#L705))

### CSS effects ([index.css:219-273](../../src/index.css#L219))
- Hides `.app-bottom-nav` (translateY 110%, 0.2s ease-out)
- Hides `.app-time-filter` (opacity → 0, 0.2s)
- **Mobile only** (≤767px):
  - `html`/`body` locked to `100dvh`, no scroll
  - `<main>` loses padding, height = `100dvh`
  - Inline brand wordmark hidden
  - Mobile 3-CTA grid + DataAttribution footer hidden (the dock subsumes them)

Desktop: only the chrome hides; layout keeps its normal flex flow.

---

## 4. Design tokens

See [_design-tokens.md](./_design-tokens.md) for the full palette.

| Token | Where | Purpose |
|---|---|---|
| `chess-accent` | Loading spinner, back-button highlight, eval bar tick, primary CTA fills | Brand action color |
| `chess-text` / `-secondary` / `-tertiary` | Body / labels / metadata | Hierarchy |
| `chess-best` | Best-move quality pills, sometimes board overlays | "Best" move |
| `chess-excellent` | "Excellent" quality pill | |
| `chess-blunder` | Blunder pills, key-moment severity HIGH, MISS badges, CHECKMATE banner | Red severity |
| `chess-mistake` | Mistake pills, severity MEDIUM | Amber |
| `chess-inaccuracy` | Inaccuracy pills, severity LOW, analyzing-pulse text | Yellow |
| `chess-light` / `chess-dark` | Board square colors | (passed via ThemedChessboard) |

### Hardcoded values
| Value | Where | Purpose |
|---|---|---|
| `#1baca6` (teal) | "Brilliant" quality color ([:1686](../../src/pages/GameDetail.tsx#L1686)) | Top tier move |
| `#5c8bb0` (steel) | "Great" quality color ([:1687](../../src/pages/GameDetail.tsx#L1687)) | |
| `rgba(255,170,0,0.85)` | Orange "played move" arrow ([:877](../../src/pages/GameDetail.tsx#L877)) | Board overlay |
| `rgba(74,222,128,0.7)` | Green "best move" arrow ([:888](../../src/pages/GameDetail.tsx#L888)) | Board overlay |
| `rgba(239,68,68,...)` | Mate flourish — loser radial gradient | Checkmate ([:1346-1365](../../src/pages/GameDetail.tsx#L1346)) |
| `rgba(74,222,128,...)` | Mate flourish — winner radial gradient | Same |
| `#ef4444` | "CHECKMATE" banner text ([:1379](../../src/pages/GameDetail.tsx#L1379)) | |

### Animations
| Class / keyframe | Where | Trigger |
|---|---|---|
| `animate-spin` | Loading spinner ([:1006](../../src/pages/GameDetail.tsx#L1006)) | Initial load |
| `animate-pulse` | Analyzing label, skeleton bars ([:1274, 1770, 2071-2079](../../src/pages/GameDetail.tsx#L1274)) | Mid-analysis / streaming wait |
| `mate-pulse` (inline `style`, defined in [index.css:200](../../src/index.css#L200)) | Both mate-flourish gradients ([:1353, 1363](../../src/pages/GameDetail.tsx#L1353)) | Checkmate position |
| `transition-all duration-300 ease-out` | EvalBar segment height | Move change |

No framer-motion in this file. Move-change animation uses `animatingFen` state ([:666-678](../../src/pages/GameDetail.tsx#L666)) — sets the board to the `fenBefore`, then clears after 100 ms, letting react-chessboard's piece tween handle the rest.

---

## 5. Components

| Component | File | Key props | Notes |
|---|---|---|---|
| `ThemedChessboard` | `src/components/ThemedChessboard.tsx` | `position`, `boardOrientation`, `boardWidth`, `arePiecesDraggable`, `isDraggablePiece`, `onPieceDrop`, `customArrows`, `customSquareStyles` | Wraps `react-chessboard`. Memoize `customSquareStyles` outside `useMemo` to avoid square-diff thrash. |
| `EvalBar` | `src/components/EvalBar.tsx` | `score` (cp), `scoreType` (`'cp' \| 'mate'`), `height` | Vertical white/black bar, exported as `memo` |
| `MoveList` | `src/components/MoveList.tsx` | `moves`, `currentMoveIndex` (deferred), `onMoveClick` | Auto-scrolls active move into view; exported as `memo` |
| `ExplanationText` | `src/components/ExplanationText.tsx` | `text`, `onSquareClick`, `onTabChange`, `isBestMove` | Parses `THEMES:` prefix, renders `ThemeChip`s inline; tabbed view |
| `ThemeChip` | `src/components/ThemeChip.tsx` | `slug`, `size` (`'sm' \| 'md'`) | Inline theme badges |
| `MoveInsightPanel` | local ([:1916](../../src/pages/GameDetail.tsx#L1916)) | `move`, `aiExplanation`, `aiExplanationLoading`, `hasCommentary`, `onSquareClick`, `onTabChange` | Always rendered on desktop (layout stability); only when `!playFen && currentMove` on mobile |
| `PracticeCoachPanel` | local ([:1726](../../src/pages/GameDetail.tsx#L1726)) | `trapId`, `trapHintSan`, `lastUserMove`, `showFeedback`, `onToggleFeedback`, `botMode`, `onSetBotMode`, `isBotThinking`, `onExit` | Shown only when user is mid-`playFen` (drag-to-play active) |
| `AccuracyRing` | local ([:1608](../../src/pages/GameDetail.tsx#L1608)) | `accuracy` (0–100), `size` | Circular SVG ring with % label; stats tab |
| `PhaseBar` | local ([:1630](../../src/pages/GameDetail.tsx#L1630)) | `phases` (`{opening, middlegame, endgame}`) | 3-segment accuracy bar |
| `KeyMomentCard` | local ([:1670](../../src/pages/GameDetail.tsx#L1670)) | `moment`, `onClick`, `isActive`, `tutorialTargetId` | h-scroll on mobile, vertical on desktop |
| `ShareComposer` | `src/components/share/ShareComposer.tsx` | `isOpen`, `onClose`, `game`, `summary`, `move`, `allMoves`, `profile` | Modal — game / move / sequence share cards |
| `PlayerAvatar` | `src/components/PlayerAvatar.tsx` | `username`, `size` | 34px header avatar |
| `DataAttribution` | `src/components/PlatformBadge.tsx` | — | "Powered by …" footer (hidden in mobile focus mode) |

---

## 6. Interactions

### Move navigation
- Arrow keys: ← / ↑ = previous, → / ↓ = next, Home = move 0, End = final ([:105-121](../../src/pages/GameDetail.tsx#L105))
- Dock arrows: ◄◄ ◄ ► ►► — disabled at boundaries ([:1442-1478](../../src/pages/GameDetail.tsx#L1442))
- Click move in `MoveList` → `onMoveClick(index)`
- Click `KeyMomentCard` → `jumpToMoveWithAnimation(moveIndex)`
- Click pattern chip → same jump function

All paths funnel through `setCurrentMoveIndex` / `jumpToMoveWithAnimation` (the latter triggers the `animatingFen` mid-frame).

### Board (play mode)
- Drag piece → `handlePieceDrop(from, to)` ([:1337](../../src/pages/GameDetail.tsx#L1337))
  - If user's piece + their turn → enters play mode, sets `playFen`
  - Applies move client-side, plays sound, triggers bot reply
- Bot reply mode (`botMode`): `'engine'` (Stockfish) or `'opponent'` (replay opponent's actual move; falls through to Stockfish-at-opponent-rating if user deviates)
- Feedback (`showFeedback`): runs an extra depth-12 Stockfish eval in parallel on each user move; persisted in localStorage ([:217-223](../../src/pages/GameDetail.tsx#L217))

### Audio
- Move sound plays on every scrub via `useEffect` ([:609-631](../../src/pages/GameDetail.tsx#L609))
- Sound chosen by `pickMoveSound(san, flags, isUserMove)` ([:594](../../src/pages/GameDetail.tsx#L594))
- Wrapped in try/catch — audio context may be locked before first user gesture; failures swallowed

### Tab switching (insight panel)
- `handleTabSwitch('stats' | 'moments' | 'patterns')` ([:951](../../src/pages/GameDetail.tsx#L951))
- Saves/restores last-viewed move index per tab so you can hop between Patterns and Key Moments without losing your place

### CTAs
- **Practice** → `navigate('/timemachine')` with game filter + `returnTo` state (TimeMachine reads this and routes back here on exit)
- **Compare** → `navigate('/compare')` with opponent username
- **Share** → opens `ShareComposer` modal at the current move

---

## 7. States

| State | Trigger | Render |
|---|---|---|
| Loading | `gameLoading \|\| analysisLoading` | Spinner + `t('detail_loading')` |
| Not found | `!game` | "Not found" message + `← Go back` |
| No analysis | analysis missing AND not currently analyzing | Card + `Analyze now` CTA |
| Analyzing | `game.analysisStatus === 'analyzing'` | Yellow `animate-pulse` "Analyzing" text |
| Streaming AI | `aiExplanationLoading === true` after first stream delta | Skeleton bars `animate-pulse`; text replaces skeleton once delta arrives ([:839, 2086](../../src/pages/GameDetail.tsx#L839)) |
| Checkmate | `mateFlourish` truthy (FEN check + SAN ends with `#` or mate-in-0 eval) | Two radial gradients (red loser, green winner), `mate-pulse` 1.4s + `CHECKMATE` banner |
| Empty key moments | `!hasKeyMoments` | Moments tab not rendered ([:1058](../../src/pages/GameDetail.tsx#L1058)); insights default to patterns or stats |
| Move boundary | `currentMoveIndex` at 0 or N-1 | Nav arrows disabled |
| Bot thinking | `isBotThinking` | Pieces not draggable ([:1323](../../src/pages/GameDetail.tsx#L1323)) |
| Focus mode | Always on this page | Bottom nav + top-right filter hidden; mobile locks viewport |

---

## 8. Responsive

Breakpoint: `md:` (768px). Many critical layout flips.

| Element | Mobile | Desktop |
|---|---|---|
| Header | Hidden when `inMoveView` (just a floating back button) | Always shown |
| Board | Full-bleed (`w-screen` + `ml-[calc(50%-50vw)]`) | Centered in 3fr column, sized by `useResponsiveBoardSize(700)` and clamped against viewport+dock |
| Insight tabs + chips | Horizontal scroll inside the dock | Vertical stack in sidebar (`md:flex-col md:overflow-y-auto md:max-h-[195px]`) |
| Move list | In the dock with nav arrows around it | Inside `MoveInsightPanel` (sidebar) |
| Move-insight panel | Mobile: only when `!playFen && currentMove` | Desktop: always rendered (layout stability) |
| CTAs | 3-column grid `grid-cols-3 md:hidden` ([:1556](../../src/pages/GameDetail.tsx#L1556)) | Sidebar bottom, pinned with `mt-auto` |
| Mate flourish | Spans the board area | Spans the board area (same) |

**Board sizing**: `useResponsiveBoardSize(700)` returns a container width. Final width = `Math.max(safeBoardWidth, 200)`, where `safeBoardWidth` accounts for the eval bar + a viewport cap. On mobile in focus mode, the cap is `viewportHeight - (headerReserve + 80 + dockHeight + 24 + 8)` so nothing overflows.

---

## 9. Edge cases

- **100+ move games**: `MoveList` is horizontally scrollable on mobile, vertically (`md:max-h-[195px]`) on desktop; auto-scrolls active move into view
- **Long player names**: header `truncate` ([:1233, 1245](../../src/pages/GameDetail.tsx#L1233))
- **Missing PGN headers**: opening falls back to `t('common_unknown_opening')`, termination silently skipped
- **No blunders in game**: `keyMoments = []`, Moments tab is omitted, insights default to patterns/stats
- **AI stream failure**: caught silently (`AbortError` ignored), loading flag clears, panel shows skeleton or "no commentary" state. Error logged with `[GameDetail]` prefix
- **Audio locked**: every `playChessSound()` is try/catch — no console errors before first gesture
- **Deep-link with bad `move=`**: resolution math fails → defaults to move 0
- **Stale bot reply** (user navigates away mid-think): `playSessionRef.current` is bumped on every reset; stale resolvers compare against current session token and bail ([:237-238, 389, 402, 454, 475](../../src/pages/GameDetail.tsx#L237))

---

## 10. Motion

| Element | Trigger | Animation | Duration | Easing |
|---|---|---|---|---|
| Loading spinner | Initial mount | `animate-spin` | 1s | linear |
| Analyzing label | `analysisStatus === 'analyzing'` | `animate-pulse` | 2s | ease-in-out |
| AI skeleton bars | `aiExplanationLoading` | `animate-pulse` | 2s | ease-in-out |
| Eval bar | Move change | Height transition | 300 ms | ease-out |
| Board move | Scrub / next / prev | `animatingFen` mid-frame swap + react-chessboard piece tween | ~200 ms | (chessboard default) |
| Checkmate flourish | Mate position | `mate-pulse` (radial gradients fade in/out at 50%) | 1.4s loop | ease-in-out |

No `prefers-reduced-motion` handling.

---

## 11. Accessibility

- `aria-label` on every icon-only control: `"Back"`, `"Jump to start"`, `"Previous move"`, `"Next move"`, `"Jump to end"`, `"Exit practice mode"`
- AI streaming skeleton: `aria-busy="true" aria-live="polite"`, `<span class="sr-only">{t('common_loading')}</span>`
- Decorative SVGs: `aria-hidden`
- Keyboard:
  - Arrow keys / Home / End for move navigation
  - All buttons reachable via Tab; standard `<button>` semantics
- **Not handled**: chess-square ARIA labels (react-chessboard limitation). The MoveList provides text equivalents.

---

## 12. i18n keys (visible copy)

| Key | Used at | English fallback |
|---|---|---|
| `detail_loading` | Spinner | Loading… |
| `detail_not_found` | Not-found state | (message) |
| `detail_go_back` | Not-found CTA | ← Go back |
| `detail_stats` / `detail_key_moments` / `detail_patterns` | Insight tabs | Stats / Key Moments / Patterns |
| `detail_analyzing` | Mid-analysis pulse | Analyzing… |
| `detail_not_analyzed` | Empty analysis | No analysis yet |
| `detail_analyze_now` | Analyze CTA | Analyze now |
| `detail_show_board` | Mobile board toggle | ♟ Show board |
| `detail_practice_cta` / `detail_practice_sub` | Practice CTA | Practice / mistakes |
| `detail_compare` / `detail_compare_sub` | Compare CTA | Compare / vs. {opponent} |
| `detail_share` / `detail_share_sub` | Share CTA | Share / Create card |
| `detail_replay` | Replay button (also used in TimeMachine) | Replay |
| `detail_move_n` | Move number badge | #{n} |
| `detail_best_label` | Best-move label | Best: |
| `detail_severity_high/medium/low` | Severity pills | High / Medium / Low |
| `quality_*` | Move quality | brilliant, great, best, excellent, good, book, forced, inaccuracy, mistake, miss, blunder |
| `phase_opening` / `phase_middlegame` / `phase_endgame` | Phase bars | Opening / Middlegame / Endgame |
| `result_win_full` / `result_loss_full` / `result_draw_full` | Result badge | Win / Loss / Draw |
| `pattern_*` | Pattern themes | (per slug) |
| `game_term_*` | Termination labels | Checkmate / Stalemate / etc. |
| `common_unknown_opening` | Header fallback | Unknown Opening |
| `common_loading` | sr-only fallback | Loading… |

### Hardcoded strings (consider extracting)
- `"Trap"` ([:1122](../../src/pages/GameDetail.tsx#L1122))
- `"Use"` / `"Missed"` ([:1107](../../src/pages/GameDetail.tsx#L1107))
- `"Practicing"` ([:1792](../../src/pages/GameDetail.tsx#L1792))
- `"Your move"` ([:1806](../../src/pages/GameDetail.tsx#L1806))
- `"Engine"` / `"Opponent"` ([:1774-1775](../../src/pages/GameDetail.tsx#L1774))
- `"Feedback on/off"` ([:1783](../../src/pages/GameDetail.tsx#L1783))
- `"CHECKMATE"` ([:1379](../../src/pages/GameDetail.tsx#L1379))
- `"No commentary — AI explanations appear on key moments & pattern moves."` ([:2063](../../src/pages/GameDetail.tsx#L2063))

---

## 13. Notable quirks

1. **Hook ordering**: ⚠️ all hooks above the early returns near `:1003`. Adding `useState` below those returns will throw React error #300/#310. CLAUDE.md flags this file specifically.
2. **Focus mode is unconditional** on this page. There is no opt-out for users; the bottom nav and time-class filter are always hidden here.
3. **Two AI-explanation caches**: in-memory `Map` per session ([:541](../../src/pages/GameDetail.tsx#L541)) plus localStorage ([:731-738](../../src/pages/GameDetail.tsx#L731)). Both checked before billing the AI API. Cache keys are derived per `(gameId, moveIndex)`.
4. **Play session token** (`playSessionRef`): bumped on every play-mode reset. Bot reply promises check against it and bail if stale. Without this, navigating away mid-thought can land an old bot move on the wrong position.
5. **Console prefix `[GameDetail]`** on every warn/error log — searchable in DevTools.
6. **Move-change "animation"** isn't CSS — it's a state swap: `animatingFen = move.fenBefore` for 100 ms, then clears. React-chessboard's own piece tween does the rest.
7. **Arrow colors are hardcoded** (orange `rgba(255,170,0,0.85)`, green `rgba(74,222,128,0.7)`) — not tokenized. Don't substitute `chess-*` without checking the visual on board overlays.
8. **`customSquareStyles` memoization**: critical. Without `useMemo` ([:897](../../src/pages/GameDetail.tsx#L897)), react-chessboard diffs every square every render and the board feels janky.
9. **Share cards must use hardcoded hex** (not `chess-*` CSS vars): html2canvas can't resolve CSS custom properties, so `src/components/share/*` overlays use the `SHARE_COLORS` constant. This is enforced in CLAUDE.md.
10. **Trap deep-link** uses `useRef` to dedupe ([:519-530](../../src/pages/GameDetail.tsx#L519)) so the auto-select runs once even if the user navigates the URL bar back to the same `?trap=` value.
