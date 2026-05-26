/**
 * Centralized data context for the Chess DNA app.
 *
 * Fetches core entities (Game, Analysis, Pattern) once and provides
 * derived values (profile, counts, tier, benchmarks, journey stage)
 * to all consumers. Eliminates duplicate fetches across 7+ components.
 */
import { createContext, useContext, useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useSmartEntityList, useSmartSingletonEntity } from '@/hooks/useEntity';
import { useTheme } from '@/components/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { analysisEvents, isBatchMode, setBatchMode } from '@/engine/analysis-events';
import { deserializeAnalysis, deserializePattern, runBatchAnalysis } from '@/engine/analysis-pipeline';
import { calculateSkillProfile, getWeakestDimensions, getStrongestDimensions } from '@/patterns/skill-calculator';
import { getTierForScore, getTierProgress, getNextTier } from '@/patterns/rank-tiers';
import { getBenchmarkForRating, getOverallPercentile, getLeadersBenchmark } from '@/patterns/score-benchmarks';
import { hasAnyProvider } from '@/ai/ai-router';
import { useChessComSync } from '@/hooks/useChessComSync';
import { cleanupDuplicates } from '@/utils/db-cleanup';
import { importChessComGames } from '@/api/chess-com-import';
import { CHESS_COM_API_BASE } from '@shared/constants';
import { fetchChessCom } from '@/api/chess-com-fetch';
import { base44 } from '@/api/base44Client';
import type { GameRecord, TimeClass } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { CurrentPatterns, SkillProfile, SkillDimension, RankTier, TrapStats } from '@shared/types/patterns';
import { computeTrapStats } from '@/patterns/trap-detector';
import type { JourneyStage } from '@/components/Onboarding';

// ── Shared default for the Pattern singleton ──
export const DEFAULT_PATTERNS: CurrentPatterns & Record<string, unknown> = {
  patterns: [],
  lastUpdated: 0,
  gamesInWindow: 0,
};

// ── Context value type ──
interface ChessDataContextValue {
  // Raw entity data
  allGames: GameRecord[];
  allAnalyses: GameAnalysis[];
  patterns: CurrentPatterns;

  // Loading states
  gamesLoading: boolean;
  analysesLoading: boolean;
  // True until the FULL analyses batch lands. `analysesLoading` flips false as
  // soon as the 30-game progressive batch arrives, which makes derived state
  // (radar, profile) flicker through a partial value before the full set
  // lands. Consumers that want to avoid that flicker should wait on this.
  fullAnalysesLoading: boolean;
  patternsLoading: boolean;
  dataLoading: boolean;

  // Game counts (from ALL games, ignoring time-class filter)
  totalGameCount: number;
  analyzedCount: number;
  analyzingCount: number;
  pendingCount: number;

  // Lookups
  gamesMap: Record<string, GameRecord>;
  availableTimeClasses: Set<TimeClass>;

  // Friends & top players — non-self games imported for the Time Machine
  // "Friends" / "Top Players" tabs. Filtered from rawGames by username so
  // they don't pollute the user's own profile/patterns.
  friendGames: GameRecord[];
  friendAnalyses: GameAnalysis[];
  topPlayerGames: GameRecord[];
  topPlayerAnalyses: GameAnalysis[];

  // Filtered by settings.selectedTimeClass
  games: GameRecord[];
  analyses: GameAnalysis[];
  filteredAnalyzedCount: number;
  filteredAnalyzingCount: number;

  // Opening-trap stats — Used (player set) vs FellInto (opponent set)
  trapStats: TrapStats;

  // Profile (computed from filtered games)
  profile: SkillProfile;
  weakest: SkillDimension[];
  strongest: SkillDimension[];
  playerElo: number;

  // Tier
  tier: RankTier;
  tierProgress: number;
  nextTier: RankTier | null;

  // Benchmarks
  benchmark: Record<string, number>;
  leadersBenchmark: Record<string, number>;
  overallPercentile: number;

  // Journey stage
  journeyStage: JourneyStage;
  hasPatterns: boolean;
  hasAI: boolean;
  patternsUnlocked: boolean;

  // Sync
  isSyncing: boolean;
  lastSyncAt: number | null;
  lastSyncNewGames: number;
  syncError: string | null;
  /** `force: true` skips the sinceMs watermark, hitting chess.com fresh.
      Use for user-initiated syncs (pull-to-refresh, refresh button) so
      back-to-back invocations actually re-check. */
  syncNow: (opts?: { force?: boolean }) => void;

  // Live analysis queue + per-game progress.  Consumers use these to
  // show per-row state ("Up next", "#3 in queue", "Analyzing 12/45 moves",
  // "Moved to top") without each row having to subscribe to the bus
  // directly.  `analysisQueueIds` is the FIFO order of games still
  // waiting; `analyzingNow` is the one currently being crunched; and
  // `recentlyPromotedIds` flags games the user just bumped to the front
  // so the row can briefly pulse.
  analysisQueueIds: string[];
  analyzingNow: { gameId: string; current: number; total: number } | null;
  recentlyPromotedIds: Set<string>;

  // Refetch
  refetchGames: () => void;
  refetchAnalyses: () => void;
  refetchPatterns: () => void;
  refetchAll: () => void;

  // Analysis queue — push game IDs here instead of calling runBatchAnalysis directly
  queueForAnalysis: (gameIds: string[], opts?: { priority?: 'normal' | 'high' }) => void;

  // Stable accessor for stored games by player username. Uses a ref so callers
  // can read the *current* rawGames from inside an async closure without
  // re-render staleness — needed by the Follow flow, where the click handler
  // captures dataSrc before settings update and can't see freshly imported
  // top-player/friend games via the username-filtered lists.
  getStoredGameIdsByUsername: (username: string) => string[];
}

// ── Fallback profile for default context ──
const EMPTY_PROFILE: SkillProfile = {
  dimensions: [],
  overallRating: 0,
  calculatedAt: 0,
  gamesUsed: 0,
};

const EMPTY_TIER = getTierForScore(0);

const ChessDataContext = createContext<ChessDataContextValue>({
  allGames: [],
  allAnalyses: [],
  patterns: DEFAULT_PATTERNS,
  gamesLoading: true,
  analysesLoading: true,
  fullAnalysesLoading: true,
  patternsLoading: true,
  dataLoading: true,
  totalGameCount: 0,
  analyzedCount: 0,
  analyzingCount: 0,
  pendingCount: 0,
  gamesMap: {},
  availableTimeClasses: new Set(),
  friendGames: [],
  friendAnalyses: [],
  topPlayerGames: [],
  topPlayerAnalyses: [],
  games: [],
  analyses: [],
  filteredAnalyzedCount: 0,
  filteredAnalyzingCount: 0,
  trapStats: { used: [], fellInto: [], gamesScanned: 0 },
  profile: EMPTY_PROFILE,
  weakest: [],
  strongest: [],
  playerElo: 1200,
  tier: EMPTY_TIER,
  tierProgress: 0,
  nextTier: null,
  benchmark: {},
  leadersBenchmark: {},
  overallPercentile: 50,
  journeyStage: 0,
  hasPatterns: false,
  hasAI: false,
  patternsUnlocked: false,
  isSyncing: false,
  lastSyncAt: null,
  lastSyncNewGames: 0,
  syncError: null,
  syncNow: () => {},
  analysisQueueIds: [],
  analyzingNow: null,
  recentlyPromotedIds: new Set(),
  refetchGames: () => {},
  refetchAnalyses: () => {},
  refetchPatterns: () => {},
  refetchAll: () => {},
  queueForAnalysis: () => {},
  getStoredGameIdsByUsername: () => [],
});

// ── Provider ──
export function ChessDataProvider({ children }: { children: React.ReactNode }) {
  const { settings, updateSettings } = useTheme();
  const { userId, isGuest, isAuthenticated, authResolved, isAdmin } = useAuth();

  // Smart hooks: use localStorage for guests, Base44 for authenticated users.
  // Auth-awareness is built into the hooks — no manual skip logic needed.
  // NOTE: Data isolation relies on the configuredUsername filter below (line ~270)
  // which scopes games by chess.com username. Base44 RLS should also handle this
  // server-side. A created_by_id filter was removed because legacy games don't
  // have that field set, causing them to be silently dropped.
  // Cap at the most-recent 250 games / analyses so first paint stays fast
  // even for users with thousands of imported games. Server-side sort by
  // playedAt (descending) means the freshest data lands first; older games
  // simply don't get pulled into the client.
  // Per-user cache keys: the JWT userId is decoded synchronously in
  // AuthContext, so on a returning user's first paint we rehydrate
  // games/analyses from localStorage before the Base44 fetch even fires.
  // Network refetch still runs in the background and swaps in fresh data.
  const gamesCacheKey = userId ? `list-cache-Game-${userId}` : undefined;
  // One-shot: drop orphaned `list-cache-Analysis-*` keys from a brief
  // window where the Analysis fetch was cached too. Caching analyses didn't
  // work — they exceed the localStorage quota, partial writes produced a
  // broken UI (DNA defaults, games stuck "pending"), so caching was pulled.
  // The keys are dead weight that can push other writes (settings,
  // follow list) past the quota — clear them once on mount.
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      const stale = Object.keys(localStorage).filter((k) => k.startsWith('list-cache-Analysis-'));
      for (const k of stale) localStorage.removeItem(k);
    } catch { /* noop */ }
  }, []);
  // Limit rationale:
  //  • Regular users: RLS scopes the response to their own records, so a 250
  //    limit naturally returns up to 250 of their most-recent games.
  //  • Admin (yuval.inc): RLS is bypassed and the fetch sees every user's
  //    rows. To avoid the admin's own games getting crowded out by other
  //    users' recent activity, we widen the network limit — but cap it
  //    *much lower* than before. The previous 2500 cap meant ~10s fetch
  //    times + ~75 MB of JS memory (250 records × 50 stringified moves
  //    each), which made admin reload feel like the app crashed. 800
  //    still pulls plenty of admin's own recent games (admin plays
  //    daily) while cutting the payload ~3× — and the page rehydrates
  //    from the cached profile / radar regardless.
  const fetchLimit = isAdmin === true ? 800 : 250;
  // PGN strings are the heaviest field on a Game record (~5 KB each) —
  // replacing them with a length-bearing sentinel before persisting to
  // localStorage lets us fit all 250 most-recent games in the cache
  // instead of getting truncated to 100 by the quota-fallback. PGN
  // isn't used in the games list view; the game-detail page re-fetches
  // the full record by id when opened.
  //
  // CRITICAL: the ghost-record filter in `allGames` rejects records
  // whose pgn is missing or < 10 chars. The sentinel below is 24 chars
  // so cached rehydrated records pass validation — without this, an
  // entire cached set is treated as ghosts on the next mount,
  // `totalGameCount` collapses to 0, and the journey stage falls back
  // to onboarding (S0) even for fully-onboarded returning users.
  const PGN_CACHE_SENTINEL = '[CACHED:PGN_AVAILABLE]';
  const stripGameForCache = useCallback(
    (g: GameRecord): GameRecord => ({ ...g, pgn: PGN_CACHE_SENTINEL }),
    [],
  );
  const [rawGames, gamesLoading, , refetchGames] = useSmartEntityList<GameRecord>(
    'Game',
    undefined,
    undefined,
    undefined,
    { sort: '-playedAt', limit: fetchLimit, cacheKey: gamesCacheKey, cacheStrip: stripGameForCache },
  );
  // Progressive fetch — a small first batch of the freshest 30 analyses
  // lands in ~500 ms and lets the most-recent game cards show real
  // accuracy almost immediately. The full fetch continues in the
  // background; results merge in the `rawAnalyses` memo below once
  // either batch lands.
  const [firstAnalyses, firstAnalysesLoading] = useSmartEntityList<GameAnalysis>(
    'Analysis',
    undefined,
    deserializeAnalysis as (raw: unknown) => GameAnalysis,
    undefined,
    { sort: '-created_date', limit: 30 },
  );
  const [fullAnalyses, fullAnalysesLoading, , refetchAnalyses] = useSmartEntityList<GameAnalysis>(
    'Analysis',
    undefined,
    deserializeAnalysis as (raw: unknown) => GameAnalysis,
    undefined,
    { sort: '-created_date', limit: fetchLimit },
  );
  // Prefer full once it lands; fall back to the first batch until then.
  // Dedup by id so a record present in both batches doesn't appear twice.
  const rawAnalyses = useMemo<GameAnalysis[]>(() => {
    if (fullAnalyses.length === 0) return firstAnalyses;
    if (firstAnalyses.length === 0) return fullAnalyses;
    const seen = new Set(fullAnalyses.map((a) => a.gameId));
    const extra = firstAnalyses.filter((a) => !seen.has(a.gameId));
    return extra.length === 0 ? fullAnalyses : [...fullAnalyses, ...extra];
  }, [firstAnalyses, fullAnalyses]);
  // Loading is "true" only until *at least the first batch* lands —
  // we stop blocking renders the moment any analyses are available.
  const analysesLoading = firstAnalysesLoading && fullAnalysesLoading;

  // ── Missing-analysis backfill ──
  // The `Analysis` list is sorted by -created_date and capped at 250 so first
  // paint stays fast. For users whose own analyses are spread across time
  // (e.g. a returning user with friend/top-player imports that crowded out
  // older personal analyses), some of their games end up marked 'complete'
  // on the Game record but have no matching Analysis row in the 250-window.
  // The game cards then show "Pending" even though the data exists server-
  // side. This effect detects that mismatch and fetches the missing analyses
  // one-by-one (small parallel requests) so the cards repaint with accuracy.
  const [backfillAnalyses, setBackfillAnalyses] = useState<GameAnalysis[]>([]);
  const backfillAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (gamesLoading || analysesLoading) return;
    if (rawGames.length === 0) return;
    const lower = (settings.chesscomUsername ?? '').toLowerCase();
    if (!lower) return;
    // `known` covers BOTH entity-id and chess.com-id matches — mirrors the
    // expanded `allAnalyses` join above. Without this, games whose analysis
    // matches only by chessGameId still appear "missing" and get backfilled
    // unnecessarily.
    const known = new Set<string>();
    const knownChessIds = new Set<string>();
    for (const a of [...rawAnalyses, ...backfillAnalyses]) {
      known.add(a.gameId);
      const c = (a as unknown as Record<string, unknown>).chessGameId as string | undefined;
      if (c) knownChessIds.add(c);
    }
    const missing = rawGames.filter((g) => {
      if (g.analysisStatus !== 'complete') return false;
      if ((g.player?.username ?? '').toLowerCase() !== lower) return false;
      if (known.has(g.id)) return false;
      const chessId = (g as unknown as Record<string, unknown>).gameId as string | undefined;
      if (chessId && knownChessIds.has(chessId)) return false;
      if (backfillAttemptedRef.current.has(g.id)) return false;
      return true;
    });
    if (missing.length === 0) return;
    for (const g of missing) backfillAttemptedRef.current.add(g.id);
    // Hard cap — admin users can have 500+ analyses living outside the
    // 250-window. Backfilling all of them every load streams network
    // activity for 8+ seconds, which feels janky even though the UI
    // is technically interactive. 20 covers the most-recent missing
    // analyses (which is what the user looks at first) and keeps the
    // background fetch short and silent.
    const BACKFILL_CAP = 20;
    const toFetch = missing.slice(0, BACKFILL_CAP);
    console.log(`[Chess DNA] Backfilling ${toFetch.length}${missing.length > toFetch.length ? `/${missing.length}` : ''} missing analyses (outside the 250-window)`);
    // Defer until the browser is idle — the first paint, the main
    // entity fetches, and the analysis events should all settle first.
    // Without this, backfill XHRs compete with the user's initial
    // render and slow the perceived load.
    const ric = (cb: () => void) => {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number };
      if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(cb, { timeout: 4000 });
      else setTimeout(cb, 2500);
    };
    ric(() => {
      (async () => {
        const CONCURRENCY = 3;
        const fetched: GameAnalysis[] = [];
        for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
          const batch = toFetch.slice(i, i + CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map(async (g) => {
              const list = await (base44.entities as Record<string, any>).Analysis.filter({ gameId: g.id });
              const first = Array.isArray(list) ? list[0] : null;
              return first ? deserializeAnalysis(first) : null;
            }),
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) fetched.push(r.value);
          }
        }
        if (fetched.length > 0) {
          console.log(`[Chess DNA] Backfill found ${fetched.length}/${missing.length} analyses`);
          setBackfillAnalyses((prev) => {
            const seen = new Set(prev.map((a) => a.gameId));
            const merged = [...prev];
            for (const a of fetched) if (!seen.has(a.gameId)) merged.push(a);
            return merged;
          });
        }
      })();
    });
  }, [rawGames, rawAnalyses, gamesLoading, analysesLoading, settings.chesscomUsername, backfillAnalyses]);

  const [patterns, , patternsLoading, refetchPatterns] = useSmartSingletonEntity<CurrentPatterns & Record<string, unknown>>(
    'Pattern',
    DEFAULT_PATTERNS,
    deserializePattern as (raw: Record<string, unknown>) => CurrentPatterns & Record<string, unknown>,
    undefined,
    userId,
  );

  const dataLoading = gamesLoading || analysesLoading || patternsLoading;

  // ── Reset stuck analyses on app boot ──
  // Games that crashed mid-analysis stay marked `analysisStatus: 'analyzing'`
  // forever and never get re-picked-up. On boot, find any record stuck for
  // >30 min based on Base44's auto-updated `updated_date` and flip it back
  // to 'pending' so the regular analysis queue can retry it.
  const stuckResetRanRef = useRef(false);
  useEffect(() => {
    if (stuckResetRanRef.current || gamesLoading || rawGames.length === 0) return;
    stuckResetRanRef.current = true;

    const THIRTY_MIN = 30 * 60 * 1000;
    const now = Date.now();
    const stuck: GameRecord[] = [];
    for (const g of rawGames) {
      if (g.analysisStatus !== 'analyzing') continue;
      const updatedRaw = (g as unknown as Record<string, unknown>).updated_date;
      const updatedMs = typeof updatedRaw === 'string' ? Date.parse(updatedRaw) : NaN;
      // If the timestamp is missing or older than 30 min, treat as stuck.
      if (!Number.isFinite(updatedMs) || now - updatedMs > THIRTY_MIN) {
        stuck.push(g);
      }
    }
    if (stuck.length === 0) return;

    console.log(`[Chess DNA] Resetting ${stuck.length} stuck-analyzing games to pending`);
    (async () => {
      for (const g of stuck) {
        try {
          await (base44.entities as Record<string, any>).Game.update(g.id, { analysisStatus: 'pending' });
        } catch (err) {
          console.warn('[Chess DNA] Failed to reset stuck game:', g.id, err);
        }
      }
      refetchGamesRef.current();
    })();
  }, [gamesLoading, rawGames]);

  // ── Auto-cleanup: delete duplicate Game/Analysis records ──
  // Runs whenever rawGames loads and contains any duplicates or ghost
  // records. Old thresholds (≥2000 games, ≥50 dupes) only fired on heavily
  // bloated DBs and let smaller dupe counts leak into the UI as broken
  // rows. Now we trigger as soon as we see ANY dupe-by-gameId or ghost
  // record (missing PGN / playedAt / totalMoves), so the user never sees
  // a "game that doesn't exist" again.
  const cleanupRanRef = useRef(false);
  useEffect(() => {
    if (cleanupRanRef.current || gamesLoading || rawGames.length === 0) return;

    const chessIds = new Set<string>();
    let dupeCount = 0;
    let ghostCount = 0;
    for (const g of rawGames) {
      const cid = (g as unknown as Record<string, unknown>).gameId as string | undefined;
      if (cid) {
        if (chessIds.has(cid)) dupeCount++;
        else chessIds.add(cid);
      }
      const isGhost = !g.pgn || g.pgn.length < 10
        || !g.player?.username || !g.opponent?.username
        || typeof g.totalMoves !== 'number' || g.totalMoves <= 0
        || typeof g.playedAt !== 'number' || g.playedAt <= 0;
      if (isGhost) ghostCount++;
    }

    if (dupeCount === 0 && ghostCount === 0) return;
    cleanupRanRef.current = true;

    console.log(`[Chess DNA] Found ${dupeCount} duplicates + ${ghostCount} ghost games in ${rawGames.length} records — starting cleanup...`);
    cleanupDuplicates((msg) => console.log(`[DB Cleanup] ${msg}`))
      .then(result => {
        console.log(`[Chess DNA] Cleanup done: ${result.gamesDeleted} games + ${result.analysesDeleted} analyses deleted`);
        if (result.gamesDeleted > 0) {
          // Refetch to get clean data
          refetchGamesRef.current();
          refetchAnalysesRef.current();
        }
      })
      .catch(err => console.warn('[Chess DNA] Cleanup failed:', err));
  }, [gamesLoading, rawGames]);

  // Keep refs to avoid stale closures in long-running async callbacks
  const rawGamesRef = useRef(rawGames);
  rawGamesRef.current = rawGames;
  const refetchGamesRef = useRef(refetchGames);
  refetchGamesRef.current = refetchGames;
  const refetchAnalysesRef = useRef(refetchAnalyses);
  refetchAnalysesRef.current = refetchAnalyses;
  const refetchPatternsRef = useRef(refetchPatterns);
  refetchPatternsRef.current = refetchPatterns;

  // Debounced refetch — prevents overlapping fetches from multiple triggers
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedRefetchAll = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      refetchGamesRef.current();
      refetchAnalysesRef.current();
      refetchPatternsRef.current();
    }, 150);
  }, []);

  // ── Auto-sync from Chess.com ──
  // Analysis queue: never drop game IDs, process sequentially
  const analysisQueueRef = useRef<string[]>([]);
  const processingAnalysisRef = useRef(false);

  // Live mirrors of the analysis pipeline so UI consumers can show
  // queue position, per-game progress, and a brief "moved to top" pulse
  // without subscribing to analysisEvents directly.
  const [analysisQueueIds, setAnalysisQueueIds] = useState<string[]>([]);
  const [analyzingNow, setAnalyzingNow] = useState<{ gameId: string; current: number; total: number } | null>(null);
  const [recentlyPromotedIds, setRecentlyPromotedIds] = useState<Set<string>>(new Set());
  const promotedTimersRef = useRef<Map<string, number>>(new Map());
  // Throttle progress updates — the bus fires per move (~5–10 Hz during
  // analysis).  Every setState here triggers a full provider re-render,
  // which cascades to every useChessData() consumer.  Cap visible
  // updates at ~4 Hz; the badge still feels live without trashing perf.
  const progressUpdateRef = useRef<{ lastAt: number; lastGameId: string | null }>({ lastAt: 0, lastGameId: null });

  // Keep the queue state mirror in sync with the ref.
  const syncQueueState = useCallback(() => {
    setAnalysisQueueIds([...analysisQueueRef.current]);
  }, []);

  // Clear pending pulse-decay timers on unmount so a closing provider
  // doesn't leak timers that fire setState on a torn-down tree.
  useEffect(() => {
    const timers = promotedTimersRef.current;
    return () => {
      timers.forEach((handle) => window.clearTimeout(handle));
      timers.clear();
    };
  }, []);

  // Keep the latest onboarding game IDs in a ref so processAnalysisQueue
  // (a long-running async closure) can read the current set without becoming
  // a churn-y dependency.
  const onboardingIdsRef = useRef<Set<string>>(new Set(settings.onboardingGameIds ?? []));
  onboardingIdsRef.current = new Set(settings.onboardingGameIds ?? []);
  const radarRevealedRef = useRef<boolean>(!!settings.radarRevealedAt);
  radarRevealedRef.current = !!settings.radarRevealedAt;

  const processAnalysisQueue = useCallback(async () => {
    if (processingAnalysisRef.current || analysisQueueRef.current.length === 0) return;
    processingAnalysisRef.current = true;
    try {
      const batch = [...analysisQueueRef.current];
      analysisQueueRef.current = [];
      syncQueueState();
      // Sort: onboarding games FIRST (so the user's decoding screen finishes
      // ASAP regardless of how many other games race into the queue), then
      // newest-first by playedAt for everything else.
      const gamesMap = new Map(rawGamesRef.current.map(g => [g.id, g]));
      const obSet = onboardingIdsRef.current;
      batch.sort((a, b) => {
        const aIsOb = obSet.has(a) ? 0 : 1;
        const bIsOb = obSet.has(b) ? 0 : 1;
        if (aIsOb !== bIsOb) return aIsOb - bIsOb;
        const ga = gamesMap.get(a);
        const gb = gamesMap.get(b);
        return (gb?.playedAt ?? 0) - (ga?.playedAt ?? 0);
      });
      // Only suppress per-game refetches on big batches (the 30-game
      // chess.com sync). Small queues — e.g. the 3-game Follow import —
      // skip batch mode so each finished analysis triggers a refetch and
      // challenges appear gradually instead of all-at-once.
      //
      // While onboarding is still in progress (radar not yet revealed and
      // we have onboarding game IDs), keep batch mode OFF — the Decoding
      // screen depends on per-game refetches to update s1AnalyzedCount and
      // unlock the next stage.
      const onboardingActive = !radarRevealedRef.current && obSet.size > 0;
      setBatchMode(!onboardingActive && batch.length > 5);
      // During onboarding, cap depth at 10 so the Decoding screen finishes in ~30s
      // even on slow devices (Android emulator, low-end mobile). Depth 10 is plenty
      // for seeding the initial profile; later batch syncs use the user's full setting.
      const depth = onboardingActive
        ? Math.min(settings.analysisDepth, 10)
        : settings.analysisDepth;
      console.log('[Chess DNA] Processing analysis queue:', batch.length, 'games at depth', depth, onboardingActive ? '[onboarding]' : '');
      await runBatchAnalysis(batch, depth);
    } catch (err) {
      console.error('[Chess DNA Sync] Batch analysis failed:', err);
    } finally {
      setBatchMode(false);
      processingAnalysisRef.current = false;
      setAnalyzingNow(null);
      // Use refs to avoid stale closures (this callback runs minutes later)
      refetchGamesRef.current();
      refetchAnalysesRef.current();
      refetchPatternsRef.current();
      // Process any games that arrived while analyzing
      if (analysisQueueRef.current.length > 0) {
        processAnalysisQueue();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.analysisDepth, syncQueueState]);

  // Look up game IDs by player username via the rawGames ref. Bypasses the
  // username-filtered memos, which are stale inside async click handlers
  // that captured dataSrc before settings updated.
  const getStoredGameIdsByUsername = useCallback((username: string): string[] => {
    const lower = username.toLowerCase();
    return rawGamesRef.current
      .filter((g) => (g.player?.username ?? '').toLowerCase() === lower)
      .map((g) => g.id);
  }, []);

  // Exposed queue function — deduplicates and processes through the single pipeline
  const queueForAnalysis = useCallback((gameIds: string[], opts?: { priority?: 'normal' | 'high' }) => {
    if (gameIds.length === 0) return;
    if (opts?.priority === 'high') {
      // Front-of-queue insert so high-priority games (e.g. the game the
      // user just clicked Analyze on, or a just-followed top player) get
      // analyzed first — challenges appear in seconds instead of waiting
      // behind the user's whole sync queue.
      //
      // If the game was already queued further back, *move* it to the
      // front rather than skipping the call — the user explicitly asked
      // for it, so we want to honor the promotion even when it's a dedupe.
      analysisQueueRef.current = [
        ...gameIds,
        ...analysisQueueRef.current.filter((id) => !gameIds.includes(id)),
      ];
      // Mark these IDs as recently promoted so the row can pulse briefly.
      setRecentlyPromotedIds((prev) => {
        const next = new Set(prev);
        gameIds.forEach((id) => next.add(id));
        return next;
      });
      // Auto-clear the pulse after ~4s.  Per-ID timers so back-to-back
      // promotions of different games don't reset each other.
      gameIds.forEach((id) => {
        const existing = promotedTimersRef.current.get(id);
        if (existing) window.clearTimeout(existing);
        const handle = window.setTimeout(() => {
          setRecentlyPromotedIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          promotedTimersRef.current.delete(id);
        }, 4000);
        promotedTimersRef.current.set(id, handle);
      });
    } else {
      // Normal priority — dedupe-and-append.
      const existing = new Set(analysisQueueRef.current);
      const newIds = gameIds.filter((id) => !existing.has(id));
      if (newIds.length === 0) return;
      analysisQueueRef.current.push(...newIds);
    }
    syncQueueState();
    processAnalysisQueue();
  }, [processAnalysisQueue, syncQueueState]);

  const {
    isSyncing,
    lastSyncAt,
    lastSyncNewGames,
    error: syncError,
    syncNow,
  } = useChessComSync({
    username: settings.chesscomUsername,
    // Gate on real auth state, not just username presence. Without this,
    // the sync fires before the SDK has loaded its auth header and every
    // Game.create lands as `created_by_id: "anonymous"` — see the CSV
    // export, which had ~1000 anonymous orphan rows from this race.
    //
    // Also gate on the radar having been revealed (i.e. onboarding complete).
    // Otherwise the initial doSync fires the moment a fresh user sets a
    // chess.com username — fetching another 30 games and pushing them into
    // the same analysis queue as the 5 onboarding games. That triggers
    // batch-mode (queue > 5) and the user's progress counter spirals to
    // values like "11 / 5 games" while their own onboarding games are
    // starved behind the sync games.
    enabled:
      !!settings.chesscomUsername &&
      authResolved &&
      (isAuthenticated || isGuest) &&
      (!!settings.radarRevealedAt || (settings.onboardingGameIds?.length ?? 0) === 0),
    guest: isGuest,
    initialLastSyncAt: settings.lastSyncAt,
    onNewGames: (gameIds) => {
      if (gameIds.length === 0) return;
      // Queue for analysis — refetch will happen via the event listener
      analysisQueueRef.current.push(...gameIds);
      // Debounced refetch so games appear in UI without overlapping fetches
      debouncedRefetchAll();
      processAnalysisQueue();
    },
    onSyncComplete: (ts) => {
      updateSettings({ lastSyncAt: ts });
    },
  });

  // ── Derive the player's chess.com username ──
  // Priority: settings > most frequent player.username in games
  const configuredUsername = useMemo(() => {
    if (settings.chesscomUsername) return settings.chesscomUsername.toLowerCase();
    // Derive from games: find the most common player.username
    const counts = new Map<string, number>();
    for (const g of rawGames) {
      if (g.player?.username) {
        const u = g.player.username.toLowerCase();
        counts.set(u, (counts.get(u) ?? 0) + 1);
      }
    }
    let best = '';
    let bestCount = 0;
    for (const [u, c] of counts) {
      if (c > bestCount) { best = u; bestCount = c; }
    }
    if (best) console.log(`[Chess DNA] Derived username from games: "${best}" (${bestCount} games)`);
    return best;
  }, [settings.chesscomUsername, rawGames]);

  // ── Deduplicate games by gameId (chess.com ID) and filter to configured username ──
  // IMPORTANT: When multiple copies of the same chess.com game exist (duplicate imports),
  // we prefer keeping the copy that has a matching Analysis record. This ensures that
  // the join in calculateSkillProfile (analysis.gameId → game.id) succeeds.
  // Merge backfilled analyses (fetched on-demand for user's games whose
  // Analysis row fell outside the 250 most-recent window) into the working
  // set, deduping by gameId so the game-card join sees them.
  const mergedAnalyses = useMemo(() => {
    if (backfillAnalyses.length === 0) return rawAnalyses;
    const seen = new Set(rawAnalyses.map((a) => a.gameId));
    const extra = backfillAnalyses.filter((a) => !seen.has(a.gameId));
    return extra.length === 0 ? rawAnalyses : [...rawAnalyses, ...extra];
  }, [rawAnalyses, backfillAnalyses]);

  const allGames = useMemo(() => {
    // Build set of Base44 entity IDs that are referenced by Analysis records
    const analyzedEntityIds = new Set(mergedAnalyses.map(a => a.gameId));

    // Filter to configured username AND drop ghost records — entries that
    // somehow persisted in Base44 with missing core fields. Without this
    // filter, broken imports surface as "games that don't exist" rows in
    // the UI (no opponent, no PGN, can't analyze, can't open). A legit
    // game has a non-empty PGN, both player names, totalMoves > 0, and
    // a positive playedAt timestamp.
    const userGames = rawGames.filter((g) => {
      // Username scope
      if (configuredUsername && g.player?.username) {
        if (g.player.username.toLowerCase() !== configuredUsername) return false;
      }
      // Ghost-record filter
      if (!g.pgn || g.pgn.length < 10) return false;
      if (!g.player?.username || !g.opponent?.username) return false;
      if (typeof g.totalMoves !== 'number' || g.totalMoves <= 0) return false;
      if (typeof g.playedAt !== 'number' || g.playedAt <= 0) return false;
      return true;
    });

    // Group by chess.com gameId, preferring analyzed copies
    const bestByChessId = new Map<string, GameRecord>();
    const noChessId: GameRecord[] = [];

    for (const g of userGames) {
      const key = (g as unknown as Record<string, unknown>).gameId as string | undefined;
      if (!key) { noChessId.push(g); continue; }

      const existing = bestByChessId.get(key);
      if (!existing) {
        bestByChessId.set(key, g);
      } else {
        // Prefer the copy that has a matching Analysis record
        const existingHasAnalysis = analyzedEntityIds.has(existing.id);
        const currentHasAnalysis = analyzedEntityIds.has(g.id);
        if (!existingHasAnalysis && currentHasAnalysis) {
          bestByChessId.set(key, g); // swap to analyzed copy
        }
        // If both or neither have analyses, keep the first (existing)
      }
    }

    const deduped = [...bestByChessId.values(), ...noChessId];
    // Hard cap at the 250 most-recent so heavy users (1.5k+ games) don't
    // melt the patterns / profile / chart memos that iterate every game.
    // The fetch already pulls in more than 250 for the admin case so that
    // their own data isn't crowded out — this is the final on-app cap.
    deduped.sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0));
    return deduped.slice(0, 250);
  }, [rawGames, mergedAnalyses, configuredUsername]);

  // Scope analyses to just the 250-capped games so heavy memos (skill
  // profile, pattern engine, chart aggregations) don't iterate thousands
  // of analyses they'd ultimately throw away.
  //
  // Match by EITHER Base44 entity id OR chess.com gameId — duplicate Game
  // records (and the dedup that picks one winner per chess.com gameId)
  // mean an Analysis row's `gameId` often points to a losing duplicate
  // that's no longer in `allGames`. Entity-only matching drops those
  // analyses; the chess.com gameId fallback recovers them. Without this,
  // `allAnalyses` collapses to ~0 for users with duplicate records,
  // calculateSkillProfile sees an empty moves list, every dimension
  // returns the "no data" 50 default, and the DNA renders as a flat 50.
  const allAnalyses = useMemo(() => {
    const keepEntityIds = new Set(allGames.map((g) => g.id));
    const keepChessIds = new Set(
      allGames
        .map((g) => (g as unknown as Record<string, unknown>).gameId as string | undefined)
        .filter((v): v is string => !!v),
    );
    return mergedAnalyses.filter((a) => {
      if (keepEntityIds.has(a.gameId)) return true;
      const chessId = (a as unknown as Record<string, unknown>).chessGameId as string | undefined;
      return chessId ? keepChessIds.has(chessId) : false;
    });
  }, [mergedAnalyses, allGames]);

  // ── Friend & top-player games — non-self games imported into Base44
  // for the Time Machine "Friends" / "Top Players" tabs. Same ghost-record
  // validity rules as allGames; matches by username (lowercased) against
  // the configured friend / top lists in settings. Kept separate from
  // `allGames` so the user's profile/patterns aren't polluted. ──
  const friendUsernameSet = useMemo(
    () => new Set((settings.friendUsernames ?? []).map((u) => u.toLowerCase())),
    [settings.friendUsernames],
  );
  const topPlayerUsernameSet = useMemo(
    () => new Set((settings.topPlayerUsernames ?? []).map((u) => u.toLowerCase())),
    [settings.topPlayerUsernames],
  );

  const isValidGameRecord = (g: GameRecord): boolean => {
    if (!g.pgn || g.pgn.length < 10) return false;
    if (!g.player?.username || !g.opponent?.username) return false;
    if (typeof g.totalMoves !== 'number' || g.totalMoves <= 0) return false;
    if (typeof g.playedAt !== 'number' || g.playedAt <= 0) return false;
    return true;
  };

  const friendGames = useMemo(() => {
    if (friendUsernameSet.size === 0) return [];
    return rawGames.filter((g) => {
      const u = g.player?.username?.toLowerCase();
      return !!u && friendUsernameSet.has(u) && isValidGameRecord(g);
    });
  }, [rawGames, friendUsernameSet]);

  const topPlayerGames = useMemo(() => {
    if (topPlayerUsernameSet.size === 0) return [];
    return rawGames.filter((g) => {
      const u = g.player?.username?.toLowerCase();
      return !!u && topPlayerUsernameSet.has(u) && isValidGameRecord(g);
    });
  }, [rawGames, topPlayerUsernameSet]);

  const friendAnalyses = useMemo(() => {
    if (friendGames.length === 0) return [];
    const ids = new Set(friendGames.map((g) => g.id));
    return rawAnalyses.filter((a) => ids.has(a.gameId));
  }, [rawAnalyses, friendGames]);

  const topPlayerAnalyses = useMemo(() => {
    if (topPlayerGames.length === 0) return [];
    const ids = new Set(topPlayerGames.map((g) => g.id));
    return rawAnalyses.filter((a) => ids.has(a.gameId));
  }, [rawAnalyses, topPlayerGames]);

  // ── Enrich games with analysis status from Analysis records ──
  // Build a set of chess.com gameIds that have been analyzed.
  // Uses three strategies: direct chessGameId field, entity ID lookup, and
  // reverse lookup through ALL rawGames duplicates.
  const analyzedChessGameIds = useMemo(() => {
    // Strategy 1: Map ALL Base44 entity IDs → chess.com gameId
    const entityToChessId = new Map<string, string>();
    for (const g of rawGames) {
      const chessId = (g as unknown as Record<string, unknown>).gameId as string | undefined;
      if (chessId) entityToChessId.set(g.id, chessId);
    }

    // Strategy 2: Also build reverse map chess.com gameId → all entity IDs
    // so we can check if an analysis points to ANY duplicate of a game
    const chessIdToEntityIds = new Map<string, Set<string>>();
    for (const g of rawGames) {
      const chessId = (g as unknown as Record<string, unknown>).gameId as string | undefined;
      if (chessId) {
        if (!chessIdToEntityIds.has(chessId)) chessIdToEntityIds.set(chessId, new Set());
        chessIdToEntityIds.get(chessId)!.add(g.id);
      }
    }

    // Build set of all entity IDs that belong to ANY known chess.com game
    const allKnownEntityIds = new Set<string>();
    for (const g of rawGames) allKnownEntityIds.add(g.id);

    const analyzedChessIds = new Set<string>();

    for (const a of rawAnalyses) {
      // Method 1: Direct chessGameId field (new analyses)
      const directChessId = (a as unknown as Record<string, unknown>).chessGameId as string | undefined;
      if (directChessId) {
        analyzedChessIds.add(directChessId);
        continue;
      }
      // Method 2: Entity ID lookup (works if analysis points to a record in current 5000)
      if (a.gameId) {
        const chessId = entityToChessId.get(a.gameId);
        if (chessId) {
          analyzedChessIds.add(chessId);
        }
      }
    }

    return analyzedChessIds;
  }, [rawAnalyses, rawGames]);

  // Patch allGames with corrected analysisStatus based on Analysis records.
  // If direct matching fails (due to duplicate Game records), fall back to
  // marking ALL games as complete if we have a significant number of analyses.
  const enrichedAllGames = useMemo(() => {
    // First try: match by chess.com gameId
    let matchedCount = 0;
    const enriched = allGames.map(g => {
      const chessId = (g as unknown as Record<string, unknown>).gameId as string | undefined;
      if (chessId && analyzedChessGameIds.has(chessId) && g.analysisStatus !== 'complete') {
        matchedCount++;
        return { ...g, analysisStatus: 'complete' as const };
      }
      if (g.analysisStatus === 'complete') matchedCount++;
      return g;
    });

    // Fallback: if we have many analyses but few matched games,
    // the matching is broken due to duplicate records.
    // Mark all games as 'complete' since analyses clearly exist.
    const totalGames = allGames.length;
    if (matchedCount < Math.min(5, totalGames) && rawAnalyses.length >= totalGames && totalGames > 0) {
      console.warn(`[Chess DNA] Analysis matching limited (${matchedCount}/${totalGames} matched, ${rawAnalyses.length} analyses). Marking all games as complete.`);
      return allGames.map(g => ({ ...g, analysisStatus: 'complete' as const }));
    }

    return enriched;
  }, [allGames, analyzedChessGameIds, rawAnalyses]);

  // ── Game counts (all games, no time-class filter) ──
  const totalGameCount = enrichedAllGames.length;
  const analyzedCount = useMemo(
    () => enrichedAllGames.filter((g) => g.analysisStatus === 'complete').length,
    [enrichedAllGames],
  );
  const analyzingCount = useMemo(
    () => enrichedAllGames.filter((g) => g.analysisStatus === 'analyzing').length,
    [enrichedAllGames],
  );
  const pendingCount = totalGameCount - analyzedCount - analyzingCount;

  // ── Lookups ──
  const gamesMap = useMemo(() => {
    const map: Record<string, GameRecord> = {};
    for (const g of enrichedAllGames) map[g.id] = g;
    return map;
  }, [enrichedAllGames]);

  const availableTimeClasses = useMemo(
    () => new Set(enrichedAllGames.map((g) => g.timeClass)),
    [enrichedAllGames],
  );

  // ── Filtered by selected time class ──
  const timeClassFilter = settings.selectedTimeClass ?? null;

  const games = useMemo(
    () => (timeClassFilter ? enrichedAllGames.filter((g) => g.timeClass === timeClassFilter) : enrichedAllGames),
    [enrichedAllGames, timeClassFilter],
  );

  const analyses = useMemo(() => {
    if (!timeClassFilter) return allAnalyses;
    // Match by both Base44 entity ID and chess.com gameId for compatibility
    const filteredEntityIds = new Set(games.map((g) => g.id));
    const filteredChessIds = new Set(
      games.map((g) => (g as unknown as Record<string, unknown>).gameId as string).filter(Boolean),
    );
    return allAnalyses.filter((a) => {
      if (filteredEntityIds.has(a.gameId)) return true;
      const chessId = (a as unknown as Record<string, unknown>).chessGameId as string | undefined;
      return chessId ? filteredChessIds.has(chessId) : false;
    });
  }, [allAnalyses, games, timeClassFilter]);

  const filteredAnalyzedCount = useMemo(
    () => games.filter((g) => g.analysisStatus === 'complete').length,
    [games],
  );
  const filteredAnalyzingCount = useMemo(
    () => games.filter((g) => g.analysisStatus === 'analyzing').length,
    [games],
  );

  const trapStats = useMemo(() => computeTrapStats(games), [games]);

  // Fetch real rating from chess.com stats API (ground truth).
  // Rehydrate synchronously from a 12-hour localStorage cache so the user's
  // shown rating doesn't flicker through "no data" → "1200 fallback" → real
  // value while the API round-trip lands.
  const CHESS_COM_RATINGS_TTL_MS = 12 * 60 * 60 * 1000;
  const chessComCacheKey = configuredUsername
    ? `chesscom-ratings-${configuredUsername.toLowerCase()}`
    : null;
  const [chessComRatings, setChessComRatings] = useState<Record<string, number>>(() => {
    if (!chessComCacheKey || typeof localStorage === 'undefined') return {};
    try {
      const raw = localStorage.getItem(chessComCacheKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as { ratings: Record<string, number>; ts: number };
      if (!parsed?.ratings || Date.now() - parsed.ts > CHESS_COM_RATINGS_TTL_MS) return {};
      return parsed.ratings;
    } catch { return {}; }
  });
  const chessComFetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!configuredUsername) return;
    if (chessComFetchedRef.current === configuredUsername) return; // already fetched
    chessComFetchedRef.current = configuredUsername;
    console.log('[Chess DNA] Fetching chess.com stats for:', configuredUsername);
    fetchChessCom(`${CHESS_COM_API_BASE}/player/${configuredUsername}/stats`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { console.warn('[Chess DNA] chess.com stats fetch returned no data'); return; }
        const ratings: Record<string, number> = {};
        if (data.chess_bullet?.last?.rating) ratings.bullet = data.chess_bullet.last.rating;
        if (data.chess_blitz?.last?.rating) ratings.blitz = data.chess_blitz.last.rating;
        if (data.chess_rapid?.last?.rating) ratings.rapid = data.chess_rapid.last.rating;
        if (data.chess_daily?.last?.rating) ratings.daily = data.chess_daily.last.rating;
        console.log('[Chess DNA] chess.com ratings fetched:', ratings);
        setChessComRatings(ratings);
        if (chessComCacheKey) {
          try {
            localStorage.setItem(chessComCacheKey, JSON.stringify({ ratings, ts: Date.now() }));
          } catch { /* quota — best-effort */ }
        }
      })
      .catch((err) => { console.error('[Chess DNA] chess.com stats fetch failed:', err); });
  });

  const playerElo = useMemo(() => {
    // Use real chess.com rating for the selected time class, or overall average
    if (timeClassFilter && chessComRatings[timeClassFilter]) {
      return chessComRatings[timeClassFilter];
    }
    // No time class filter: use weighted average of available ratings
    const vals = Object.values(chessComRatings);
    if (vals.length > 0) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    // Fallback to game data if API unavailable
    const sorted = [...allGames].filter((g) => g.player?.rating && g.player.rating > 0).sort((a, b) => b.playedAt - a.playedAt);
    return sorted[0]?.player?.rating ?? 1200;
  }, [chessComRatings, timeClassFilter, allGames]);

  // ── Profile (from filtered games, opponent-adjusted) ──
  // Persist the computed profile per (user, timeClass) so a returning user
  // sees their real DNA scores in the first paint instead of waiting on
  // the Analysis fetch + deserialize + memo chain (5–10s for heavy users).
  // The profile object is small (~2 KB / 8 dimensions + overall) so it
  // fits comfortably in localStorage even when the analyses cache won't.
  const profileCacheKey = userId
    ? `chess-dna-profile-${userId}-${timeClassFilter ?? 'all'}`
    : null;
  const [cachedInitialProfile] = useState<SkillProfile | null>(() => {
    if (!profileCacheKey || typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(profileCacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SkillProfile;
      return parsed && parsed.gamesUsed > 0 ? parsed : null;
    } catch { return null; }
  });
  const computedProfile = useMemo(
    () => calculateSkillProfile(patterns, games, analyses),
    [patterns, games, analyses],
  );
  // Prefer the freshly-computed profile once it has data; fall back to the
  // cached one while analyses are still loading. Never downgrade from a
  // real computed profile back to the cached one (avoids flicker if a
  // refetch transiently empties analyses).
  const profile = computedProfile.gamesUsed > 0
    ? computedProfile
    : (cachedInitialProfile ?? computedProfile);
  // Persist after each compute that has real data.
  useEffect(() => {
    if (!profileCacheKey || computedProfile.gamesUsed === 0) return;
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(profileCacheKey, JSON.stringify(computedProfile)); }
    catch { /* quota — best-effort */ }
  }, [computedProfile, profileCacheKey]);

  const weakest = useMemo(() => getWeakestDimensions(profile, 3), [profile]);
  const strongest = useMemo(() => getStrongestDimensions(profile, 2), [profile]);

  // ── Tier ──
  const tier = useMemo(() => getTierForScore(profile.overallRating), [profile.overallRating]);
  const tierProgress = useMemo(() => getTierProgress(profile.overallRating), [profile.overallRating]);
  const nextTier = useMemo(() => getNextTier(profile.overallRating), [profile.overallRating]);

  // ── Benchmarks ──
  const benchmark = useMemo(() => getBenchmarkForRating(playerElo), [playerElo]);
  const leadersBenchmark = useMemo(() => getLeadersBenchmark(), []);
  const overallPercentile = useMemo(() => getOverallPercentile(profile, playerElo), [profile, playerElo]);

  // ── Journey stage ──
  const hasPatterns = !!(patterns && patterns.patterns.length > 0);
  const hasAI = hasAnyProvider(settings);

  // Patterns unlock immediately when available (no day-gate)
  const patternsUnlocked = !!(settings.patternsUnlockedAt || hasPatterns);

  const journeyStage = useMemo((): JourneyStage => {
    const stage: JourneyStage =
      totalGameCount === 0 ? 0 :
      !settings.radarRevealedAt ? 1 :
      !patternsUnlocked ? 2 :
      !settings.guidedWalkthroughDone ? 4 : 5;
    console.log('[Chess DNA] journeyStage:', stage, '— totalGames:', totalGameCount, 'radarRevealed:', !!settings.radarRevealedAt, 'patternsUnlocked:', patternsUnlocked);
    return stage;
  }, [totalGameCount, settings.radarRevealedAt, patternsUnlocked, settings.guidedWalkthroughDone]);

  // ── Auto-unlock patterns as soon as they're available ──
  useEffect(() => {
    if (settings.radarRevealedAt && !settings.patternsUnlockedAt && hasPatterns) {
      updateSettings({ patternsUnlockedAt: Date.now() });
    }
  }, [settings.radarRevealedAt, settings.patternsUnlockedAt, hasPatterns, updateSettings]);

  // ── Post-onboarding backfill: pull the OTHER time classes once the user is
  //    fully onboarded. During onboarding we only fetch the picked time class
  //    (5 games) so the user lands on their DNA fast — this effect waits until
  //    they reach the main view, then backfills any time classes that don't
  //    yet have at least 20 games. Idempotent because importChessComGames
  //    de-dupes against existing records.
  //
  //    Persisted across reloads — without this, every page load re-fires the
  //    backfill (firing ~40+ Base44 dedup filter calls per under-stocked
  //    class), which then triggers rate-limit 429s and slows the whole page.
  //    Once the backfill has run successfully for a user, we don't repeat
  //    it for 24h. ──
  const backfillTriggeredRef = useRef(false);
  const BACKFILL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const backfillStorageKey = userId ? `chess-dna-tc-backfill-${userId}` : null;
  useEffect(() => {
    if (backfillTriggeredRef.current) return;
    if (journeyStage < 5) return;
    if (!settings.chesscomUsername) return;
    if (rawGames.length === 0) return;

    // Cooldown check — skip if a recent backfill already ran for this user.
    if (backfillStorageKey && typeof localStorage !== 'undefined') {
      try {
        const last = parseInt(localStorage.getItem(backfillStorageKey) ?? '0', 10) || 0;
        if (Date.now() - last < BACKFILL_COOLDOWN_MS) {
          backfillTriggeredRef.current = true;
          return;
        }
      } catch { /* noop */ }
    }

    const tcCounts = new Map<TimeClass, number>();
    for (const g of rawGames) {
      if (g.timeClass) tcCounts.set(g.timeClass, (tcCounts.get(g.timeClass) ?? 0) + 1);
    }
    const allTcs: TimeClass[] = ['rapid', 'blitz', 'bullet', 'daily'];
    const understocked = allTcs.filter((tc) => (tcCounts.get(tc) ?? 0) < 20);
    if (understocked.length === 0) {
      // Even when nothing's under-stocked, mark the cooldown so we don't
      // re-check every reload.
      if (backfillStorageKey && typeof localStorage !== 'undefined') {
        try { localStorage.setItem(backfillStorageKey, String(Date.now())); }
        catch { /* noop */ }
      }
      backfillTriggeredRef.current = true;
      return;
    }

    backfillTriggeredRef.current = true;
    const username = settings.chesscomUsername;
    const guestMode = isGuest;
    console.log('[Chess DNA] Backfilling under-stocked time classes:', understocked);

    (async () => {
      const newIds: string[] = [];
      // Hard cap so we never let the user's stored Game count balloon past
      // ~500. Each time class gets a slice of the remaining headroom so
      // imports stay incremental — newest games always come first thanks to
      // chess-com-import iterating archives in reverse.
      const MAX_TOTAL = 250;
      let remaining = Math.max(0, MAX_TOTAL - rawGames.length);
      const PER_TC_TARGET = 20;
      for (const tc of understocked) {
        if (remaining <= 0) break;
        const take = Math.min(PER_TC_TARGET, remaining);
        try {
          const ids = await importChessComGames(username, {
            timeClass: tc,
            maxGames: take,
            guest: guestMode,
          });
          newIds.push(...ids);
          remaining -= ids.length;
        } catch (err) {
          console.warn('[Chess DNA] Backfill failed for', tc, err);
        }
      }
      // Persist the run-time so we don't re-attempt within the cooldown
      // window. Stamped regardless of whether imports succeeded — that
      // way a flaky chess.com response or rate-limit storm doesn't make
      // every subsequent reload retry the same imports.
      if (backfillStorageKey && typeof localStorage !== 'undefined') {
        try { localStorage.setItem(backfillStorageKey, String(Date.now())); }
        catch { /* noop */ }
      }
      if (newIds.length > 0) {
        console.log('[Chess DNA] Backfill imported', newIds.length, 'games — queueing for analysis');
        refetchGamesRef.current();
        // Push directly into the queue ref + kick the processor (both are stable
        // module-level refs; doing this avoids needing queueForAnalysis in deps).
        analysisQueueRef.current.push(...newIds);
        processAnalysisQueue();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyStage, settings.chesscomUsername, rawGames, isGuest]);

  // ── Analysis event listener — auto-refetch ──
  // Uses refs to avoid stale closures — the listener is registered ONCE and
  // always calls the latest refetch functions via refs.
  const batchCompleteCountRef = useRef(0);
  useEffect(() => {
    const unsub = analysisEvents.on((event) => {
      if (event.type === 'progress') {
        // Drive the per-row "Analyzing N/M" indicator.  Throttled so
        // we don't re-render every useChessData() consumer 5–10×/sec
        // during a batch.  We always update when the game changes (so
        // the indicator switches rows immediately), but cap subsequent
        // updates within the same game to ~4 Hz.
        const now = Date.now();
        const last = progressUpdateRef.current;
        const isNewGame = last.lastGameId !== event.gameId;
        if (isNewGame || now - last.lastAt >= 250) {
          progressUpdateRef.current = { lastAt: now, lastGameId: event.gameId };
          setAnalyzingNow({
            gameId: event.gameId,
            current: event.moveIndex,
            total: event.totalMoves,
          });
        }
      } else if (event.type === 'complete') {
        batchCompleteCountRef.current++;
        setAnalyzingNow((prev) => (prev?.gameId === event.gameId ? null : prev));
        // Onboarding games always trigger an immediate refetch so the
        // Decoding screen's s1AnalyzedCount updates in lockstep with the
        // games getting analyzed. Without this, batch-mode would suppress
        // refetches and the user would stay stuck at "Decoding" even after
        // all 5 onboarding games are done.
        const isOnboardingGame = onboardingIdsRef.current.has(event.gameId);
        if (isOnboardingGame || !isBatchMode()) {
          refetchGamesRef.current();
          refetchAnalysesRef.current();
        } else if (batchCompleteCountRef.current % 5 === 0) {
          // Batch mode: refetch every 5 games to update progress
          refetchGamesRef.current();
          refetchAnalysesRef.current();
          refetchPatternsRef.current();
        }
      } else if (event.type === 'error') {
        setAnalyzingNow((prev) => (prev?.gameId === event.gameId ? null : prev));
      } else if (event.type === 'all_complete') {
        batchCompleteCountRef.current = 0;
        setAnalyzingNow(null);
        refetchGamesRef.current();
        refetchAnalysesRef.current();
        refetchPatternsRef.current();
      }
    });
    return unsub;
  }, []); // Empty deps — listener registered once, uses refs for latest functions

  // ── Refetch all ──
  const refetchAll = useCallback(() => {
    refetchGames();
    refetchAnalyses();
    refetchPatterns();
  }, [refetchGames, refetchAnalyses, refetchPatterns]);

  // ── Memoized context value ──
  const value = useMemo<ChessDataContextValue>(
    () => ({
      allGames: enrichedAllGames,
      allAnalyses,
      patterns,
      gamesLoading,
      analysesLoading,
      fullAnalysesLoading,
      patternsLoading,
      dataLoading,
      totalGameCount,
      analyzedCount,
      analyzingCount,
      pendingCount,
      gamesMap,
      availableTimeClasses,
      friendGames,
      friendAnalyses,
      topPlayerGames,
      topPlayerAnalyses,
      games,
      analyses,
      filteredAnalyzedCount,
      filteredAnalyzingCount,
      trapStats,
      profile,
      weakest,
      strongest,
      playerElo,
      tier,
      tierProgress,
      nextTier,
      benchmark,
      leadersBenchmark,
      overallPercentile,
      journeyStage,
      hasPatterns,
      hasAI,
      patternsUnlocked,
      isSyncing,
      lastSyncAt,
      lastSyncNewGames,
      syncError,
      syncNow,
      analysisQueueIds,
      analyzingNow,
      recentlyPromotedIds,
      refetchGames,
      refetchAnalyses,
      refetchPatterns,
      refetchAll,
      queueForAnalysis,
      getStoredGameIdsByUsername,
    }),
    [
      enrichedAllGames, allAnalyses, patterns,
      gamesLoading, analysesLoading, fullAnalysesLoading, patternsLoading, dataLoading,
      totalGameCount, analyzedCount, analyzingCount, pendingCount,
      gamesMap, availableTimeClasses,
      friendGames, friendAnalyses, topPlayerGames, topPlayerAnalyses,
      games, analyses, filteredAnalyzedCount, filteredAnalyzingCount, trapStats,
      profile, weakest, strongest, playerElo,
      tier, tierProgress, nextTier,
      benchmark, leadersBenchmark, overallPercentile,
      journeyStage, hasPatterns, hasAI, patternsUnlocked,
      isSyncing, lastSyncAt, lastSyncNewGames, syncError, syncNow,
      analysisQueueIds, analyzingNow, recentlyPromotedIds,
      refetchGames, refetchAnalyses, refetchPatterns, refetchAll, queueForAnalysis,
      getStoredGameIdsByUsername,
    ],
  );

  return (
    <ChessDataContext.Provider value={value}>
      {children}
    </ChessDataContext.Provider>
  );
}

// ── Hook ──
export function useChessData() {
  return useContext(ChessDataContext);
}
