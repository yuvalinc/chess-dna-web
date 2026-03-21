import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHESS_COM_API_BASE } from '@shared/constants';
import { importChessComGames } from '@/api/chess-com-import';
import { base44 } from '@/api/base44Client';
import { runBatchAnalysis, runAnalysisPipeline, deserializePatternSnapshot, deserializeTrainingPlan, serializeTrainingPlan, deserializeLesson, deserializeExercise } from '@/engine/analysis-pipeline';
import { analysisEvents, setBatchMode } from '@/engine/analysis-events';
import { useEntityList, useSingletonEntity } from '@/hooks/useEntity';
import { useChessData } from '@/contexts/ChessDataContext';
import { useAuth } from '@/contexts/AuthContext';
import type { CurrentPatterns, SkillDimension } from '@shared/types/patterns';
import type { GameRecord, TimeClass } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { UserSettings } from '@shared/types/storage';
import { calculateSkillProfile, getWeakestDimensions, getStrongestDimensions } from '@/patterns/skill-calculator';
import { hasAnyProvider } from '@/ai/ai-router';
import { getThemeLabel } from '@/patterns/pattern-engine';
import type { TrainingPlanState } from '@shared/types/training';
import type { Exercise, Lesson } from '@shared/types/ai';
import type { PatternSnapshot } from '@shared/types/patterns';
import { generateTrainingPlanOptions, updatePlanProgress, computeTrainingAccuracy } from '@/patterns/training-planner';
import { getTierForScore, getTierColor, getTierGlowColor, getTierProgress, getNextTier, pointsToNextTier, ALL_TIERS } from '@/patterns/rank-tiers';
import {
  getOverallPercentile,
  getRatingRangeLabel,
} from '@/patterns/score-benchmarks';
import { computeWindowedProfile, computePatternsFromGames, TIME_WINDOWS, DEFAULT_WINDOW, type TimeWindowId } from '@/patterns/windowed-profile';
import SkillRadar from '@/components/SkillRadar';
import ChartGallery from '@/components/ChartGallery/ChartGallery';
import TimeWindowTabs from '@/components/TimeWindowTabs';
import { useAudioPlayer } from '@/contexts/AudioPlayerContext';
import { type JourneyStage } from '@/components/Onboarding';
import { useTheme } from '@/components/ThemeContext';
import FriendCompare from '@/components/FriendCompare';

interface OverviewProps {
  stageOverride?: JourneyStage | null;
  timeClassFilter?: TimeClass | null;
}

export default function Overview({ stageOverride, timeClassFilter: timeClassFilterProp }: OverviewProps) {
  const navigate = useNavigate();
  const { settings, updateSettings, isAdmin } = useTheme();
  const {
    patterns,
    allGames,
    allAnalyses,
    games,
    analyses,
    dataLoading,
    filteredAnalyzedCount: analyzedCount,
    filteredAnalyzingCount: analyzingCount,
    totalGameCount,
    analyzedCount: globalAnalyzedCount,
    analyzingCount: globalAnalyzingCount,
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
    refetchGames,
    refetchAnalyses,
    refetchPatterns,
  } = useChessData();

  // Use prop if provided, otherwise read from settings
  const timeClassFilter = timeClassFilterProp ?? settings.selectedTimeClass ?? null;

  // Admin stage navigator (isAdmin comes from ThemeContext)
  const [adminStageOverride, setAdminStageOverride] = useState<JourneyStage | null>(null);

  const effectiveStage = stageOverride ?? adminStageOverride ?? journeyStage;

  const [activeWindow, setActiveWindow] = useState<TimeWindowId>(DEFAULT_WINDOW);
  const [statsExpanded, setStatsExpanded] = useState(true);
  const [activeChartIndex, setActiveChartIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Await all three refetches to ensure data is updated before clearing the spinner
      await Promise.all([
        refetchGames(),
        refetchAnalyses(),
        refetchPatterns(),
      ]);
    } catch {
      // ignore — hooks handle their own errors
    } finally {
      // Brief delay so the user sees the spin feedback
      setTimeout(() => setRefreshing(false), 400);
    }
  }, [refetchGames, refetchAnalyses, refetchPatterns]);

  // Global audio player
  const { state: audioState, controls: audioControls } = useAudioPlayer();

  // Sync state — shows whenever games need importing or analyzing
  const [syncStatus, setSyncStatus] = useState<{
    phase: 'importing' | 'analyzing';
    currentType: 'rapid' | 'blitz' | 'bullet';
    imported: number;
    total: number;
    analyzed: number;
    analyzeTotal: number;
  } | null>(null);
  // Suppress per-game refetches during a type's analysis to prevent flicker
  const syncAnalyzingRef = useRef(false);
  const syncTriggeredRef = useRef(false);

  // Windowed profile computation for the active time window
  const windowedData = useMemo(() => {
    const windowDef = TIME_WINDOWS.find(w => w.id === activeWindow)!;
    return computeWindowedProfile(games, analyses, windowDef.gameCount);
  }, [games, analyses, activeWindow]);

  // Windowed analyses (filtered to match windowed games — for chart gallery)
  const windowedAnalyses = useMemo(() => {
    const gameIds = new Set(windowedData.games.map((g) => g.id));
    return analyses.filter((a) => gameIds.has(a.gameId));
  }, [analyses, windowedData.games]);

  // Windowed dimensions for stat squares
  const windowedWeakest = useMemo(() => getWeakestDimensions(windowedData.profile, 3), [windowedData.profile]);
  const windowedStrongest = useMemo(() => getStrongestDimensions(windowedData.profile, 2), [windowedData.profile]);
  const windowedPercentile = useMemo(
    () => getOverallPercentile(windowedData.profile, playerElo),
    [windowedData.profile, playerElo],
  );

  // radarBenchmarks removed — no longer using vs-mode comparison

  // Note: Auto-unlock patterns + analysis event refetching now handled by ChessDataContext

  // Auto-analyze games that aren't complete (works at any stage)
  // During onboarding (S1): only analyze the 5 onboarding games
  // Post-onboarding: analyze all unanalyzed games
  const analysisTriggeredRef = useRef(false);
  useEffect(() => {
    if (games.length === 0) return;
    if (analysisTriggeredRef.current || syncTriggeredRef.current) return;

    const onboardingIds = settings.onboardingGameIds ?? [];
    const isOnboarding = onboardingIds.length > 0 && !settings.radarRevealedAt;

    // Include games that are pending, errored, or stuck in 'analyzing' (from a previous interrupted session)
    const needsAnalysis = (g: typeof games[0]) =>
      g.analysisStatus !== 'complete';

    let toAnalyze: typeof games;
    if (isOnboarding) {
      const idSet = new Set(onboardingIds);
      toAnalyze = games.filter(
        (g) => idSet.has(g.id) && needsAnalysis(g),
      );
    } else {
      toAnalyze = games.filter(needsAnalysis);
    }

    if (toAnalyze.length === 0) return;

    analysisTriggeredRef.current = true;
    setBatchMode(true); // suppress per-game refetch — only update on all_complete
    const gameIds = toAnalyze.map((g) => g.id);
    console.log('[Chess DNA] Auto-analyzing', gameIds.length, 'games', isOnboarding ? '(onboarding only)' : '');
    runBatchAnalysis(gameIds, settings.analysisDepth ?? 18)
      .then(() => {
        setBatchMode(false);
        analysisTriggeredRef.current = false;
      })
      .catch((err) => {
        setBatchMode(false);
        console.error('[Chess DNA] Batch analysis failed:', err);
        analysisTriggeredRef.current = false;
      });
  }, [games, settings.analysisDepth, settings.onboardingGameIds, settings.radarRevealedAt]);

  // Sync: incremental import + analyze NEW games only.
  // Runs once per page load at S5+. Only processes freshly imported games.
  useEffect(() => {
    if (effectiveStage < 5) return;
    if (syncTriggeredRef.current) return;
    if (!settings.chesscomUsername) return;
    if (!settings.bulkImportDone) return; // initial bulk import handled by onboarding

    syncTriggeredRef.current = true;
    const username = settings.chesscomUsername;

    (async () => {
      const timeClasses = ['rapid', 'blitz', 'bullet'] as const;

      for (const tc of timeClasses) {
        // Phase 1: Import new games only (duplicates are skipped inside importChessComGames)
        setSyncStatus({ phase: 'importing', currentType: tc, imported: 0, total: 0, analyzed: 0, analyzeTotal: 0 });

        let newIds: string[] = [];
        try {
          newIds = await importChessComGames(username, {
            timeClass: tc,
            maxGames: 30,
            onProgress: (progress) => {
              setSyncStatus(prev => prev ? {
                ...prev,
                imported: progress.fetched,
                total: progress.total || 30,
              } : prev);
            },
          });
        } catch (err) {
          console.warn(`[Chess DNA] Sync import ${tc} failed:`, err);
        }

        // Phase 2: Analyze ONLY newly imported games (batch mode suppresses per-game refetch)
        if (newIds.length > 0) {
          setSyncStatus(prev => prev ? { ...prev, phase: 'analyzing', analyzed: 0, analyzeTotal: newIds.length } : prev);

          syncAnalyzingRef.current = true;
          analysisTriggeredRef.current = true;
          setBatchMode(true);
          try {
            for (let i = 0; i < newIds.length; i++) {
              await runAnalysisPipeline(newIds[i], settings.analysisDepth ?? 18);
              setSyncStatus(prev => prev ? { ...prev, analyzed: i + 1 } : prev);
            }
          } catch (err) {
            console.error(`[Chess DNA] Sync analysis ${tc} failed:`, err);
          } finally {
            setBatchMode(false);
            syncAnalyzingRef.current = false;
            analysisTriggeredRef.current = false;
          }

          // Refresh data ONCE after all games in this time class complete
          refetchGames();
          refetchAnalyses();
          refetchPatterns();
          console.log(`[Chess DNA] Sync ${tc}: ${newIds.length} new games imported & analyzed`);
        }
      }

      setSyncStatus(null);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- syncTriggeredRef prevents re-runs; refetch/analysis fns are stable
  }, [effectiveStage, settings.chesscomUsername, settings.bulkImportDone, settings.analysisDepth]);

  const handleDimensionClick = useCallback((id: string) => {
    document.getElementById(`dim-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  /* --- Admin stage navigator (floating overlay) --- */
  const adminNav = isAdmin ? (
    <AdminStageNav
      currentStage={effectiveStage}
      autoStage={journeyStage}
      isOverridden={adminStageOverride !== null}
      onSetStage={setAdminStageOverride}
      onUpdateSettings={updateSettings}
      refetchAll={() => { refetchGames(); refetchAnalyses(); refetchPatterns(); }}
      settings={settings}
    />
  ) : null;

  /* --- S0: Connect your chess.com account --- */
  if (effectiveStage === 0) {
    return (
      <>{adminNav}<Stage0Connect
        settings={settings}
        onSettingsChange={updateSettings}
        onImportComplete={() => {
          console.log('[Chess DNA] onImportComplete — calling refetchGames, refetchAnalyses & refetchPatterns');
          refetchGames();
          refetchAnalyses();
          refetchPatterns();
        }}
      /></>
    );
  }

  /* --- S1: Games imported -> analyzing -> "Unlock your Chess DNA" --- */
  if (effectiveStage === 1) {
    const obIds = settings.onboardingGameIds ?? [];
    const obIdSet = new Set(obIds);
    const s1Games = obIds.length > 0 ? games.filter(g => obIdSet.has(g.id)) : games;
    const s1AnalyzedCount = s1Games.filter(g => g.analysisStatus === 'complete').length;
    const s1AnalyzingCount = s1Games.filter(g => g.analysisStatus === 'analyzing').length;

    return (
      <>{adminNav}<Stage1Analysis
        games={s1Games}
        analyzedCount={s1AnalyzedCount}
        analyzingCount={s1AnalyzingCount}
        settings={settings}
        onUpdateSettings={updateSettings}
      /></>
    );
  }

  /* --- S2: Radar revealed, patterns day-gated --- */
  if (effectiveStage === 2) {
    // Scope to onboarding games for initial reveal
    const obIds2 = settings.onboardingGameIds ?? [];
    const obIdSet2 = new Set(obIds2);
    const s2Games = obIds2.length > 0 ? games.filter(g => obIdSet2.has(g.id)) : games;
    const s2Analyses = obIds2.length > 0 ? analyses.filter(a => obIdSet2.has(a.gameId)) : analyses;

    return (
      <>{adminNav}<Stage2RadarReveal
        tier={tier}
        tierProgress={tierProgress}
        nextTier={nextTier}
        playerElo={playerElo}
        strongest={strongest}
        weakest={weakest}
        overallPercentile={overallPercentile}
        games={s2Games}
        analyses={s2Analyses}
        totalGameCount={totalGameCount}
        globalAnalyzedCount={globalAnalyzedCount}
        globalAnalyzingCount={globalAnalyzingCount}
        onUpdateSettings={updateSettings}
        onboardingTimeClass={settings.onboardingTimeClass}
      /></>
    );
  }

  /* --- S3: (REMOVED -- S2 goes to S4 directly) --- */
  /* --- S4: Guided walkthrough -- patterns, training intro --- */
  if (effectiveStage === 4) {
    const obCount = (settings.onboardingGameIds ?? []).length || 5;
    const obTC = settings.onboardingTimeClass ?? 'rapid';
    const sampleText = `Based on a sample of ${obCount} ${obTC} game${obCount !== 1 ? 's' : ''}`;

    return (
      <>{adminNav}<Stage4GuidedWalkthrough
        patterns={patterns}
        hasAI={hasAnyProvider(settings)}
        totalGameCount={totalGameCount}
        globalAnalyzedCount={globalAnalyzedCount}
        globalAnalyzingCount={globalAnalyzingCount}
        onUpdateSettings={updateSettings}
        sampleText={sampleText}
      /></>
    );
  }

  /* --- S5: Fully onboarded -- combined DNA view --- */

  // Famous player benchmarks for S5 stat squares (combined)
  const magnusScore = 95;
  const hikaruScore = 93;

  // Win stats from windowed games
  const windowGames = windowedData.games;
  const winCount = windowGames.filter(g => g.player?.result === 'win').length;
  const winPct = windowGames.length > 0 ? Math.round((winCount / windowGames.length) * 100) : 0;

  // Windowed tier info -- so hero matches the radar
  const windowedTier = getTierForScore(windowedData.profile.overallRating);
  const windowedTierProgress = getTierProgress(windowedData.profile.overallRating);
  const windowedNextTier = getNextTier(windowedData.profile.overallRating);

  const handleGenerateAudio = () => {
    if (!hasAnyProvider(settings) || audioState.isGenerating) return;
    const profileScores = windowedData.profile.dimensions.map((d) => ({
      dimension: d.label,
      score: d.score,
    }));
    audioControls.generateAndPlay(settings, windowedData.games, windowedAnalyses, windowedData.patterns, profileScores);
  };

  return (
    <div className="pb-20">
      {adminNav}

      {/* Progress / sync badge */}
      <div className="mb-2">
        <div className="inline-flex items-center gap-1.5 bg-chess-surface/80 backdrop-blur-md rounded-lg px-2.5 py-1.5 border border-chess-border/30 text-[11px]">
          {syncStatus ? (() => {
            const isImporting = syncStatus.phase === 'importing';
            const done = isImporting ? syncStatus.imported : syncStatus.analyzed;
            const total = isImporting ? syncStatus.total : syncStatus.analyzeTotal;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <>
                <span className={`text-chess-accent ${!isImporting ? 'animate-pulse' : ''}`}>
                  {isImporting ? '🔄' : '🧬'}
                </span>
                <span className="text-chess-text-secondary">
                  {isImporting ? `Checking ${syncStatus.currentType}` : `Analyzing ${syncStatus.currentType}`}
                </span>
                {(!isImporting && total > 0) && (
                  <span className="text-chess-accent font-semibold">{done}/{total} · {pct}%</span>
                )}
              </>
            );
          })() : globalAnalyzedCount < totalGameCount ? (
            <>
              <span className="text-chess-accent animate-pulse">🧬</span>
              <span className="text-chess-text-secondary">Analyzing</span>
              <span className="text-chess-accent font-semibold">{globalAnalyzedCount}/{totalGameCount}</span>
              <div className="w-16 bg-chess-muted/40 rounded-full h-1 overflow-hidden">
                <div className="bg-chess-accent h-full rounded-full transition-all duration-500" style={{ width: `${totalGameCount > 0 ? (globalAnalyzedCount / totalGameCount) * 100 : 0}%` }} />
              </div>
            </>
          ) : (
            <span className="text-chess-text-secondary">{globalAnalyzedCount} games analyzed</span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={`text-chess-accent hover:text-chess-text font-semibold transition-colors ml-1 ${refreshing ? 'animate-spin' : ''}`}
          >
            ↻
          </button>
        </div>
      </div>

      {/* Score hero + radar — gate on data loaded to prevent number flash */}
      {dataLoading ? (
        <div className="flex flex-col items-center gap-4 py-12">
          <div className="w-6 h-6 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-500">Loading your Chess DNA...</span>
        </div>
      ) : analyzedCount < 5 ? (
        <div className="flex flex-col items-center gap-4 py-10 animate-fade-in">
          <div className="text-4xl animate-pulse" style={{ filter: 'drop-shadow(0 0 12px rgba(74,222,128,0.5))' }}>
            {'\uD83E\uDDEC'}
          </div>
          <h2 className="text-lg font-black text-chess-text">Building your Chess DNA</h2>
          <p className="text-sm text-gray-400 text-center max-w-xs">
            Need at least 5 analyzed games for an accurate profile.{' '}
            {globalAnalyzedCount < totalGameCount
              ? `Analyzing ${globalAnalyzedCount}/${totalGameCount}…`
              : `Only ${analyzedCount} analyzed so far.`}
          </p>
          <div className="w-48 bg-chess-muted/40 rounded-full h-2 overflow-hidden">
            <div
              className="bg-chess-accent h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.min((analyzedCount / 5) * 100, 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-500">{analyzedCount}/5 games ready</span>
        </div>
      ) : (
        <>
          {/* Score hero -- uses WINDOWED profile to match the radar below */}
          <ScoreHero profile={windowedData.profile} tier={windowedTier} tierProgress={windowedTierProgress} nextTier={windowedNextTier} playerElo={playerElo} totalAnalyzed={analyzedCount} />

          {/* Training plan banner */}
          <TrainingPlanBanner
            profile={windowedData.profile}
            patterns={windowedData.patterns}
            onNavigateToExercises={() => navigate('/training')}
          />

          {/* Time window tabs */}
          <TimeWindowTabs
            activeWindow={activeWindow}
            onWindowChange={setActiveWindow}
            analyzedGameCount={analyzedCount}
          />

          {/* Chart Gallery */}
          <div className="space-y-4">
            <div>
              <ChartGallery
                games={windowedData.games}
                analyses={windowedAnalyses}
                profile={windowedData.profile}
                onDimensionClick={handleDimensionClick}
                onChartChange={setActiveChartIndex}
              />
            </div>

            {/* Audio Summary */}
            {hasAnyProvider(settings) && windowedData.games.length >= 3 && (
              <SummaryAudioSection
                analyzedCount={windowedData.games.length}
                onGenerate={handleGenerateAudio}
              />
            )}

            {/* Review Latest Game */}
            {(() => {
              const latestGame = games
                .filter(g => g.analysisStatus === 'complete')
                .sort((a, b) => b.playedAt - a.playedAt)[0];
              if (!latestGame) return null;
              const latestAnalysis = allAnalyses.find(a => a.gameId === latestGame.id);
              return (
                <button
                  onClick={() => navigate(`/games/${latestGame.id}`)}
                  className="w-full rounded-xl bg-chess-surface/30 border border-chess-border/30 p-3 text-left hover:border-chess-accent/30 transition-all"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Latest Game</span>
                    <span className="text-[10px] text-chess-accent font-bold">Review {'\u2192'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold ${latestGame.player.result === 'win' ? 'text-chess-accent' : latestGame.player.result === 'loss' ? 'text-red-400' : 'text-gray-400'}`}>
                      {latestGame.player.result.toUpperCase()}
                    </span>
                    <span className="text-sm text-chess-text">vs {latestGame.opponent.username}</span>
                    <span className="text-xs text-gray-500">({latestGame.opponent.rating})</span>
                    {latestAnalysis && (
                      <span className="ml-auto text-xs text-gray-400">{latestAnalysis.summary.accuracy}% acc</span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {latestGame.opening?.name ?? 'Unknown'} {'\u00B7'} {latestGame.timeClass}
                  </div>
                </button>
              );
            })()}

            {/* Stat Squares -- collapsible */}
            <div className="rounded-xl border border-chess-border/30 overflow-hidden">
              <button
                onClick={() => setStatsExpanded(e => !e)}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-chess-surface/20 hover:bg-chess-surface/30 transition-colors"
              >
                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Your Stats</span>
                <span className="text-gray-500 text-xs">{statsExpanded ? '\u25B2' : '\u25BC'}</span>
              </button>
              {statsExpanded && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
                  {/* Percentile */}
                  <div className="rounded-xl p-3 bg-chess-surface/30 border border-chess-border/30 text-center">
                    <div className="text-lg mb-0.5">{'\uD83D\uDCCA'}</div>
                    <div className="text-2xl font-black text-chess-text">Top {Math.max(1, 100 - windowedPercentile)}%</div>
                    <div className="text-[10px] text-gray-500">among {getRatingRangeLabel(playerElo)}</div>
                  </div>

                  {/* vs World's Best */}
                  <div className="rounded-xl p-3 bg-chess-surface/30 border border-chess-border/30 text-center">
                    <div className="text-lg mb-0.5">{'\uD83C\uDF0D'}</div>
                    <div className="text-[10px] text-gray-500 mb-0.5">vs World's Best</div>
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-[10px] text-gray-400">Magnus <span className="font-bold text-chess-text">{magnusScore}</span></span>
                      <span className="text-gray-600">{'\u00B7'}</span>
                      <span className="text-[10px] text-gray-400">Hikaru <span className="font-bold text-chess-text">{hikaruScore}</span></span>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {Math.min(magnusScore, hikaruScore) - windowedData.profile.overallRating > 0
                        ? `${Math.min(magnusScore, hikaruScore) - windowedData.profile.overallRating} pts to beat both`
                        : 'You beat them both!'}
                    </div>
                  </div>

                  {/* Win Rate */}
                  <div className="rounded-xl p-3 bg-chess-surface/30 border border-chess-border/30 text-center">
                    <div className="text-lg mb-0.5">{'\u2694\uFE0F'}</div>
                    <div className="text-[10px] text-gray-500 mb-0.5">Last {windowGames.length} Games</div>
                    <div className="text-2xl font-black text-chess-text">{winPct}%</div>
                    <div className="text-[10px] text-gray-500">{winCount}W {'\u00B7'} {windowGames.filter(g => g.player?.result === 'loss').length}L {'\u00B7'} {windowGames.filter(g => g.player?.result === 'draw').length}D</div>
                    {games.length > 0 && (
                      <button onClick={() => navigate('/games')} className="text-[9px] text-chess-accent hover:underline mt-1">
                        See all {games.length} games {'\u2192'}
                      </button>
                    )}
                  </div>

                  {/* ELO */}
                  <div className="rounded-xl p-3 bg-chess-surface/30 border border-chess-border/30 text-center">
                    <div className="text-lg mb-0.5">{'\uD83D\uDCC8'}</div>
                    <div className="text-[10px] text-gray-500 mb-0.5">Your ELO</div>
                    <div className="text-2xl font-black text-chess-text">{playerElo}</div>
                    <div className="text-[10px] text-gray-500">{getRatingRangeLabel(playerElo)}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Share button */}
            <ShareButton profile={windowedData.profile} tier={windowedTier} playerElo={playerElo} />

            {/* Compare with friends */}
            <div className="mt-4">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">
                Compare with Friends
              </h3>
              <FriendCompare />
            </div>
          </div>
        </>
      )}

      {/* Sticky bottom CTA — above bottom nav bar (z-50, ~60px tall) */}
      <div className="fixed bottom-[60px] left-0 right-0 z-[51] bg-chess-bg/95 backdrop-blur-md px-3 py-2">
        <div className="max-w-6xl mx-auto">
          <button
            onClick={() => navigate('/training')}
            className="w-full bg-chess-accent text-chess-bg py-3 rounded-xl text-sm font-black hover:brightness-110 transition-all shadow-[0_0_12px_rgba(74,222,128,0.2)]"
          >
            Let's get better {'\u2192'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
 *  Patterns Panel (right column in S5)
 * ================================================================ */

/* ================================================================
 *  S0: Connect chess.com account
 * ================================================================ */

function Stage0Connect({
  settings: _settings,
  onSettingsChange,
  onImportComplete,
}: {
  settings: UserSettings;
  onSettingsChange: (patch: Partial<UserSettings>) => Promise<void>;
  onImportComplete: () => void;
}) {
  void _settings; // Available for future use
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUsernameHelp, setShowUsernameHelp] = useState(false);
  const [fetchState, setFetchState] = useState<{
    phase: 'idle' | 'validating' | 'fetching' | 'done';
    fetched: number;
    total: number;
    error?: string;
  }>({ phase: 'idle', fetched: 0, total: 0 });

  const handleConnect = async () => {
    const trimmed = username.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setFetchState({ phase: 'validating', fetched: 0, total: 0 });

    try {
      const resp = await fetch(`${CHESS_COM_API_BASE}/player/${trimmed.toLowerCase()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) {
        setError('Username not found on chess.com');
        setFetchState({ phase: 'idle', fetched: 0, total: 0 });
        setLoading(false);
        return;
      }

      // Import 5 games with fallback: rapid → blitz → bullet → all
      setFetchState({ phase: 'fetching', fetched: 0, total: 5 });

      const fallbackOrder: Array<'rapid' | 'blitz' | 'bullet' | 'all'> = ['rapid', 'blitz', 'bullet', 'all'];
      let onboardingIds: string[] = [];
      let usedTimeClass = 'rapid';

      for (const tc of fallbackOrder) {
        onboardingIds = await importChessComGames(trimmed, {
          timeClass: tc,
          maxGames: 5,
          onProgress: (progress) => {
            setFetchState({
              phase: progress.done ? 'done' : 'fetching',
              fetched: progress.fetched,
              total: progress.total || 5,
              error: progress.error,
            });
          },
        });
        if (onboardingIds.length > 0) {
          usedTimeClass = tc;
          break;
        }
      }

      // Save username + onboarding metadata
      await onSettingsChange({
        chesscomUsername: trimmed,
        onboardingGameIds: onboardingIds,
        onboardingTimeClass: usedTimeClass,
      });

      // Notify ChessDataContext so it refetches games → totalGameCount > 0 → stage transitions to S1
      onImportComplete();

      // Continue importing remaining games in background
      (async () => {
        try {
          await importChessComGames(trimmed, { timeClass: 'rapid', maxGames: 30 });
          await importChessComGames(trimmed, { timeClass: 'blitz', maxGames: 30 });
          await importChessComGames(trimmed, { timeClass: 'bullet', maxGames: 30 });
        } catch (err) {
          console.warn('[Chess DNA] Background import failed:', err);
        } finally {
          onSettingsChange({ bulkImportDone: true });
          console.log('[Chess DNA] Background import complete — bulkImportDone set');
        }
      })();

    } catch {
      setError('Could not connect. Check your internet.');
      setFetchState({ phase: 'idle', fetched: 0, total: 0 });
    } finally {
      setLoading(false);
    }
  };

  const isFetching = fetchState.phase === 'fetching' || fetchState.phase === 'validating';
  const isDone = fetchState.phase === 'done';

  return (
    <div className="max-w-md mx-auto py-12">
      <div className="text-center mb-8">
        <div className="text-5xl mb-4 glow-green-lg">{'\uD83E\uDDEC'}</div>
        <h2 className="text-xl font-black mb-2">Welcome to <span className="text-chess-accent glow-green">Chess DNA</span></h2>
        <p className="text-[10px] text-chess-accent/50 uppercase tracking-[0.2em] mb-3">AI-Powered Coach</p>
        <p className="text-gray-400 text-sm max-w-xs mx-auto">
          Enter your <span className="font-bold text-chess-text">Chess.com</span> username and we'll analyze your recent games to build your personalized Chess DNA profile.
        </p>
        <p className="text-[10px] text-gray-500 mt-2">No password needed {'\u2014'} we only read public game data.</p>
      </div>

      <div className="bg-chess-surface rounded-xl p-4 border border-chess-border/30 mb-4">
        <div className="flex items-center gap-1.5 mb-2">
          <label className="text-[10px] text-gray-500 uppercase tracking-widest">
            Chess.com username
          </label>
          <button
            onClick={() => setShowUsernameHelp(h => !h)}
            className="w-4 h-4 rounded-full bg-chess-muted/60 text-gray-400 text-[10px] font-bold flex items-center justify-center hover:bg-chess-muted hover:text-chess-text-secondary transition-colors"
            title="How to find your username"
          >
            ?
          </button>
        </div>
        {showUsernameHelp && (
          <div className="bg-chess-bg/50 rounded-lg p-3 mb-3 border border-chess-border/30 text-xs text-gray-400 space-y-1.5">
            <p className="font-medium text-chess-text-secondary">How to find your username:</p>
            <p>1. Go to <span className="font-bold text-chess-text">chess.com</span> and log in</p>
            <p>2. Click your profile icon (top right)</p>
            <p>3. Your username is shown at the top of your profile</p>
            <p>4. It's also in the URL: chess.com/member/<span className="text-chess-accent">your_username</span></p>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === 'Enter' && !isFetching && handleConnect()}
            placeholder="your_username"
            disabled={isFetching || isDone}
            className="flex-1 bg-chess-bg border border-chess-border/40 rounded-lg px-3 py-2 text-sm text-chess-text placeholder:text-gray-600 focus:outline-none focus:border-chess-accent/50 disabled:opacity-50"
          />
        </div>
        {error && <p className="text-chess-blunder text-xs mt-2">{error}</p>}
      </div>

      <button
        onClick={handleConnect}
        disabled={loading || isFetching || isDone || !username.trim()}
        className="w-full bg-chess-accent text-chess-bg py-3 rounded-xl text-sm font-black hover:brightness-110 transition-all shadow-[0_0_12px_rgba(74,222,128,0.25)] disabled:opacity-50 mb-4"
      >
        {loading && !isFetching ? 'Connecting...' : 'Get and analyze my games'}
      </button>

      {fetchState.phase === 'validating' && (
        <div className="bg-chess-surface/50 rounded-xl p-4 border border-chess-border/30 mb-4 text-center">
          <div className="text-sm text-gray-400 animate-pulse">Validating username...</div>
        </div>
      )}

      {fetchState.phase === 'fetching' && (
        <div className="bg-chess-surface/50 rounded-xl p-4 border border-chess-border/30 mb-4">
          <div className="flex justify-between text-[11px] text-gray-400 mb-2">
            <span>Importing your rapid games...</span>
            <span>{fetchState.fetched} / {fetchState.total || 5}</span>
          </div>
          <div className="w-full bg-chess-muted/60 rounded-full h-2 overflow-hidden">
            <div
              className="bg-chess-accent h-full rounded-full transition-all duration-500"
              style={{ width: `${(fetchState.fetched / (fetchState.total || 5)) * 100}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-500 mt-2">Fetching your 5 most recent rapid games...</p>
        </div>
      )}

      {isDone && !fetchState.error && (
        <div className="bg-chess-accent/5 rounded-xl p-4 border border-chess-accent/20 mb-4 text-center">
          <div className="text-2xl mb-1">{'\u2713'}</div>
          <div className="text-sm font-bold text-chess-text">
            Games imported! Analysis starting...
          </div>
          <p className="text-[10px] text-gray-400 mt-1">
            This page will update automatically once analysis begins.
          </p>
        </div>
      )}

      {isDone && fetchState.error && (
        <div className="bg-chess-blunder/5 rounded-xl p-4 border border-chess-blunder/20 mb-4 text-center">
          <div className="text-sm text-chess-blunder">{fetchState.error}</div>
          <p className="text-[10px] text-gray-400 mt-1">
            You can still play on chess.com {'\u2014'} games will be detected automatically.
          </p>
        </div>
      )}

      {!isFetching && !isDone && (
        <div className="space-y-2">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest px-1">Other platforms</p>
          <button disabled className="w-full flex items-center gap-3 bg-chess-surface/30 rounded-xl p-3 border border-chess-border/30 opacity-40 cursor-not-allowed">
            <span className="text-lg">{'\u265E'}</span>
            <div className="flex-1 text-left">
              <div className="text-sm font-medium text-gray-400">Lichess</div>
            </div>
            <span className="text-[9px] bg-chess-accent/10 text-chess-accent px-2 py-0.5 rounded-full font-medium">Soon</span>
          </button>
          <button disabled className="w-full flex items-center gap-3 bg-chess-surface/30 rounded-xl p-3 border border-chess-border/30 opacity-40 cursor-not-allowed">
            <span className="text-lg">{'\u265A'}</span>
            <div className="flex-1 text-left">
              <div className="text-sm font-medium text-gray-400">Chess24</div>
            </div>
            <span className="text-[9px] bg-chess-accent/10 text-chess-accent px-2 py-0.5 rounded-full font-medium">Soon</span>
          </button>
          <button disabled className="w-full flex items-center gap-3 bg-chess-surface/30 rounded-xl p-3 border border-chess-border/30 opacity-40 cursor-not-allowed">
            <span className="text-lg">{'\u265C'}</span>
            <div className="flex-1 text-left">
              <div className="text-sm font-medium text-gray-400">Chess.org</div>
            </div>
            <span className="text-[9px] bg-chess-accent/10 text-chess-accent px-2 py-0.5 rounded-full font-medium">Soon</span>
          </button>
        </div>
      )}

      <p className="text-[10px] text-gray-600 text-center mt-6">
        We only read public game data. Nothing is stored on our servers.
      </p>
    </div>
  );
}

/* ================================================================
 *  S1: Analysis Loading -- Premium Experience
 * ================================================================ */

function Stage1Analysis({
  games,
  analyzedCount,
  analyzingCount,
  settings,
  onUpdateSettings,
}: {
  games: GameRecord[];
  analyzedCount: number;
  analyzingCount: number;
  settings: UserSettings;
  onUpdateSettings: (patch: Partial<UserSettings>) => Promise<void>;
}) {
  const totalGames = games.length;
  const [showBurst, setShowBurst] = useState(false);

  // Track per-move analysis progress via event bus
  const [moveProgress, setMoveProgress] = useState<{ moveIndex: number; totalMoves: number } | null>(null);
  const [localAnalyzed, setLocalAnalyzed] = useState(0);

  const pendingCount = totalGames - analyzedCount - analyzingCount;
  // Allow unlock after 5 games analyzed (rest continues in background)
  const MIN_GAMES_FOR_UNLOCK = 5;
  const effectiveAnalyzedForGate = Math.max(analyzedCount, localAnalyzed);
  const canUnlock = totalGames > 0 && (
    effectiveAnalyzedForGate >= totalGames ||
    effectiveAnalyzedForGate >= MIN_GAMES_FOR_UNLOCK
  );
  const allDone = effectiveAnalyzedForGate >= totalGames && totalGames > 0;
  const remainingAfterUnlock = totalGames - effectiveAnalyzedForGate;

  useEffect(() => {
    const unsub = analysisEvents.on((event) => {
      if (event.type === 'progress') {
        setMoveProgress({ moveIndex: event.moveIndex, totalMoves: event.totalMoves });
      } else if (event.type === 'complete') {
        setLocalAnalyzed((prev) => prev + 1);
        setMoveProgress(null);
      }
    });
    return unsub;
  }, []);

  // Calculate smooth progress: completed games + fractional progress of current game
  // Use the higher of entity-based count vs local event-based count for real-time feel
  const effectiveAnalyzed = Math.max(analyzedCount, localAnalyzed);
  const currentGameFraction = moveProgress
    ? moveProgress.moveIndex / moveProgress.totalMoves
    : (analyzingCount > 0 || (localAnalyzed < totalGames && localAnalyzed > 0) ? 0.01 : 0);
  // Show progress toward unlock threshold (5 games) when there are many games,
  // otherwise show progress toward all games
  const progressTarget = totalGames > MIN_GAMES_FOR_UNLOCK ? MIN_GAMES_FOR_UNLOCK : totalGames;
  const progressPct = progressTarget > 0
    ? Math.min(((effectiveAnalyzed + currentGameFraction) / progressTarget) * 100, 100)
    : 0;


  const handleUnlock = () => {
    setShowBurst(true);
    setTimeout(() => {
      onUpdateSettings({ radarRevealedAt: Date.now() });
    }, 600);
  };

  // Orbit pieces
  const orbitPieces = [
    { piece: '\u2654', delay: '0s', duration: '6s' },
    { piece: '\u265B', delay: '1.5s', duration: '7s' },
    { piece: '\u265D', delay: '3s', duration: '8s' },
    { piece: '\u265E', delay: '4.5s', duration: '5.5s' },
  ];

  if (canUnlock) {
    return (
      <div className="max-w-md mx-auto text-center py-12 relative">
        {/* Burst effect */}
        {showBurst && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-32 h-32 rounded-full bg-chess-accent/30 animate-unlock-burst" />
            <div className="w-24 h-24 rounded-full bg-chess-accent/20 animate-unlock-burst" style={{ animationDelay: '0.1s' }} />
          </div>
        )}

        <div className="animate-scale-in">
          <div className="text-6xl mb-4" style={{ filter: 'drop-shadow(0 0 20px rgba(74,222,128,0.6))' }}>
            {'\uD83E\uDDEC'}
          </div>
          <h2 className="text-2xl font-black mb-2 text-chess-text">
            {allDone ? 'Analysis Complete!' : 'Your Chess DNA is Ready!'}
          </h2>
          <p className="text-gray-400 text-sm mb-8 max-w-xs mx-auto">
            {effectiveAnalyzedForGate} game{effectiveAnalyzedForGate !== 1 ? 's' : ''} analyzed.
            {' '}Your Chess DNA profile is ready to be revealed.
          </p>

          <button
            onClick={handleUnlock}
            disabled={showBurst}
            className="bg-chess-accent text-chess-bg px-8 py-4 rounded-2xl text-lg font-black hover:brightness-110 transition-all animate-pulse-glow disabled:opacity-80"
          >
            Unlock your Chess DNA
          </button>

          {!allDone && remainingAfterUnlock > 0 && (
            <p className="text-[11px] text-gray-400 mt-4 flex items-center justify-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-chess-accent animate-pulse" />
              {remainingAfterUnlock} more game{remainingAfterUnlock !== 1 ? 's' : ''} analyzing in the background
            </p>
          )}

          <p className="text-[10px] text-gray-500 mt-3">
            Discover your 8-dimension skill profile, rank tier, and how you compare
          </p>
        </div>
      </div>
    );
  }

  // Still analyzing
  return (
    <div className="max-w-md mx-auto text-center py-12">
      {/* Orbiting chess pieces */}
      <div className="relative w-40 h-40 mx-auto mb-8">
        {/* Center DNA icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-4xl animate-pulse" style={{ filter: 'drop-shadow(0 0 12px rgba(74,222,128,0.5))' }}>
            {'\uD83E\uDDEC'}
          </div>
        </div>

        {/* Orbiting pieces */}
        {orbitPieces.map(({ piece, delay, duration }) => (
          <div
            key={piece}
            className="absolute inset-0 flex items-center justify-center"
            style={{
              animation: `orbit ${duration} linear infinite`,
              animationDelay: delay,
            }}
          >
            <span className="text-2xl opacity-60">{piece}</span>
          </div>
        ))}
      </div>

      <h2 className="text-xl font-black mb-2">Decoding your Chess DNA</h2>
      <p className="text-gray-400 text-sm mb-6 max-w-xs mx-auto">
        Stockfish is analyzing every move from {totalGames} game{totalGames !== 1 ? 's' : ''}.
      </p>

      {/* Circular progress */}
      <div className="relative w-32 h-32 mx-auto mb-6">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
          <circle cx="64" cy="64" r="56" fill="none" stroke="rgb(var(--chess-border))" strokeWidth="6" opacity="0.3" />
          <circle
            cx="64" cy="64" r="56" fill="none"
            stroke="rgb(var(--chess-accent))" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 56}`}
            strokeDashoffset={`${2 * Math.PI * 56 * (1 - progressPct / 100)}`}
            style={{ transition: 'stroke-dashoffset 0.7s ease-out', filter: 'drop-shadow(0 0 6px rgba(74,222,128,0.5))' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-black text-chess-accent">{Math.round(progressPct)}%</span>
          <span className="text-[9px] text-gray-500">{effectiveAnalyzed}/{progressTarget}</span>
        </div>
      </div>

      {/* Status details */}
      <div className="bg-chess-surface rounded-xl p-3 max-w-xs mx-auto mb-5">
        <div className="flex justify-between text-[11px] text-gray-400">
          <span>{analyzedCount} analyzed</span>
          <span>
            {analyzingCount > 0 && <span className="text-chess-accent animate-pulse mr-2">{analyzingCount} in progress</span>}
            {pendingCount > 0 && <span>{pendingCount} queued</span>}
          </span>
        </div>
      </div>

      {totalGames > MIN_GAMES_FOR_UNLOCK && effectiveAnalyzed < MIN_GAMES_FOR_UNLOCK && (
        <p className="text-xs text-chess-accent/80 mb-2">
          {MIN_GAMES_FOR_UNLOCK - effectiveAnalyzed} more game{MIN_GAMES_FOR_UNLOCK - effectiveAnalyzed !== 1 ? 's' : ''} until you can unlock your profile
        </p>
      )}
      <p className="text-xs text-gray-500 mb-4">
        {totalGames > MIN_GAMES_FOR_UNLOCK
          ? 'You can unlock after 5 games — the rest will continue in the background'
          : 'Usually takes 5-10 minutes'}
      </p>

      <p className="text-[10px] text-gray-600 mt-4">Feel free to close this tab and come back later.</p>
    </div>
  );
}

/* ================================================================
 *  S2: Radar Reveal + Stats + Friends + Patterns Teaser
 * ================================================================ */

function Stage2RadarReveal({
  tier,
  tierProgress,
  nextTier,
  playerElo,
  strongest,
  weakest,
  overallPercentile,
  games,
  analyses,
  totalGameCount,
  globalAnalyzedCount,
  globalAnalyzingCount,
  onUpdateSettings,
  onboardingTimeClass,
}: {
  tier: ReturnType<typeof getTierForScore>;
  tierProgress: number;
  nextTier: ReturnType<typeof getNextTier>;
  playerElo: number;
  strongest: SkillDimension[];
  weakest: SkillDimension[];
  overallPercentile: number;
  games: GameRecord[];
  analyses: GameAnalysis[];
  totalGameCount: number;
  globalAnalyzedCount: number;
  globalAnalyzingCount: number;
  onUpdateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  onboardingTimeClass?: string | null;
}) {
  // Compute patterns inline so S2 radar reflects real data (not stored patterns which may be empty)
  const { theme } = useTheme();
  const s2Patterns = useMemo(() => computePatternsFromGames(games, analyses, 1), [games, analyses]);
  const s2Profile = useMemo(() => calculateSkillProfile(s2Patterns, games, analyses), [s2Patterns, games, analyses]);

  const [s2StatsExpanded, setS2StatsExpanded] = useState(true);
  const [revealComplete, setRevealComplete] = useState(false);
  const [shrinkTransition, setShrinkTransition] = useState(false);

  // Responsive radar size for mobile
  const [radarSize, setRadarSize] = useState(Math.min(window.innerWidth - 64, 340));
  useEffect(() => {
    const handler = () => setRadarSize(Math.min(window.innerWidth - 64, 340));
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Famous player benchmarks
  const magnusScore = 95;
  const hikaruScore = 93;

  // Win stats from all games
  const winCount = games.filter(g => g.player?.result === 'win').length;
  const winPct = games.length > 0 ? Math.round((winCount / games.length) * 100) : 0;

  // After reveal completes, wait a beat then shrink the radar
  const handleRevealComplete = () => {
    setTimeout(() => {
      setShrinkTransition(true);
      setTimeout(() => setRevealComplete(true), 600);
    }, 800);
  };

  const handleUnlockPatterns = () => {
    onUpdateSettings({ patternsUnlockedAt: Date.now() });
  };

  // Full-screen radar during reveal animation
  if (!revealComplete) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ minHeight: '70vh' }}>
        <div className="text-center mb-4 animate-fade-in">
          <h2 className="text-2xl font-black text-chess-text mb-1">Your <span className="text-chess-accent glow-green">Chess DNA</span></h2>
          <p className="text-sm text-gray-400">Based on your last 5 rapid games</p>
        </div>

        <div
          className="transition-all duration-700 ease-in-out"
          style={{
            transform: shrinkTransition ? 'scale(0.7)' : 'scale(1)',
            opacity: shrinkTransition ? 0.6 : 1,
          }}
        >
          <div className="bg-chess-surface/50 rounded-2xl p-6 border border-chess-accent/10 shadow-[0_0_40px_rgba(74,222,128,0.12)]">
            <SkillRadar
              profile={s2Profile}
              size={radarSize}
              sequentialReveal
              onRevealComplete={handleRevealComplete}
            />
          </div>
        </div>
      </div>
    );
  }

  const compactRadarSize = Math.min(Math.floor(radarSize * 0.7), 260);

  // After reveal: show score + stats + sticky unlock CTA
  return (
    <div className="max-w-2xl mx-auto animate-fade-in pb-20">
      {/* Background analysis banner — top of page so it doesn't overlap */}
      {globalAnalyzedCount < totalGameCount && (
        <div className="flex items-center gap-3 rounded-xl bg-chess-surface/30 border border-chess-accent/10 px-4 py-2.5 mb-4 animate-fade-in">
          <div className="text-sm animate-spin-slow">{'\uD83E\uDDEC'}</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-chess-text-secondary font-medium">
              Analyzing {globalAnalyzingCount > 0 ? `game ${globalAnalyzedCount + 1}` : ''} {'\u2014'} {globalAnalyzedCount}/{totalGameCount} done
            </div>
            <div className="w-full bg-chess-muted/40 rounded-full h-1 mt-1 overflow-hidden">
              <div className="bg-chess-accent h-full rounded-full transition-all duration-500" style={{ width: `${(globalAnalyzedCount / totalGameCount) * 100}%` }} />
            </div>
          </div>
          <span className="text-[10px] text-gray-500 shrink-0">Profile keeps improving</span>
        </div>
      )}

      {/* Overall score hero */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-3 mb-2">
          <span className="text-5xl" style={{ filter: `drop-shadow(0 0 16px ${getTierGlowColor(tier, theme)})` }}>
            {tier.icon}
          </span>
          <div>
            <div className="text-5xl font-black" style={{ color: getTierColor(tier, theme) }}>
              {s2Profile.overallRating}
            </div>
            <div className="text-sm font-bold text-gray-400">{tier.name} Tier</div>
          </div>
        </div>
        {nextTier && (
          <div className="flex items-center gap-3 max-w-xs mx-auto">
            <div className="flex-1 bg-chess-muted/50 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${tierProgress}%`, backgroundColor: getTierColor(tier, theme), boxShadow: `0 0 8px ${getTierGlowColor(tier, theme)}` }}
              />
            </div>
            <span className="text-[10px] text-gray-500 shrink-0">
              {pointsToNextTier(s2Profile.overallRating)} to {nextTier.icon}
            </span>
          </div>
        )}
      </div>

      {/* Compact radar */}
      <div className="flex justify-center mb-2">
        <div className="bg-chess-surface/50 rounded-2xl p-3 border border-chess-accent/10 shadow-[0_0_20px_rgba(74,222,128,0.06)]">
          <SkillRadar profile={s2Profile} size={compactRadarSize} />
        </div>
      </div>
      {/* 4 Stats grid -- collapsible (matches S5 layout) */}
      <div className="rounded-xl border border-chess-border/30 overflow-hidden mb-8 animate-fade-in-up">
        <button
          onClick={() => setS2StatsExpanded(e => !e)}
          className="w-full flex items-center justify-between px-3 py-2.5 bg-chess-surface/20 hover:bg-chess-surface/30 transition-colors"
        >
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Your {onboardingTimeClass ? `${onboardingTimeClass} ` : ''}Stats</span>
          <span className="text-gray-500 text-xs">{s2StatsExpanded ? '\u25B2' : '\u25BC'}</span>
        </button>
        {s2StatsExpanded && (
          <div className="grid grid-cols-2 gap-2 p-3">
            {/* Percentile */}
            <div className="rounded-xl p-3 bg-chess-surface/30 border border-chess-border/30 text-center">
              <div className="text-lg mb-0.5">{'\uD83D\uDCCA'}</div>
              <div className="text-2xl font-black text-chess-text">Top {Math.max(1, 100 - overallPercentile)}%</div>
              <div className="text-[10px] text-gray-500">among {getRatingRangeLabel(playerElo)}</div>
            </div>

            {/* vs World's Best */}
            <div className="rounded-xl p-3 bg-chess-surface/30 border border-chess-border/30 text-center">
              <div className="text-lg mb-0.5">{'\uD83C\uDF0D'}</div>
              <div className="text-[10px] text-gray-500 mb-0.5">vs World's Best</div>
              <div className="flex items-center justify-center gap-2">
                <span className="text-[10px] text-gray-400">Magnus <span className="font-bold text-chess-text">{magnusScore}</span></span>
                <span className="text-gray-600">{'\u00B7'}</span>
                <span className="text-[10px] text-gray-400">Hikaru <span className="font-bold text-chess-text">{hikaruScore}</span></span>
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">
                {Math.min(magnusScore, hikaruScore) - s2Profile.overallRating > 0
                  ? `${Math.min(magnusScore, hikaruScore) - s2Profile.overallRating} pts to beat both`
                  : 'You beat them both!'}
              </div>
            </div>

            {/* Win Rate */}
            <div className="rounded-xl p-3 bg-chess-surface/30 border border-chess-border/30 text-center">
              <div className="text-lg mb-0.5">{'\u2694\uFE0F'}</div>
              <div className="text-[10px] text-gray-500 mb-0.5">{games.length} Games</div>
              <div className={`text-2xl font-black ${winPct >= 50 ? 'text-chess-accent' : 'text-chess-blunder'}`}>{winPct}%</div>
              <div className="text-[10px] text-gray-500">{winCount}W {'\u00B7'} {games.filter(g => g.player?.result === 'loss').length}L {'\u00B7'} {games.filter(g => g.player?.result === 'draw').length}D</div>
            </div>

            {/* ELO */}
            <div className="rounded-xl p-3 bg-chess-surface/30 border border-chess-border/30 text-center">
              <div className="text-lg mb-0.5">{'\uD83D\uDCC8'}</div>
              <div className="text-[10px] text-gray-500 mb-0.5">Your ELO</div>
              <div className="text-2xl font-black text-chess-text">{playerElo}</div>
              <div className="text-[10px] text-gray-500">{getRatingRangeLabel(playerElo)}</div>
            </div>
          </div>
        )}
      </div>

      {/* Share button */}
      <ShareButton profile={s2Profile} tier={tier} playerElo={playerElo} />

      {/* Sticky bottom CTA -- unlock patterns (no nav bar at S2) */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-chess-bg/95 backdrop-blur-md p-3">
        <div className="max-w-6xl mx-auto">
          <button
            onClick={handleUnlockPatterns}
            className="w-full bg-chess-accent text-chess-bg py-3 rounded-xl text-sm font-black hover:brightness-110 transition-all shadow-[0_0_12px_rgba(74,222,128,0.2)]"
          >
            Unlock your patterns {'\u2192'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* S3 (Stage3AIChoice) and PatternsSummary removed -- S3 is skipped in the flow */

/* ================================================================
 *  S4: Guided Walkthrough
 * ================================================================ */

function Stage4GuidedWalkthrough({
  patterns,
  hasAI,
  totalGameCount,
  globalAnalyzedCount,
  globalAnalyzingCount,
  onUpdateSettings,
  sampleText,
}: {
  patterns: CurrentPatterns | null;
  hasAI: boolean;
  totalGameCount: number;
  globalAnalyzedCount: number;
  globalAnalyzingCount: number;
  onUpdateSettings: (partial: Partial<UserSettings>) => Promise<void>;
  sampleText?: string;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [expandedPattern, setExpandedPattern] = useState<string | null>(null);
  const totalSteps = 3; // Removed step 0 (radar), now: Patterns -> Training -> Puzzles

  const topPattern = patterns?.patterns[0];

  const handleFinish = () => {
    onUpdateSettings({ guidedWalkthroughDone: true });
  };

  // Classify pattern into skill category
  const getPatternSkillCategory = (themeStr: string): { label: string; color: string } => {
    const defensePatterns = ['missed_defense', 'hanging_pieces', 'back_rank_weakness', 'king_safety'];
    const attackPatterns = ['missed_tactic', 'missed_fork', 'missed_pin', 'missed_skewer', 'missed_discovery', 'premature_attack'];
    if (defensePatterns.some(d => themeStr.includes(d))) return { label: 'Defence', color: 'text-blue-400' };
    if (attackPatterns.some(a => themeStr.includes(a))) return { label: 'Attack', color: 'text-red-400' };
    return { label: 'Positional', color: 'text-purple-400' };
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              i === step ? 'w-8 bg-chess-accent' : i < step ? 'w-4 bg-chess-accent/40' : 'w-4 bg-chess-muted'
            }`}
          />
        ))}
      </div>

      {/* Step 0: Your Patterns (was Step 1 -- now first) */}
      {step === 0 && (
        <div className="animate-fade-in">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">{'\uD83D\uDD0D'}</div>
            <h2 className="text-xl font-black mb-1">Your Patterns</h2>
            <p className="text-sm text-gray-400 max-w-md mx-auto">
              {patterns && patterns.patterns.length > 0
                ? 'We analyzed your games and found recurring patterns. These are the areas where focused practice will have the biggest impact.'
                : 'We\u2019re still analyzing your games to find recurring patterns. Once ready, you\u2019ll see the areas where focused practice will have the biggest impact.'}
            </p>
            {sampleText && (
              <p className="text-[10px] text-chess-accent/50 uppercase tracking-widest mt-2">{sampleText}</p>
            )}
          </div>

          {patterns && patterns.patterns.length > 0 ? (
            <div className="space-y-2 mb-6">
              {patterns.patterns.slice(0, 5).map((p, i) => {
                const skillCat = getPatternSkillCategory(p.theme);
                const isExpanded = expandedPattern === p.theme;
                return (
                  <div
                    key={p.theme}
                    className="rounded-xl bg-chess-surface/30 border border-chess-border/30 animate-fade-in-up overflow-hidden"
                    style={{ animationDelay: `${i * 150}ms` }}
                  >
                    <button
                      onClick={() => setExpandedPattern(isExpanded ? null : p.theme)}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-chess-surface/50 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-lg bg-chess-blunder/10 flex items-center justify-center text-chess-blunder text-sm font-bold">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-chess-text">{getThemeLabel(p.theme)}</div>
                        <div className="flex items-center gap-2 text-[10px] text-gray-500">
                          <span>{p.occurrences} occurrences across {p.gamesAffected} games</span>
                          <span className={`font-bold ${skillCat.color}`}>{skillCat.label}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-xs font-bold text-chess-blunder">{p.severity}cp</div>
                        <span className={`text-gray-500 text-xs transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>{'\u25BC'}</span>
                      </div>
                    </button>

                    {/* Expanded detail for one pattern */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-chess-border/20 animate-fade-in">
                        <div className="mt-3 space-y-3">
                          <div>
                            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">What is this?</div>
                            <p className="text-xs text-chess-text-secondary leading-relaxed">
                              {p.theme.includes('tactic') && 'A tactical pattern where you miss winning combinations like forks, pins, or skewers during critical moments.'}
                              {p.theme.includes('time') && 'Time management issues where you either move too quickly in complex positions or run low on time.'}
                              {p.theme.includes('endgame') && 'Endgame technique weakness \u2014 converting advantages or holding difficult endings needs improvement.'}
                              {p.theme.includes('opening') && 'Opening preparation gaps \u2014 you may be entering unfamiliar positions or missing key theoretical moves.'}
                              {!p.theme.includes('tactic') && !p.theme.includes('time') && !p.theme.includes('endgame') && !p.theme.includes('opening') &&
                                `This pattern appears when you consistently lose material or positional advantage in similar types of positions. It occurred ${p.occurrences} times with an average centipawn loss of ${p.severity}.`}
                            </p>
                          </div>
                          <div className="flex gap-4">
                            <div>
                              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">Avg Loss</div>
                              <div className="text-sm font-bold text-chess-blunder">{p.severity}cp</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">Games</div>
                              <div className="text-sm font-bold text-chess-text">{p.gamesAffected}</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">Skill</div>
                              <div className={`text-sm font-bold ${skillCat.color}`}>{skillCat.label}</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">Trend</div>
                              <div className={`text-sm font-bold ${
                                p.trend === 'improving' ? 'text-chess-accent' : p.trend === 'worsening' ? 'text-chess-blunder' : 'text-gray-500'
                              }`}>
                                {p.trend === 'improving' ? '\u2197 Improving' : p.trend === 'worsening' ? '\u2198 Worsening' : '\u2192 Stable'}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl p-6 bg-chess-surface/30 border border-chess-border/30 text-center mb-6">
              <div className="text-2xl mb-3 animate-spin-slow">{'\uD83E\uDDEC'}</div>
              <div className="text-sm text-chess-text-secondary font-medium mb-2">
                Still analyzing your games...
              </div>
              <div className="text-xs text-gray-500 mb-3">
                {globalAnalyzedCount}/{totalGameCount} games analyzed
                {globalAnalyzingCount > 0 && ` \u00B7 analyzing now...`}
              </div>
              <div className="w-full max-w-xs mx-auto bg-chess-muted/40 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-chess-accent h-full rounded-full transition-all duration-700"
                  style={{ width: `${totalGameCount > 0 ? (globalAnalyzedCount / totalGameCount) * 100 : 0}%` }}
                />
              </div>
              <p className="text-[10px] text-gray-600 mt-3">
                Patterns will appear once enough games are analyzed.
              </p>
            </div>
          )}

          <button
            onClick={() => setStep(1)}
            disabled={!patterns || patterns.patterns.length === 0}
            className={`w-full py-3 rounded-xl text-sm font-black transition-all ${
              patterns && patterns.patterns.length > 0
                ? 'bg-chess-accent text-chess-bg hover:brightness-110 shadow-[0_0_12px_rgba(74,222,128,0.25)]'
                : 'bg-chess-muted/50 text-gray-500 cursor-not-allowed'
            }`}
          >
            {patterns && patterns.patterns.length > 0
              ? `Next: Training ${'\u2192'}`
              : `Waiting for patterns... (${globalAnalyzedCount}/${totalGameCount})`}
          </button>
        </div>
      )}

      {/* Step 1: How Training Works */}
      {step === 1 && (
        <div className="animate-fade-in">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">{'\uD83D\uDCD6'}</div>
            <h2 className="text-xl font-black mb-1">Getting Better</h2>
            <p className="text-sm text-gray-400 max-w-md mx-auto">
              {hasAI
                ? 'The "Getting Better" tab has lessons and puzzles targeting your weakness patterns.'
                : 'With an AI provider set up, the "Getting Better" tab gives you personalized lessons and puzzles.'}
            </p>
          </div>

          <div className="space-y-3 mb-6">
            <WalkthroughStep
              number={1}
              title="Click a pattern"
              desc="From your DNA view, click 'Lesson' or 'Practice' on any pattern to start training."
              icon={'\u25C8'}
            />
            <WalkthroughStep
              number={2}
              title="Study & Practice"
              desc={topPattern
                ? `We'll create content about "${getThemeLabel(topPattern.theme)}" \u2014 your most common pattern.`
                : 'Lessons explain the concept; puzzles let you practice finding the right move.'}
              icon={'\u2728'}
            />
            <WalkthroughStep
              number={3}
              title="Track progress"
              desc="Your radar updates as you play more games. Watch your weak areas improve!"
              icon={'\uD83D\uDCC8'}
            />
          </div>

          {!hasAI && (
            <div className="rounded-xl p-3 bg-yellow-500/5 border border-yellow-500/20 text-center mb-3">
              <div className="text-xs text-yellow-400">
                Add an AI API key in Account settings to enable training.
              </div>
              <button
                onClick={() => navigate('/settings')}
                className="text-[11px] text-yellow-300 hover:underline mt-1"
              >
                Go to Account {'\u2192'}
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => setStep(0)} className="flex-1 text-xs text-gray-500 py-2 hover:text-chess-text-secondary transition-colors">{'\u2190'} Back</button>
            <button
              onClick={() => setStep(2)}
              className="flex-1 bg-chess-accent text-chess-bg py-3 rounded-xl text-sm font-black hover:brightness-110 transition-all shadow-[0_0_12px_rgba(74,222,128,0.25)]"
            >
              Next: Puzzles {'\u2192'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Puzzle Experience */}
      {step === 2 && (
        <div className="animate-fade-in">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">{'\uD83E\uDDE9'}</div>
            <h2 className="text-xl font-black mb-1">Practice Puzzles</h2>
            <p className="text-sm text-gray-400 max-w-md mx-auto">
              Puzzles are interactive {'\u2014'} find the best move by playing on the board. They target your exact weaknesses.
            </p>
          </div>

          <div className="space-y-3 mb-6">
            <WalkthroughStep
              number={1}
              title="Open a puzzle"
              desc="Puzzles appear in the 'Getting Better' tab, organized by pattern."
              icon={'\uD83E\uDDE9'}
            />
            <WalkthroughStep
              number={2}
              title="Find the best move"
              desc="The board fills the screen. Drag pieces to make your move, use hints if stuck."
              icon={'\u265F'}
            />
            <WalkthroughStep
              number={3}
              title="Learn from mistakes"
              desc="Each puzzle includes an explanation of why the move is best."
              icon={'\uD83E\uDDE0'}
            />
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="flex-1 text-xs text-gray-500 py-2 hover:text-chess-text-secondary transition-colors">{'\u2190'} Back</button>
            <button
              onClick={handleFinish}
              className="flex-1 relative overflow-hidden bg-gradient-to-r from-chess-accent to-emerald-400 text-chess-bg py-4 rounded-2xl text-base font-black hover:brightness-110 transition-all shadow-[0_0_30px_rgba(74,222,128,0.35)] group"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <span className="text-lg">{'\uD83E\uDDEC'}</span>
                My Chess DNA {'\u2192'}
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WalkthroughStep({
  number,
  title,
  desc,
  icon,
}: {
  number: number;
  title: string;
  desc: string;
  icon: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl p-3 bg-chess-surface/30 border border-chess-border/30">
      <div className="w-8 h-8 rounded-lg bg-chess-accent/10 text-chess-accent flex items-center justify-center text-sm font-bold shrink-0">
        {number}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm">{icon}</span>
          <span className="text-sm font-bold text-chess-text">{title}</span>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

/* ================================================================
 *  Share Button (Facebook, Instagram, WhatsApp)
 * ================================================================ */

function ShareButton({
  profile,
  tier,
  playerElo,
}: {
  profile: ReturnType<typeof calculateSkillProfile>;
  tier: ReturnType<typeof getTierForScore>;
  playerElo: number;
}) {
  const [showShare, setShowShare] = useState(false);

  const shareText = `\uD83E\uDDEC My Chess DNA: ${profile.overallRating} (${tier.name} Tier) \u00B7 ELO ${playerElo} \u00B7 Discover yours at chessdna.com`;

  const shareLinks = [
    {
      name: 'WhatsApp',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      ),
      color: 'hover:text-green-400',
      url: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
    },
    {
      name: 'Telegram',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
        </svg>
      ),
      color: 'hover:text-blue-300',
      url: `https://t.me/share/url?url=${encodeURIComponent('https://chessdna.com')}&text=${encodeURIComponent(shareText)}`,
    },
    {
      name: 'Facebook',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
      ),
      color: 'hover:text-blue-400',
      url: `https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(shareText)}`,
    },
    {
      name: 'Instagram',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
        </svg>
      ),
      color: 'hover:text-pink-400',
      url: null, // Instagram doesn't have a share URL -- copy text instead
    },
  ];

  const handleShare = (url: string | null) => {
    if (url) {
      window.open(url, '_blank', 'width=600,height=400');
    } else {
      // Instagram: copy text to clipboard
      navigator.clipboard.writeText(shareText).then(() => {
        alert('Copied to clipboard! Paste it to your Instagram story.');
      });
    }
    setShowShare(false);
  };

  return (
    <div className="w-full">
      <div className="relative">
        <button
          onClick={() => setShowShare(!showShare)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-chess-surface/40 border border-chess-border/30 text-sm text-gray-400 hover:text-chess-text hover:border-chess-accent/30 transition-all"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          Share your DNA
        </button>

        {showShare && (
          <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-chess-surface border border-chess-border/40 rounded-xl p-3 flex gap-3 shadow-lg z-50 animate-fade-in">
            {shareLinks.map((link) => (
              <button
                key={link.name}
                onClick={() => handleShare(link.url)}
                className={`flex flex-col items-center gap-1 text-gray-500 ${link.color} transition-colors p-2 rounded-lg hover:bg-white/5`}
                title={link.name}
              >
                {link.icon}
                <span className="text-[9px]">{link.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
 *  Score Hero
 * ================================================================ */

function ScoreHero({
  profile,
  tier,
  tierProgress,
  nextTier,
  playerElo,
  totalAnalyzed,
}: {
  profile: ReturnType<typeof calculateSkillProfile>;
  tier: ReturnType<typeof getTierForScore>;
  tierProgress: number;
  nextTier: ReturnType<typeof getNextTier>;
  playerElo: number;
  totalAnalyzed: number;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const { theme } = useTheme();

  return (
    <div className="mb-6">
      <div className="flex items-center gap-4 mb-2">
        <span className="text-5xl" style={{ filter: `drop-shadow(0 0 16px ${getTierGlowColor(tier, theme)})` }}>
          {tier.icon}
        </span>
        <div>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-black" style={{ color: getTierColor(tier, theme) }}>{profile.overallRating}</span>
            <span className="text-sm font-bold text-gray-400">{tier.name}</span>
            <button
              onClick={() => setShowInfo(true)}
              className="text-gray-500 hover:text-chess-accent transition-colors ml-1"
              title="How is this calculated?"
            >
              <span className="text-[10px] border border-gray-500/40 rounded-full w-4 h-4 inline-flex items-center justify-center hover:border-chess-accent/40">i</span>
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{tier.funTitle} {'\u00B7'} ELO {playerElo} {'\u00B7'} {totalAnalyzed} games</p>
        </div>
      </div>
      {nextTier && (
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-chess-muted/50 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${tierProgress}%`, backgroundColor: getTierColor(tier, theme), boxShadow: `0 0 8px ${getTierGlowColor(tier, theme)}` }}
            />
          </div>
          <span className="text-[10px] text-gray-500 shrink-0">
            {pointsToNextTier(profile.overallRating)} to {nextTier.icon} {nextTier.name}
          </span>
        </div>
      )}
      {showInfo && <ScoringInfoPopup profile={profile} onClose={() => setShowInfo(false)} />}
    </div>
  );
}

/* ================================================================
 *  Scoring Info Popup
 * ================================================================ */

const CATEGORY_INFO: Record<string, { icon: string; what: string; how: string }> = {
  openings: {
    icon: '\uD83D\uDCD6',
    what: 'How well you handle the opening phase \u2014 following principles and developing pieces.',
    how: 'Blends opening mistake patterns with your opening phase accuracy. Fewer opening errors + higher accuracy = higher score.',
  },
  tactics: {
    icon: '\u2694\uFE0F',
    what: 'Your ability to spot forks, pins, skewers, and winning combinations.',
    how: 'Blends missed tactical patterns with your middlegame accuracy. This is the strictest category \u2014 tactical mistakes are penalized most heavily.',
  },
  defense: {
    icon: '\uD83D\uDEE1\uFE0F',
    what: 'How well you protect pieces and your king \u2014 avoiding hanging pieces and back-rank threats.',
    how: 'Blends defensive mistake patterns (hanging pieces, king safety) with your overall accuracy.',
  },
  positional: {
    icon: '\u265F\uFE0F',
    what: 'Your understanding of pawn structure, piece placement, and space control.',
    how: 'Blends positional error patterns with your middlegame accuracy. More pawn structure and piece activity mistakes = lower score.',
  },
  endgame: {
    icon: '\uD83C\uDFC1',
    what: 'Your technique in endgames \u2014 king activity, pawn promotion, and converting advantages.',
    how: 'Blends endgame mistake patterns with your endgame phase accuracy.',
  },
  calculation: {
    icon: '\uD83E\uDDEE',
    what: 'How precisely you calculate \u2014 finding the best move consistently.',
    how: 'Based on your overall accuracy and best-move rate across all positions. Reflects raw calculation ability independent of specific pattern types.',
  },
  time_management: {
    icon: '\u23F1\uFE0F',
    what: 'How well you manage your clock \u2014 maintaining steady play and avoiding rushed decisions.',
    how: 'Based on time-pressure blunders and consistency of accuracy across game phases. Steady accuracy = good timing.',
  },
  resilience: {
    icon: '\uD83D\uDCAA',
    what: 'How well you perform under pressure \u2014 avoiding blunders in critical moments.',
    how: 'Based on your overall blunder rate. Fewer blunders = higher resilience.',
  },
};

function ScoringInfoPopup({
  profile,
  onClose,
}: {
  profile: ReturnType<typeof calculateSkillProfile>;
  onClose: () => void;
}) {
  const { theme } = useTheme();

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-chess-bg border border-chess-border/40 rounded-2xl max-w-md w-full max-h-[80vh] overflow-y-auto p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black text-chess-text">How Your Score Works</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-chess-text-secondary text-lg">{'\u2715'}</button>
        </div>

        {/* Overall explanation */}
        <div className="rounded-xl bg-chess-surface/30 border border-chess-border/30 p-3 mb-4">
          <div className="text-xs text-gray-400 mb-1 uppercase tracking-widest">Overall Score</div>
          <p className="text-sm text-chess-text-secondary leading-relaxed">
            Your overall score is a weighted average of 8 skill dimensions. Each dimension is scored 0{'\u2013'}99 based on patterns detected in your games and your accuracy metrics.
          </p>
        </div>

        {/* Per-category breakdown */}
        <div className="space-y-2">
          {profile.dimensions.map((dim) => {
            const info = CATEGORY_INFO[dim.id];
            if (!info) return null;
            const dimTier = getTierForScore(dim.score);
            return (
              <div key={dim.id} className="rounded-xl bg-chess-surface/20 border border-chess-border/20 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm">{info.icon}</span>
                  <span className="text-sm font-bold text-chess-text">{dim.label}</span>
                  <span className="ml-auto text-sm font-black" style={{ color: getTierColor(dimTier, theme) }}>{dim.score}</span>
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed mb-1">{info.what}</p>
                <p className="text-[11px] text-gray-500 leading-relaxed italic">{info.how}</p>
              </div>
            );
          })}
        </div>

        {/* How scoring works */}
        <div className="mt-4 rounded-xl bg-chess-surface/20 border border-chess-border/20 p-3">
          <div className="text-xs text-gray-400 mb-1 uppercase tracking-widest">Opponent-Adjusted Scoring</div>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Your scores are adjusted based on opponent strength. The same accuracy against a 1800-rated
            opponent counts more than against an 800-rated opponent. This means your scores reflect
            not just how well you play, but who you play against.
          </p>
        </div>

        {/* Tier reference strip */}
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
          {ALL_TIERS.map(t => (
            <span key={t.id} className="px-2 py-0.5 rounded bg-chess-surface/30 text-gray-400">
              {t.icon} {t.name} {t.minScore}{'\u2013'}{t.maxScore}
            </span>
          ))}
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="w-full mt-4 py-2 rounded-xl bg-chess-surface/40 text-sm text-gray-400 hover:text-chess-text transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/* ================================================================
 *  Summary Audio Section (compact inline)
 * ================================================================ */

function SummaryAudioSection({
  analyzedCount,
  onGenerate,
}: {
  analyzedCount: number;
  onGenerate: () => void;
}) {
  const { state: audio, controls } = useAudioPlayer();

  // Audio is active (playing or paused) — show "Now Playing" indicator
  if (audio.script) {
    return (
      <div className="flex items-center justify-between bg-chess-surface/50 rounded-lg px-3 py-2.5 border border-chess-accent/30">
        <div className="flex items-center gap-2">
          <span className="text-base">{'\uD83C\uDF99'}</span>
          <span className="text-xs text-chess-accent font-semibold">
            {audio.isPlaying ? 'Now playing' : 'Paused'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => audio.isPlaying ? controls.pause() : controls.play()}
            className="flex items-center gap-1.5 bg-chess-accent/15 text-chess-accent px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-chess-accent/25 transition-all"
          >
            {audio.isPlaying ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                Pause
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                Resume
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Default: generate CTA
  return (
    <div className="flex items-center justify-between bg-chess-surface/50 rounded-lg px-3 py-2.5 border border-chess-border/20">
      <div className="flex items-center gap-2">
        <span className="text-base">{'\uD83C\uDF99'}</span>
        <span className="text-xs text-chess-text-secondary">
          Your <span className="font-bold text-chess-text">{analyzedCount}</span> games review
        </span>
      </div>

      <div className="flex items-center gap-2">
        {audio.error && (
          <span className="text-[10px] text-chess-blunder">{audio.error}</span>
        )}
        <button
          onClick={onGenerate}
          disabled={audio.isGenerating}
          className="flex items-center gap-1.5 bg-chess-accent text-chess-bg px-3 py-1.5 rounded-lg text-xs font-bold hover:brightness-110 transition-all disabled:opacity-50"
        >
          {audio.isGenerating ? (
            <span className="animate-pulse">Generating...</span>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
              Listen now
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ================================================================
 *  Training Plan Banner (compact inline on Overview)
 * ================================================================ */

const defaultPlanState: TrainingPlanState & Record<string, unknown> = {
  options: [],
  activeIndex: 0,
  generatedAt: 0,
};

function TrainingPlanBanner({
  profile,
  patterns,
  onNavigateToExercises,
}: {
  profile: ReturnType<typeof calculateSkillProfile>;
  patterns: CurrentPatterns;
  onNavigateToExercises: () => void;
}) {
  const { authResolved } = useAuth();
  // RLS handles user scoping server-side
  const singletonUserId = authResolved ? undefined : null;
  const [planState, setPlanState] = useSingletonEntity<TrainingPlanState & Record<string, unknown>>('TrainingPlan', defaultPlanState, deserializeTrainingPlan as (raw: Record<string, unknown>) => TrainingPlanState & Record<string, unknown>, serializeTrainingPlan, singletonUserId);
  const [exercises] = useEntityList<Exercise>('Exercise', undefined, deserializeExercise as (raw: unknown) => Exercise, !authResolved);
  const [lessons] = useEntityList<Lesson>('Lesson', undefined, deserializeLesson as (raw: unknown) => Lesson, !authResolved);
  const [snapshots] = useEntityList<PatternSnapshot>('PatternSnapshot', undefined, deserializePatternSnapshot as (raw: unknown) => PatternSnapshot, !authResolved);

  // Auto-generate plan options if none exist
  useEffect(() => {
    if ((!planState || planState.options.length === 0) && profile.gamesUsed >= 3 && patterns.patterns.length > 0) {
      const newState = generateTrainingPlanOptions(profile, patterns);
      if (newState) setPlanState(newState as Partial<TrainingPlanState & Record<string, unknown>>);
    }
  }, [planState, profile, patterns, setPlanState]);

  // Update active plan with progress
  const activePlan = useMemo(() => {
    if (!planState || planState.options.length === 0) return null;
    const plan = planState.options[planState.activeIndex];
    if (!plan) return null;
    return updatePlanProgress(plan, exercises, lessons);
  }, [planState, exercises, lessons]);

  // Compute accuracy
  const accuracy = useMemo(() => {
    if (!activePlan) return null;
    return computeTrainingAccuracy(activePlan, exercises, snapshots);
  }, [activePlan, exercises, snapshots]);

  if (!activePlan || activePlan.isComplete) return null;

  const completedStages = activePlan.stages.filter(s => s.completedCount >= s.targetCount).length;
  const totalStages = activePlan.stages.length;
  const progressPct = (completedStages / totalStages) * 100;
  const currentStage = activePlan.stages[activePlan.currentStageIndex];

  return (
    <div
      className="mb-3 rounded-xl bg-chess-accent/[0.04] border border-chess-accent/15 px-4 py-2.5 cursor-pointer hover:bg-chess-accent/[0.07] transition-all"
      onClick={onNavigateToExercises}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-bold text-chess-text truncate mr-2">
          {activePlan.targetPatternLabel}
        </span>
        <span className="text-[10px] text-chess-text-secondary shrink-0">
          {completedStages}/{totalStages}
        </span>
      </div>
      {/* Progress bar */}
      <div className="w-full bg-chess-muted/50 rounded-full h-1 overflow-hidden mb-1.5">
        <div
          className="h-full rounded-full bg-chess-accent transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-chess-text-secondary">
          {currentStage && `${currentStage.label} (${currentStage.completedCount}/${currentStage.targetCount})`}
          {accuracy && accuracy.practiceTotal > 0 && (
            <> {'\u00B7'} Practice {accuracy.practiceAccuracy}%</>
          )}
          {accuracy && accuracy.gameAccuracyTrend.length > 0 && (
            <> {'\u00B7'} Games {accuracy.gameAccuracy}%
              {accuracy.gameAccuracyTrend.length >= 3 && (
                accuracy.gameAccuracyTrend[accuracy.gameAccuracyTrend.length - 1] >
                accuracy.gameAccuracyTrend[0] ? ' \u2197' : ' \u2198'
              )}
            </>
          )}
        </span>
        <span className="text-[10px] text-chess-accent font-bold shrink-0 ml-2">
          Continue &rarr;
        </span>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
 *  Admin Stage Navigator — floating overlay for testing onboarding
 *  Only visible for admin user or on localhost
 * ──────────────────────────────────────────────────────────── */

const ADMIN_STAGES: { label: string; value: JourneyStage | null }[] = [
  { label: 'S0', value: 0 },
  { label: 'S1', value: 1 },
  { label: 'S2', value: 2 },
  { label: 'S4', value: 4 },
  { label: 'S5', value: 5 },
];

function AdminStageNav({
  currentStage,
  autoStage,
  isOverridden,
  onSetStage,
  onUpdateSettings,
  refetchAll,
  settings: adminSettings,
}: {
  currentStage: JourneyStage;
  autoStage: JourneyStage;
  isOverridden: boolean;
  onSetStage: (stage: JourneyStage | null) => void;
  onUpdateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  refetchAll: () => void;
  settings: UserSettings;
}) {
  const [resetting, setResetting] = useState(false);

  // When admin overrides to a stage, also persist the prerequisite settings
  // so AppShell/ChessDataContext journeyStage matches and bottom nav appears
  const handleStageOverride = async (value: JourneyStage | null) => {
    onSetStage(value);
    if (value === null) return;
    const patch: Partial<UserSettings> = {};
    if (value >= 2 && !adminSettings.radarRevealedAt) patch.radarRevealedAt = Date.now();
    if (value >= 4 && !adminSettings.patternsUnlockedAt) patch.patternsUnlockedAt = Date.now();
    if (value >= 5 && !adminSettings.guidedWalkthroughDone) patch.guidedWalkthroughDone = true;
    if (Object.keys(patch).length > 0) {
      await onUpdateSettings(patch);
      refetchAll();
    }
  };

  const handleSwitchUser = () => {
    base44.auth.logout();
  };

  const handleFullReset = async () => {
    if (resetting) return;
    if (!window.confirm('Delete ALL your games, analyses, patterns, lessons, exercises and reset onboarding to S0?\n\nThis is irreversible.')) return;

    setResetting(true);
    try {
      // 1. Delete all entity records (RLS scopes to current user)
      // Sequential with delay to avoid 429 rate limits.
      const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
      const entityNames = ['Game', 'Analysis', 'Pattern', 'PatternSnapshot', 'TrainingPlan', 'Lesson', 'Exercise'];
      for (const name of entityNames) {
        try {
          const entity = (base44.entities as Record<string, any>)[name];
          let deleted = 0;
          for (let page = 0; page < 15; page++) {
            const records = await entity.list();
            if (!Array.isArray(records) || records.length === 0) break;
            for (const r of records) {
              try {
                await entity.delete(r.id);
                deleted++;
              } catch (delErr: any) {
                // If rate limited, wait and retry once
                if (delErr?.response?.status === 429 || String(delErr).includes('429')) {
                  await wait(1000);
                  try { await entity.delete(r.id); deleted++; } catch { /* skip */ }
                }
              }
              await wait(150); // 150ms between each delete
            }
            console.log(`[Admin Reset] ${name} page ${page + 1} done (${deleted} total)`);
          }
          console.log(`[Admin Reset] Deleted ${deleted} ${name} records total`);
        } catch (err) {
          console.warn(`[Admin Reset] Failed to delete ${name}:`, err);
        }
      }

      // 2. Reset all onboarding flags
      await onUpdateSettings({
        chesscomUsername: '',
        radarRevealedAt: null,
        patternsUnlockedAt: null,
        guidedWalkthroughDone: false,
        bulkImportDone: false,
        aiChoiceMade: false,
        onboardingGameIds: [],
        onboardingTimeClass: null,
      });

      // 3. Clear stage override and refetch
      onSetStage(null);
      refetchAll();

      console.log('[Admin Reset] Full reset complete — back to S0');
    } catch (err) {
      console.error('[Admin Reset] Failed:', err);
      alert('Reset failed — check console');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="fixed bottom-20 right-3 z-50 flex items-center gap-1 bg-black/80 backdrop-blur-sm rounded-full px-2 py-1.5 border border-chess-border/40 shadow-lg">
      <span className="text-[9px] text-gray-500 font-mono mr-1">
        {isOverridden ? '⚙' : '●'} {currentStage}
      </span>
      {ADMIN_STAGES.map(({ label, value }) => (
        <button
          key={label}
          onClick={() => handleStageOverride(value)}
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full transition-all ${
            currentStage === value
              ? 'bg-chess-accent text-chess-bg font-bold'
              : 'text-gray-400 hover:text-chess-text hover:bg-white/10'
          }`}
        >
          {label}
        </button>
      ))}
      {isOverridden && (
        <button
          onClick={() => onSetStage(null)}
          className="text-[10px] text-red-400 hover:text-red-300 font-mono px-1 ml-0.5"
          title={`Reset to auto (S${autoStage})`}
        >
          ✕
        </button>
      )}
      <div className="w-px h-3 bg-gray-600 mx-0.5" />
      <button
        onClick={handleFullReset}
        disabled={resetting}
        className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full transition-all ${
          resetting
            ? 'text-orange-300 animate-pulse cursor-wait'
            : 'text-orange-400 hover:text-orange-300 hover:bg-orange-400/10'
        }`}
        title="Full reset: delete all data & restart from S0"
      >
        {resetting ? '⏳' : '🔄'}
      </button>
      <button
        onClick={handleSwitchUser}
        className="text-[10px] font-mono px-1.5 py-0.5 rounded-full text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10 transition-all"
        title="Sign out and log in as a different user"
      >
        👤
      </button>
    </div>
  );
}
