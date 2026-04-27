import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHESS_COM_API_BASE } from '@shared/constants';
import { fetchChessCom } from '@/api/chess-com-fetch';
import { importChessComGames } from '@/api/chess-com-import';
import { importLichessGames } from '@/api/lichess-import';
import { DataAttribution } from '@/components/PlatformBadge';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/contexts/AuthContext';
import { AuthPrompt } from '@/components/AuthGuard';
import { analysisEvents } from '@/engine/analysis-events';
import { useChessData } from '@/contexts/ChessDataContext';
import type { CurrentPatterns, SkillDimension } from '@shared/types/patterns';
import type { GameRecord, TimeClass } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { UserSettings } from '@shared/types/storage';
import { calculateSkillProfile, getWeakestDimensions, getStrongestDimensions } from '@/patterns/skill-calculator';
import { getThemeLabel } from '@/patterns/pattern-engine';
import { hasAnyProvider } from '@/ai/ai-router';
import { getTierForScore, getTierColor, getTierGlowColor, getTierProgress, getNextTier, pointsToNextTier, ALL_TIERS } from '@/patterns/rank-tiers';
import {
  getRatingRangeLabel,
} from '@/patterns/score-benchmarks';
import { computeWindowedProfile, computePatternsFromGames, TIME_WINDOWS, DEFAULT_WINDOW, type TimeWindowId } from '@/patterns/windowed-profile';
import SkillRadar from '@/components/SkillRadar';
import ChartGallery from '@/components/ChartGallery/ChartGallery';
import TimeWindowTabs from '@/components/TimeWindowTabs';
import { useAudioPlayer } from '@/contexts/AudioPlayerContext';
import { type JourneyStage } from '@/components/Onboarding';
import { useTheme } from '@/components/ThemeContext';
import { useT, translateTierName, translateTierTitle, SUPPORTED_LANGUAGES } from '@/i18n/index';
import NumberTicker from '@/components/NumberTicker';
// FriendCompare moved to /compare page

interface OverviewProps {
  stageOverride?: JourneyStage | null;
  timeClassFilter?: TimeClass | null;
}

export default function Overview({ stageOverride, timeClassFilter: timeClassFilterProp }: OverviewProps) {
  const navigate = useNavigate();
  const { t } = useT();
  const { settings, updateSettings, isAdmin } = useTheme();
  const { isGuest } = useAuth();
  const {
    patterns,
    allAnalyses,
    games,
    analyses,
    dataLoading,
    filteredAnalyzedCount: analyzedCount,
    totalGameCount,
    analyzedCount: globalAnalyzedCount,
    analyzingCount: globalAnalyzingCount,
    weakest,
    strongest,
    playerElo,
    tier,
    tierProgress,
    nextTier,
    overallPercentile,
    journeyStage,
    refetchGames,
    refetchAnalyses,
    refetchPatterns,
    queueForAnalysis,
  } = useChessData();

  // Use prop if provided, otherwise read from settings
  // timeClassFilter available for future use
  void (timeClassFilterProp ?? settings.selectedTimeClass);

  // Admin stage navigator (isAdmin comes from ThemeContext)
  const [adminStageOverride, setAdminStageOverride] = useState<JourneyStage | null>(null);

  // Track highest journey stage reached to prevent regression from stale renders.
  // Once user reaches S5, never show S0/S1/S2 again even if data temporarily resets.
  const highestStageRef = useRef<JourneyStage>(journeyStage);
  if (journeyStage > highestStageRef.current) {
    highestStageRef.current = journeyStage;
  }
  const stableJourneyStage = Math.max(journeyStage, highestStageRef.current) as JourneyStage;

  const effectiveStage = stageOverride ?? adminStageOverride ?? stableJourneyStage;

  // S1 progress updates are now handled by the analysis event listener in
  // ChessDataContext (refetches every 5 completed games). No polling needed.

  const [activeWindow, setActiveWindow] = useState<TimeWindowId>(DEFAULT_WINDOW);
  const [, setActiveChartIndex] = useState(0);
  // Global audio player
  const { state: audioState, controls: audioControls } = useAudioPlayer();

  // syncTriggeredRef — kept to coordinate with analysis effect
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
  // Used in expanded stat view
  void getWeakestDimensions;
  void getStrongestDimensions;

  // radarBenchmarks removed — no longer using vs-mode comparison

  // Note: Auto-unlock patterns + analysis event refetching now handled by ChessDataContext

  // Auto-analyze games that aren't complete (works at any stage)
  // Pushes game IDs into the shared analysis queue in ChessDataContext,
  // which ensures a single analysis pipeline (no duplicate batch runs).
  const analysisTriggeredRef = useRef(false);
  useEffect(() => {
    if (games.length === 0) return;
    if (analysisTriggeredRef.current || syncTriggeredRef.current) return;

    const onboardingIds = settings.onboardingGameIds ?? [];
    const isOnboarding = onboardingIds.length > 0 && !settings.radarRevealedAt;

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
    // Analyze newest games first (highest playedAt first)
    toAnalyze.sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0));

    if (toAnalyze.length === 0) return;

    analysisTriggeredRef.current = true;
    const gameIds = toAnalyze.map((g) => g.id);
    console.log('[Chess DNA] Queuing', gameIds.length, 'games for analysis', isOnboarding ? '(onboarding only)' : '');
    queueForAnalysis(gameIds);
  }, [games, settings.onboardingGameIds, settings.radarRevealedAt, queueForAnalysis]);

  // Note: Game sync is now handled globally by useChessComSync in ChessDataContext.
  // The old per-page-load sync effect has been removed.

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
  // Don't flash S0 while data is still loading — the user may already have games
  if (effectiveStage === 0 && dataLoading) {
    return null; // Show nothing until data loads
  }
  if (effectiveStage === 0) {
    return (
      <>{adminNav}<Stage0Connect
        settings={settings}
        onSettingsChange={updateSettings}
        isGuest={isGuest}
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
        games={games}
        analyses={analyses}
        onUpdateSettings={updateSettings}
        sampleText={sampleText}
        isGuest={isGuest}
      /></>
    );
  }

  /* --- S5: Fully onboarded -- combined DNA view --- */

  // Windowed tier info -- so hero matches the radar
  const windowedTier = getTierForScore(windowedData.profile.overallRating);
  const windowedTierProgress = getTierProgress(windowedData.profile.overallRating);
  const windowedNextTier = getNextTier(windowedData.profile.overallRating);


  return (
    <div className="pb-20">
      {adminNav}

      {/* Progress badge — only when analysis is in progress */}
      {globalAnalyzedCount < totalGameCount && (
        <div className="mb-2">
          <div className="border-beam inline-flex items-center gap-1.5 bg-chess-surface/80 backdrop-blur-md rounded-lg px-2.5 py-1.5 border border-chess-border/30 text-[11px]">
            <span className="text-chess-accent animate-pulse">{'\uD83E\uDDEC'}</span>
            <span className="text-chess-text-secondary">{t('overview_analyzing')}</span>
            <span className="text-chess-accent font-semibold">{globalAnalyzedCount}/{totalGameCount}</span>
            <div className="w-16 bg-chess-muted/40 rounded-full h-1 overflow-hidden">
              <div className="bg-chess-accent h-full rounded-full transition-all duration-500" style={{ width: `${totalGameCount > 0 ? (globalAnalyzedCount / totalGameCount) * 100 : 0}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Score hero + radar — gate on data loaded to prevent number flash */}
      {dataLoading ? (
        <div className="flex flex-col items-center gap-4 py-12">
          <div className="w-6 h-6 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-500">Loading your Chess DNA...</span>
        </div>
      ) : (
        <>
          {/* Score hero -- uses WINDOWED profile to match the radar below */}
          <ScoreHero profile={windowedData.profile} tier={windowedTier} tierProgress={windowedTierProgress} nextTier={windowedNextTier} playerElo={playerElo} totalAnalyzed={analyzedCount} />

          {/* Time window tabs */}
          <TimeWindowTabs
            activeWindow={activeWindow}
            onWindowChange={setActiveWindow}
            analyzedGameCount={analyzedCount}
          />

          {/* Desktop: two-column grid / Mobile: single column */}
          <div className="md:grid md:grid-cols-[3fr_2fr] md:gap-6 space-y-4 md:space-y-0">
            {/* Left column: Charts */}
            <div className="space-y-4">
              <ChartGallery
                games={windowedData.games}
                analyses={windowedAnalyses}
                profile={windowedData.profile}
                onDimensionClick={handleDimensionClick}
                onChartChange={setActiveChartIndex}
              />
            </div>

            {/* Right column: Latest Game, Share, Compare */}
            <div className="space-y-4">

            {/* Review Latest Game + Audio */}
            {(() => {
              const latestGame = games
                .filter(g => g.analysisStatus === 'complete')
                .sort((a, b) => b.playedAt - a.playedAt)[0];
              if (!latestGame) return null;
              const latestAnalysis = allAnalyses.find(a => a.gameId === latestGame.id);
              const audioIsForThisGame = audioState.script?.source?.type === 'game' && audioState.script.source.gameId === latestGame.id;
              const hasAI = hasAnyProvider(settings) && latestAnalysis;
              return (
                <div className="rounded-xl bg-chess-surface/30 border border-chess-border/30 p-3">
                  <button
                    onClick={() => navigate(`/games/${latestGame.id}`)}
                    className="w-full text-left hover:opacity-80 transition-opacity"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('overview_latest_game')}</span>
                      <span className="text-xs text-chess-accent font-bold">{t('overview_review')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${latestGame.player.result === 'win' ? 'text-chess-accent' : latestGame.player.result === 'loss' ? 'text-red-400' : 'text-gray-400'}`}>
                        {latestGame.player.result === 'win' ? t('result_win_full') : latestGame.player.result === 'loss' ? t('result_loss_full') : t('result_draw_full')}
                      </span>
                      <span className="text-sm text-chess-text">vs {latestGame.opponent.username}</span>
                      <span className="text-xs text-gray-500">({latestGame.opponent.rating})</span>
                      {latestAnalysis && (
                        <span className="ml-auto text-xs text-gray-400">{latestAnalysis.summary.accuracy}% acc</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {latestGame.opening?.name ?? 'Unknown'} {'\u00B7'} {latestGame.timeClass}
                    </div>
                  </button>
                  {/* Audio button — always visible when AI available */}
                  {hasAI && (
                    <div className="mt-2 pt-2 border-t border-chess-border/20">
                      {audioState.isGenerating ? (
                        <div className="flex items-center gap-2 text-xs text-chess-accent">
                          <span className="w-3 h-3 border-[1.5px] border-chess-accent border-t-transparent rounded-full animate-spin" />
                          <span>Generating audio{audioState.genProgress ? ` (${audioState.genProgress.done}/${audioState.genProgress.total})` : '...'}</span>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (audioIsForThisGame) {
                              audioState.isPlaying ? audioControls.pause() : audioControls.play();
                            } else {
                              audioControls.generateGameAndPlay(settings, latestGame, latestAnalysis);
                            }
                          }}
                          className="flex items-center gap-1.5 text-xs text-chess-accent hover:text-chess-accent/80 transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            {audioIsForThisGame && audioState.isPlaying
                              ? <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>
                              : <polygon points="5,3 19,12 5,21" />}
                          </svg>
                          {audioIsForThisGame ? (audioState.isPlaying ? 'Pause' : 'Resume') : t('overview_listen_recap')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Share button */}
            <ShareButton profile={windowedData.profile} tier={windowedTier} playerElo={playerElo} />

            {/* Settings shortcut */}
            <div className="mt-4 md:mt-0">
              <button
                onClick={() => navigate('/settings')}
                className="w-full bg-chess-surface rounded-lg px-4 py-3 border border-chess-border/20 flex items-center gap-3 hover:border-chess-border/40 transition-all group"
              >
                <span className="text-lg">⚙️</span>
                <div className="flex-1 text-left">
                  <div className="text-sm font-bold text-chess-text">{t('overview_settings')}</div>
                  <div className="text-xs text-gray-500">{t('overview_settings_sub')}</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-500 group-hover:text-chess-accent transition-colors rtl:rotate-180"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>

            {/* Sign Out */}
            <button
              onClick={() => base44.auth.logout()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm text-gray-500 hover:text-red-400 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              {t('settings_sign_out')}
            </button>
            </div>{/* end right column */}
          </div>{/* end grid */}
        </>
      )}

      {/* Sticky bottom CTA — above bottom nav bar (account for guest signup bar height) */}
      <div className={`fixed left-0 right-0 z-[51] bg-chess-bg/95 backdrop-blur-md px-3 py-2 ${isGuest ? 'bottom-[100px]' : 'bottom-[60px]'}`}>
        <div className="max-w-6xl mx-auto">
          <button
            onClick={() => navigate('/timemachine')}
            className="shimmer-btn w-full bg-chess-accent text-chess-bg py-3 rounded-xl text-sm font-black hover:brightness-110 transition-all shadow-[0_0_12px_rgba(74,222,128,0.2)] flex items-center justify-center gap-2"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 22h14" /><path d="M5 2h14" />
              <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
              <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
            </svg>
            {t('overview_practice_mistakes')}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="rtl:rotate-180"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>
      <DataAttribution />
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
  isGuest = false,
}: {
  settings: UserSettings;
  onSettingsChange: (patch: Partial<UserSettings>) => Promise<void>;
  onImportComplete: () => void;
  isGuest?: boolean;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [platform] = useState<'chesscom' | 'lichess'>('chesscom');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      if (platform === 'chesscom') {
        // Chess.com flow
        const resp = await fetchChessCom(`${CHESS_COM_API_BASE}/player/${trimmed.toLowerCase()}`, {
          headers: { Accept: 'application/json' },
        });
        if (!resp.ok) {
          setError('Username not found on Chess.com');
          setFetchState({ phase: 'idle', fetched: 0, total: 0 });
          setLoading(false);
          return;
        }

        setFetchState({ phase: 'fetching', fetched: 0, total: 5 });
        const fallbackOrder: Array<'rapid' | 'blitz' | 'bullet' | 'all'> = ['rapid', 'blitz', 'bullet', 'all'];
        let onboardingIds: string[] = [];
        let usedTimeClass = 'rapid';

        for (const tc of fallbackOrder) {
          onboardingIds = await importChessComGames(trimmed, {
            timeClass: tc, maxGames: 5, guest: isGuest,
            onProgress: (progress) => {
              setFetchState({
                phase: progress.done ? 'done' : 'fetching',
                fetched: progress.fetched,
                total: progress.total || 5,
                error: progress.error,
              });
            },
          });
          if (onboardingIds.length > 0) { usedTimeClass = tc; break; }
        }

        await onSettingsChange({
          chesscomUsername: trimmed,
          onboardingGameIds: onboardingIds,
          onboardingTimeClass: usedTimeClass,
        });
        onImportComplete();

        // Background import
        (async () => {
          try {
            await importChessComGames(trimmed, { timeClass: 'rapid', maxGames: 30, guest: isGuest });
            await importChessComGames(trimmed, { timeClass: 'blitz', maxGames: 30, guest: isGuest });
            await importChessComGames(trimmed, { timeClass: 'bullet', maxGames: 30, guest: isGuest });
          } catch { /* ignore */ } finally {
            onSettingsChange({ bulkImportDone: true });
          }
        })();
      } else {
        // Lichess flow
        setFetchState({ phase: 'fetching', fetched: 0, total: 5 });
        const onboardingIds = await importLichessGames(trimmed, {
          maxGames: 5, guest: isGuest,
          onProgress: (progress) => {
            setFetchState({
              phase: progress.phase === 'done' ? 'done' : progress.phase === 'error' ? 'idle' : 'fetching',
              fetched: progress.fetched,
              total: progress.total || 5,
              error: progress.error,
            });
          },
        });

        if (onboardingIds.length === 0) {
          setError(`Username "${trimmed}" not found on Lichess`);
          setFetchState({ phase: 'idle', fetched: 0, total: 0 });
          setLoading(false);
          return;
        }

        await onSettingsChange({
          lichessUsername: trimmed,
          onboardingGameIds: onboardingIds,
          onboardingTimeClass: 'rapid',
        });
        onImportComplete();

        // Background import
        (async () => {
          try {
            await importLichessGames(trimmed, { maxGames: 30, timeClass: 'rapid', guest: isGuest });
            await importLichessGames(trimmed, { maxGames: 30, timeClass: 'blitz', guest: isGuest });
            await importLichessGames(trimmed, { maxGames: 30, timeClass: 'bullet', guest: isGuest });
          } catch { /* ignore */ } finally {
            onSettingsChange({ bulkImportDone: true });
          }
        })();
      }
    } catch {
      setError('Could not connect. Check your internet.');
      setFetchState({ phase: 'idle', fetched: 0, total: 0 });
    } finally {
      setLoading(false);
    }
  };

  const isFetching = fetchState.phase === 'fetching' || fetchState.phase === 'validating';
  const isDone = fetchState.phase === 'done';

  // ── Landing hero (first thing users see) ──
  if (!showForm) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-6">
        <div className="max-w-lg text-center">
          {/* Language picker */}
          <div className="flex justify-center gap-2 mb-10">
            {SUPPORTED_LANGUAGES.map((lang) => {
              const currentLang = (_settings as unknown as Record<string, unknown>).language as string | undefined;
              return (
                <button
                  key={lang.code}
                  onClick={() => { onSettingsChange({ language: lang.code } as Partial<UserSettings>); try { localStorage.setItem('chess-dna-language', lang.code); } catch {} }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    (currentLang ?? 'en') === lang.code
                      ? 'bg-chess-accent/20 text-chess-accent border border-chess-accent/30'
                      : 'bg-chess-surface/50 text-gray-400 border border-chess-border/20 hover:text-chess-text'
                  }`}
                >
                  {lang.label}
                </button>
              );
            })}
          </div>

          <div className="mb-6 animate-scale-in flex justify-center">
            <img src="/favicon.png" alt="Chess DNA" width={96} height={96} className="rounded-2xl" />
          </div>
          <h1 className="text-4xl font-bold mb-3 animate-fade-in-up">{t('s0_title')}</h1>
          <p className="text-chess-text text-xl font-medium mb-3 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
            {t('s0_subtitle')}
          </p>
          <p className="text-chess-text-secondary text-base mb-8 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
            {t('s0_desc')}
          </p>

          <button
            onClick={() => setShowForm(true)}
            className="bg-chess-accent text-chess-bg font-semibold px-8 py-3 rounded-xl text-lg hover:opacity-90 transition-all shadow-lg animate-fade-in-up"
            style={{ animationDelay: '0.3s' }}
          >
            {t('s0_get_started')}
          </button>

          <div className="mt-12 grid grid-cols-3 gap-6 text-center animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
            <div>
              <div className="text-2xl mb-1">
                <svg className="inline-block text-chess-accent" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 19.5 8 17.5 17 6.5 17 4.5 8" opacity="0.3" fill="currentColor" />
                  <polygon points="12 6 16 9.5 14.8 14.5 9.2 14.5 8 9.5" opacity="0.15" fill="currentColor" />
                  <polygon points="12 2 19.5 8 17.5 17 6.5 17 4.5 8" />
                  <line x1="12" y1="2" x2="12" y2="12" /><line x1="19.5" y1="8" x2="12" y2="12" />
                  <line x1="17.5" y1="17" x2="12" y2="12" /><line x1="6.5" y1="17" x2="12" y2="12" />
                  <line x1="4.5" y1="8" x2="12" y2="12" />
                </svg>
              </div>
              <p className="text-chess-text-tertiary text-xs">{t('s0_reveal')}</p>
            </div>
            <div>
              <div className="text-2xl mb-1">
                <svg className="inline-block text-chess-accent" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <path d="M8 8l2 4 2-3 2 2" opacity="0.8" />
                </svg>
              </div>
              <p className="text-chess-text-tertiary text-xs">{t('s0_patterns')}</p>
            </div>
            <div>
              <div className="text-2xl mb-1">
                <svg className="inline-block text-chess-accent" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
              </div>
              <p className="text-chess-text-tertiary text-xs">{t('s0_practice')}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Username entry form ──
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="mb-4 flex justify-center">
            <svg className="w-12 h-12 text-chess-accent" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <g transform="rotate(45 12 12)">
                <path d="M8 2c0 6.5 8 12.5 8 19" />
                <path d="M16 2c0 6.5-8 12.5-8 19" />
                <line x1="9.2" y1="5.5" x2="14.8" y2="5.5" />
                <line x1="11" y1="8.5" x2="13" y2="8.5" />
                <line x1="11" y1="14.5" x2="13" y2="14.5" />
                <line x1="9.2" y1="17.5" x2="14.8" y2="17.5" />
              </g>
            </svg>
          </div>
          <h2 className="text-xl font-black mb-2">{t('onboarding_welcome')} <span className="text-chess-accent glow-green">Chess DNA</span></h2>
          <p className="text-gray-400 text-sm max-w-xs mx-auto">{t('onboarding_desc')}</p>
          <p className="text-xs text-gray-500 mt-2">{t('onboarding_no_password')}</p>
        </div>

        {/* Platform — Chess.com only */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-chess-accent/10 text-chess-accent border border-chess-accent/30">
            <img src="/logos/chesscom.png" alt="" className="w-4 h-4 rounded-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            Chess.com
          </div>
        </div>

        <div className="bg-chess-surface rounded-xl p-4 border border-chess-border/30 mb-4">
          <label className="text-xs text-gray-500 uppercase tracking-widest block mb-2">
            {t('onboarding_username_label')}
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === 'Enter' && !isFetching && handleConnect()}
            placeholder={t('onboarding_username_placeholder')}
            disabled={isFetching || isDone}
            className="w-full bg-chess-bg border border-chess-border/40 rounded-lg px-3 py-2 text-sm text-chess-text placeholder:text-gray-600 focus:outline-none focus:border-chess-accent/50 disabled:opacity-50"
          />
          {error && <p className="text-chess-blunder text-xs mt-2">{error}</p>}
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || isFetching || isDone || !username.trim()}
          className="w-full bg-chess-accent text-chess-bg py-3 rounded-xl text-sm font-black hover:brightness-110 transition-all shadow-[0_0_12px_rgba(74,222,128,0.25)] disabled:opacity-50 mb-4"
        >
          {loading && !isFetching ? t('onboarding_connecting') : t('onboarding_get_games')}
        </button>

        {fetchState.phase === 'validating' && (
          <div className="bg-chess-surface/50 rounded-xl p-4 border border-chess-border/30 mb-4 text-center">
            <div className="text-sm text-gray-400 animate-pulse">{t('onboarding_validating')}</div>
          </div>
        )}

        {fetchState.phase === 'fetching' && (
          <div className="bg-chess-surface/50 rounded-xl p-4 border border-chess-border/30 mb-4">
            <div className="flex justify-between text-[11px] text-gray-400 mb-2">
              <span>Importing games...</span>
              <span>{fetchState.fetched} / {fetchState.total || 5}</span>
            </div>
            <div className="w-full bg-chess-muted/60 rounded-full h-2 overflow-hidden">
              <div className="bg-chess-accent h-full rounded-full transition-all duration-500" style={{ width: `${(fetchState.fetched / (fetchState.total || 5)) * 100}%` }} />
            </div>
          </div>
        )}

        {isDone && !fetchState.error && (
          <div className="bg-chess-accent/5 rounded-xl p-4 border border-chess-accent/20 mb-4 text-center">
            <div className="text-2xl mb-1">{'\u2713'}</div>
            <div className="text-sm font-bold text-chess-text">Games imported! Analysis starting...</div>
            <p className="text-xs text-gray-400 mt-1">This page will update automatically once analysis begins.</p>
          </div>
        )}

        {isDone && fetchState.error && (
          <div className="bg-chess-blunder/5 rounded-xl p-4 border border-chess-blunder/20 mb-4 text-center">
            <div className="text-sm text-chess-blunder">{fetchState.error}</div>
          </div>
        )}

        {!isFetching && !isDone && (
          <div className="mt-4 space-y-2">
            <button
              onClick={() => navigate('/settings')}
              className="w-full flex items-center gap-3 bg-chess-surface/30 rounded-xl p-3 border border-chess-border/30 hover:border-chess-accent/30 transition-colors"
            >
              <span className="text-lg">{'\u2191'}</span>
              <div className="flex-1 text-left">
                <div className="text-sm font-medium text-chess-text">Upload PGN</div>
                <div className="text-[10px] text-gray-500">Paste or upload .pgn files from any platform</div>
              </div>
              <span className="text-gray-500">{'\u203A'}</span>
            </button>
          </div>
        )}

        <p className="text-xs text-gray-600 text-center mt-6">{t('onboarding_privacy')}</p>
      </div>
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
  settings: _settings,
  onUpdateSettings,
}: {
  games: GameRecord[];
  analyzedCount: number;
  analyzingCount: number;
  settings: UserSettings;
  onUpdateSettings: (patch: Partial<UserSettings>) => Promise<void>;
}) {
  const { t } = useT();
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
      } else if (event.type === 'all_complete') {
        // Force local count to match total — guarantees canUnlock triggers
        setLocalAnalyzed(totalGames);
        setMoveProgress(null);
      }
    });
    return unsub;
  }, [totalGames]);

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
          <div className="mb-4" style={{ filter: 'drop-shadow(0 0 20px rgba(74,222,128,0.6))' }}>
            <svg className="inline-block text-chess-accent" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><g transform="rotate(45 12 12)"><path d="M8 2c0 6.5 8 12.5 8 19" /><path d="M16 2c0 6.5-8 12.5-8 19" /><line x1="9.2" y1="5.5" x2="14.8" y2="5.5" /><line x1="11" y1="8.5" x2="13" y2="8.5" /><line x1="11" y1="14.5" x2="13" y2="14.5" /><line x1="9.2" y1="17.5" x2="14.8" y2="17.5" /></g></svg>
          </div>
          <h2 className="text-2xl font-black mb-2 text-chess-text">
            {allDone ? t('overview_analysis_complete') : 'Your Chess DNA is Ready!'}
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
            {t('overview_unlock')}
          </button>

          {!allDone && remainingAfterUnlock > 0 && (
            <p className="text-[11px] text-gray-400 mt-4 flex items-center justify-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-chess-accent animate-pulse" />
              {remainingAfterUnlock} more game{remainingAfterUnlock !== 1 ? 's' : ''} analyzing in the background
            </p>
          )}

          <p className="text-xs text-gray-500 mt-3">
            {t('overview_unlock_sub')}
          </p>
        </div>
      </div>
    );
  }

  // Still analyzing
  return (
    <div className="max-w-md mx-auto text-center min-h-[70vh] flex flex-col items-center justify-center py-12">
      {/* Orbiting chess pieces */}
      <div className="relative w-40 h-40 mx-auto mb-8">
        {/* Center DNA icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-pulse" style={{ filter: 'drop-shadow(0 0 12px rgba(74,222,128,0.5))' }}>
            <svg className="text-chess-accent" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <g transform="rotate(45 12 12)"><path d="M8 2c0 6.5 8 12.5 8 19" /><path d="M16 2c0 6.5-8 12.5-8 19" /><line x1="9.2" y1="5.5" x2="14.8" y2="5.5" /><line x1="11" y1="8.5" x2="13" y2="8.5" /><line x1="11" y1="14.5" x2="13" y2="14.5" /><line x1="9.2" y1="17.5" x2="14.8" y2="17.5" /></g>
            </svg>
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
        Analyzing every move from {totalGames} game{totalGames !== 1 ? 's' : ''}.
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
          <span className="text-[11px] text-gray-500">{effectiveAnalyzed}/{progressTarget}</span>
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
          : 'Usually takes a few minutes'}
      </p>

      <p className="text-xs text-gray-600 mt-4">Feel free to close this tab and come back later.</p>
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
  strongest: _strongest,
  weakest: _weakest,
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
  const { t } = useT();
  const { theme } = useTheme();
  const { isGuest } = useAuth();
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
      {/* Background analysis banner */}
      {globalAnalyzedCount < totalGameCount && (
        <div className="border-beam flex items-center gap-3 rounded-xl bg-chess-surface/30 border border-chess-accent/10 px-4 py-2.5 mb-4 animate-fade-in">
          <svg className="text-chess-accent animate-spin-slow w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><g transform="rotate(45 12 12)"><path d="M8 2c0 6.5 8 12.5 8 19" /><path d="M16 2c0 6.5-8 12.5-8 19" /><line x1="9.2" y1="5.5" x2="14.8" y2="5.5" /><line x1="11" y1="8.5" x2="13" y2="8.5" /><line x1="11" y1="14.5" x2="13" y2="14.5" /><line x1="9.2" y1="17.5" x2="14.8" y2="17.5" /></g></svg>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-chess-text-secondary font-medium">
              Analyzing {globalAnalyzingCount > 0 ? `game ${globalAnalyzedCount + 1}` : ''} {'\u2014'} {globalAnalyzedCount}/{totalGameCount} done
            </div>
            <div className="w-full bg-chess-muted/40 rounded-full h-1 mt-1 overflow-hidden">
              <div className="bg-chess-accent h-full rounded-full transition-all duration-500" style={{ width: `${(globalAnalyzedCount / totalGameCount) * 100}%` }} />
            </div>
          </div>
          <span className="text-xs text-gray-500 shrink-0">Profile keeps improving</span>
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
            <div className="text-sm font-bold text-gray-400">{translateTierName(tier.id, t)}</div>
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
            <span className="text-xs text-gray-500 shrink-0">
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
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('overview_your_stats')}{onboardingTimeClass ? ` (${onboardingTimeClass})` : ''}</span>
          <span className="text-gray-500 text-xs">{s2StatsExpanded ? '\u25B2' : '\u25BC'}</span>
        </button>
        {s2StatsExpanded && (
          <div className="grid grid-cols-2 gap-2 p-3">
            {/* Percentile */}
            <div className="rounded-xl p-3 bg-chess-surface/30 border border-chess-border/30 text-center">
              <div className="text-lg mb-0.5">{'\uD83D\uDCCA'}</div>
              <div className="text-2xl font-black text-chess-text">{t('overview_top_pct', { pct: Math.max(1, 100 - overallPercentile) })}</div>
              <div className="text-xs text-gray-500">among {getRatingRangeLabel(playerElo)}</div>
            </div>

            {/* vs World's Best */}
            <div className="rounded-xl p-3 bg-chess-surface/30 border border-chess-border/30 text-center">
              <div className="text-lg mb-0.5">{'\uD83C\uDF0D'}</div>
              <div className="text-xs text-gray-500 mb-0.5">{t('overview_vs_worlds_best')}</div>
              <div className="flex items-center justify-center gap-2">
                <span className="text-xs text-gray-400">Magnus <span className="font-bold text-chess-text">{magnusScore}</span></span>
                <span className="text-gray-600">{'\u00B7'}</span>
                <span className="text-xs text-gray-400">Hikaru <span className="font-bold text-chess-text">{hikaruScore}</span></span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {Math.min(magnusScore, hikaruScore) - s2Profile.overallRating > 0
                  ? t('overview_pts_to_beat', { pts: Math.min(magnusScore, hikaruScore) - s2Profile.overallRating })
                  : 'You beat them both!'}
              </div>
            </div>

            {/* Win Rate */}
            <div className="rounded-xl p-3 bg-chess-surface/30 border border-chess-border/30 text-center">
              <div className="text-lg mb-0.5">{'\u2694\uFE0F'}</div>
              <div className="text-xs text-gray-500 mb-0.5">{t('overview_games_count', { count: games.length })}</div>
              <div className={`text-2xl font-black ${winPct >= 50 ? 'text-chess-accent' : 'text-chess-blunder'}`}>{winPct}%</div>
              <div className="text-xs text-gray-500">{winCount}W {'\u00B7'} {games.filter(g => g.player?.result === 'loss').length}L {'\u00B7'} {games.filter(g => g.player?.result === 'draw').length}D</div>
            </div>

            {/* ELO */}
            <div className="rounded-xl p-3 bg-chess-surface/30 border border-chess-border/30 text-center">
              <div className="text-lg mb-0.5">{'\uD83D\uDCC8'}</div>
              <div className="text-xs text-gray-500 mb-0.5">{t('overview_your_elo')}</div>
              <div className="text-2xl font-black text-chess-text">{playerElo}</div>
              <div className="text-xs text-gray-500">{getRatingRangeLabel(playerElo)}</div>
            </div>
          </div>
        )}
      </div>

      {/* Share button */}
      <ShareButton profile={s2Profile} tier={tier} playerElo={playerElo} />

      {/* Sticky bottom CTA -- unlock patterns (above nav bar + guest CTA) */}
      <div className={`fixed left-0 right-0 z-[51] bg-chess-bg/95 backdrop-blur-md px-3 py-2 ${isGuest ? 'bottom-[100px]' : 'bottom-[60px]'}`}>
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
  games,
  analyses,
  onUpdateSettings,
  sampleText,
  isGuest = false,
}: {
  patterns: CurrentPatterns;
  games: GameRecord[];
  analyses: GameAnalysis[];
  onUpdateSettings: (partial: Partial<UserSettings>) => Promise<void>;
  sampleText?: string;
  isGuest?: boolean;
}) {
  const { t } = useT();
  const [step, setStep] = useState(0);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const totalSteps = 2;

  // Compute patterns inline if stored patterns are empty (common during onboarding)
  const effectivePatterns = useMemo(() => {
    if (patterns.patterns.length > 0) return patterns.patterns;
    const computed = computePatternsFromGames(games, analyses, 1);
    return computed.patterns;
  }, [patterns, games, analyses]);
  const topPatterns = effectivePatterns.slice(0, 5);

  const handleFinish = () => {
    if (isGuest) {
      // Guest: show auth prompt instead of completing
      setShowAuthPrompt(true);
      return;
    }
    onUpdateSettings({ guidedWalkthroughDone: true });
  };

  // Guest auth prompt
  if (showAuthPrompt) {
    return (
      <div className="max-w-md mx-auto mt-12">
        <AuthPrompt onSkip={() => onUpdateSettings({ guidedWalkthroughDone: true })} />
      </div>
    );
  }

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

      {/* Step 0: Deep Game Analysis */}
      {step === 0 && (
        <div className="animate-fade-in">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">{'\uD83D\uDD2C'}</div>
            <h2 className="text-xl font-black mb-1">{t('s4_deep_analysis_title')}</h2>
            <p className="text-sm text-gray-400 max-w-md mx-auto">
              {t('s4_deep_analysis_desc')}
            </p>
            {sampleText && (
              <p className="text-xs text-chess-accent/50 uppercase tracking-widest mt-2">{sampleText}</p>
            )}
          </div>

          <div className="space-y-3 mb-6">
            <WalkthroughStep
              number={1}
              title={t('s4_step_import_title')}
              desc={t('s4_step_import_desc')}
              icon={'\u2693'}
            />
            <WalkthroughStep
              number={2}
              title={t('s4_step_quality_title')}
              desc={t('s4_step_quality_desc')}
              icon={'\uD83C\uDFA8'}
            />
            <WalkthroughStep
              number={3}
              title={t('s4_step_progress_title')}
              desc={t('s4_step_progress_desc')}
              icon={'\uD83D\uDCC8'}
            />
          </div>

          <button
            onClick={() => setStep(1)}
            className="w-full bg-chess-accent text-chess-bg py-3 rounded-xl text-sm font-black hover:brightness-110 transition-all shadow-[0_0_12px_rgba(74,222,128,0.25)]"
          >
            {t('s4_next_time_machine')} {'\u2192'}
          </button>
        </div>
      )}

      {/* Step 1: Time Machine */}
      {step === 1 && (
        <div className="animate-fade-in">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">{'\u23F3'}</div>
            <h2 className="text-xl font-black mb-1">{t('s4_time_machine_title')}</h2>
            <p className="text-sm text-gray-400 max-w-md mx-auto">
              {t('s4_time_machine_desc')}
            </p>
          </div>

          <div className="space-y-3 mb-6">
            <WalkthroughStep
              number={1}
              title={t('s4_step_find_mistakes_title')}
              desc={t('s4_step_find_mistakes_desc')}
              icon={'\uD83D\uDD0D'}
            />
            <WalkthroughStep
              number={2}
              title={t('s4_step_go_back_title')}
              desc={t('s4_step_go_back_desc')}
              icon={'\u265F'}
            />
            <WalkthroughStep
              number={3}
              title={t('s4_step_rank_title')}
              desc={t('s4_step_rank_desc')}
              icon={'\uD83C\uDFC6'}
            />
          </div>

          {/* User's detected patterns */}
          {topPatterns.length > 0 && (
            <div className="mb-6">
              <p className="text-[11px] text-gray-400 mb-2 px-0.5">{t('s4_your_patterns')}</p>
              <div className="space-y-1.5">
                {topPatterns.map((p, i) => {
                  const sev = p.severity >= 200 ? { color: 'text-red-400', bg: 'bg-red-500/10' }
                    : p.severity >= 100 ? { color: 'text-orange-400', bg: 'bg-orange-500/10' }
                    : { color: 'text-amber-400', bg: 'bg-amber-500/10' };
                  return (
                    <div
                      key={p.theme}
                      className="rounded-xl bg-gradient-to-r from-white/[0.04] to-transparent animate-fade-in-up"
                      style={{ animationDelay: `${i * 100}ms` }}
                    >
                      <div className="px-3 py-2.5 flex items-center gap-2.5">
                        <span className="text-[14px] font-black text-gray-600 w-5 text-center shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-black text-chess-text">{getThemeLabel(p.theme)}</div>
                          <div className="text-[10px] text-gray-500">
                            {t('s4_pattern_games', { games: String(p.gamesAffected) })} | {t('s4_pattern_occurrences', { count: String(p.occurrences) })}
                          </div>
                        </div>
                        <div className={`text-[13px] font-black ${sev.color}`}>{'\u2212'}{p.severity}<span className="text-[10px] font-bold"> CP</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => setStep(0)} className="flex-1 text-xs text-gray-500 py-2 hover:text-chess-text-secondary transition-colors">{'\u2190'} {t('s4_back')}</button>
            <button
              onClick={handleFinish}
              className="flex-1 relative overflow-hidden bg-gradient-to-r from-chess-accent to-emerald-400 text-chess-bg py-2.5 rounded-xl text-sm font-black hover:brightness-110 transition-all shadow-[0_0_20px_rgba(74,222,128,0.25)] group"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><g transform="rotate(45 12 12)"><path d="M8 2c0 6.5 8 12.5 8 19" /><path d="M16 2c0 6.5-8 12.5-8 19" /><line x1="9.2" y1="5.5" x2="14.8" y2="5.5" /><line x1="11" y1="8.5" x2="13" y2="8.5" /><line x1="11" y1="14.5" x2="13" y2="14.5" /><line x1="9.2" y1="17.5" x2="14.8" y2="17.5" /></g></svg>
                {t('s4_finish')} {'\u2192'}
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
  const { t } = useT();
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
          {t('overview_share_dna')}
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
                <span className="text-[11px]">{link.name}</span>
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
  const { t } = useT();

  const tierColor = getTierColor(tier, theme);
  const tierGlow = getTierGlowColor(tier, theme);

  return (
    <div className="mb-6">
      {/* Neon Gradient Card wrapping the tier display */}
      <div
        className="neon-card px-5 py-4 mb-3"
        style={{ '--neon-color-a': tierColor, '--neon-color-b': '#4ade80' } as React.CSSProperties}
      >
        <div className="flex items-center gap-4">
          <span className="text-5xl" style={{ filter: `drop-shadow(0 0 16px ${tierGlow})` }}>
            {tier.icon}
          </span>
          <div>
            <div className="flex items-baseline gap-3">
              <NumberTicker value={profile.overallRating} className="text-4xl font-black" style={{ color: tierColor }} delay={200} />
              <span className="text-sm font-bold text-gray-400" style={{ color: tierColor }}>{translateTierName(tier.id, t)}</span>
              <button
                onClick={() => setShowInfo(true)}
                className="text-gray-500 hover:text-chess-accent transition-colors ml-1"
                title="How is this calculated?"
              >
                <span className="text-xs border border-gray-500/40 rounded-full w-4 h-4 inline-flex items-center justify-center hover:border-chess-accent/40">i</span>
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{translateTierTitle(tier.id, t)} {'\u00B7'} ELO {playerElo} {'\u00B7'} {totalAnalyzed} {t('common_games')}</p>
          </div>
        </div>
        {nextTier && (
          <div className="flex items-center gap-3 mt-3">
            <div className="flex-1 bg-chess-muted/50 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${tierProgress}%`, backgroundColor: tierColor, boxShadow: `0 0 8px ${tierGlow}` }}
              />
            </div>
            <span className="text-xs text-gray-500 shrink-0">
              {t('overview_points_to_next', { points: String(pointsToNextTier(profile.overallRating)), tier: `${nextTier.icon} ${translateTierName(nextTier.id, t)}` })}
            </span>
          </div>
        )}
      </div>
      {showInfo && <ScoringInfoPopup profile={profile} onClose={() => setShowInfo(false)} />}
    </div>
  );
}

/* ================================================================
 *  Scoring Info Popup
 * ================================================================ */

function getCategoryInfo(t: (key: any) => string): Record<string, { icon: string; what: string; how: string }> {
  return {
    openings: {
      icon: '\uD83D\uDCD6',
      what: t('skill_openings_what'),
      how: t('skill_openings_how'),
    },
    tactics: {
      icon: '\u2694\uFE0F',
      what: t('skill_tactics_what'),
      how: t('skill_tactics_how'),
    },
    defense: {
      icon: '\uD83D\uDEE1\uFE0F',
      what: t('skill_defense_what'),
      how: t('skill_defense_how'),
    },
    positional: {
      icon: '\u265F\uFE0F',
      what: t('skill_positional_what'),
      how: t('skill_positional_how'),
    },
    endgame: {
      icon: '\uD83C\uDFC1',
      what: t('skill_endgame_what'),
      how: t('skill_endgame_how'),
    },
    calculation: {
      icon: '\uD83E\uDDEE',
      what: t('skill_calculation_what'),
      how: t('skill_calculation_how'),
    },
    time_management: {
      icon: '\u23F1\uFE0F',
      what: t('skill_time_management_what'),
      how: t('skill_time_management_how'),
    },
    resilience: {
      icon: '\uD83D\uDCAA',
      what: t('skill_resilience_what'),
      how: t('skill_resilience_how'),
    },
  };
}

function ScoringInfoPopup({
  profile,
  onClose,
}: {
  profile: ReturnType<typeof calculateSkillProfile>;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useT();
  const categoryInfo = getCategoryInfo(t);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-chess-bg border border-chess-border/40 rounded-2xl max-w-md md:max-w-3xl w-full max-h-[80vh] overflow-y-auto p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black text-chess-text">{t('overview_score_title')}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-chess-text-secondary text-lg">{'\u2715'}</button>
        </div>

        {/* Top row: Overall + Opponent Adjustment side by side on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
          <div className="rounded-xl bg-chess-surface/30 border border-chess-border/30 p-3">
            <div className="text-xs text-gray-400 mb-1 uppercase tracking-widest">{t('overview_overall_score')}</div>
            <p className="text-[11px] text-chess-text-secondary leading-relaxed">
              {t('overview_overall_desc')}
            </p>
          </div>
          <div className="rounded-xl bg-chess-surface/30 border border-chess-border/30 p-3">
            <div className="text-xs text-gray-400 mb-1 uppercase tracking-widest">{t('overview_opponent_adjusted')}</div>
            <p className="text-[11px] text-chess-text-secondary leading-relaxed">
              {t('overview_opponent_desc')}
            </p>
            <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
              {ALL_TIERS.map(t => (
                <span key={t.id} className="px-1.5 py-0.5 rounded bg-chess-surface/40 text-gray-500">
                  {t.icon} {t.name} {t.minScore}{'\u2013'}{t.maxScore}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Per-category breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {profile.dimensions.map((dim) => {
            const info = categoryInfo[dim.id];
            if (!info) return null;
            const dimTier = getTierForScore(dim.score);
            return (
              <div key={dim.id} className="rounded-xl bg-chess-surface/20 border border-chess-border/20 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm">{info.icon}</span>
                  <span className="text-sm font-bold text-chess-text">{t(`skill_${dim.id}` as any)}</span>
                  <span className="ml-auto text-sm font-black" style={{ color: getTierColor(dimTier, theme) }}>{dim.score}</span>
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed mb-1">{info.what}</p>
                <p className="text-[11px] text-gray-500 leading-relaxed italic">{info.how}</p>
              </div>
            );
          })}
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="w-full mt-4 py-2 rounded-xl bg-chess-surface/40 text-sm text-gray-400 hover:text-chess-text transition-colors"
        >
          {t('overview_got_it')}
        </button>
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
      <span className="text-[11px] text-gray-500 font-mono mr-1">
        {isOverridden ? '⚙' : '●'} {currentStage}
      </span>
      {ADMIN_STAGES.map(({ label, value }) => (
        <button
          key={label}
          onClick={() => handleStageOverride(value)}
          className={`text-xs font-mono px-1.5 py-0.5 rounded-full transition-all ${
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
          className="text-xs text-red-400 hover:text-red-300 font-mono px-1 ml-0.5"
          title={`Reset to auto (S${autoStage})`}
        >
          ✕
        </button>
      )}
      <div className="w-px h-3 bg-gray-600 mx-0.5" />
      <button
        onClick={handleFullReset}
        disabled={resetting}
        className={`text-xs font-mono px-1.5 py-0.5 rounded-full transition-all ${
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
        className="text-xs font-mono px-1.5 py-0.5 rounded-full text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10 transition-all"
        title="Sign out and log in as a different user"
      >
        👤
      </button>
    </div>
  );
}
