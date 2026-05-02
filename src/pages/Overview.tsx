import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataAttribution } from '@/components/PlatformBadge';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/contexts/AuthContext';
import { useChessData } from '@/contexts/ChessDataContext';
import type { TimeClass } from '@shared/types/game';
import type { UserSettings } from '@shared/types/storage';
import { calculateSkillProfile, getWeakestDimensions, getStrongestDimensions } from '@/patterns/skill-calculator';
import { getTierForScore, getTierColor, getTierGlowColor, getTierProgress, getNextTier, pointsToNextTier, ALL_TIERS } from '@/patterns/rank-tiers';
import { computeWindowedProfile, TIME_WINDOWS, DEFAULT_WINDOW, type TimeWindowId } from '@/patterns/windowed-profile';
import ChartGallery from '@/components/ChartGallery/ChartGallery';
import TimeWindowTabs from '@/components/TimeWindowTabs';
import { useAudioPlayer } from '@/contexts/AudioPlayerContext';
import { type JourneyStage } from '@/components/Onboarding';
import {
  LandingScreen,
  ConnectScreen,
  DecodingScreen,
  UnlockScreen,
  RadarRevealScreen,
} from '@/components/OnboardingFlow';
import OrbitDnaLoader from '@/components/OrbitDnaLoader';
import PlayerCardShare from '@/components/share/PlayerCardShare';
import { useTheme } from '@/components/ThemeContext';
import { useT, translateTierName, translateTierTitle } from '@/i18n/index';
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
    games,
    analyses,
    dataLoading,
    gamesLoading,
    filteredAnalyzedCount: analyzedCount,
    totalGameCount,
    analyzedCount: globalAnalyzedCount,
    playerElo,
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
  // S0 wrapper: switches between Landing and Connect once user clicks Get Started.
  const [s0ShowConnect, setS0ShowConnect] = useState(false);
  // S2 fallback: if the journeyStage hasn't recomputed yet after radar reveal,
  // this flag lets us fall through to the S5 view immediately.
  const [s2Continued, setS2Continued] = useState(false);
  // Global audio player — controls used only when the recap CTA is visible
  // (currently hidden), so we mark it as void to keep the lint clean.
  const { controls: audioControls } = useAudioPlayer();
  void audioControls;

  // syncTriggeredRef — kept to coordinate with analysis effect
  const syncTriggeredRef = useRef(false);

  // Windowed profile computation for the active time window
  const windowedData = useMemo(() => {
    const windowDef = TIME_WINDOWS.find(w => w.id === activeWindow)!;
    return computeWindowedProfile(games, analyses, windowDef.sinceMsAgo);
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

  // Auto-start the tutorial coachmarks for any user who finished the radar
  // reveal but never had a tutorialStepsSeen array (legacy users from before
  // the per-page seen-list model). For brand-new users we leave the array
  // empty so each page they visit fires its step exactly once.
  useEffect(() => {
    if (settings.radarRevealedAt && settings.guidedWalkthroughDone && settings.tutorialStepsSeen === undefined) {
      updateSettings({ tutorialStepsSeen: [] });
    }
  }, [settings.radarRevealedAt, settings.guidedWalkthroughDone, settings.tutorialStepsSeen, updateSettings]);

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

  /* ── S0: Landing → Connect (multi-source: Chess.com / Lichess / PGN) ── */
  // Don't flash the LandingScreen for returning users while games are still
  // loading — wait until we know whether they have any. (Once gamesLoading
  // resolves, journeyStage updates from 0 to 5 in the same render so the
  // user goes straight to their DNA view.)
  if (effectiveStage === 0 && gamesLoading) {
    return (
      <div className="fixed inset-0 z-30 bg-chess-bg flex items-center justify-center">
        <OrbitDnaLoader size={96} caption="Loading your Chess DNA..." />
      </div>
    );
  }
  if (effectiveStage === 0) {
    const refetchAll = () => {
      console.log('[Chess DNA] onImportComplete — calling refetchGames, refetchAnalyses & refetchPatterns');
      refetchGames(); refetchAnalyses(); refetchPatterns();
    };
    return (
      <>
        {adminNav}
        {s0ShowConnect ? (
          <ConnectScreen
            isGuest={isGuest}
            onSettingsChange={updateSettings}
            onImportComplete={refetchAll}
            onBack={() => setS0ShowConnect(false)}
          />
        ) : (
          <LandingScreen
            settings={settings}
            onSettingsChange={updateSettings}
            onGetStarted={() => setS0ShowConnect(true)}
          />
        )}
      </>
    );
  }

  /* ── S1: Decoding → "Your Chess DNA is Ready" ── */
  if (effectiveStage === 1) {
    const obIds = settings.onboardingGameIds ?? [];
    const obIdSet = new Set(obIds);
    const s1Games = obIds.length > 0 ? games.filter((g) => obIdSet.has(g.id)) : games;
    const s1AnalyzedCount = s1Games.filter((g) => g.analysisStatus === 'complete').length;
    const s1AnalyzingCount = s1Games.filter((g) => g.analysisStatus === 'analyzing').length;
    const MIN_FOR_UNLOCK = 5;
    const canUnlock = s1Games.length > 0 && (
      s1AnalyzedCount >= s1Games.length || s1AnalyzedCount >= MIN_FOR_UNLOCK
    );

    if (canUnlock) {
      return (
        <>{adminNav}
          <UnlockScreen
            analyzedCount={s1AnalyzedCount}
            totalGames={s1Games.length}
            onUnlock={() => updateSettings({ radarRevealedAt: Date.now() })}
          />
        </>
      );
    }
    return (
      <>{adminNav}
        <DecodingScreen
          games={s1Games}
          analyzedCount={s1AnalyzedCount}
          analyzingCount={s1AnalyzingCount}
          onUpdateSettings={updateSettings}
        />
      </>
    );
  }

  /* ── S2: Radar reveal animation + explainer ──
        Gated on `radarRevealedAt && !guidedWalkthroughDone` instead of
        journeyStage === 2 — otherwise users whose patterns are already
        unlocked when they click "Unlock your DNA" jump from stage 1 → 4
        and skip the reveal entirely. */
  if (settings.radarRevealedAt && !settings.guidedWalkthroughDone && !s2Continued && stageOverride == null && adminStageOverride == null) {
    const obIds2 = settings.onboardingGameIds ?? [];
    const obIdSet2 = new Set(obIds2);
    const s2Games = obIds2.length > 0 ? games.filter((g) => obIdSet2.has(g.id)) : games;
    const s2Analyses = obIds2.length > 0 ? analyses.filter((a) => obIdSet2.has(a.gameId)) : analyses;
    return (
      <>{adminNav}
        <RadarRevealScreen
          games={s2Games}
          analyses={s2Analyses}
          onboardingTimeClass={settings.onboardingTimeClass}
          onContinue={() => {
            // Skip the old guided walkthrough — the new tutorial coachmarks
            // take over once the user lands on the main DNA screen.
            updateSettings({
              guidedWalkthroughDone: true,
              tutorialStep: 1,
            });
            setS2Continued(true);
          }}
        />
      </>
    );
  }

  /* ── S4: legacy guided walkthrough — bypassed for new users
        (we set guidedWalkthroughDone=true on radar reveal). Existing users
        at S4 fall through to S5 view + tutorial coachmarks below. ── */
  void patterns;

  /* --- S5: Fully onboarded -- combined DNA view --- */

  // Windowed tier info -- so hero matches the radar
  const windowedTier = getTierForScore(windowedData.profile.overallRating);
  const windowedTierProgress = getTierProgress(windowedData.profile.overallRating);
  const windowedNextTier = getNextTier(windowedData.profile.overallRating);


  return (
    <div className="pb-20">
      {adminNav}

      {/* Progress badge — fixed top-start so it sits on the same row as the
          game-type filter (Blitz ▼) which lives in AppShell at top-end. */}
      {globalAnalyzedCount < totalGameCount && (
        <div className="fixed top-3 start-3 z-50">
          <div className="border-beam inline-flex items-center gap-1.5 bg-chess-surface/90 backdrop-blur-md rounded-lg px-2.5 py-1.5 border border-chess-border/30 text-[11px] shadow-lg">
            <span className="text-chess-accent animate-pulse">{'🧬'}</span>
            <span className="text-chess-text-secondary">{t('overview_analyzing')}</span>
            <span className="text-chess-accent font-semibold">{globalAnalyzedCount}/{totalGameCount}</span>
            <div className="w-16 bg-chess-muted/40 rounded-full h-1 overflow-hidden">
              <div className="bg-chess-accent h-full rounded-full transition-all duration-500" style={{ width: `${totalGameCount > 0 ? (globalAnalyzedCount / totalGameCount) * 100 : 0}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Score hero + radar — gate on data loaded to prevent number flash.
          The loader sits at the top of the content area (where the score
          hero will land) so the screen doesn't jump when data arrives. */}
      {dataLoading ? (
        <div className="fixed inset-0 z-30 bg-chess-bg flex items-center justify-center pointer-events-none">
          <OrbitDnaLoader size={96} caption="Loading your Chess DNA..." />
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
            <div className="space-y-4" data-tutorial-target="dna-radar">
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

      {/* Sticky bottom CTA — sits above the bottom-nav with enough clearance
          that it doesn't clip the active-tab highlight (which extends a few
          pixels above the nav's interior). Larger offset for guests because
          the signup strip adds ~40px on top of the nav. */}
      <div className={`fixed left-0 right-0 z-[51] bg-chess-bg/95 backdrop-blur-md px-3 py-2 ${isGuest ? 'bottom-[116px]' : 'bottom-[76px]'}`}>
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
      {/* Data attribution — only render after the page is fully loaded so
          it doesn't appear floating mid-loader. */}
      {!dataLoading && <DataAttribution />}
    </div>
  );
}

/* ================================================================
 *  Patterns Panel (right column in S5)
 * ================================================================ */


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
  const { settings } = useTheme();
  const [showCardShare, setShowCardShare] = useState(false);
  // Username/lichessUsername come from settings \u2014 keep the existing
  // text-share fallback off the menu since the new flow opens a visual
  // card composer with a native share sheet at the end.
  const username = settings.chesscomUsername || settings.lichessUsername || 'player';
  void playerElo;

  return (
    <div className="w-full">
      <button
        onClick={() => setShowCardShare(true)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-chess-surface/40 border border-chess-border/30 text-sm text-gray-400 hover:text-chess-text hover:border-chess-accent/30 transition-all"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        {t('overview_share_dna')}
      </button>

      {showCardShare && (
        <PlayerCardShare
          profile={profile}
          tier={tier}
          playerElo={playerElo}
          username={username}
          lichessUsername={settings.lichessUsername}
          onClose={() => setShowCardShare(false)}
        />
      )}
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
    <div className="mb-4">
      {/* Neon Gradient Card wrapping the tier display */}
      <div
        className="neon-card px-5 py-3 mb-3"
        style={{ '--neon-color-a': tierColor, '--neon-color-b': '#4ade80' } as React.CSSProperties}
      >
        {/* Big white tier number on the left, chess piece + tier label
            inline beside, ELO + percentile underneath. Matches Claude Design. */}
        <div className="flex items-center gap-4">
          <NumberTicker
            value={profile.overallRating}
            className="text-[60px] sm:text-[68px] font-black leading-none tabular-nums tracking-[-0.04em] text-chess-text shrink-0"
            delay={200}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="text-2xl leading-none"
                style={{ filter: `drop-shadow(0 0 12px ${tierGlow})` }}
              >
                {tier.icon}
              </span>
              <span className="text-lg font-extrabold text-chess-text tracking-tight">
                {translateTierName(tier.id, t)}
              </span>
              <button
                onClick={() => setShowInfo(true)}
                className="text-gray-500 hover:text-chess-accent transition-colors"
                title="How is this calculated?"
              >
                <span className="text-[10px] border border-gray-500/40 rounded-full w-4 h-4 inline-flex items-center justify-center hover:border-chess-accent/40">i</span>
              </button>
            </div>
            <p className="text-[13px] text-chess-text-secondary mt-1 tabular-nums">{playerElo} ELO · {translateTierTitle(tier.id, t)}{totalAnalyzed > 0 ? ` · ${totalAnalyzed} ` : ""}{totalAnalyzed > 0 ? t("common_games") : ""}</p>
          </div>
        </div>
        {nextTier && (
          <div className="mt-3.5">
            {/* Slim Bishop ___|___ Rook progress bar with from-to gradient */}
            <div className="flex items-center justify-between text-[11px] text-chess-text-secondary mb-1.5">
              <span className="font-semibold" style={{ color: tierColor }}>
                {translateTierName(tier.id, t)}
              </span>
              <span className="tabular-nums">
                {pointsToNextTier(profile.overallRating)} to {translateTierName(nextTier.id, t)}
              </span>
            </div>
            <div className="bg-chess-muted/50 rounded-full h-2 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${tierProgress}%`,
                  background: `linear-gradient(90deg, ${tierColor}, ${getTierColor(nextTier, theme)})`,
                  boxShadow: `0 0 8px ${tierGlow}`,
                }}
              />
            </div>
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
  const navigate = useNavigate();
  const [resetting, setResetting] = useState(false);
  const tutorialStep = adminSettings.tutorialStep ?? 0;

  const setTutorial = (step: number) => {
    onUpdateSettings({ tutorialStep: step });
  };

  // All app pages — used by the page-jump row in the floating admin bar.
  const PAGES: { label: string; path: string; title: string }[] = [
    { label: 'DNA', path: '/', title: 'DNA Overview' },
    { label: 'Games', path: '/games', title: 'Recent Games' },
    { label: 'TM', path: '/timemachine', title: 'Time Machine' },
    { label: 'Cmp', path: '/compare', title: 'Compare' },
    { label: 'Set', path: '/settings', title: 'Settings' },
    { label: 'Pat', path: '/patterns', title: 'Patterns (legacy)' },
    { label: 'Les', path: '/lessons', title: 'Lessons (legacy)' },
    { label: 'Exr', path: '/exercises', title: 'Exercises (legacy)' },
    { label: 'Trn', path: '/training', title: 'Training (GettingBetter)' },
    { label: 'Sk', path: '/skill', title: 'SkillStudio' },
  ];

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
    <div className="fixed bottom-20 right-3 z-50 bg-black/85 backdrop-blur-sm rounded-2xl px-2 py-1.5 border border-chess-border/40 shadow-lg max-w-[calc(100vw-24px)]">
      {/* Row 1 — stage overrides + reset/user controls */}
      <div className="flex items-center gap-1 flex-wrap">
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

      {/* Row 2 — page jumps + tutorial step jumps */}
      <div className="flex items-center gap-1 flex-wrap mt-1 pt-1 border-t border-white/10">
        <span className="text-[10px] text-gray-600 font-mono mr-0.5" title="Pages">
          📄
        </span>
        {PAGES.map((p) => {
          const isCurrent = window.location.pathname === p.path;
          return (
            <button
              key={p.path}
              onClick={() => navigate(p.path)}
              title={p.title}
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full transition-all ${
                isCurrent
                  ? 'bg-blue-500/30 text-blue-200 font-bold'
                  : 'text-gray-400 hover:text-chess-text hover:bg-white/10'
              }`}
            >
              {p.label}
            </button>
          );
        })}
        <div className="w-px h-3 bg-gray-600 mx-0.5" />
        <span className="text-[10px] text-gray-600 font-mono mr-0.5" title={`Tutorial step (current: ${tutorialStep})`}>
          ⓘ {tutorialStep}
        </span>
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            onClick={() => setTutorial(n)}
            title={`Set tutorial to step ${n} — go to that screen and the coachmark fires automatically`}
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full transition-all ${
              tutorialStep === n
                ? 'bg-purple-500/40 text-purple-100 font-bold'
                : 'text-gray-400 hover:text-chess-text hover:bg-white/10'
            }`}
          >
            T{n}
          </button>
        ))}
        <button
          onClick={() => setTutorial(0)}
          title="Reset tutorial (mark as not started)"
          className="text-[10px] font-mono px-1 text-red-400 hover:text-red-300"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
