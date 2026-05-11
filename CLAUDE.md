# Chess DNA Web — Project Guide

## Quick Start
```bash
npm install
npm run dev          # Vite dev server on :5173
npm run build        # tsc + vite build → dist/
npx base44 site deploy -y   # Deploy to https://chess-dna-fdd5fbde.base44.app
```

## Tech Stack
- **React 19** + React Router 7 + TypeScript 5.9 (strict)
- **Vite 7** build tool
- **Tailwind CSS 4** with custom chess theme (dark/light)
- **Base44 SDK** — backend (entities, auth, RLS)
- **Stockfish 17 WASM** — chess engine in Web Worker (singleton)
- **Recharts** — charts (radar, line, area, composed)
- **chess.js** + **react-chessboard** — PGN parsing & board UI
- **AI providers**: Claude (sonnet-4), OpenAI (gpt-4o), Gemini (2.0-flash) — with fallback routing
- **TTS**: OpenAI `/v1/audio/speech` (gpt-4o-mini-tts)

## Project Structure
```
src/
├── pages/           # 8 route pages (Overview, RecentGames, GameDetail, Patterns, Lessons, Exercises, GettingBetter, Settings)
├── components/      # UI (SkillRadar, EvalBar, EvalChart, MoveList, ThemedChessboard, MiniAudioPlayer, ChartGallery/, FriendCompare, Onboarding, AppShell)
├── contexts/        # React Context providers (Auth, ChessData, AudioPlayer)
│   └── ChessDataContext.tsx  # Core data hub — 40+ derived values (profile, tier, patterns, benchmarks)
├── hooks/           # useEntity, useAnalysisPipeline, useTTSPlayback, usePlayerRating, useResponsiveBoardSize
├── engine/          # Stockfish client, game-analyzer, analysis-pipeline, eval-classifier, phase-detector, tactical-detector
├── ai/              # AI router + Claude/OpenAI/Gemini clients, TTS, podcast, script generation, prompt builder
├── patterns/        # skill-calculator (8 dimensions), pattern-engine, rank-tiers, score-benchmarks, training-planner, windowed-profile
├── api/             # base44Client.ts (appId: 69a04516fd2be6e9fdd5fbde)
├── storage/         # settings-store, audio-session-store (IndexedDB), insight-store
├── shared/
│   ├── types/       # 9 type files: game, analysis, engine, patterns, ai, audio, podcast, storage, training
│   ├── utils/       # chess-utils, date-utils
│   └── constants.ts # All thresholds, API endpoints, depth settings
```

## Architecture

### Context Provider Nesting (App.tsx)
```
AuthProvider → ThemeProvider → ToastProvider → ChessDataProvider → AudioPlayerProvider
  ├── AppShell (layout + routes)
  ├── MiniAudioPlayer (sticky top bar)
  └── FeedbackButton (floating)
```

### Key Data Flows

**Game Analysis**: PGN → `parsePgnToGameRecord()` → Base44 Game entity → Stockfish Web Worker → `MoveAnalysis[]` → `createSnapshot()` → Pattern computation → Base44 Pattern entity → ChessDataContext refetch

**Skill Profile**: Games + Analyses + Patterns → `calculateSkillProfile()` → 8 dimensions (0-99) → weighted overall → `getTierForScore()` → Rank tier (Pawn/Knight/Bishop/Rook/Queen/King)

**Audio**: Patterns/Games → `generateSummaryAudioScript()` → `AudioScript` (speaker turns) → `generateTTSAudio()` (streaming chunks) → playback → IndexedDB persistence

### Base44 Entities
- `Game` — chess games with PGN, metadata, analysis status
- `Analysis` — move-by-move analysis (JSON stringified, deserialized client-side via `deserializeAnalysis()`)
- `Pattern` — weakness patterns (singleton per user)
- `UserPreferences` — settings (singleton)
- `Insight`, `Lesson`, `Exercise`, `TrainingPlan` — AI-generated content

RLS is server-side — no client filtering needed. Entity hooks: `useEntityList<T>()`, `useEntityById<T>()`, `useSingletonEntity<T>()` — all return `[data, loading, error, refetch]`.

### Auth
- Base44 SDK login redirect → JWT in localStorage (`base44_access_token`)
- `AuthContext` checks token; dev mode = always authenticated
- Admin: `yuval.inc@gmail.com`

## Conventions

### Styling
- **Dark theme default** — CSS vars on `[data-theme="dark"]` in `index.css`
- Tailwind custom colors: `chess-surface`, `chess-text`, `chess-accent` (green), `chess-blunder` (red), `chess-mistake` (amber), `chess-inaccuracy` (yellow), `chess-best` (green), `chess-excellent` (teal)
- Mobile-first responsive design

### Patterns
- Context + hook pattern: `FooProvider` + `useFoo()`
- Singleton Stockfish worker: `StockfishClient.getInstance()`
- AI fallback routing: tries providers in priority order (`sendWithFallback()`)
- 429 retry with exponential backoff in entity hooks
- Event-driven analysis: `analysisEvents` emitter for progress/completion
- Heavy computation wrapped in `useMemo()`

### Key Constants (from `shared/constants.ts`)
- Analysis depth: 18 (Stockfish)
- Move quality thresholds (win chance loss): best=0, excellent=0.02, good=0.05, inaccuracy=0.10, mistake=0.20
- Pattern min games: 3, default window: 50 games
- Claude model: `claude-sonnet-4-20250514`, max_tokens: 2048
- TTS: `gpt-4o-mini-tts`, $0.015/1K chars

### 8 Skill Dimensions (weights)
Openings (0.12), Tactics (0.18), Defense (0.15), Positional (0.13), Endgame (0.13), Calculation (0.15), Time Management (0.10), Resilience (0.07)

### 6 Rank Tiers
Pawn (0-29), Knight (30-44), Bishop (45-59), Rook (60-74), Queen (75-89), King (90-99)

## Environment Variables
```
VITE_FALLBACK_CLAUDE_KEY   # Shared beta Claude API key
VITE_FALLBACK_OPENAI_KEY   # Shared beta OpenAI API key
```

## Critical Files (extra caution required)
These files are complex, widely depended on, and easy to break:
- `src/contexts/ChessDataContext.tsx` — core data hub, 40+ derived values, event listeners with refs. **All hooks must come before early returns.**
- `src/pages/GameDetail.tsx` — complex hook ordering. **All useState/useEffect/useMemo/useCallback MUST be before any conditional returns** (React error #300/#310).
- `src/engine/stockfish-client.ts` — singleton WASM worker. Breaking this breaks all analysis.
- `src/patterns/skill-calculator.ts` — profile computation with fallback logic for broken game-analysis joins.
- `src/shared/constants.ts` — all thresholds; changing values has cascading effects across the app.
- `src/hooks/useEntity.ts` — Base44 entity hooks with guest/auth branching. Hook count must stay stable.

## Do NOT
- Do not use `any` type — define proper interfaces in `src/shared/types/`
- Do not add new npm dependencies without discussing first
- Do not modify Base44 entity schemas — Base44 silently drops unknown fields
- Do not put React hooks after conditional `return` statements — causes React error #300
- Do not use `tsc -b` exit code to determine build success — it has incremental cache bugs; check for `dist/` output instead
- Do not filter entities by `created_by_id` server-side — legacy records don't have this field
- Do not call `runBatchAnalysis` directly — always use `queueForAnalysis()` from ChessDataContext
- Do not use CSS custom properties (`var(--chess-*)`) in share card components — html2canvas can't resolve them; use `SHARE_COLORS` constants
- Do not assume `entity.list()` returns all records — Base44 has a 5000-record limit

## Build & Deploy
```bash
npm run build          # tsc -b && vite build
npx base44 site deploy -y   # Deploy dist/ to production
```
- Build MUST succeed with no TypeScript errors before deploying
- Verify the `dist/assets/index-*.js` filename changes after build (content hash)
- After deploy, clear browser cache to verify new bundle loads (check filename in DevTools network tab)

### ⚠️ NEVER deploy from a worktree
**Deploys MUST run from `/Users/yuval/Chess-dna` (main checkout), not from `.claude/worktrees/*`.**

The main checkout almost always has uncommitted in-progress work that production already includes. A worktree sits at a clean commit and DOES NOT include those changes — building+deploying from a worktree ships a bundle that's *missing the in-progress work*, wiping it from production. This has happened twice (2026-05-11/12) — once from `gallant-faraday-6a27fb`, once from `nifty-payne-ca6170` — both wiped the WaitlistGate / new nav / new radar.

If you're in a worktree (`pwd` contains `.claude/worktrees/`):
1. **Do not run `npx base44 site deploy`.** Apply your changes to `/Users/yuval/Chess-dna/...` first.
2. **Check main is in sync**: `git -C /Users/yuval/Chess-dna status --porcelain | wc -l`. If nonzero, main has uncommitted work the worktree doesn't see — your worktree's `dist/` is NOT a valid deploy artifact.
3. Then `cd /Users/yuval/Chess-dna && npm run build && npx base44 site deploy -y`.

The `prebuild` npm script enforces this — it aborts the build when run from a worktree while main has uncommitted changes. Do NOT bypass it.

## Notable Details
- No `User` entity in Base44 — `auth.me()` may 401 but token still works for CRUD
- Streaming TTS: chunks play as they arrive (don't wait for full synthesis)
- Opponent strength adjustment: skill scores adjust vs 1200 baseline
- Analysis batching: `isBatchMode()` prevents incremental re-renders during bulk import
- Stockfish validates AI-generated exercises (depth 16, 50cp tolerance)
- Journey stages: onboarding progression (0=no games → 5=fully onboarded)
- Fallback API keys from env vars let users try the app without setting personal keys
- Audio sessions persist to IndexedDB (survives page reload)
- `[Chess DNA]` / `[Chess Tutor]` console log prefixes for debugging
- Game deduplication: `allGames` memo prefers game copies that have matching Analysis records
- Share card rendering: overlays use inline styles with hardcoded hex colors, not Tailwind
