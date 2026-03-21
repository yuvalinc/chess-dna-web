/**
 * Centralized data context for the Chess DNA app.
 *
 * Fetches core entities (Game, Analysis, Pattern) once and provides
 * derived values (profile, counts, tier, benchmarks, journey stage)
 * to all consumers. Eliminates duplicate fetches across 7+ components.
 */
import { createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import { useEntityList, useSingletonEntity } from '@/hooks/useEntity';
import { useTheme } from '@/components/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { analysisEvents, isBatchMode } from '@/engine/analysis-events';
import { deserializeAnalysis, deserializePattern } from '@/engine/analysis-pipeline';
import { calculateSkillProfile, getWeakestDimensions, getStrongestDimensions } from '@/patterns/skill-calculator';
import { getTierForScore, getTierProgress, getNextTier } from '@/patterns/rank-tiers';
import { getBenchmarkForRating, getOverallPercentile, getLeadersBenchmark } from '@/patterns/score-benchmarks';
import { hasAnyProvider } from '@/ai/ai-router';
import { isDifferentCalendarDay } from '@shared/utils/date-utils';
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

  // Refetch
  refetchGames: () => void;
  refetchAnalyses: () => void;
  refetchPatterns: () => void;
  refetchAll: () => void;
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
  refetchGames: () => {},
  refetchAnalyses: () => {},
  refetchPatterns: () => {},
  refetchAll: () => {},
});

// ── Provider ──
export function ChessDataProvider({ children }: { children: React.ReactNode }) {
  const { settings, updateSettings } = useTheme();
  const { authResolved } = useAuth();

  // Only skip while auth is still resolving. Once resolved, fetch without filters
  // — server-side RLS ensures data isolation (created_by_id filter is unreliable
  // because Base44's stored created_by_id doesn't match auth.me().id).
  const skipFetch = !authResolved;

  // ── Single fetch of core entities (RLS-protected on server) ──
  const [rawGames, gamesLoading, , refetchGames] = useEntityList<GameRecord>(
    'Game', undefined, undefined, skipFetch,
  );
  const [rawAnalyses, analysesLoading, , refetchAnalyses] = useEntityList<GameAnalysis>(
    'Analysis',
    undefined,
    deserializeAnalysis as (raw: unknown) => GameAnalysis,
    skipFetch,
  );
  // For singleton: undefined means "fetch without user filter" (RLS handles isolation).
  // null means "still loading" (skip fetch).
  const singletonUserId = authResolved ? undefined : null;
  const [patterns, , patternsLoading, refetchPatterns] = useSingletonEntity<CurrentPatterns & Record<string, unknown>>(
    'Pattern',
    DEFAULT_PATTERNS,
    deserializePattern as (raw: Record<string, unknown>) => CurrentPatterns & Record<string, unknown>,
    undefined,
    singletonUserId,
  );

  const dataLoading = gamesLoading || analysesLoading || patternsLoading;

  // ── Deduplicate games by gameId (chess.com ID) ──
  const allGames = useMemo(() => {
    const seen = new Set<string>();
    return rawGames.filter((g) => {
      const key = (g as Record<string, unknown>).gameId as string | undefined;
      if (!key) return true; // keep games without gameId
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [rawGames]);

  const allAnalyses = rawAnalyses;

  // ── Game counts (all games, no time-class filter) ──
  const totalGameCount = allGames.length;
  const analyzedCount = useMemo(
    () => allGames.filter((g) => g.analysisStatus === 'complete').length,
    [allGames],
  );
  const analyzingCount = useMemo(
    () => allGames.filter((g) => g.analysisStatus === 'analyzing').length,
    [allGames],
  );
  const pendingCount = totalGameCount - analyzedCount - analyzingCount;

  // ── Lookups ──
  const gamesMap = useMemo(() => {
    const map: Record<string, GameRecord> = {};
    for (const g of allGames) map[g.id] = g;
    return map;
  }, [allGames]);

  const availableTimeClasses = useMemo(
    () => new Set(allGames.map((g) => g.timeClass)),
    [allGames],
  );

  // ── Filtered by selected time class ──
  const timeClassFilter = settings.selectedTimeClass ?? null;

  const games = useMemo(
    () => (timeClassFilter ? allGames.filter((g) => g.timeClass === timeClassFilter) : allGames),
    [allGames, timeClassFilter],
  );

  const analyses = useMemo(() => {
    if (!timeClassFilter) return allAnalyses;
    const filteredIds = new Set(games.map((g) => g.id));
    return allAnalyses.filter((a) => filteredIds.has(a.gameId));
  }, [allAnalyses, games, timeClassFilter]);

  const filteredAnalyzedCount = useMemo(
    () => games.filter((g) => g.analysisStatus === 'complete').length,
    [games],
  );
  const filteredAnalyzingCount = useMemo(
    () => games.filter((g) => g.analysisStatus === 'analyzing').length,
    [games],
  );

  const playerElo = useMemo(() => {
    const sorted = [...games].filter((g) => g.player?.rating).sort((a, b) => b.playedAt - a.playedAt);
    return sorted[0]?.player?.rating ?? 1200;
  }, [games]);

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

  const patternsUnlocked = !!(
    settings.patternsUnlockedAt ||
    (hasPatterns && isDifferentCalendarDay(settings.radarRevealedAt))
  );

  const journeyStage = useMemo((): JourneyStage => {
    const stage: JourneyStage =
      totalGameCount === 0 ? 0 :
      !settings.radarRevealedAt ? 1 :
      !patternsUnlocked ? 2 :
      !settings.guidedWalkthroughDone ? 4 : 5;
    console.log('[Chess DNA] journeyStage:', stage, '— totalGames:', totalGameCount, 'radarRevealed:', !!settings.radarRevealedAt, 'patternsUnlocked:', patternsUnlocked);
    return stage;
  }, [totalGameCount, settings.radarRevealedAt, patternsUnlocked, settings.guidedWalkthroughDone]);

  // ── Auto-unlock patterns on new calendar day ──
  useEffect(() => {
    if (
      settings.radarRevealedAt &&
      !settings.patternsUnlockedAt &&
      hasPatterns &&
      isDifferentCalendarDay(settings.radarRevealedAt)
    ) {
      updateSettings({ patternsUnlockedAt: Date.now() });
    }
  }, [settings.radarRevealedAt, settings.patternsUnlockedAt, hasPatterns, updateSettings]);

  // ── Analysis event listener — auto-refetch ──
  // In batch mode, skip per-game refetch to prevent incremental dashboard re-renders.
  useEffect(() => {
    const unsub = analysisEvents.on((event) => {
      if (event.type === 'complete' && !isBatchMode()) {
        refetchGames();
        refetchAnalyses();
      } else if (event.type === 'all_complete') {
        refetchGames();
        refetchAnalyses();
        refetchPatterns();
      }
    });
    return unsub;
  }, [refetchGames, refetchAnalyses, refetchPatterns]);

  // ── Refetch all ──
  const refetchAll = useCallback(() => {
    refetchGames();
    refetchAnalyses();
    refetchPatterns();
  }, [refetchGames, refetchAnalyses, refetchPatterns]);

  // ── Memoized context value ──
  const value = useMemo<ChessDataContextValue>(
    () => ({
      allGames,
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
      refetchGames,
      refetchAnalyses,
      refetchPatterns,
      refetchAll,
    }),
    [
      allGames, allAnalyses, patterns,
      gamesLoading, analysesLoading, patternsLoading, dataLoading,
      totalGameCount, analyzedCount, analyzingCount, pendingCount,
      gamesMap, availableTimeClasses,
      games, analyses, filteredAnalyzedCount, filteredAnalyzingCount,
      profile, weakest, strongest, playerElo,
      tier, tierProgress, nextTier,
      benchmark, leadersBenchmark, overallPercentile,
      journeyStage, hasPatterns, hasAI, patternsUnlocked,
      refetchGames, refetchAnalyses, refetchPatterns, refetchAll,
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
