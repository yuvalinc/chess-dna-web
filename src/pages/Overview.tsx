import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/contexts/AuthContext';
import { useChessData } from '@/contexts/ChessDataContext';
import { importChessComGames } from '@/api/chess-com-import';
import type { TimeClass } from '@shared/types/game';
import type { UserSettings } from '@shared/types/storage';
import type { SkillProfile } from '@shared/types/patterns';
import { calculateSkillProfile } from '@/patterns/skill-calculator';
import { getTierForScore, getTierColor, getNextTier, pointsToNextTier, ALL_TIERS } from '@/patterns/rank-tiers';
import { computeWindowedProfile, TIME_WINDOWS, DEFAULT_WINDOW, type TimeWindowId } from '@/patterns/windowed-profile';
import ChartGallery from '@/components/ChartGallery/ChartGallery';
import { RadarLegend, SkillIcon } from '@/components/SkillRadar';
import { type JourneyStage } from '@/components/Onboarding';
import {
  ConnectScreen,
  DecodingScreen,
  UnlockScreen,
  RadarRevealScreen,
} from '@/components/OnboardingFlow';
import OrbitDnaLoader from '@/components/OrbitDnaLoader';
import PlayerCardShare from '@/components/share/PlayerCardShare';
import { useTheme } from '@/components/ThemeContext';
import { useT, translateTierName } from '@/i18n/index';
// FriendCompare moved to /compare page

interface OverviewProps {
  stageOverride?: JourneyStage | null;
  timeClassFilter?: TimeClass | null;
}

export default function Overview({ stageOverride, timeClassFilter: timeClassFilterProp }: OverviewProps) {
  const navigate = useNavigate();
  const { t } = useT();
  const { settings, updateSettings, isAdmin, settingsLoading } = useTheme();
  const { isGuest, userId } = useAuth();
  const {
    patterns,
    games,
    analyses,
    dataLoading,
    gamesLoading,
    playerElo,
    journeyStage,
    profile,
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

  // Time-window tabs were removed in favor of all 3 timeframes overlaid on
  // the radar. Right-column recap components still want a single "active"
  // window — keep the default but no longer expose a setter.
  const activeWindow: TimeWindowId = DEFAULT_WINDOW;
  const [showScoringInfo, setShowScoringInfo] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);
  const [, setActiveChartIndex] = useState(0);
  // S0 wrapper: kept for backwards compatibility with deep-links; landing
  // step removed so S0 starts on the connect screen.
  const [, setS0ShowConnect] = useState(false);
  // S2 fallback: if the journeyStage hasn't recomputed yet after radar reveal,
  // this flag lets us fall through to the S5 view immediately.
  const [s2Continued, setS2Continued] = useState(false);
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

  // Three-profile bundle for the radar overlays (last week / last month /
  // all time, all rendered simultaneously).
  //
  // Cached per (user, timeClass) so the radar paints from the previous
  // session's compute on cold load — otherwise the user sees the 50s
  // baseline for 5–10s while analyses fetch, deserialize, and re-memo.
  // Total cache is ~6 KB (3 windowed profiles × ~2 KB each) so quota is
  // a non-issue. Live data swaps in the moment it's available.
  const radarCacheKey = userId
    ? `chess-dna-radar-${userId}-${settings.selectedTimeClass ?? 'all'}`
    : null;
  const [cachedRadarProfiles] = useState<{
    week: SkillProfile;
    month: SkillProfile;
    all: SkillProfile;
  } | null>(() => {
    if (!radarCacheKey || typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(radarCacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.week || !parsed?.month || !parsed?.all) return null;
      if ((parsed.month.gamesUsed ?? 0) === 0) return null;
      return parsed;
    } catch { return null; }
  });
  const computedRadarProfiles = useMemo(() => {
    const find = (id: TimeWindowId) => TIME_WINDOWS.find(w => w.id === id)!;
    return {
      week:  computeWindowedProfile(games, analyses, find('week').sinceMsAgo).profile,
      month: computeWindowedProfile(games, analyses, find('month').sinceMsAgo).profile,
      all:   computeWindowedProfile(games, analyses, find('all').sinceMsAgo).profile,
    };
  }, [games, analyses]);
  // Prefer the freshly-computed bundle once `month` has real data. Until
  // then fall back to the cached one so the radar shows real values from
  // the moment the page paints.
  const radarProfiles = computedRadarProfiles.month.gamesUsed > 0
    ? computedRadarProfiles
    : (cachedRadarProfiles ?? computedRadarProfiles);
  useEffect(() => {
    if (!radarCacheKey) return;
    if (computedRadarProfiles.month.gamesUsed === 0) return;
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(radarCacheKey, JSON.stringify(computedRadarProfiles)); }
    catch { /* quota — best-effort */ }
  }, [computedRadarProfiles, radarCacheKey]);

  // Overlays definition — kept stable across renders so we can pass the
  // same array to both the radar and the standalone legend.
  const radarOverlays = useMemo(() => [
    {
      id: 'week',
      label: t('tab_week'),
      profile: radarProfiles.week,
      color: '#4ade80', /* green — Last week */
    },
    {
      id: 'all',
      label: t('tab_all_time'),
      profile: radarProfiles.all,
      color: '#c084fc', /* purple — All time */
    },
  ], [t, radarProfiles.week, radarProfiles.all]);

  // Overlays without enough data → render checkbox as disabled. The same
  // gamesUsed === 0 check keeps SkillRadar from drawing the all-50 polygon.
  const disabledOverlayIds = useMemo(() => {
    const s = new Set<string>();
    for (const ov of radarOverlays) {
      if (ov.profile.gamesUsed === 0) s.add(ov.id);
    }
    return s;
  }, [radarOverlays]);

  // Radar timeframe visibility — owned here so the legend (rendered below
  // the tier-info line) can drive the radar's polygon visibility.
  const [radarPrimaryVisible, setRadarPrimaryVisible] = useState<boolean>(true);
  const [radarVisibleOverlayIds, setRadarVisibleOverlayIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Visibility toggles enforce a "≥1 checked" rule — un-toggling the last
  // visible polygon would leave a blank radar, so we silently ignore that.
  const togglePrimaryVisible = useCallback(() => {
    setRadarPrimaryVisible((v) => {
      if (v && radarVisibleOverlayIds.size === 0) return v; // keep last visible
      return !v;
    });
  }, [radarVisibleOverlayIds]);
  const toggleOverlayVisible = useCallback((id: string) => {
    setRadarVisibleOverlayIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Don't allow disabling the last visible polygon.
        if (next.size === 1 && !radarPrimaryVisible) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, [radarPrimaryVisible]);

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
  //
  // Tracks per-ID so the effect can pick up newly-arrived pending games:
  // the games array first fills from the localStorage cache (possibly
  // stale), then gets replaced by the fresh server fetch which may
  // include additional pending games. Without per-ID tracking, the
  // cache-driven first fire would set a boolean ref and the genuine
  // pending games from the fresh fetch would never be queued.
  const queuedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (games.length === 0) return;
    if (syncTriggeredRef.current) return;

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
    // Skip IDs we've already queued this session.
    toAnalyze = toAnalyze.filter((g) => !queuedIdsRef.current.has(g.id));
    // Analyze newest games first (highest playedAt first)
    toAnalyze.sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0));

    if (toAnalyze.length === 0) return;

    const gameIds = toAnalyze.map((g) => g.id);
    for (const id of gameIds) queuedIdsRef.current.add(id);
    console.log('[Chess DNA] Queuing', gameIds.length, 'games for analysis', isOnboarding ? '(onboarding only)' : '');
    queueForAnalysis(gameIds);
  }, [games, settings.onboardingGameIds, settings.radarRevealedAt, queueForAnalysis]);

  // Post-onboarding cross-time-class bulk import. Runs once, after the radar
  // reveal, so it never competes with the 5 onboarding games for the analysis
  // queue. Idempotent via the `bulkImportDone` settings flag.
  const bulkImportTriggeredRef = useRef(false);
  useEffect(() => {
    if (bulkImportTriggeredRef.current) return;
    if (!settings.radarRevealedAt) return;
    if (settings.bulkImportDone) return;
    const username = settings.chesscomUsername;
    if (!username) return;
    const startedFrom = settings.onboardingTimeClass;
    bulkImportTriggeredRef.current = true;
    (async () => {
      const allNewIds: string[] = [];
      try {
        for (const tc of ['rapid', 'blitz', 'bullet', 'daily'] as TimeClass[]) {
          if (tc === startedFrom) continue;
          // Catch per-time-class so a transient chess.com failure on one
          // (now throws ChessComFetchError instead of silently returning [])
          // doesn't abort the whole bulk import.
          try {
            const ids = await importChessComGames(username, { timeClass: tc, maxGames: 30, guest: isGuest });
            allNewIds.push(...ids);
          } catch (err) {
            console.warn('[Chess DNA] Bulk import failed for', tc, err);
          }
        }
        if (allNewIds.length > 0) queueForAnalysis(allNewIds);
        refetchGames();
        refetchAnalyses();
      } finally {
        updateSettings({ bulkImportDone: true });
      }
    })();
  }, [settings.radarRevealedAt, settings.bulkImportDone, settings.chesscomUsername, settings.onboardingTimeClass, isGuest, refetchGames, refetchAnalyses, updateSettings, queueForAnalysis]);

  // Note: Game sync is now handled globally by useChessComSync in ChessDataContext.
  // The old per-page-load sync effect has been removed.

  const [activeDimension, setActiveDimension] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const handleDimensionClick = useCallback((id: string, event?: React.MouseEvent) => {
    if (event) {
      setActiveDimension({ id, x: event.clientX, y: event.clientY });
    } else {
      setActiveDimension({ id, x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }
  }, []);

  /* --- Admin stage navigator (floating overlay) — localhost only --- */
  const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const adminNav = isAdmin && isLocalhost ? (
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
  // Hold the loading splash until BOTH games + settings have come back
  // once. Without this we'd flash S1 (decoding) for a fraction of a
  // second on every reload — games returning first (totalGameCount > 0)
  // while `radarRevealedAt` is still its default `null`.
  if (settingsLoading || (effectiveStage === 0 && gamesLoading)) {
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
    // S0 now starts directly on the username-connect screen — the landing
    // page is the marketing site outside the app, so showing it again here
    // is redundant. Kept on the route only as a stage-fallback for admin.
    return (
      <>
        {adminNav}
        <ConnectScreen
          isGuest={isGuest}
          onSettingsChange={updateSettings}
          onImportComplete={refetchAll}
          onBack={() => setS0ShowConnect(false)}
        />
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

  // Windowed tier info — used by the share button for card branding.
  // Route through the CACHED radarProfiles[activeWindow] (not windowedData)
  // so the score paints from cache on cold load. windowedData is an
  // identical compute but uncached; using radarProfiles here means the
  // visible "X overall" number, tier, and "Y to next tier" line all
  // benefit from the prior-session cache instead of flashing 50.
  const activeProfile = radarProfiles[activeWindow] ?? radarProfiles.month;
  const windowedTier = getTierForScore(activeProfile.overallRating);


  return (
    <div className="pb-2 min-h-[calc(100dvh-110px)] flex flex-col">
      {adminNav}

      {/* Score hero + radar — render whenever we have profile data, even if
          live data is still streaming in. The context rehydrates a cached
          profile synchronously on mount, so returning users see their real
          DNA scores immediately instead of staring at the loader for 5–10s
          while analyses fetch + deserialize. Loader appears only when we
          genuinely have no data yet (first-ever load or cleared cache). */}
      {dataLoading && profile.gamesUsed === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <OrbitDnaLoader size={96} caption="Loading your Chess DNA..." />
        </div>
      ) : (
        <>
          {/* Desktop: two-column grid / Mobile: single flex column with
              the CTAs pinned to the bottom (mt-auto on the right column)
              — kills the dead space between the radar block and the
              bottom-nav. */}
          <div className="flex flex-col flex-1 gap-4 md:grid md:grid-cols-[3fr_2fr] md:gap-6 md:flex-none">
            {/* Left column: Charts */}
            <div className="space-y-3" data-tutorial-target="dna-radar">
              <ChartGallery
                games={windowedData.games}
                analyses={windowedAnalyses}
                profile={radarProfiles.month}
                onDimensionClick={handleDimensionClick}
                onChartChange={setActiveChartIndex}
                primaryLabel={t('tab_month')}
                primaryColor="#60a5fa" /* blue — Last month (default) */
                overlays={radarOverlays}
                primaryVisible={radarPrimaryVisible}
                visibleOverlayIds={radarVisibleOverlayIds}
                showLegend={false}
              />
              {/* Tier-info line — sits directly under the radar. ELO +
                  percentile lead, then tier progress, then the overall
                  score with an (i) info button next to it. */}
              <div className="text-center text-[12px] text-chess-text-tertiary tabular-nums">
                {playerElo > 0 && (
                  <span>{playerElo} ELO</span>
                )}
                {(() => {
                  const next = getNextTier(activeProfile.overallRating);
                  const pts = pointsToNextTier(activeProfile.overallRating);
                  if (!next || pts <= 0) return null;
                  return (
                    <>
                      <span className="mx-1.5 inline-block w-1 h-1 rounded-full bg-chess-text-tertiary/50 align-middle" />
                      <span>{pts} to {translateTierName(next.id, t)}</span>
                    </>
                  );
                })()}
                <span className="mx-1.5 inline-block w-1 h-1 rounded-full bg-chess-text-tertiary/50 align-middle" />
                <span>
                  <span className="text-chess-text font-extrabold">{activeProfile.overallRating}</span>
                  <span className="ms-1">overall</span>
                </span>
                <button
                  onClick={() => setShowScoringInfo(true)}
                  className="ml-1.5 text-gray-500 hover:text-chess-accent transition-colors align-middle"
                  title="How is this calculated?"
                >
                  <span className="text-[9px] border border-gray-500/40 rounded-full w-3.5 h-3.5 inline-flex items-center justify-center hover:border-chess-accent/40">i</span>
                </button>
              </div>
              {/* Timeframe checkboxes — sit below the tier-info line so the
                  user can toggle which polygons are drawn on the radar. */}
              <RadarLegend
                primaryLabel={t('tab_month')}
                primaryColor="#60a5fa"
                primaryVisible={radarPrimaryVisible}
                primaryDisabled={radarProfiles.month.gamesUsed === 0}
                onTogglePrimary={togglePrimaryVisible}
                overlays={radarOverlays}
                visibleOverlayIds={radarVisibleOverlayIds}
                disabledOverlayIds={disabledOverlayIds}
                onToggleOverlay={toggleOverlayVisible}
              />
            </div>

            {/* Right column: 4 main CTAs (Share / Progress / Profile /
                Replay). Divider above visually separates the radar block
                (chart + tier-info + checkboxes) from the action area.
                On mobile, mt-auto pushes the CTAs to the bottom so the
                space between them and the bottom-nav disappears. */}
            <div className="space-y-2 mt-auto md:mt-0">
              <div className="border-t border-chess-border/30" />
              <FourCtaGrid
                onShareClick={() => setShowShareCard(true)}
                onSettingsClick={() => navigate('/settings')}
                onProgressClick={() => navigate('/games?tab=progress')}
                onReplayClick={() => navigate('/timemachine')}
              />
            </div>
            </div>{/* end grid */}

          {showShareCard && (
            <PlayerCardShare
              profile={windowedData.profile}
              tier={windowedTier}
              playerElo={playerElo}
              username={settings.chesscomUsername || settings.lichessUsername || 'player'}
              lichessUsername={settings.lichessUsername}
              onClose={() => setShowShareCard(false)}
            />
          )}

          {/* Popups rendered at the page root so their fixed-position render
              doesn't sit inside the `space-y-5` flow above (which was
              causing a small layout shift on click). */}
          {showScoringInfo && (
            <ScoringInfoPopup profile={windowedData.profile} onClose={() => setShowScoringInfo(false)} />
          )}
          {activeDimension && (
            <DimensionInfoTooltip
              profile={radarProfiles.month}
              dimensionId={activeDimension.id}
              anchorX={activeDimension.x}
              anchorY={activeDimension.y}
              onClose={() => setActiveDimension(null)}
            />
          )}
        </>
      )}

    </div>
  );
}

/* ================================================================
 *  Four-CTA Grid (Share / Settings / Progress / Replay)
 *
 *  Renders the four primary actions inline so the DNA screen fits the
 *  viewport without scrolling. Replaces the older right-column recap +
 *  sticky bottom CTA combo.
 * ================================================================ */
function FourCtaGrid({
  onShareClick,
  onSettingsClick,
  onProgressClick,
  onReplayClick,
}: {
  onShareClick: () => void;
  onSettingsClick: () => void;
  onProgressClick: () => void;
  onReplayClick: () => void;
}) {
  const { t } = useT();
  return (
    <div className="space-y-1.5">
      {/* Top row: Share DNA · Your Progress · Profile (3 equal columns) */}
      <div className="grid grid-cols-3 gap-1.5">
        <CtaCard
          label={t('overview_share_dna')}
          onClick={onShareClick}
          icon={(
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          )}
        />
        <CtaCard
          label={t('overview_progress')}
          onClick={onProgressClick}
          icon={(
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          )}
        />
        <CtaCard
          label={t('overview_profile')}
          onClick={onSettingsClick}
          icon={(
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
            </svg>
          )}
        />
      </div>
      {/* Primary CTA — full width */}
      <CtaCard
        label={t('overview_replay_mistakes')}
        onClick={onReplayClick}
        primary
        fullWidth
        icon={(
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none" />
          </svg>
        )}
      />
    </div>
  );
}

function CtaCard({
  icon,
  label,
  onClick,
  primary = false,
  fullWidth = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
  fullWidth?: boolean;
}) {
  // Primary CTA: flat at rest. On hover, layered shadows kick in (top
  // white highlight, bottom inner shadow, accent-tinted drop) so the
  // button lifts off the page. On press it sinks slightly. Same accent
  // hue at all times.
  const baseClasses = primary
    ? 'rounded-xl bg-chess-accent text-chess-bg font-bold transition-all hover:brightness-110 hover:shadow-[inset_0_2px_0_rgba(255,255,255,0.28),inset_0_-3px_0_rgba(0,0,0,0.18),0_6px_14px_rgba(74,222,128,0.35),0_2px_4px_rgba(0,0,0,0.25)] active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.18),0_2px_6px_rgba(74,222,128,0.25)]'
    : 'rounded-xl bg-chess-surface border border-chess-border/20 text-chess-text hover:border-chess-accent/40 transition-all';

  // Wide button: icon + label inline (bigger). Square button: icon above label.
  const layoutClasses = fullWidth
    ? 'w-full flex items-center justify-center gap-3 px-4 py-3.5 min-h-[64px]'
    : 'flex flex-col items-center justify-center gap-1.5 px-3 py-3.5 min-h-[80px]';
  const labelClasses = fullWidth ? 'text-[17px] font-bold' : 'text-[13px] font-semibold leading-tight text-center';

  return (
    <button onClick={onClick} className={`${baseClasses} ${layoutClasses}`}>
      <span className={primary ? 'text-chess-bg' : 'text-chess-text-secondary'}>{icon}</span>
      <span className={labelClasses}>{label}</span>
    </button>
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
                  <span className="text-chess-text-secondary">
                    <SkillIcon id={dim.id} size={16} />
                  </span>
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

/* ================================================================
 *  Dimension Info Tooltip — small floating tooltip anchored next to
 *  the clicked vertex on the radar. Shows the skill's icon, name,
 *  big score, and a one-line "what" description.
 * ================================================================ */
function DimensionInfoTooltip({
  profile,
  dimensionId,
  anchorX,
  anchorY,
  onClose,
}: {
  profile: ReturnType<typeof calculateSkillProfile>;
  dimensionId: string;
  anchorX: number;
  anchorY: number;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useT();
  const dim = profile.dimensions.find((d) => d.id === dimensionId);

  // Dismiss on outside click / Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-dim-tooltip="1"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    // Defer the click listener so the click that opened us doesn't immediately close.
    const id = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.clearTimeout(id);
    };
  }, [onClose]);

  if (!dim) return null;

  const info = getCategoryInfo(t)[dim.id];
  const tier = getTierForScore(dim.score);
  const color = getTierColor(tier, theme);

  // Position the tooltip beside the click, keeping it inside the viewport.
  const TOOLTIP_W = 220;
  const TOOLTIP_H_EST = 130;
  const margin = 8;
  let left = anchorX + 12;
  let top = anchorY - 12;
  if (typeof window !== 'undefined') {
    if (left + TOOLTIP_W + margin > window.innerWidth) left = anchorX - TOOLTIP_W - 12;
    if (left < margin) left = margin;
    if (top + TOOLTIP_H_EST + margin > window.innerHeight) top = window.innerHeight - TOOLTIP_H_EST - margin;
    if (top < margin) top = margin;
  }

  return (
    <div
      data-dim-tooltip="1"
      className="fixed z-50 bg-chess-bg border border-chess-border/50 rounded-lg shadow-xl p-3"
      style={{ left, top, width: TOOLTIP_W }}
      role="tooltip"
    >
      <div className="flex items-start gap-2">
        <span className="text-chess-text-secondary mt-0.5">
          <SkillIcon id={dim.id} size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-chess-text leading-tight">
            {t(`skill_${dim.id}` as any)}
          </div>
        </div>
        <div
          className="text-2xl font-extrabold tabular-nums leading-none"
          style={{ color }}
        >
          {dim.score}
        </div>
      </div>
      {info?.what && (
        <p className="mt-2 text-[11px] text-chess-text-secondary leading-snug">
          {info.what}
        </p>
      )}
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
    { label: 'TM', path: '/timemachine', title: 'Replays' },
    { label: 'Cmp', path: '/compare', title: 'Compare' },
    { label: 'Set', path: '/settings', title: 'Settings' },
    { label: 'Pat', path: '/patterns', title: 'Patterns (legacy)' },
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
    if (!window.confirm('Delete ALL your games, analyses, patterns and reset onboarding to S0?\n\nThis is irreversible.')) return;

    setResetting(true);
    try {
      // 1. Delete all entity records (RLS scopes to current user)
      // Sequential with delay to avoid 429 rate limits.
      const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
      const entityNames = ['Game', 'Analysis', 'Pattern', 'PatternSnapshot'];
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

