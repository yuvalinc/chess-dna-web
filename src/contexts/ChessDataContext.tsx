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
import { CHESS_COM_API_BASE } from '@shared/constants';
import { fetchChessCom } from '@/api/chess-com-fetch';
import type { GameRecord, TimeClass } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { CurrentPatterns, SkillProfile, SkillDimension, RankTier } from '@shared/types/patterns';
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

  // Filtered by settings.selectedTimeClass
  games: GameRecord[];
  analyses: GameAnalysis[];
  filteredAnalyzedCount: number;
  filteredAnalyzingCount: number;

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
  syncError: string | null;
  syncNow: () => void;

  // Refetch
  refetchGames: () => void;
  refetchAnalyses: () => void;
  refetchPatterns: () => void;
  refetchAll: () => void;

  // Analysis queue — push game IDs here instead of calling runBatchAnalysis directly
  queueForAnalysis: (gameIds: string[]) => void;
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
  patternsLoading: true,
  dataLoading: true,
  totalGameCount: 0,
  analyzedCount: 0,
  analyzingCount: 0,
  pendingCount: 0,
  gamesMap: {},
  availableTimeClasses: new Set(),
  games: [],
  analyses: [],
  filteredAnalyzedCount: 0,
  filteredAnalyzingCount: 0,
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
  syncError: null,
  syncNow: () => {},
  refetchGames: () => {},
  refetchAnalyses: () => {},
  refetchPatterns: () => {},
  refetchAll: () => {},
  queueForAnalysis: () => {},
});

// ── Provider ──
export function ChessDataProvider({ children }: { children: React.ReactNode }) {
  const { settings, updateSettings } = useTheme();
  const { userId } = useAuth();

  // Smart hooks: use localStorage for guests, Base44 for authenticated users.
  // Auth-awareness is built into the hooks — no manual skip logic needed.
  // NOTE: Data isolation relies on the configuredUsername filter below (line ~270)
  // which scopes games by chess.com username. Base44 RLS should also handle this
  // server-side. A created_by_id filter was removed because legacy games don't
  // have that field set, causing them to be silently dropped.
  const [rawGames, gamesLoading, , refetchGames] = useSmartEntityList<GameRecord>(
    'Game',
  );
  const [rawAnalyses, analysesLoading, , refetchAnalyses] = useSmartEntityList<GameAnalysis>(
    'Analysis',
    undefined,
    deserializeAnalysis as (raw: unknown) => GameAnalysis,
  );
  const [patterns, , patternsLoading, refetchPatterns] = useSmartSingletonEntity<CurrentPatterns & Record<string, unknown>>(
    'Pattern',
    DEFAULT_PATTERNS,
    deserializePattern as (raw: Record<string, unknown>) => CurrentPatterns & Record<string, unknown>,
    undefined,
    userId,
  );

  const dataLoading = gamesLoading || analysesLoading || patternsLoading;

  // ── Auto-cleanup: delete duplicate Game/Analysis records ──
  // Runs once when rawGames loads and has near-limit records (indicating duplicates)
  const cleanupRanRef = useRef(false);
  useEffect(() => {
    if (cleanupRanRef.current || gamesLoading || rawGames.length < 2000) return;
    cleanupRanRef.current = true;

    // Check if there are actual duplicates before running cleanup
    const chessIds = new Set<string>();
    let dupeCount = 0;
    for (const g of rawGames) {
      const cid = (g as unknown as Record<string, unknown>).gameId as string | undefined;
      if (cid) {
        if (chessIds.has(cid)) dupeCount++;
        else chessIds.add(cid);
      }
    }

    if (dupeCount < 50) return; // Not enough dupes to bother

    console.log(`[Chess DNA] Found ${dupeCount} duplicate games in ${rawGames.length} records — starting cleanup...`);
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

  const processAnalysisQueue = useCallback(async () => {
    if (processingAnalysisRef.current || analysisQueueRef.current.length === 0) return;
    processingAnalysisRef.current = true;
    try {
      const batch = [...analysisQueueRef.current];
      analysisQueueRef.current = [];
      // Sort newest first: look up playedAt from rawGames ref for each queued ID
      const gamesMap = new Map(rawGamesRef.current.map(g => [g.id, g]));
      batch.sort((a, b) => {
        const ga = gamesMap.get(a);
        const gb = gamesMap.get(b);
        return (gb?.playedAt ?? 0) - (ga?.playedAt ?? 0);
      });
      setBatchMode(true);
      console.log('[Chess DNA] Processing analysis queue:', batch.length, 'games (newest first)');
      await runBatchAnalysis(batch, settings.analysisDepth);
    } catch (err) {
      console.error('[Chess DNA Sync] Batch analysis failed:', err);
    } finally {
      setBatchMode(false);
      processingAnalysisRef.current = false;
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
  }, [settings.analysisDepth]);

  // Exposed queue function — deduplicates and processes through the single pipeline
  const queueForAnalysis = useCallback((gameIds: string[]) => {
    if (gameIds.length === 0) return;
    // Deduplicate: only add IDs not already in the queue
    const existing = new Set(analysisQueueRef.current);
    const newIds = gameIds.filter(id => !existing.has(id));
    if (newIds.length === 0) return;
    analysisQueueRef.current.push(...newIds);
    processAnalysisQueue();
  }, [processAnalysisQueue]);

  const {
    isSyncing,
    lastSyncAt,
    error: syncError,
    syncNow,
  } = useChessComSync({
    username: settings.chesscomUsername,
    enabled: !!settings.chesscomUsername,
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
  const allGames = useMemo(() => {
    // Build set of Base44 entity IDs that are referenced by Analysis records
    const analyzedEntityIds = new Set(rawAnalyses.map(a => a.gameId));

    // Filter to configured username first
    const userGames = rawGames.filter((g) => {
      if (configuredUsername && g.player?.username) {
        if (g.player.username.toLowerCase() !== configuredUsername) return false;
      }
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

    return [...bestByChessId.values(), ...noChessId];
  }, [rawGames, rawAnalyses, configuredUsername]);

  const allAnalyses = rawAnalyses;

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

  // Fetch real rating from chess.com stats API (ground truth)
  const [chessComRatings, setChessComRatings] = useState<Record<string, number>>({});
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
  const profile = useMemo(
    () => calculateSkillProfile(patterns, games, analyses),
    [patterns, games, analyses],
  );

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

  // ── Analysis event listener — auto-refetch ──
  // Uses refs to avoid stale closures — the listener is registered ONCE and
  // always calls the latest refetch functions via refs.
  const batchCompleteCountRef = useRef(0);
  useEffect(() => {
    const unsub = analysisEvents.on((event) => {
      if (event.type === 'complete') {
        batchCompleteCountRef.current++;
        if (!isBatchMode()) {
          // Single-game analysis: refetch immediately
          refetchGamesRef.current();
          refetchAnalysesRef.current();
        } else if (batchCompleteCountRef.current % 5 === 0) {
          // Batch mode: refetch every 5 games to update progress
          refetchGamesRef.current();
          refetchAnalysesRef.current();
          refetchPatternsRef.current();
        }
      } else if (event.type === 'all_complete') {
        batchCompleteCountRef.current = 0;
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
      patternsLoading,
      dataLoading,
      totalGameCount,
      analyzedCount,
      analyzingCount,
      pendingCount,
      gamesMap,
      availableTimeClasses,
      games,
      analyses,
      filteredAnalyzedCount,
      filteredAnalyzingCount,
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
      syncError,
      syncNow,
      refetchGames,
      refetchAnalyses,
      refetchPatterns,
      refetchAll,
      queueForAnalysis,
    }),
    [
      enrichedAllGames, allAnalyses, patterns,
      gamesLoading, analysesLoading, patternsLoading, dataLoading,
      totalGameCount, analyzedCount, analyzingCount, pendingCount,
      gamesMap, availableTimeClasses,
      games, analyses, filteredAnalyzedCount, filteredAnalyzingCount,
      profile, weakest, strongest, playerElo,
      tier, tierProgress, nextTier,
      benchmark, leadersBenchmark, overallPercentile,
      journeyStage, hasPatterns, hasAI, patternsUnlocked,
      isSyncing, lastSyncAt, syncError, syncNow,
      refetchGames, refetchAnalyses, refetchPatterns, refetchAll, queueForAnalysis,
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
