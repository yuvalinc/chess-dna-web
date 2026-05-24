import { useMemo, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import { useChessData } from '@/contexts/ChessDataContext';
import { useTheme } from '@/components/ThemeContext';
import { useT } from '@/i18n/index';
import PlayerAvatar from '@/components/PlayerAvatar';
import ThemedChessboard from '@/components/ThemedChessboard';
import { prefetchAvatars, fetchAvatar, getCachedAvatar } from '@/api/chess-com-avatar';
import { useFlag } from '@/hooks/useFlag';
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis, MoveAnalysis } from '@shared/types/analysis';
import { DataAttribution } from '@/components/PlatformBadge';
import ShareComposer from '@/components/share/ShareComposer';
import { captureCardAsBlob, shareImage } from '@/utils/share-image';
import { renderAchievementShareImage } from '@/utils/share-achievement-canvas';
import { computePatternsFromGames } from '@/patterns/windowed-profile';
import { getTerminationReason, type TerminationReason } from '@shared/utils/chess-utils';
import type { TranslationKey } from '@/i18n/locales/en';
import type { TrapStats } from '@shared/types/patterns';

const TERMINATION_I18N_KEY: Record<TerminationReason, TranslationKey> = {
  checkmate: 'game_term_checkmate',
  stalemate: 'game_term_stalemate',
  time: 'game_term_time',
  resignation: 'game_term_resignation',
  agreement: 'game_term_agreement',
  repetition: 'game_term_repetition',
  insufficient: 'game_term_insufficient',
  '50-move': 'game_term_50move',
  abandoned: 'game_term_abandoned',
  rules: 'game_term_rules',
};

const PAGE_SIZE = 20;

type TabId = 'all' | 'progress' | 'highlights';
type HighlightsSubTab = 'takeaways' | 'achievements';

export default function RecentGames() {
  const { allGames: rawGames, allAnalyses, gamesLoading: loading, profile, queueForAnalysis } = useChessData();
  const { settings } = useTheme();
  const { t, language } = useT();
  const timeClassFilter = settings.selectedTimeClass ?? null;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Allow deep-linking via ?tab=progress (used by the DNA page CTA).
  const initialTab: TabId = (() => {
    const t = searchParams.get('tab');
    return t === 'progress' || t === 'highlights' ? t : 'all';
  })();
  const [tab, setTab] = useState<TabId>(initialTab);
  const [opponentSearch, setOpponentSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [shareTarget, setShareTarget] = useState<Achievement | null>(null);
  const [, setAchActiveIdx] = useState(0);
  // Per-id "seen" set, persisted so the blue dot on the Achievements tab
  // disappears once the user has actually viewed each card and stays gone
  // across reloads.
  const [seenAchievements, setSeenAchievements] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('chess-dna-seen-achievements');
      return new Set(raw ? JSON.parse(raw) as string[] : []);
    } catch { return new Set(); }
  });
  const markAchievementSeen = (id: string) => {
    setSeenAchievements((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem('chess-dna-seen-achievements', JSON.stringify(Array.from(next))); } catch { /* noop */ }
      return next;
    });
  };

  const allGames = useMemo(
    () => [...rawGames].sort((a, b) => b.playedAt - a.playedAt),
    [rawGames],
  );

  // Pre-search list: applies the time-class filter only. Achievements
  // use this so the opponent-search box in the All tab doesn't leak
  // into the Achievements tab.
  const timeFilteredGames = useMemo(
    () => (timeClassFilter ? allGames.filter((g) => g.timeClass === timeClassFilter) : allGames),
    [allGames, timeClassFilter],
  );

  const gamesList = useMemo(() => {
    if (!opponentSearch.trim()) return timeFilteredGames;
    const q = opponentSearch.trim().toLowerCase();
    return timeFilteredGames.filter((g) => g.opponent.username.toLowerCase().includes(q));
  }, [timeFilteredGames, opponentSearch]);

  // Reset pagination when the filter or search changes so old page
  // count doesn't linger across different lists.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [timeClassFilter, opponentSearch]);

  const analysisMap = useMemo(() => {
    const map = new Map<string, GameAnalysis>();
    for (const a of allAnalyses) map.set(a.gameId, a);
    return map;
  }, [allAnalyses]);


  const visibleGames = useMemo(
    () => gamesList.slice(0, visibleCount),
    [gamesList, visibleCount],
  );

  // Prefetch avatars for the currently visible opponents only — new
  // usernames are prefetched as the user loads more batches.
  useEffect(() => {
    const usernames = visibleGames.map((g) => g.opponent.username);
    if (usernames.length > 0) prefetchAvatars(usernames);
  }, [visibleGames]);

  const achievements = useMemo(
    () => computeAchievements(timeFilteredGames, analysisMap),
    [timeFilteredGames, analysisMap],
  );

  if (loading) {
    return <div className="text-gray-400">{t('games_loading')}</div>;
  }

  if (allGames.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-4">&#9812;</div>
        <h2 className="text-xl mb-2">{t('games_empty_title')}</h2>
        <p className="text-gray-400 text-sm">{t('games_empty_desc')}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Page header — chart-line brand glyph + title + supporting tagline. */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-chess-accent">
            <AnalyzeBrandIcon />
          </span>
          <h1 className="text-[22px] font-extrabold text-chess-text leading-none">
            {t('nav_games')}
          </h1>
        </div>
        <p className="text-sm text-gray-400 leading-relaxed">
          Where your games turn into insights.
        </p>
      </div>

      {/* Underlined tab strip — All games · Progress · Highlights.
          Highlights is a unified container for Takeaways + Achievements
          with an inner filter, so the top strip stays at three primary
          destinations.  Inactive tabs show icon-only; the active tab
          expands to icon + label so the name reads as a "title in the
          tab". */}
      <div className="flex items-center gap-5 mb-4 border-b border-chess-border/20 overflow-x-auto overflow-y-hidden scrollbar-hide touch-pan-x overscroll-x-contain">
        <UnderlineTab
          active={tab === 'all'}
          onClick={() => setTab('all')}
          label="Games"
          icon={<TabIconRows />}
          count={gamesList.length}
        />
        <UnderlineTab
          active={tab === 'progress'}
          onClick={() => setTab('progress')}
          label="Progress"
          icon={<TabIconTrend />}
        />
        <UnderlineTab
          active={tab === 'highlights'}
          onClick={() => setTab('highlights')}
          label="Highlights"
          icon={<TabIconHighlights />}
          count={achievements.length}
          hasUnread={achievements.some((a) => !seenAchievements.has(a.id))}
        />
      </div>

      {tab === 'all' && (
        <>
          <div className="mb-3">
            <input
              type="text"
              value={opponentSearch}
              onChange={(e) => setOpponentSearch(e.target.value)}
              placeholder={t('recent_search_opponent')}
              className="w-full px-3 py-2 rounded-lg bg-chess-surface border border-chess-border/30 text-sm text-chess-text placeholder-gray-500 focus:outline-none focus:border-chess-accent/50 transition-colors"
            />
          </div>

          <div className="space-y-2">
            {visibleGames.map((game, idx) => {
              const a = analysisMap.get(game.id);
              return (
                <GameRow
                  key={game.id}
                  game={game}
                  analysis={a}
                  language={language}
                  isTutorialTarget={idx === 0}
                  onSeeMove={(moveNumber) => navigate(`/games/${game.id}?move=${moveNumber}`)}
                  onClick={() => {
                    // For pending / unanalyzed games, kick off analysis
                    // before navigating — the GameDetail page can then
                    // show the in-progress state instead of just sitting
                    // on "Pending" forever. High priority so it jumps
                    // ahead of any backfill / sync queue.
                    if (game.analysisStatus !== 'complete') {
                      queueForAnalysis([game.id], { priority: 'high' });
                    }
                    navigate(`/games/${game.id}`);
                  }}
                  onPractice={() => navigate('/timemachine', { state: { gameFilter: game.id, returnTo: { path: `/games/${game.id}` } } })}
                  onCompare={() => navigate('/compare', { state: { autoCompare: game.opponent.username } })}
                  onShare={() => setShareTarget({
                    id: 'accuracy',
                    Icon: () => null as unknown as React.JSX.Element,
                    title: '',
                    statValue: '',
                    tone: '',
                    toneBg: '',
                    toneHex: '#4ade80',
                    shareKind: 'game',
                    game,
                    analysis: a,
                  })}
                />
              );
            })}
          </div>

          {/* Load-more control — renders only while more games remain. */}
          {visibleCount < gamesList.length && (
            <div className="flex justify-center py-4">
              <button
                onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
                className="bg-chess-surface hover:bg-chess-surface/80 text-chess-text-secondary text-sm font-medium border border-chess-border/30 hover:border-chess-accent/40 rounded-lg px-4 py-2 transition-colors"
              >
                Load more
                <span className="text-gray-500 ms-1.5">
                  ({Math.min(PAGE_SIZE, gamesList.length - visibleCount)} of {gamesList.length - visibleCount})
                </span>
              </button>
            </div>
          )}

          {gamesList.length === 0 && (
            <p className="text-center text-sm text-gray-500 py-6">No games match this filter.</p>
          )}
        </>
      )}

      {tab === 'progress' && <ProgressView games={timeFilteredGames} analyses={allAnalyses} />}

      {tab === 'highlights' && (
        <HighlightsView
          games={timeFilteredGames}
          analyses={allAnalyses}
          achievements={achievements}
          language={language}
          onViewGame={(id) => navigate(`/games/${id}`)}
          onAchievementActiveIndexChange={(idx) => {
            setAchActiveIdx(idx);
            const ach = achievements[idx];
            if (ach) markAchievementSeen(ach.id);
          }}
        />
      )}

      <DataAttribution />

      {/* Share composer — used by the All-tab game rows. */}
      {shareTarget && (
        <ShareComposer
          isOpen={true}
          onClose={() => setShareTarget(null)}
          game={shareTarget.game}
          summary={shareTarget.analysis?.summary}
          move={shareTarget.shareMove ?? null}
          allMoves={shareTarget.analysis?.moves}
          profile={profile}
          initialMode={shareTarget.shareKind}
        />
      )}

    </div>
  );
}


/* Analyze brand glyph — chart-line in a frame, matching the bottom-nav
 * "Analyze" tab icon. Used in the page header. */
function AnalyzeBrandIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <polyline points="7 14 11 10 14 13 18 8" />
    </svg>
  );
}

/* Underline-style tab — replaces the older pill-style TabButton on the
 * Analyze page. Active tab gets a green underline; counts/dots render
 * inline alongside the label. */
function UnderlineTab({
  active,
  onClick,
  label,
  icon,
  count,
  hasUnread,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  count?: number;
  hasUnread?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`relative shrink-0 flex items-center gap-1.5 pb-2 text-[14px] font-extrabold transition-colors ${
        active ? 'text-chess-accent' : 'text-gray-500 hover:text-chess-text'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
      {typeof count === 'number' && (
        <span className={`inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${
          active ? 'bg-chess-accent/15 text-chess-accent' : 'bg-chess-surface/60 text-gray-500'
        }`}>
          {count}
        </span>
      )}
      {hasUnread && (
        <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.7)]" />
      )}
      {active && <span aria-hidden className="absolute left-0 right-0 -bottom-px h-[2px] bg-chess-accent rounded-full" />}
    </button>
  );
}

/* Per-tab line-art icons. All 18×18 viewBox=24, strokeWidth 1.8 to
 * match the rest of the page's icon style. */
function TabIconRows() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
function TabIconTrend() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </svg>
  );
}
/* Sub-filter icons inside the Highlights tab — kept smaller (14px) than
 * the top-level tab icons since they sit inline with the pill text. */
function SubFilterIconStar() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
function SubFilterIconTrophy() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M17 4h3v3a3 3 0 0 1-3 3" />
      <path d="M7 4H4v3a3 3 0 0 0 3 3" />
    </svg>
  );
}
/* "Highlights" — a four-point sparkle (the big highlight) with a smaller
 * sparkle in the corner (the curated accent). Reads as "best of" without
 * being a trophy or a star — distinct from the other tab icons. */
function TabIconHighlights() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3z" />
      <path d="M19 16l0.6 1.9L21.5 18.5l-1.9 0.6L19 21l-0.6-1.9L16.5 18.5l1.9-0.6L19 16z" />
    </svg>
  );
}

/* "Most interesting" — story-style takeaway cards drawn from the user's
 * games. 10 kinds total (4 from the original spec + 6 added later):
 *   BIGGEST_SWING · BEST_GAME · PATTERN_MATCH · UPSET ·
 *   BRILLIANCY · NEMESIS · CRITICAL_SAVE · STREAK · OPENING_TREND · TIME_TROUBLE
 * Each kind has its own accent color and computes from games + analyses.
 * Card shape: [accent stripe] · KIND chip · date · title · subtitle · linked game row. */
/* Highlights — unified container for Takeaways (story-style cards) +
 * Achievements (trophies). A pill toggle at the top picks the active
 * sub-view; the underlying components are unchanged. Default to
 * Takeaways since it's the more dynamic, content-rich feed. */
function HighlightsView({
  games,
  analyses,
  achievements,
  language,
  onViewGame,
  onAchievementActiveIndexChange,
}: {
  games: GameRecord[];
  analyses: GameAnalysis[];
  achievements: Achievement[];
  language: string;
  onViewGame: (id: string) => void;
  onAchievementActiveIndexChange?: (idx: number) => void;
}) {
  const [sub, setSub] = useState<HighlightsSubTab>('takeaways');
  const hasUnreadAch = achievements.length > 0;
  return (
    <div className="space-y-3">
      {/* Sub-filter — pill switch between the two highlight kinds. */}
      {/* Sub-filter — underline-style row that matches the main tab strip
          so it reads as a hierarchy (Highlights → Takeaways/Achievements)
          rather than a separate pill widget. */}
      <div className="flex items-center gap-5 -mt-1 border-b border-chess-border/15">
        {(['takeaways', 'achievements'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSub(s)}
            className={`relative pb-2 inline-flex items-center gap-1.5 text-[12px] font-extrabold transition-colors ${
              sub === s
                ? 'text-chess-accent'
                : 'text-chess-text-tertiary hover:text-chess-text'
            }`}
          >
            {s === 'takeaways' ? <SubFilterIconStar /> : <SubFilterIconTrophy />}
            {s === 'takeaways' ? 'Takeaways' : 'Achievements'}
            {s === 'achievements' && hasUnreadAch && (
              <span className={`inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] font-extrabold tabular-nums ${
                sub === 'achievements' ? 'bg-chess-accent/15 text-chess-accent' : 'bg-chess-text-tertiary/15 text-chess-text-tertiary'
              }`}>
                {achievements.length}
              </span>
            )}
            {sub === s && (
              <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-chess-accent rounded-full" />
            )}
          </button>
        ))}
      </div>
      {sub === 'takeaways' ? (
        <InterestingTakeaways games={games} analyses={analyses} />
      ) : (
        <AchievementsView
          achievements={achievements}
          language={language}
          onViewGame={onViewGame}
          onActiveIndexChange={onAchievementActiveIndexChange}
        />
      )}
    </div>
  );
}

function InterestingTakeaways({ games, analyses }: { games: GameRecord[]; analyses: GameAnalysis[] }) {
  const navigate = useNavigate();
  const { trapStats } = useChessData();
  const items = useMemo(
    () => computeInterestingTakeaways(games, analyses, trapStats),
    [games, analyses, trapStats],
  );
  const gameMap = useMemo(() => new Map(games.map((g) => [g.id, g] as const)), [games]);
  const analysisMap = useMemo(() => new Map(analyses.map((a) => [a.gameId, a] as const)), [analyses]);
  const [shareItem, setShareItem] = useState<InterestingItem | null>(null);

  if (items.length === 0) {
    return (
      <div className="rounded-xl bg-chess-surface/40 border border-chess-border/20 px-4 py-10 text-center">
        <div className="text-3xl mb-2 opacity-60">{'✨'}</div>
        <div className="text-[15px] font-extrabold text-chess-text">Takeaways</div>
        <p className="mt-1 text-[12px] text-chess-text-tertiary leading-relaxed max-w-xs mx-auto">
          Hand-picked stories from your games — biggest swings, brilliancies, upsets. Play a few more games and they'll show up here.
        </p>
      </div>
    );
  }
  if (shareItem) {
    return (
      <TakeawayShareView
        item={shareItem}
        game={gameMap.get(shareItem.gameId)}
        analysis={analysisMap.get(shareItem.gameId)}
        onBack={() => setShareItem(null)}
        onOpenGame={() => {
          const params = new URLSearchParams();
          if (shareItem.moveNumber) params.set('move', String(shareItem.moveNumber));
          if (shareItem.trapId) params.set('trap', shareItem.trapId);
          const qs = params.toString();
          navigate(`/games/${shareItem.gameId}${qs ? `?${qs}` : ''}`);
        }}
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-chess-text-tertiary mb-1 px-0.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-chess-accent mr-1.5" />
        Hand-picked from your last 30 days · sorted by learning value
      </p>
      {items.map((item, idx) => {
        const navParams = new URLSearchParams();
        if (item.moveNumber) navParams.set('move', String(item.moveNumber));
        if (item.trapId) navParams.set('trap', item.trapId);
        const navQs = navParams.toString();
        const navTarget = `/games/${item.gameId}${navQs ? `?${navQs}` : ''}`;
        return (
          <div
            key={`${item.kind}-${item.gameId}-${idx}`}
            role="button"
            tabIndex={0}
            onClick={() => setShareItem(item)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShareItem(item); } }}
            className="w-full text-left rounded-xl bg-chess-surface/40 border border-chess-border/20 hover:border-chess-accent/30 transition-colors overflow-hidden cursor-pointer"
            style={{ borderLeft: `3px solid ${item.accentHex}` }}
          >
            <div className="px-4 py-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="text-[10px] font-extrabold uppercase tracking-[1.4px] px-2 py-0.5 rounded-md"
                  style={{ backgroundColor: `${item.accentHex}26`, color: item.accentHex }}
                >
                  {item.kindLabel}
                </span>
                <span className="text-[11px] text-chess-text-tertiary">
                  {item.dateStr}{item.metaSuffix ? ` · ${item.metaSuffix}` : ''}
                </span>
              </div>
              <div className="text-[15px] font-extrabold text-chess-text leading-tight">
                {item.title}
              </div>
              {item.subtitle && (
                <p className="text-[12px] text-chess-text-tertiary mt-1 leading-snug">
                  {item.subtitle}
                </p>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); navigate(navTarget); }}
                className="mt-2.5 w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-chess-bg/40 border border-chess-border/20 hover:border-chess-accent/40 transition-colors text-left"
              >
                <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-[10px] font-black ${
                  item.gameResult === 'win' ? 'bg-chess-accent/15 text-chess-accent' : item.gameResult === 'loss' ? 'bg-chess-blunder/15 text-chess-blunder' : 'bg-chess-muted text-chess-text-tertiary'
                }`}>
                  {item.gameResult === 'win' ? 'W' : item.gameResult === 'loss' ? 'L' : 'D'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-chess-text truncate">
                    {item.linkedRowTitle}
                  </div>
                  <div className="text-[10px] text-chess-text-tertiary truncate">
                    {item.linkedRowSubtitle}
                  </div>
                </div>
                <svg className="w-3 h-3 text-chess-text-tertiary shrink-0 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Display labels for weakness pattern themes. Mirrors the map in
 * TimeMachine's `patternLabel()` so the Progress CTA reads identically
 * to the worst-pattern hero card on the Replays page. */
const PATTERN_LABEL_MAP: Record<string, string> = {
  missed_fork: 'Missed forks',
  missed_pin: 'Missed pins',
  missed_skewer: 'Missed skewers',
  missed_tactic_other: 'Missed tactics',
  hanging_piece: 'Hanging pieces',
  back_rank_weakness: 'Back-rank weakness',
  king_safety: 'King safety',
  pawn_structure: 'Pawn structure',
  piece_activity: 'Piece activity',
  space_control: 'Space control',
  opening_inaccuracy: 'Opening inaccuracies',
  opening_specific: 'Opening prep',
  middlegame_tactics: 'Middlegame tactics',
  endgame_technique: 'Endgame technique',
  endgame_pawn_play: 'Endgame pawns',
  time_pressure_blunder: 'Time pressure',
};

function humanizeTheme(theme: string): string {
  return theme.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* Progress tab — week / month / all-time retrospective. Compact stats
 * strip on top, then a RETRO hero with headline → CTA → 5 bullets. All
 * numbers (sparkline points, What Changed deltas, bullet counts) derive
 * from the same period the user picked, so the timeframe drives the
 * whole tab. */
type ProgressPeriod = 'week' | 'month' | 'all';
function ProgressView({ games, analyses }: { games: GameRecord[]; analyses: GameAnalysis[] }) {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<ProgressPeriod>('month');
  const [stripIndex, setStripIndex] = useState(0);
  // Re-derive patterns from the games + analyses currently in scope — the
  // parent already filters by selected time class, so computing here keeps
  // the worst-pattern CTA aligned with the user's chosen game type.
  const scopedPatterns = useMemo(() => {
    const matched = analyses.filter((a) => games.some((g) => g.id === a.gameId));
    return computePatternsFromGames(games, matched, 1);
  }, [games, analyses]);
  const data = useMemo(() => computeProgressSnapshot(games, analyses, scopedPatterns, period), [games, analyses, scopedPatterns, period]);

  // Period toggle — rendered identically in the empty and loaded states
  // so the user can flip between timeframes even before data exists.
  // Underline-style matches the main tab strip so it reads as a
  // hierarchy (Progress → Week/Month/All time).
  const toggle = (
    <div className="flex items-center gap-5 -mt-1 border-b border-chess-border/15">
      {(['week', 'month', 'all'] as const).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => setPeriod(p)}
          className={`relative pb-2 text-[12px] font-extrabold transition-colors ${
            period === p
              ? 'text-chess-accent'
              : 'text-chess-text-tertiary hover:text-chess-text'
          }`}
        >
          {p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'All time'}
          {period === p && (
            <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-chess-accent rounded-full" />
          )}
        </button>
      ))}
    </div>
  );

  if (!data) {
    return (
      <div className="space-y-3">
        {toggle}
        <div className="rounded-xl bg-chess-surface/40 border border-chess-border/20 px-4 py-10 text-center">
          <div className="mb-2 inline-flex items-center justify-center text-chess-text-tertiary">
            <TabIconTrend />
          </div>
          <div className="text-[15px] font-extrabold text-chess-text">Progress</div>
          <p className="mt-1 text-[12px] text-chess-text-tertiary leading-relaxed max-w-xs mx-auto">
            Play a few more games and we'll start tracking how your accuracy and rating move.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Week / Month / All-time toggle — drives every block on the
          Progress tab so the stats strip and the RETRO card all reflect
          one timeframe. */}
      {toggle}

      {/* Compact stats strip — Rating tile + What Changed tile, swipeable. */}
      <CompactStatsStrip data={data} index={stripIndex} setIndex={setStripIndex} />

      {/* RETRO hero — chip + headline → Focus-next CTA → 5 bullets. */}
      <div className="rounded-xl bg-chess-surface/60 border border-chess-accent/40 shadow-[0_0_24px_rgba(74,222,128,0.06)] p-3.5">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-[1.4px] px-2 py-0.5 rounded-md bg-chess-accent/15 text-chess-accent">
              Retro
            </span>
            <span className="text-[11px] text-chess-text-tertiary">{data.windowLabel}</span>
          </div>
          {data.headlineCallout && (
            <span className="text-[11px] font-bold text-chess-accent inline-flex items-center gap-1">
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 17 9 11 13 15 21 7" />
                <polyline points="21 7 21 13 15 13" />
              </svg>
              {data.headlineCallout}
            </span>
          )}
        </div>
        <div className="text-[17px] font-extrabold text-chess-text leading-[1.25]">
          {data.headline}
        </div>
        {/* Focus-next CTA — sits directly under the headline so the
            "what to do next" answer is right next to the diagnosis. */}
        {data.focusNext && (
          <button
            type="button"
            onClick={() => {
              if (data.focusNext?.theme) {
                navigate('/timemachine', { state: { preselectedTheme: data.focusNext.theme } });
              } else {
                navigate('/timemachine');
              }
            }}
            className="mt-2.5 w-full rounded-lg border border-chess-accent/30 bg-chess-accent/[0.05] hover:bg-chess-accent/[0.10] hover:border-chess-accent/50 transition-colors px-3 py-2 flex items-center gap-3 text-left"
          >
            <span className="w-8 h-8 rounded-md bg-chess-accent/15 text-chess-accent flex items-center justify-center shrink-0">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="5" />
                <circle cx="12" cy="12" r="1" fill="currentColor" />
              </svg>
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-extrabold uppercase tracking-[1.3px] text-chess-accent leading-tight">
                {data.focusNext.kicker}
              </div>
              <div className="text-[13px] font-extrabold text-chess-text leading-tight truncate">{data.focusNext.title}</div>
            </div>
            <span className="px-3 py-1.5 rounded-md bg-chess-accent text-black text-[11px] font-extrabold uppercase tracking-[1.3px] shrink-0">
              {data.focusNext.theme ? 'Play' : 'Start'}
            </span>
          </button>
        )}
        {/* Bullets — Strong-first then Improve. */}
        <div className="space-y-1 mt-2.5">
          {data.bullets.map((b, i) => {
            const clickable = !!b.gameId;
            const onBulletClick = () => {
              if (!b.gameId) return;
              if (b.moveNumber) navigate(`/games/${b.gameId}?move=${b.moveNumber}`);
              else navigate(`/games/${b.gameId}`);
            };
            const Wrapper: 'button' | 'div' = clickable ? 'button' : 'div';
            return (
              <Wrapper
                key={i}
                {...(clickable ? { type: 'button' as const, onClick: onBulletClick } : {})}
                className={`w-full flex items-start gap-2.5 py-1.5 px-1.5 -mx-1.5 rounded-md text-start ${
                  clickable ? 'hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors cursor-pointer' : ''
                }`}
              >
                <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 ${
                  b.tone === 'strong' ? 'bg-chess-accent/15 text-chess-accent' : 'bg-amber-400/15 text-amber-400'
                }`}>
                  {b.tone === 'strong' ? (
                    /* Thumbs-up — matches the per-game Strong row icon */
                    <svg width={11} height={11} viewBox="0 0 24 24" fill="rgba(74,222,128,0.18)" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 10v12" />
                      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" />
                    </svg>
                  ) : (
                    /* Warning triangle — matches the per-game Improve row icon */
                    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 9v4M12 17h.01" />
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] leading-snug truncate">
                    <span className={`font-extrabold ${b.tone === 'strong' ? 'text-chess-accent' : 'text-amber-400'}`}>
                      {b.tone === 'strong' ? 'Strong: ' : 'Improve: '}
                    </span>
                    <span className="font-bold text-chess-text">{b.title}</span>
                  </div>
                  <p className="text-[12px] text-chess-text-tertiary leading-snug mt-0.5 truncate">
                    {b.body}
                    {b.moveNumber ? (
                      <span className="ml-1 text-chess-accent font-bold tabular-nums">#{b.moveNumber}</span>
                    ) : null}
                  </p>
                </div>
                {clickable && (
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-1.5 text-chess-text-tertiary rtl:rotate-180">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                )}
              </Wrapper>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* Compact, swipeable 2-tile gallery that condenses the old standalone
 * Rating + What Changed cards into ~90px total. Tile 1 is rating with an
 * inline mini-sparkline; tile 2 is the four-up delta grid. Tiles are
 * driven by index state passed from the parent so the active tile stays
 * sticky across re-renders. */
function CompactStatsStrip({
  data,
  index,
  setIndex,
}: {
  data: ProgressSnapshot;
  index: number;
  setIndex: (i: number) => void;
}) {
  const tileCount = 2;
  const safeIndex = Math.max(0, Math.min(tileCount - 1, index));
  const ratingDeltaColor =
    data.ratingDelta > 0
      ? 'text-chess-accent'
      : data.ratingDelta < 0
        ? 'text-chess-blunder'
        : 'text-chess-text-tertiary';

  // Touch-swipe — horizontal drag advances/retreats one tile.
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (t) touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0 && safeIndex < tileCount - 1) setIndex(safeIndex + 1);
    if (dx > 0 && safeIndex > 0) setIndex(safeIndex - 1);
  };

  return (
    <div className="rounded-xl bg-chess-surface/40 border border-chess-border/20">
      <div
        className="relative overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="flex transition-transform duration-200 ease-out"
          style={{ width: `${tileCount * 100}%`, transform: `translateX(-${(safeIndex / tileCount) * 100}%)` }}
        >
          {/* Tile 1 — Rating + sparkline */}
          <div style={{ width: `${100 / tileCount}%` }} className="shrink-0 px-3 pt-1.5 pb-1.5">
            <div className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-[9px] font-extrabold uppercase tracking-[1.3px] text-chess-text-tertiary truncate">
                  Rating · {data.timeClassLabel}
                </span>
              </div>
              <span className={`text-[11px] font-extrabold tabular-nums ${ratingDeltaColor}`}>
                {data.ratingDelta > 0 ? '+' : ''}{data.ratingDelta}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-[22px] font-black text-chess-text leading-none tabular-nums shrink-0">
                {data.currentRating}
              </span>
              <div className="flex-1 min-w-0">
                <RatingSparkline points={data.ratingSeries} compact />
              </div>
            </div>
          </div>

          {/* Tile 2 — What Changed (four-up grid) */}
          <div style={{ width: `${100 / tileCount}%` }} className="shrink-0 px-3 pt-1.5 pb-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-[1.3px] text-chess-text-tertiary">
                What changed
              </span>
              <span className="text-[10px] text-chess-text-tertiary">vs {data.priorLabel}</span>
            </div>
            <div className="grid grid-cols-4 gap-2 mt-1.5">
              {data.deltas.map((d) => {
                const positive = d.delta > 0;
                const polarityGood = d.higherIsBetter === false ? !positive : positive;
                const deltaColor = d.delta === 0
                  ? 'text-chess-text-tertiary'
                  : polarityGood
                    ? 'text-chess-accent'
                    : 'text-chess-blunder';
                return (
                  <div key={d.label} className="min-w-0">
                    <div className="text-[9px] uppercase tracking-[1px] text-chess-text-tertiary truncate">
                      {d.label === 'Rating change' ? 'Rating Δ' : d.label === 'Avg accuracy' ? 'Accuracy' : d.label}
                    </div>
                    <div className="text-[13px] font-extrabold text-chess-text tabular-nums truncate leading-tight">
                      {d.currentFormatted}
                    </div>
                    <div className={`text-[10px] font-bold tabular-nums ${deltaColor}`}>
                      {positive ? '▲' : d.delta < 0 ? '▼' : '–'} {d.deltaFormatted}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {/* Dot indicator — also doubles as click affordance to switch tiles. */}
      <div className="flex justify-center gap-1.5 pb-1 pt-0.5">
        {Array.from({ length: tileCount }).map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`View tile ${i + 1}`}
            className={`w-1 h-1 rounded-full transition-colors ${
              i === safeIndex ? 'bg-chess-accent' : 'bg-chess-text-tertiary/30 hover:bg-chess-text-tertiary/60'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/* Sparkline for the Rating card — small, dependency-free SVG line.
 * In compact mode (used inside the stats strip) the line shrinks to
 * 28px and the wrapper drops the top margin so it sits inline with the
 * big rating number. */
function RatingSparkline({ points, compact = false }: { points: number[]; compact?: boolean }) {
  if (points.length < 2) return null;
  const w = 320;
  const h = compact ? 22 : 64;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const dx = w / (points.length - 1);
  const path = points
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * dx).toFixed(1)} ${(h - ((v - min) / range) * (h - 8) - 4).toFixed(1)}`)
    .join(' ');
  const last = points[points.length - 1];
  const lastX = (points.length - 1) * dx;
  const lastY = h - ((last - min) / range) * (h - 8) - 4;
  return (
    <svg className={`w-full ${compact ? '' : 'mt-2'}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height: h }}>
      <path d={path} fill="none" stroke="rgb(74, 222, 128)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={compact ? 2.5 : 3.5} fill="rgb(74, 222, 128)" />
    </svg>
  );
}

/* ── Country flag for an opponent's username (small inline emoji). ── */
function OpponentFlag({ username, small }: { username: string; small?: boolean }) {
  const flag = useFlag(username);
  if (!flag) return null;
  return (
    <span className={`shrink-0 leading-none ${small ? 'text-[11px]' : 'text-[13px]'}`} aria-hidden>
      {flag}
    </span>
  );
}

/* ── Game row (unchanged from before) ── */

function GameRow({
  game,
  analysis,
  language,
  onClick,
  onPractice,
  onCompare,
  onShare,
  onSeeMove,
  isTutorialTarget = false,
}: {
  game: GameRecord;
  analysis?: GameAnalysis;
  language: string;
  /** Click anywhere on the game header — opens the analysis page (same as the Analyze CTA). */
  onClick: () => void;
  onPractice: () => void;
  onCompare: () => void;
  onShare: () => void;
  /** Navigate to the game analysis with the given move highlighted. */
  onSeeMove: (moveNumber: number) => void;
  /** When true, marks this row + its actions with data-tutorial-target attrs
      so the tutorial coachmark can spotlight them. */
  isTutorialTarget?: boolean;
}) {
  const { t } = useT();
  const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
  const date = new Date(game.playedAt);
  const dateStr = date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  const resultKey =
    game.player.result === 'win'
      ? ('result_win' as const)
      : game.player.result === 'loss'
        ? ('result_loss' as const)
        : ('result_draw' as const);
  const resultLabel = t(resultKey);
  const resultColor =
    game.player.result === 'win'
      ? 'text-chess-accent'
      : game.player.result === 'loss'
        ? 'text-chess-blunder'
        : 'text-chess-text-tertiary';
  const resultBg =
    game.player.result === 'win'
      ? 'bg-chess-accent/15'
      : game.player.result === 'loss'
        ? 'bg-chess-blunder/15'
        : 'bg-chess-muted';

  const accuracy =
    analysis?.summary?.accuracy != null
      ? Math.round(analysis.summary.accuracy * 10) / 10
      : null;

  const terminationKey = getTerminationReason(game.pgn);
  const terminationLabel = terminationKey ? t(TERMINATION_I18N_KEY[terminationKey]) : null;

  // Share is only meaningful once analysis exists (the share card needs
  // summary stats). When it's still pending we visually disable the CTA.
  const canShare = !!analysis?.summary;

  return (
    <div className="card-3d-wrap" data-tutorial-target={isTutorialTarget ? 'games-card' : undefined}>
      <div className="card-3d bg-chess-surface rounded-xl px-3.5 py-3 border border-transparent">
        {/* Header row — same content as before, now slightly larger and
            clickable as the implicit "Analyze" affordance. */}
        <div
          onClick={onClick}
          className="flex items-center gap-3 cursor-pointer"
        >
          <div className={`w-9 h-9 rounded-lg ${resultBg} flex items-center justify-center shrink-0`}>
            <span className={`text-sm font-black ${resultColor}`}>{resultLabel}</span>
          </div>

          <PlayerAvatar username={game.opponent.username} size={36} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-chess-text truncate">
                {game.opponent.username}
              </span>
              <OpponentFlag username={game.opponent.username} />
              <span className="text-[11px] text-chess-text-tertiary shrink-0">
                ({game.opponent.rating})
              </span>
            </div>
            <div className="text-[11px] text-chess-text-tertiary mt-0.5 truncate">
              {game.opening.name && game.opening.name !== 'Unknown'
                ? game.opening.name
                : `${game.totalMoves} ${t('common_moves')}`}
              {terminationLabel ? ` \u00B7 ${terminationLabel}` : ''}
              {' \u00B7 '}
              {dateStr}
            </div>
          </div>

          <div className="flex flex-col items-end gap-0.5 shrink-0">
            {accuracy != null ? (
              <>
                <span
                  className={`text-sm font-bold tabular-nums ${
                    accuracy >= 80
                      ? 'text-chess-accent'
                      : accuracy >= 50
                        ? 'text-chess-text-secondary'
                        : 'text-chess-blunder'
                  }`}
                >
                  {accuracy}%
                </span>
                <span className="text-[9px] text-chess-text-disabled">{t('games_acc')}</span>
              </>
            ) : game.analysisStatus === 'analyzing' ? (
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 border-[1.5px] border-chess-accent border-t-transparent rounded-full animate-spin" />
                <span className="text-[10px] text-chess-text-tertiary">{t('games_analyzing')}</span>
              </div>
            ) : (
              <span className="text-[10px] text-chess-text-disabled">{t('games_pending')}</span>
            )}
          </div>
        </div>

        {/* CTA row — mirrors the four buttons at the bottom of GameDetail
            (same surface, same icons). Listen / audio is replaced with
            "Analyze" since this is the entry point into the analysis flow. */}
        <div className="grid grid-cols-4 gap-2 mt-3">
          <RowCTA
            onClick={onClick}
            label="Analyze"
            Icon={AnalyzeGlyph}
            tutorialId={isTutorialTarget ? 'games-action-analyze' : undefined}
          />
          <RowCTA
            onClick={onPractice}
            label={t('detail_practice_cta') ?? 'Practice'}
            Icon={PracticeGlyph}
            tutorialId={isTutorialTarget ? 'games-action-practice' : undefined}
          />
          <RowCTA
            onClick={onCompare}
            label={t('detail_compare') ?? 'Compare'}
            Icon={CompareGlyph}
            tutorialId={isTutorialTarget ? 'games-action-compare' : undefined}
          />
          <RowCTA
            onClick={onShare}
            label={t('detail_share') ?? 'Share'}
            Icon={ShareGlyph}
            disabled={!canShare}
            tutorialId={isTutorialTarget ? 'games-action-share' : undefined}
          />
        </div>

        {/* Per-game takeaway — single line per insight (icon inline with
            the text, no separate row), framed as a delta against the user's
            running average phase accuracy so the user instantly sees how
            this game stacked up vs. the rest. The "move N" reference is
            clickable and deep-links into the analysis at that move. */}
        {analysis?.summary && (() => {
          const tk = buildGameTakeaway(analysis.summary, analysis.moves);
          const renderMoveLink = (n: number | null) =>
            n != null ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onSeeMove(n); }}
                aria-label={`See move ${n}`}
                className="ms-1 inline text-chess-accent hover:brightness-125 font-bold tabular-nums"
              >
                #{n}
              </button>
            ) : null;
          // Each insight row is itself a tap target (bigger surface than
          // the small "#N" link alone). Tapping anywhere on the line jumps
          // straight to that move in the analysis page.
          const InsightLine = ({
            tone, ariaLabel, moveRef, children,
          }: { tone: 'strong' | 'improve'; ariaLabel: string; moveRef: number | null; children: React.ReactNode }) => (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (moveRef != null) onSeeMove(moveRef);
                else onClick();
              }}
              aria-label={ariaLabel}
              className={`w-full flex items-center gap-1.5 py-1 px-1.5 -mx-1.5 rounded-md text-start truncate whitespace-nowrap overflow-hidden text-chess-text-secondary hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors ${
                tone === 'strong' ? '' : ''
              }`}
            >
              {children}
            </button>
          );
          return (
            <div className="mt-3 space-y-0.5 text-[12px] leading-snug">
              <InsightLine
                tone="strong"
                ariaLabel={`Strong: ${tk.strong.text}${tk.strong.moveRef ? ` (move ${tk.strong.moveRef})` : ''}`}
                moveRef={tk.strong.moveRef}
              >
                {/* Thumbs-up — replaces the previous checkmark for "Strong". */}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="rgba(74,222,128,0.18)" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-chess-accent">
                  <path d="M7 10v12" />
                  <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" />
                </svg>
                <span className="truncate">
                  <span className="font-bold text-chess-text">Strong: </span>
                  {tk.strong.text}
                  {renderMoveLink(tk.strong.moveRef)}
                </span>
              </InsightLine>
              <InsightLine
                tone="improve"
                ariaLabel={`Improve: ${tk.improve.text}${tk.improve.moveRef ? ` (move ${tk.improve.moveRef})` : ''}`}
                moveRef={tk.improve.moveRef}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-400">
                  <path d="M12 9v4M12 17h.01" />
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <span className="truncate">
                  <span className="font-bold text-chess-text">Improve: </span>
                  {tk.improve.text}
                  {renderMoveLink(tk.improve.moveRef)}
                </span>
              </InsightLine>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ── Per-game takeaway: a "Strong / Improve" pair framed around concrete
       skills, patterns, and key moments — never raw point deltas. Each
       insight points to ONE representative move (best for Strong, worst
       for Improve) with a tiny "#N" deep-link into the analysis page so
       the user can dig in. Plain hyphens only — no em-dash. ── */
type GameMoves = NonNullable<GameAnalysis['moves']>;
function buildGameTakeaway(
  summary: NonNullable<GameAnalysis['summary']>,
  moves: GameMoves | undefined,
): { strong: { text: string; moveRef: number | null }; improve: { text: string; moveRef: number | null } } {
  const playerColor = summary.playerColor;
  const playerMoves = (moves ?? []).filter((m) => m.color === playerColor);

  // ── Pick a representative move for each insight ───────────────────
  const qualityRank: Record<string, number> = {
    brilliant: 0, great: 1, best: 2, excellent: 3, good: 4,
  };
  const bestMove = [...playerMoves]
    .filter((m) => m.quality in qualityRank)
    .sort((a, b) => (qualityRank[a.quality] ?? 99) - (qualityRank[b.quality] ?? 99))[0] ?? null;
  const worstMove = [...playerMoves]
    .filter((m) => m.quality === 'blunder' || m.quality === 'mistake' || m.quality === 'inaccuracy')
    .sort((a, b) => b.cpLoss - a.cpLoss)[0] ?? null;

  // Tactical motifs hit on those moves — used to name a specific pattern
  // when one is present. Falls back to the move's phase.
  const motifLabel = (m: string | undefined): string | null => {
    if (!m) return null;
    if (m === 'fork') return 'fork';
    if (m === 'pin') return 'pin';
    if (m === 'skewer') return 'skewer';
    if (m === 'hanging_piece') return 'hanging piece';
    if (m === 'back_rank') return 'back-rank tactic';
    return null;
  };
  const bestMotif = motifLabel(bestMove?.tacticalMotifs?.[0]);
  const worstMotif = motifLabel(worstMove?.tacticalMotifs?.[0]);

  // Phase-flavored skill labels — middlegame becomes "calculation" since
  // that's the underlying skill the user can think about training.
  const phaseSkill: Record<'opening' | 'middlegame' | 'endgame', string> = {
    opening: 'opening prep',
    middlegame: 'calculation',
    endgame: 'endgame technique',
  };

  // ── Strong ────── Kept short so it fits on a single line. ─────────
  let strongText: string;
  if (summary.brilliantMoves > 0) {
    strongText = `Found a brilliant move.`;
  } else if (bestMotif) {
    strongText = `Spotted a ${bestMotif}.`;
  } else if (bestMove && bestMove.phase === 'endgame' && bestMove.quality === 'best') {
    strongText = `Clean endgame technique.`;
  } else if (bestMove && bestMove.phase === 'opening' && (summary.bestMoves + summary.excellentMoves) >= 4) {
    strongText = `Sharp opening prep.`;
  } else if (bestMove) {
    strongText = `Strong ${phaseSkill[bestMove.phase]}.`;
  } else {
    strongText = `Steady play.`;
  }

  // ── Improve ──── Kept short so it fits on a single line. ──────────
  let improveText: string;
  if (worstMotif) {
    improveText = `Missed a ${worstMotif}.`;
  } else if (worstMove?.quality === 'blunder') {
    improveText = `${capFirst(phaseSkill[worstMove.phase])} slipped.`;
  } else if (worstMove?.quality === 'mistake') {
    improveText = `Mistake in your ${phaseSkill[worstMove.phase]}.`;
  } else if (worstMove) {
    improveText = `Inaccuracy in your ${phaseSkill[worstMove.phase]}.`;
  } else {
    improveText = `Push for sharper tactics.`;
  }

  return {
    strong: { text: strongText, moveRef: bestMove?.moveNumber ?? null },
    improve: { text: improveText, moveRef: worstMove?.moveNumber ?? null },
  };
}

function capFirst(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

/* ── Row CTA button — matches GameDetail's bottom CTAs ── */
function RowCTA({
  onClick,
  label,
  Icon,
  disabled = false,
  tutorialId,
}: {
  onClick: () => void;
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
  disabled?: boolean;
  tutorialId?: string;
}) {
  return (
    <button
      type="button"
      data-tutorial-target={tutorialId}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled}
      className="bg-white/[0.03] rounded-xl p-2.5 text-center border border-white/[0.04] hover:border-chess-accent/30 hover:bg-white/[0.05] transition-all group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-white/[0.04] disabled:hover:bg-white/[0.03]"
    >
      <div className="mb-0.5 opacity-70 group-hover:opacity-100 transition-opacity flex justify-center">
        <Icon className="text-gray-400" />
      </div>
      <div className="text-[11px] font-semibold text-white">{label}</div>
    </button>
  );
}

/* ── Inline CTA glyphs (same SVG paths as GameDetail's CTAs) ── */
function AnalyzeGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="20" y1="20" x2="16.5" y2="16.5" />
    </svg>
  );
}
function PracticeGlyph({ className }: { className?: string }) {
  // Replays glyph — play-in-circle, identical to the bottom-nav Replays
  // tab and the "Replay your mistakes" CTA so the visual reads as the
  // same destination across the app.
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none" />
    </svg>
  );
}
function CompareGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="10" width="4" height="11" rx="1" />
      <rect x="10" y="4" width="4" height="17" rx="1" />
      <rect x="17" y="8" width="4" height="13" rx="1" />
    </svg>
  );
}
function ShareGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

/* ─────────────────────── Achievements ─────────────────────── */

type AchievementId = 'brilliants' | 'accuracy' | 'highestElo' | 'fewestMoves' | 'fastestTime';

type IconComponent = (props: { className?: string; size?: number }) => React.JSX.Element;

/** How the achievement should open in the share composer. */
type ShareKind = 'move' | 'game' | 'sequence';

interface Achievement {
  id: AchievementId;
  Icon: IconComponent;
  title: string;
  /** Short, hero-worthy stat ("100%", "4 brilliants", "beat 1830"). */
  statValue: string;
  /** Optional secondary label under the stat ("accuracy", "Elo", "moves"). */
  statUnit?: string;
  /** Text color class for the stat + icon badge. */
  tone: string;
  /** Background tint for the stat badge. */
  toneBg: string;
  /** Hex equivalent of `tone` — used for inline-styled UI (tab/dots). */
  toneHex: string;
  /** Which share composer mode to open. */
  shareKind: ShareKind;
  /** When shareKind === 'move' or 'sequence', the anchor move. */
  shareMove?: MoveAnalysis | null;
  game: GameRecord;
  analysis?: GameAnalysis;
}

/* ── Inline SVG icons, styled to match the bottom-nav icon set ── */

function baseIconProps(className?: string, size = 20) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: `shrink-0 ${className ?? ''}`,
    'aria-hidden': true,
  };
}

function StarIcon({ className, size }: { className?: string; size?: number }) {
  return (
    <svg {...baseIconProps(className, size)}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
    </svg>
  );
}

function TargetIcon({ className, size }: { className?: string; size?: number }) {
  return (
    <svg {...baseIconProps(className, size)}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function CrownIcon({ className, size }: { className?: string; size?: number }) {
  return (
    <svg {...baseIconProps(className, size)}>
      <path d="M3 18h18" />
      <path d="M3 8l5 4 4-7 4 7 5-4-2 10H5z" />
    </svg>
  );
}

function BoltIcon({ className, size }: { className?: string; size?: number }) {
  return (
    <svg {...baseIconProps(className, size)}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10" />
    </svg>
  );
}

function StopwatchIcon({ className, size }: { className?: string; size?: number }) {
  return (
    <svg {...baseIconProps(className, size)}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5" />
      <path d="M9 2h6" />
      <path d="M12 2v3" />
    </svg>
  );
}

function computeAchievements(
  games: GameRecord[],
  analysisMap: Map<string, GameAnalysis>,
): Achievement[] {
  const out: Achievement[] = [];

  const wins = games.filter((g) => g.player.result === 'win');
  const gamesWithAnalysis = games
    .map((g) => ({ g, a: analysisMap.get(g.id) }))
    .filter((x): x is { g: GameRecord; a: GameAnalysis } => !!x.a);

  // 1. Most brilliants — fall back to "great" moves if no game has a
  //    true brilliancy (they're rare; without a fallback the row would
  //    silently disappear for most players).
  if (gamesWithAnalysis.length > 0) {
    let bestBrilliant: { g: GameRecord; a: GameAnalysis; n: number } | null = null;
    let bestGreat: { g: GameRecord; a: GameAnalysis; n: number } | null = null;
    for (const { g, a } of gamesWithAnalysis) {
      const b = a.summary.brilliantMoves;
      if (b > 0 && (!bestBrilliant || b > bestBrilliant.n)) bestBrilliant = { g, a, n: b };
      const gr = a.summary.greatMoves;
      if (gr > 0 && (!bestGreat || gr > bestGreat.n)) bestGreat = { g, a, n: gr };
    }
    if (bestBrilliant) {
      // Pick the actual brilliant move so share composer can highlight it.
      const playerColor = bestBrilliant.a.summary.playerColor;
      const anchorMove =
        bestBrilliant.a.moves.find((m) => m.color === playerColor && m.quality === 'brilliant')
        ?? null;
      out.push({
        id: 'brilliants',
        Icon: StarIcon,
        title: 'Most brilliants',
        statValue: String(bestBrilliant.n),
        statUnit: bestBrilliant.n === 1 ? 'brilliant move' : 'brilliant moves',
        tone: 'text-[#1baca6]',
        toneBg: 'bg-[#1baca6]/10',
        toneHex: '#1baca6',
        shareKind: 'move',
        shareMove: anchorMove,
        game: bestBrilliant.g,
        analysis: bestBrilliant.a,
      });
    } else if (bestGreat) {
      const playerColor = bestGreat.a.summary.playerColor;
      const anchorMove =
        bestGreat.a.moves.find((m) => m.color === playerColor && m.quality === 'great') ?? null;
      out.push({
        id: 'brilliants',
        Icon: StarIcon,
        title: 'Most great moves',
        statValue: String(bestGreat.n),
        statUnit: bestGreat.n === 1 ? 'great move' : 'great moves',
        tone: 'text-[#5c8bb0]',
        toneBg: 'bg-[#5c8bb0]/10',
        toneHex: '#5c8bb0',
        shareKind: 'move',
        shareMove: anchorMove,
        game: bestGreat.g,
        analysis: bestGreat.a,
      });
    }
  }

  // 2. Highest accuracy — any result. Share game stats.
  if (gamesWithAnalysis.length > 0) {
    const best = gamesWithAnalysis.reduce(
      (acc: { g: GameRecord; a: GameAnalysis } | null, cur) =>
        !acc || cur.a.summary.accuracy > acc.a.summary.accuracy ? cur : acc,
      null,
    );
    if (best) {
      out.push({
        id: 'accuracy',
        Icon: TargetIcon,
        title: 'Highest accuracy',
        statValue: `${Math.round(best.a.summary.accuracy * 10) / 10}%`,
        statUnit: 'accuracy',
        tone: 'text-chess-accent',
        toneBg: 'bg-chess-accent/10',
        toneHex: '#4ade80',
        shareKind: 'game',
        game: best.g,
        analysis: best.a,
      });
    }
  }

  // 3. Highest-rated opponent you beat — share game stats.
  // Skip when opponents are unrated (rating == 0): "Beat 0 Elo" is nonsense.
  const ratedWins = wins.filter((g) => (g.opponent.rating ?? 0) > 0);
  if (ratedWins.length > 0) {
    const best = ratedWins.reduce((acc: GameRecord | null, g) =>
      !acc || g.opponent.rating > acc.opponent.rating ? g : acc,
    null);
    if (best) {
      out.push({
        id: 'highestElo',
        Icon: CrownIcon,
        title: 'Biggest scalp',
        statValue: String(best.opponent.rating),
        statUnit: 'Elo beaten',
        tone: 'text-amber-300',
        toneBg: 'bg-amber-300/10',
        toneHex: '#fcd34d',
        shareKind: 'game',
        game: best,
        analysis: analysisMap.get(best.id),
      });
    }
  }

  // 4. Shortest win by move count — share sequence of the closing moves.
  // Title swaps to "Quickest mate" only if the game actually ended in
  // checkmate (last move's evalAfter is mate-in-0). For resigns / timeouts
  // we say "Shortest win" so the badge doesn't lie.
  if (wins.length > 0) {
    const best = wins.reduce((acc: GameRecord | null, g) =>
      !acc || g.totalMoves < acc.totalMoves ? g : acc,
    null);
    if (best) {
      const a = analysisMap.get(best.id);
      // Anchor sequence on the last move of the game so the replay ends
      // on the mate/resign moment.
      const anchorMove = a && a.moves.length > 0 ? a.moves[a.moves.length - 1] : null;
      const endedInCheckmate = !!(
        anchorMove?.evalAfter
        && anchorMove.evalAfter.scoreType === 'mate'
        && anchorMove.evalAfter.score === 0
      );
      out.push({
        id: 'fewestMoves',
        Icon: BoltIcon,
        title: endedInCheckmate ? 'Quickest mate' : 'Shortest win',
        statValue: String(best.totalMoves),
        statUnit: 'moves',
        tone: 'text-sky-300',
        toneBg: 'bg-sky-300/10',
        toneHex: '#7dd3fc',
        shareKind: a ? 'sequence' : 'game',
        shareMove: anchorMove,
        game: best,
        analysis: a,
      });
    }
  }

  // 5. Most efficient win by think time — total seconds spent across all
  // moves in a winning game. Phrased as "Most efficient win" rather than
  // "Fastest clock" to avoid implying a clock-time race (the metric is
  // total think time, not elapsed wall clock).
  let fastest: { g: GameRecord; a: GameAnalysis; total: number } | null = null;
  for (const { g, a } of gamesWithAnalysis) {
    if (g.player.result !== 'win') continue;
    let total = 0;
    let hasTiming = false;
    for (const m of a.moves) {
      if (m.timeSpent != null && m.timeSpent > 0) {
        total += m.timeSpent;
        hasTiming = true;
      }
    }
    if (!hasTiming || total <= 0) continue;
    if (!fastest || total < fastest.total) fastest = { g, a, total };
  }
  if (fastest) {
    out.push({
      id: 'fastestTime',
      Icon: StopwatchIcon,
      title: 'Most efficient win',
      statValue: formatDuration(fastest.total),
      statUnit: 'total think time',
      tone: 'text-violet-300',
      toneBg: 'bg-violet-300/10',
      toneHex: '#c4b5fd',
      shareKind: 'game',
      game: fastest.g,
      analysis: fastest.a,
    });
  }

  return out;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/* ── Mini board FEN: prefer anchor move, then last analyzed, then PGN end. ── */
function getAchievementBoard(ach: Achievement): { fen: string; orientation: 'white' | 'black' } {
  const orientation =
    ach.analysis?.summary.playerColor ?? ach.game.player.color ?? 'white';
  if (ach.shareMove?.fenAfter) return { fen: ach.shareMove.fenAfter, orientation };
  if (ach.analysis && ach.analysis.moves.length > 0) {
    const last = ach.analysis.moves[ach.analysis.moves.length - 1];
    if (last?.fenAfter) return { fen: last.fenAfter, orientation };
  }
  if (ach.game.pgn) {
    try {
      const c = new Chess();
      c.loadPgn(ach.game.pgn);
      return { fen: c.fen(), orientation };
    } catch { /* fall through */ }
  }
  return { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', orientation };
}

const GRID_BG_STYLE: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
  backgroundSize: '32px 32px',
};

function AppLogo({ size = 16 }: { size?: number }) {
  return (
    <img
      src="/favicon.png"
      alt=""
      width={size}
      height={size}
      className="rounded-sm shrink-0"
      crossOrigin="anonymous"
    />
  );
}

function AchievementsView({
  achievements,
  language,
  onViewGame,
  onActiveIndexChange,
}: {
  achievements: Achievement[];
  language: string;
  onViewGame: (id: string) => void;
  onActiveIndexChange?: (idx: number) => void;
}) {
  const { t } = useT();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  // Tracks whether the user has nudged the carousel; flips true on first
  // scroll motion so the "X more" hint can fade away gracefully.
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const w = el.clientWidth;
      if (w === 0) return;
      if (!hasInteracted && el.scrollLeft > 4) setHasInteracted(true);
      const idx = Math.round(el.scrollLeft / w);
      const clamped = Math.max(0, Math.min(achievements.length - 1, idx));
      setActiveIdx(clamped);
      onActiveIndexChange?.(clamped);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [achievements.length, onActiveIndexChange, hasInteracted]);

  // Mark the first card as seen on mount — opening the tab counts as having
  // viewed the leftmost achievement. Subsequent cards mark themselves seen
  // as the user scrolls.
  useEffect(() => {
    onActiveIndexChange?.(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onShareActive = async () => {
    if (busy) return;
    const ach = achievements[activeIdx];
    if (!ach) return;
    setBusy(true);
    try {
      // Draw the share image directly to canvas — no DOM walk, no
      // html2canvas. Output is identical across browsers and never clips
      // text descenders or overlaps the unit caption onto the hero stat.
      const board = getAchievementBoard(ach);
      const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
      const dateStr = new Date(ach.game.playedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
      const movesLabel = t('common_moves');
      const resultLetter =
        ach.game.player.result === 'win' ? 'W' :
          ach.game.player.result === 'loss' ? 'L' : 'D';
      // Map achievement id → canvas icon id. Same shapes the live UI uses.
      const iconId: 'star' | 'target' | 'crown' | 'bolt' | 'stopwatch' =
        ach.id === 'brilliants' ? 'star' :
          ach.id === 'accuracy' ? 'target' :
            ach.id === 'highestElo' ? 'crown' :
              ach.id === 'fewestMoves' ? 'bolt' : 'stopwatch';
      // Use the cached chess.com avatar if we already have it; otherwise
      // fetch it now so the share embeds the user's photo.
      const cached = getCachedAvatar(ach.game.opponent.username);
      const opponentAvatarUrl = cached !== undefined
        ? cached
        : await fetchAvatar(ach.game.opponent.username);
      const blob = await renderAchievementShareImage({
        title: ach.title,
        statValue: ach.statValue,
        statUnit: ach.statUnit,
        toneHex: ach.toneHex,
        iconId,
        boardFen: board.fen,
        boardOrientation: board.orientation,
        opponentUsername: ach.game.opponent.username,
        opponentRating: ach.game.opponent.rating,
        opponentAvatarUrl,
        result: ach.game.player.result,
        resultLetter,
        metaLine: `${ach.game.totalMoves} ${movesLabel} · ${dateStr}`,
      });
      await shareImage(blob, `chess-dna-${ach.id}-${ach.game.id}.jpg`);
    } catch (err) {
      console.error('[share-achievement]', err);
    } finally {
      setBusy(false);
    }
  };

  if (achievements.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-gray-500">
        No achievements yet — play (and analyze) a few games and this list fills up.
      </div>
    );
  }

  const current = achievements[activeIdx] ?? achievements[0];

  return (
    // pb-16 keeps the carousel CTAs clear of the sticky guest signup strip
    // (~36px tall) that sits just above the bottom nav.
    <div className="pb-16">
      {/* Carousel position indicator */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="text-[11px] font-bold tabular-nums text-chess-text-tertiary">
          {activeIdx + 1} / {achievements.length}
        </div>
        <div className="flex items-center gap-1">
          {achievements.map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={`h-1 rounded-full transition-all ${i === activeIdx ? 'w-4' : 'w-1'}`}
              style={{
                background: i === activeIdx ? current.toneHex : 'rgba(30,58,95,0.5)',
              }}
            />
          ))}
        </div>
      </div>

      <div className="relative">
        <div
          ref={scrollerRef}
          className="-mx-1 px-1 flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        >
          {achievements.map((ach, idx) => (
            <div
              key={ach.id}
              className="snap-center shrink-0 w-full"
              ref={(el) => { cardRefs.current[idx] = el; }}
            >
              <AchievementCard achievement={ach} language={language} forShare />
            </div>
          ))}
        </div>

        {/* Swipe hint — vertically centered on the card right edge, arrow
            only (no text), with a subtle horizontal nudge animation. Fades
            out after the user nudges the carousel. */}
        {achievements.length - activeIdx - 1 > 0 && (
          <div
            aria-hidden
            className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 transition-opacity duration-300 z-10 ${
              hasInteracted ? 'opacity-0' : 'opacity-100'
            }`}
            style={{ animation: 'swipe-nudge 1.6s ease-in-out infinite' }}
          >
            <div
              className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-black"
              style={{ boxShadow: '0 0 12px 1px rgba(255,255,255,0.18), 0 4px 12px rgba(0,0,0,0.4)' }}
            >
              <svg className="w-4 h-4 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="M13 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes swipe-nudge {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(-6px); }
        }
      `}</style>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          onClick={onShareActive}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl py-3 font-extrabold text-[13px] uppercase tracking-[1.4px] transition-all active:scale-95 bg-chess-accent text-black disabled:opacity-60"
        >
          <ShareIcon size={16} />
          {busy ? 'Preparing…' : 'Share card'}
        </button>
        <button
          onClick={() => onViewGame(current.game.id)}
          className="flex items-center justify-center gap-2 rounded-xl py-3 font-extrabold text-[13px] uppercase tracking-[1.4px] transition-all active:scale-95 border border-chess-border/40 text-chess-text hover:border-chess-accent/40"
        >
          Open game
          <svg className="w-3.5 h-3.5 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="M13 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <style>{`.scrollbar-hide{scrollbar-width:none}.scrollbar-hide::-webkit-scrollbar{display:none}`}</style>
    </div>
  );
}

function AchievementCard({
  achievement,
  language,
  forShare = false,
}: {
  achievement: Achievement;
  language: string;
  forShare?: boolean;
}) {
  const { t } = useT();
  const { game, Icon } = achievement;
  const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
  const date = new Date(game.playedAt);
  const dateStr = date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  const resultKey =
    game.player.result === 'win'
      ? ('result_win' as const)
      : game.player.result === 'loss'
        ? ('result_loss' as const)
        : ('result_draw' as const);
  const resultLabel = t(resultKey);
  const resultColor =
    game.player.result === 'win'
      ? 'text-chess-accent'
      : game.player.result === 'loss'
        ? 'text-chess-blunder'
        : 'text-chess-text-tertiary';
  const resultBg =
    game.player.result === 'win'
      ? 'bg-chess-accent/15'
      : game.player.result === 'loss'
        ? 'bg-chess-blunder/15'
        : 'bg-chess-muted';

  const board = useMemo(() => getAchievementBoard(achievement), [achievement]);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-chess-surface ${
        forShare ? 'border-white/10' : 'border-chess-border/30'
      }`}
      style={GRID_BG_STYLE}
      data-share-card={forShare ? 'true' : undefined}
    >
      {/* Subtle tone wash in the upper-right corner */}
      <div
        aria-hidden
        className={`absolute -top-20 -right-20 w-48 h-48 rounded-full opacity-10 blur-3xl pointer-events-none ${achievement.toneBg}`}
      />

      {/* Branded header */}
      <div className="relative flex items-center justify-between px-4 pt-4">
        <div className="flex items-center gap-1.5">
          <AppLogo size={16} />
          <span className="text-[11px] font-extrabold tracking-[1.5px] text-chess-text uppercase">
            Chess DNA
          </span>
        </div>
        <span className={`text-[10px] font-extrabold uppercase tracking-[1.5px] px-2 py-0.5 rounded-md ${achievement.toneBg} ${achievement.tone}`}>
          Achievement
        </span>
      </div>

      {/* Title block */}
      <div className="relative flex items-center gap-3 px-4 pt-4">
        <div className={`w-12 h-12 rounded-xl ${achievement.toneBg} border border-white/5 flex items-center justify-center shrink-0`}>
          <Icon className={achievement.tone} size={26} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[1.8px] text-chess-text-tertiary leading-[1.4]">
            Your personal best
          </div>
          {/* Title uses `whitespace-nowrap` instead of `truncate` — truncate's
              implicit overflow:hidden clips descenders ("g", "y") inside
              html2canvas, even when the text fits on a single line. Achievement
              titles are short enough that we don't need the ellipsis. */}
          <div className={`text-[20px] font-extrabold ${achievement.tone} whitespace-nowrap leading-[1.35]`}>
            {achievement.title}
          </div>
        </div>
      </div>

      {/* Hero stat */}
      <div className="relative px-4 pt-3 pb-3 text-center">
        {/* Use `leading-[1.05]` instead of `leading-none` so the "%" glyph's
            descender stays inside the line box. html2canvas's text metrics
            differ from the browser's just enough that `leading-none` (1.0)
            renders the descender overlapping the ACCURACY caption below. */}
        <div
          className={`font-black tabular-nums tracking-[-0.04em] ${achievement.tone}`}
          style={{
            fontSize: 'clamp(72px, 18vw, 112px)',
            lineHeight: '1.05',
          }}
        >
          {achievement.statValue}
        </div>
        {achievement.statUnit && (
          <div className="text-[11px] font-bold text-chess-text-tertiary uppercase tracking-[2px] mt-3">
            {achievement.statUnit}
          </div>
        )}
      </div>

      {/* Mini board */}
      <div className="relative px-8 pt-2 pb-4 mx-auto max-w-[280px]">
        <div className="rounded-md overflow-hidden ring-1 ring-white/5 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
          <ThemedChessboard
            position={board.fen}
            boardOrientation={board.orientation}
            arePiecesDraggable={false}
            customBoardStyle={{ borderRadius: 0 }}
          />
        </div>
      </div>

      {/* Game row */}
      <div className="relative w-full flex items-center gap-2.5 px-4 py-2.5 bg-black/25 border-t border-chess-border/20">
        <div className={`w-7 h-7 rounded-md ${resultBg} flex items-center justify-center shrink-0`}>
          <span className={`text-[10px] font-black ${resultColor}`}>{resultLabel}</span>
        </div>
        <PlayerAvatar username={game.opponent.username} size={24} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            {/* `leading-[1.5]` gives the truncate box enough vertical room for
                descenders. With Tailwind's default tight leading the "y"/"g"
                tails in usernames were getting clipped at the bottom of the
                clipped box during html2canvas capture. */}
            <span className="text-[13px] font-semibold text-chess-text truncate leading-[1.5]">
              vs {game.opponent.username}
            </span>
            <OpponentFlag username={game.opponent.username} small />
            <span className="text-[10px] text-chess-text-tertiary shrink-0">
              ({game.opponent.rating})
            </span>
          </div>
          <div className="text-[10px] text-chess-text-tertiary truncate leading-[1.6]">
            {game.totalMoves} {t('common_moves')} {'\u00B7 '} {dateStr}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Inline shareable card for a Takeaway. Mirrors the AchievementCard
 * pattern (branded header + title block + mini board + game row) but
 * accepts an InterestingItem instead of an Achievement. Renders inline
 * within the Takeaways tab — page tabs and bottom nav stay visible
 * above and below. Back button at top, Share + Open below. */
function TakeawayShareView({
  item,
  game,
  analysis,
  onBack,
  onOpenGame,
}: {
  item: InterestingItem;
  game: GameRecord | undefined;
  analysis: GameAnalysis | undefined;
  onBack: () => void;
  onOpenGame: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const { language } = useT();

  const board = useMemo(() => {
    const orientation = analysis?.summary.playerColor ?? game?.player.color ?? 'white';
    if (item.moveNumber && analysis) {
      const move = analysis.moves.find(
        (m) => m.moveNumber === item.moveNumber && m.color === analysis.summary.playerColor,
      );
      if (move?.fenAfter) return { fen: move.fenAfter, orientation };
    }
    if (analysis && analysis.moves.length > 0) {
      const last = analysis.moves[analysis.moves.length - 1];
      if (last?.fenAfter) return { fen: last.fenAfter, orientation };
    }
    if (game?.pgn) {
      try {
        const c = new Chess();
        c.loadPgn(game.pgn);
        return { fen: c.fen(), orientation };
      } catch { /* fall through */ }
    }
    return { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', orientation };
  }, [analysis, game, item.moveNumber]);

  const onShare = async () => {
    if (!cardRef.current || busy) return;
    setBusy(true);
    try {
      const blob = await captureCardAsBlob(cardRef.current, { storyFormat: true });
      await shareImage(blob, `chess-dna-${item.kind}-${item.gameId}.png`);
    } catch (err) {
      console.error('[share-takeaway]', err);
    } finally {
      setBusy(false);
    }
  };

  const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
  const dateStr = game ? new Date(game.playedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' }) : item.dateStr;

  return (
    <div className="pb-16">
      {/* Back row — sits inline under the page tabs */}
      <button
        type="button"
        onClick={onBack}
        className="mb-3 flex items-center gap-1.5 text-chess-text-tertiary hover:text-chess-text text-[13px] font-bold transition-colors"
      >
        <svg className="w-4 h-4 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to takeaways
      </button>

      {/* Card */}
      <div
        ref={cardRef}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-chess-surface"
        style={GRID_BG_STYLE}
        data-share-card="true"
      >
        {/* Tone wash */}
        <div
          aria-hidden
          className="absolute -top-20 -right-20 w-48 h-48 rounded-full opacity-20 blur-3xl pointer-events-none"
          style={{ backgroundColor: item.accentHex }}
        />
        {/* Branded header */}
        <div className="relative flex items-center justify-between px-4 pt-4">
          <div className="flex items-center gap-1.5">
            <AppLogo size={16} />
            <span className="text-[11px] font-extrabold tracking-[1.5px] text-chess-text uppercase">Chess DNA</span>
          </div>
          <span
            className="text-[10px] font-extrabold uppercase tracking-[1.5px] px-2 py-0.5 rounded-md"
            style={{ backgroundColor: `${item.accentHex}26`, color: item.accentHex }}
          >
            {item.kindLabel}
          </span>
        </div>

        {/* Title block */}
        <div className="relative px-4 pt-4">
          <div className="text-[10px] font-bold uppercase tracking-[1.8px] text-chess-text-tertiary">
            Takeaway · {item.dateStr}
          </div>
          <div
            className="text-[22px] font-extrabold leading-tight mt-1"
            style={{ color: item.accentHex }}
          >
            {item.title}
          </div>
          {item.subtitle && (
            <p className="text-[12px] text-chess-text-tertiary mt-1.5 leading-snug">
              {item.subtitle}
            </p>
          )}
        </div>

        {/* Mini board */}
        <div className="relative px-8 pt-3 pb-3 mx-auto max-w-[320px]">
          <div className="rounded-md overflow-hidden ring-1 ring-white/5 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            <ThemedChessboard
              position={board.fen}
              boardOrientation={board.orientation}
              arePiecesDraggable={false}
              customBoardStyle={{ borderRadius: 0 }}
            />
          </div>
          {item.moveNumber && (
            <div className="text-center mt-2 text-[11px] font-bold uppercase tracking-[1.6px] text-chess-text-tertiary">
              Position after move {item.moveNumber}
            </div>
          )}
        </div>

        {/* Game row */}
        {game && (
          <div className="relative w-full flex items-center gap-2.5 px-4 py-2.5 bg-black/25 border-t border-chess-border/20">
            <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-[10px] font-black ${
              item.gameResult === 'win' ? 'bg-chess-accent/15 text-chess-accent'
              : item.gameResult === 'loss' ? 'bg-chess-blunder/15 text-chess-blunder'
              : 'bg-chess-muted text-chess-text-tertiary'
            }`}>
              {item.gameResult === 'win' ? 'W' : item.gameResult === 'loss' ? 'L' : 'D'}
            </div>
            <PlayerAvatar username={game.opponent.username} size={24} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[13px] font-semibold text-chess-text truncate">
                  vs {game.opponent.username}
                </span>
                <OpponentFlag username={game.opponent.username} small />
                <span className="text-[10px] text-chess-text-tertiary shrink-0">
                  ({game.opponent.rating})
                </span>
              </div>
              <div className="text-[10px] text-chess-text-tertiary truncate">
                {game.totalMoves} moves · {dateStr}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action row */}
      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          type="button"
          onClick={onShare}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl py-3 font-extrabold text-[13px] uppercase tracking-[1.4px] transition-all active:scale-95 bg-chess-accent text-black disabled:opacity-60"
        >
          <ShareIcon size={16} />
          {busy ? 'Preparing…' : 'Share card'}
        </button>
        <button
          type="button"
          onClick={onOpenGame}
          className="flex items-center justify-center gap-2 rounded-xl py-3 font-extrabold text-[13px] uppercase tracking-[1.4px] transition-all active:scale-95 border border-chess-border/40 text-chess-text hover:border-chess-accent/40"
        >
          {item.moveNumber ? `Open move ${item.moveNumber}` : 'Open game'}
          <svg className="w-3.5 h-3.5 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="M13 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function ShareIcon({ className, size }: { className?: string; size?: number }) {
  return (
    <svg {...baseIconProps(className, size)}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}


/* ─────────────── Progress + Most-interesting computations ─────────────── */

interface ProgressDelta {
  label: string;
  prior: number | null;
  current: number | null;
  delta: number;
  priorFormatted: string;
  currentFormatted: string;
  deltaFormatted: string;
  /** When false, a positive delta is treated as bad (e.g. accuracy where down is bad — n/a here). */
  higherIsBetter?: boolean;
}

interface ProgressBullet {
  /** 'strong' = thumbs-up green; 'improve' = warning amber. Mirrors the
   *  per-game Strong/Improve insights so the Retro reads the same way. */
  tone: 'strong' | 'improve';
  title: string;
  body: string;
  /** When present, the bullet becomes clickable and deep-links into the
   *  game (and to a specific move when moveNumber is also set). */
  gameId?: string;
  moveNumber?: number;
}

interface ProgressSnapshot {
  windowLabel: string;
  priorLabel: string;
  headlineCallout: string | null;
  headline: string;
  bullets: ProgressBullet[];
  /** When a pattern is provided, the CTA jumps to /timemachine pre-filtered
   *  by that pattern. Otherwise it's a generic skill drill suggestion. */
  focusNext: {
    kicker: string;
    title: string;
    subtitle: string;
    /** Pattern theme to preselect on TimeMachine when present. */
    theme?: string;
    /** Used only when there's no pattern — kept for backwards compat. */
    minutes?: number;
  } | null;
  deltas: ProgressDelta[];
  currentRating: number;
  ratingDelta: number;
  ratingSeries: number[];
  timeClassLabel: string;
}

/* Fold games into a current/prior bucket pair and compute the
 * window-over-window deltas + a one-paragraph narrative. */
function computeProgressSnapshot(
  games: GameRecord[],
  analyses: GameAnalysis[],
  patterns: import('@shared/types/patterns').CurrentPatterns,
  period: ProgressPeriod,
): ProgressSnapshot | null {
  if (games.length === 0) return null;
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const windowLabel =
    period === 'week'  ? 'This week' :
    period === 'month' ? 'This month' :
    /* all */            'All time';
  const priorLabel =
    period === 'week'  ? 'last week' :
    period === 'month' ? 'last month' :
    /* all */            'first half';

  const sorted = [...games].sort((a, b) => a.playedAt - b.playedAt);
  let current: GameRecord[];
  let prior: GameRecord[];
  if (period === 'all') {
    // Career view: split chronologically — first half is the baseline,
    // second half is "current". Gives a meaningful trajectory comparison
    // even though there's no calendar window.
    if (sorted.length < 4) {
      current = sorted;
      prior = [];
    } else {
      const mid = Math.floor(sorted.length / 2);
      prior = sorted.slice(0, mid);
      current = sorted.slice(mid);
    }
  } else {
    const windowMs = period === 'week' ? 7 * dayMs : 30 * dayMs;
    const cutoffCurrent = now - windowMs;
    const cutoffPrior = now - 2 * windowMs;
    current = sorted.filter((g) => g.playedAt >= cutoffCurrent);
    prior = sorted.filter((g) => g.playedAt >= cutoffPrior && g.playedAt < cutoffCurrent);
  }
  if (current.length === 0) return null;

  const analysisById = new Map(analyses.map((a) => [a.gameId, a] as const));

  const aggAccuracy = (gs: GameRecord[]) => {
    const accs = gs.map((g) => analysisById.get(g.id)?.summary?.accuracy ?? null).filter((x): x is number => x !== null);
    if (accs.length === 0) return null;
    return accs.reduce((s, x) => s + x, 0) / accs.length;
  };
  const aggRatingChange = (gs: GameRecord[]) => {
    const rated = gs.filter((g) => (g.player.rating ?? 0) > 0);
    if (rated.length < 2) return 0;
    return rated[rated.length - 1].player.rating - rated[0].player.rating;
  };
  const aggPhaseAccuracy = (gs: GameRecord[], phase: 'tactics' | 'endgame') => {
    // Approximate phase accuracy: average win-chance loss across moves in
    // the relevant phase, inverted to a 0–100 score.
    let totalLoss = 0;
    let count = 0;
    for (const g of gs) {
      const a = analysisById.get(g.id);
      if (!a?.moves) continue;
      for (const m of a.moves) {
        if (m.color !== a.summary.playerColor) continue;
        const inPhase = phase === 'endgame'
          ? m.phase === 'endgame'
          : (m.tacticalMotifs?.length ?? 0) > 0 || m.phase === 'middlegame';
        if (!inPhase) continue;
        totalLoss += Math.min(1, Math.max(0, m.winChanceLoss ?? 0));
        count++;
      }
    }
    if (count === 0) return null;
    return Math.max(0, Math.min(100, (1 - totalLoss / count) * 100));
  };

  // Rating series (per-game) for the current window — drives the sparkline.
  const ratingSeries = current
    .filter((g) => (g.player.rating ?? 0) > 0)
    .map((g) => g.player.rating);
  const currentRating = ratingSeries.length > 0 ? ratingSeries[ratingSeries.length - 1] : 1200;
  const ratingDelta = aggRatingChange(current);

  const accCurrent = aggAccuracy(current);
  const accPrior = aggAccuracy(prior);
  const tacticsCurrent = aggPhaseAccuracy(current, 'tactics');
  const tacticsPrior = aggPhaseAccuracy(prior, 'tactics');
  const endgameCurrent = aggPhaseAccuracy(current, 'endgame');
  const endgamePrior = aggPhaseAccuracy(prior, 'endgame');
  const ratingPrior = aggRatingChange(prior);

  const fmt = (n: number | null, suffix = '') => (n === null ? '—' : `${Math.round(n * 10) / 10}${suffix}`);
  const fmtDelta = (cur: number | null, pri: number | null, suffix: string) => {
    if (cur === null || pri === null) return '0' + suffix;
    const d = cur - pri;
    return `${Math.abs(Math.round(d * 10) / 10)}${suffix}`;
  };

  const deltas: ProgressDelta[] = [
    {
      label: 'Rating change',
      prior: ratingPrior,
      current: ratingDelta,
      delta: ratingDelta - ratingPrior,
      priorFormatted: ratingPrior >= 0 ? `+${ratingPrior}` : `${ratingPrior}`,
      currentFormatted: ratingDelta >= 0 ? `+${ratingDelta}` : `${ratingDelta}`,
      deltaFormatted: `${Math.abs(ratingDelta - ratingPrior)}`,
    },
    {
      label: 'Avg accuracy',
      prior: accPrior,
      current: accCurrent,
      delta: (accCurrent ?? 0) - (accPrior ?? 0),
      priorFormatted: fmt(accPrior, '%'),
      currentFormatted: fmt(accCurrent, '%'),
      deltaFormatted: fmtDelta(accCurrent, accPrior, ''),
    },
    {
      label: 'Tactics',
      prior: tacticsPrior,
      current: tacticsCurrent,
      delta: (tacticsCurrent ?? 0) - (tacticsPrior ?? 0),
      priorFormatted: fmt(tacticsPrior, '%'),
      currentFormatted: fmt(tacticsCurrent, '%'),
      deltaFormatted: fmtDelta(tacticsCurrent, tacticsPrior, 'pts'),
    },
    {
      label: 'Endgame',
      prior: endgamePrior,
      current: endgameCurrent,
      delta: (endgameCurrent ?? 0) - (endgamePrior ?? 0),
      priorFormatted: fmt(endgamePrior, '%'),
      currentFormatted: fmt(endgameCurrent, '%'),
      deltaFormatted: fmtDelta(endgameCurrent, endgamePrior, 'pts'),
    },
  ];

  // ── Bullets ─────────────────────────────────────────────────────────
  // Mine ~12 candidate signals from the games in the window — every one
  // grounded in a real number or a real game (deep-linkable). Each gets
  // a weight; we then pick the top 5 with a guaranteed Strong/Improve
  // mix so the Retro never reads as all-sunshine or all-gloom.
  type Candidate = ProgressBullet & { weight: number };
  const candidates: Candidate[] = [];
  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const evalAt = (m: MoveAnalysis): number => {
    const ev = m.evalAfter;
    if (ev?.scoreType === 'cp') return Math.max(-10, Math.min(10, (ev.score ?? 0) / 100));
    if (ev?.scoreType === 'mate') return (ev.score ?? 0) > 0 ? 10 : -10;
    return 0;
  };

  // ── STRONG candidates ──

  // Cleanest game — highest accuracy in window (≥ 75%)
  let bestGame: { g: GameRecord; acc: number; brilliantMove?: MoveAnalysis } | null = null;
  for (const g of current) {
    const a = analysisById.get(g.id);
    if (!a?.summary?.accuracy) continue;
    if (!bestGame || a.summary.accuracy > bestGame.acc) {
      const brilliant = a.moves.find((m) => m.color === a.summary.playerColor && (m.quality === 'brilliant' || m.quality === 'great'));
      bestGame = { g, acc: a.summary.accuracy, brilliantMove: brilliant };
    }
  }
  if (bestGame && bestGame.acc >= 75) {
    candidates.push({
      tone: 'strong',
      title: 'Cleanest game',
      body: `${Math.round(bestGame.acc)}% accuracy vs ${bestGame.g.opponent.username} on ${fmtDate(bestGame.g.playedAt)} — your sharpest game of the period.`,
      gameId: bestGame.g.id,
      moveNumber: bestGame.brilliantMove?.moveNumber,
      weight: 60 + bestGame.acc * 0.3,
    });
  }

  // Punched up — biggest rating-gap win
  let slayer: { g: GameRecord; diff: number } | null = null;
  for (const g of current) {
    if (g.player.result !== 'win') continue;
    const diff = (g.opponent.rating ?? 0) - (g.player.rating ?? 0);
    if (diff <= 30) continue;
    if (!slayer || diff > slayer.diff) slayer = { g, diff };
  }
  if (slayer) {
    candidates.push({
      tone: 'strong',
      title: 'Punched up',
      body: `Beat ${slayer.g.opponent.username} (+${slayer.diff} rated) — biggest scalp this period.`,
      gameId: slayer.g.id,
      weight: 60 + slayer.diff * 0.2,
    });
  }

  // Win streak ≥ 3 (consecutive wins, oldest→newest within window)
  const currentChrono = [...current].sort((a, b) => a.playedAt - b.playedAt);
  let streakBest = 0, streakEndIdx = -1, runWin = 0;
  for (let i = 0; i < currentChrono.length; i++) {
    if (currentChrono[i].player.result === 'win') {
      runWin++;
      if (runWin > streakBest) { streakBest = runWin; streakEndIdx = i; }
    } else runWin = 0;
  }
  if (streakBest >= 3 && streakEndIdx >= 0) {
    const lastWin = currentChrono[streakEndIdx];
    candidates.push({
      tone: 'strong',
      title: `${streakBest}-win streak`,
      body: `Hot run peaking ${fmtDate(lastWin.playedAt)} — your longest of the period.`,
      gameId: lastWin.id,
      weight: 45 + streakBest * 6,
    });
  }

  // Brilliancies + great moves
  let brilliantCount = 0, greatCount = 0;
  let firstBrilliantGame: { g: GameRecord; m: MoveAnalysis } | null = null;
  for (const g of current) {
    const a = analysisById.get(g.id);
    if (!a?.summary) continue;
    brilliantCount += a.summary.brilliantMoves ?? 0;
    greatCount += a.summary.greatMoves ?? 0;
    if (!firstBrilliantGame && (a.summary.brilliantMoves ?? 0) > 0) {
      const m = a.moves.find((mv) => mv.color === a.summary.playerColor && mv.quality === 'brilliant');
      if (m) firstBrilliantGame = { g, m };
    }
  }
  if (brilliantCount >= 1 || greatCount >= 3) {
    candidates.push({
      tone: 'strong',
      title: brilliantCount > 0 ? `${brilliantCount} brilliant move${brilliantCount > 1 ? 's' : ''}` : `${greatCount} great moves`,
      body: brilliantCount > 0
        ? `Stockfish flagged ${brilliantCount} engine-tier move${brilliantCount > 1 ? 's' : ''} across ${current.length} games.`
        : `${greatCount} great-move flags — sharp tactical eye this period.`,
      gameId: firstBrilliantGame?.g.id,
      moveNumber: firstBrilliantGame?.m.moveNumber,
      weight: 50 + brilliantCount * 10 + greatCount * 2,
    });
  }

  // Phase improvement (vs prior window)
  const phaseDeltas: Array<{ phase: 'tactics' | 'endgame'; delta: number }> = [];
  if (tacticsCurrent !== null && tacticsPrior !== null) phaseDeltas.push({ phase: 'tactics', delta: tacticsCurrent - tacticsPrior });
  if (endgameCurrent !== null && endgamePrior !== null) phaseDeltas.push({ phase: 'endgame', delta: endgameCurrent - endgamePrior });
  const phaseUp = [...phaseDeltas].sort((a, b) => b.delta - a.delta)[0];
  if (phaseUp && phaseUp.delta >= 4) {
    const phaseLabel = phaseUp.phase === 'tactics' ? 'Tactics' : 'Endgames';
    candidates.push({
      tone: 'strong',
      title: `${phaseLabel} sharpened`,
      body: `${phaseLabel} score up +${Math.round(phaseUp.delta)} pts vs ${priorLabel} — biggest swing of the period.`,
      weight: 50 + phaseUp.delta * 1.5,
    });
  }

  // Solid play — games without a blunder
  let cleanCount = 0;
  for (const g of current) {
    const a = analysisById.get(g.id);
    if (!a?.summary) continue;
    if ((a.summary.blunders ?? 0) === 0 && (a.summary.mistakes ?? 0) <= 1) cleanCount++;
  }
  if (cleanCount >= 3 && current.length >= 5) {
    const ratio = Math.round((cleanCount / current.length) * 100);
    candidates.push({
      tone: 'strong',
      title: 'Solid play',
      body: `${cleanCount} of ${current.length} games (${ratio}%) finished without a blunder.`,
      weight: 40 + cleanCount * 2 + (ratio >= 50 ? 10 : 0),
    });
  }

  // Defensive comeback — lowest eval recovered to draw/win
  let bestSave: { g: GameRecord; minEval: number; lowMoveNumber: number } | null = null;
  for (const g of current) {
    if (g.player.result === 'loss') continue;
    const a = analysisById.get(g.id);
    if (!a?.moves) continue;
    const myMoves = a.moves.filter((m) => m.color === a.summary.playerColor);
    if (myMoves.length < 6) continue;
    const myEvals = myMoves.map(evalAt);
    const minEval = Math.min(...myEvals);
    const finalEval = myEvals[myEvals.length - 1];
    if (minEval <= -2 && finalEval >= -0.3) {
      if (!bestSave || minEval < bestSave.minEval) {
        bestSave = { g, minEval, lowMoveNumber: myMoves[myEvals.indexOf(minEval)].moveNumber };
      }
    }
  }
  if (bestSave) {
    candidates.push({
      tone: 'strong',
      title: 'Defensive comeback',
      body: `Held a ${bestSave.minEval.toFixed(1)} position to a ${bestSave.g.player.result} vs ${bestSave.g.opponent.username}.`,
      gameId: bestSave.g.id,
      moveNumber: bestSave.lowMoveNumber,
      weight: 45 + Math.abs(bestSave.minEval) * 4,
    });
  }

  // Best-result opening (≥ 4 games, ≥ 60% win rate)
  const openingResults = new Map<string, { games: GameRecord[]; wins: number }>();
  for (const g of current) {
    const key = g.opening?.name?.split(':')[0]?.trim();
    if (!key || key === 'Unknown') continue;
    const e = openingResults.get(key) ?? { games: [], wins: 0 };
    e.games.push(g);
    if (g.player.result === 'win') e.wins++;
    openingResults.set(key, e);
  }
  let bestOpening: { name: string; wr: number; games: GameRecord[] } | null = null;
  for (const [name, e] of openingResults) {
    if (e.games.length < 4) continue;
    const wr = (e.wins / e.games.length) * 100;
    if (wr < 60) continue;
    if (!bestOpening || wr > bestOpening.wr) bestOpening = { name, wr, games: e.games };
  }
  if (bestOpening) {
    const wins = Math.round(bestOpening.games.length * bestOpening.wr / 100);
    candidates.push({
      tone: 'strong',
      title: 'Reliable opening',
      body: `${bestOpening.name}: ${wins}/${bestOpening.games.length} wins — your most dependable repertoire.`,
      gameId: bestOpening.games[bestOpening.games.length - 1].id,
      weight: 40 + bestOpening.wr * 0.3,
    });
  }

  // ── IMPROVE candidates ──

  // Top weakness pattern (already sorted by impact in CurrentPatterns)
  const worstPatternForBullet = patterns.patterns[0];
  if (worstPatternForBullet) {
    const label = PATTERN_LABEL_MAP[worstPatternForBullet.theme] ?? humanizeTheme(worstPatternForBullet.theme);
    candidates.push({
      tone: 'improve',
      title: label,
      body: `Hit ${worstPatternForBullet.gamesAffected} game${worstPatternForBullet.gamesAffected > 1 ? 's' : ''} this period — your biggest leak.`,
      weight: 70 + Math.min(20, worstPatternForBullet.severity * 0.5),
    });
  }

  // Phase decline
  const phaseDown = [...phaseDeltas].sort((a, b) => a.delta - b.delta)[0];
  if (phaseDown && phaseDown.delta <= -4) {
    const phaseLabel = phaseDown.phase === 'tactics' ? 'Tactics' : 'Endgames';
    candidates.push({
      tone: 'improve',
      title: `${phaseLabel} slipping`,
      body: `${phaseLabel} score down ${Math.round(phaseDown.delta)} pts vs ${priorLabel}.`,
      weight: 55 + Math.abs(phaseDown.delta) * 1.5,
    });
  }

  // Won positions, dropped — eval was clearly winning then ended in loss/draw
  let throwawayCount = 0;
  let throwawayLatest: { g: GameRecord; troughMove: number } | null = null;
  for (const g of current) {
    if (g.player.result === 'win') continue;
    const a = analysisById.get(g.id);
    if (!a?.moves) continue;
    const myMoves = a.moves.filter((m) => m.color === a.summary.playerColor);
    if (myMoves.length < 6) continue;
    const myEvals = myMoves.map(evalAt);
    const peak = Math.max(...myEvals);
    const peakIdx = myEvals.indexOf(peak);
    if (peak >= 1.5 && peakIdx < myEvals.length - 3) {
      const trough = Math.min(...myEvals.slice(peakIdx + 1));
      if (peak - trough >= 3) {
        throwawayCount++;
        if (!throwawayLatest || g.playedAt > throwawayLatest.g.playedAt) {
          const troughIdx = myEvals.indexOf(trough);
          throwawayLatest = { g, troughMove: myMoves[troughIdx]?.moveNumber ?? 0 };
        }
      }
    }
  }
  if (throwawayCount >= 2) {
    candidates.push({
      tone: 'improve',
      title: 'Won positions, dropped',
      body: `${throwawayCount} games where you were clearly winning — slips cost the result.`,
      gameId: throwawayLatest?.g.id,
      moveNumber: throwawayLatest?.troughMove,
      weight: 60 + throwawayCount * 6,
    });
  }

  // Recurring missed motif
  const motifMisses = new Map<string, { count: number; latest?: { gameId: string; moveNumber: number } }>();
  for (const g of current) {
    const a = analysisById.get(g.id);
    if (!a?.moves) continue;
    for (const m of a.moves) {
      if (m.color !== a.summary.playerColor) continue;
      if (m.quality !== 'blunder' && m.quality !== 'mistake' && m.quality !== 'miss') continue;
      for (const motif of m.tacticalMotifs ?? []) {
        const e = motifMisses.get(motif) ?? { count: 0 };
        e.count++;
        e.latest = { gameId: g.id, moveNumber: m.moveNumber };
        motifMisses.set(motif, e);
      }
    }
  }
  const motifLabel = (m: string): string => {
    if (m === 'fork') return 'forks';
    if (m === 'pin') return 'pins';
    if (m === 'skewer') return 'skewers';
    if (m === 'hanging_piece') return 'hanging pieces';
    if (m === 'back_rank') return 'back-rank tactics';
    if (m === 'discovered_attack') return 'discovered attacks';
    return m.replace(/_/g, ' ') + 's';
  };
  const topMissedMotif = [...motifMisses.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  if (topMissedMotif && topMissedMotif[1].count >= 3) {
    candidates.push({
      tone: 'improve',
      title: 'Recurring miss',
      body: `Missed ${topMissedMotif[1].count} ${motifLabel(topMissedMotif[0])} this period — train the recognition first.`,
      gameId: topMissedMotif[1].latest?.gameId,
      moveNumber: topMissedMotif[1].latest?.moveNumber,
      weight: 55 + topMissedMotif[1].count * 4,
    });
  }

  // Time-pressure errors
  let timeBlunderCount = 0;
  let timeBlunderLatest: { g: GameRecord; m: MoveAnalysis } | null = null;
  for (const g of current) {
    const a = analysisById.get(g.id);
    if (!a?.moves) continue;
    for (const m of a.moves) {
      if (m.color !== a.summary.playerColor) continue;
      if (m.quality !== 'blunder' && m.quality !== 'mistake') continue;
      if (typeof m.clockRemaining !== 'number' || m.clockRemaining > 30) continue;
      timeBlunderCount++;
      if (!timeBlunderLatest || g.playedAt > timeBlunderLatest.g.playedAt) {
        timeBlunderLatest = { g, m };
      }
    }
  }
  if (timeBlunderCount >= 3 && timeBlunderLatest) {
    candidates.push({
      tone: 'improve',
      title: 'Time-pressure errors',
      body: `${timeBlunderCount} blunders or mistakes under 30s on the clock — pace earlier moves.`,
      gameId: timeBlunderLatest.g.id,
      moveNumber: timeBlunderLatest.m.moveNumber,
      weight: 45 + timeBlunderCount * 4,
    });
  }

  // Loss skid ≥ 3
  let lossStreakBest = 0, lossStreakEndIdx = -1, runLoss = 0;
  for (let i = 0; i < currentChrono.length; i++) {
    if (currentChrono[i].player.result === 'loss') {
      runLoss++;
      if (runLoss > lossStreakBest) { lossStreakBest = runLoss; lossStreakEndIdx = i; }
    } else runLoss = 0;
  }
  if (lossStreakBest >= 3 && lossStreakEndIdx >= 0) {
    const g = currentChrono[lossStreakEndIdx];
    candidates.push({
      tone: 'improve',
      title: `${lossStreakBest}-game skid`,
      body: `Tilt window ending ${fmtDate(g.playedAt)} — quitting earlier saves rating.`,
      gameId: g.id,
      weight: 45 + lossStreakBest * 5,
    });
  }

  // Worst-result opening (≥ 4 games, ≤ 30% win rate)
  let worstOpening: { name: string; wr: number; games: GameRecord[] } | null = null;
  for (const [name, e] of openingResults) {
    if (e.games.length < 4) continue;
    const wr = (e.wins / e.games.length) * 100;
    if (wr > 30) continue;
    if (!worstOpening || wr < worstOpening.wr) worstOpening = { name, wr, games: e.games };
  }
  if (worstOpening) {
    const losses = worstOpening.games.length - Math.round(worstOpening.games.length * worstOpening.wr / 100);
    candidates.push({
      tone: 'improve',
      title: 'Opening leak',
      body: `${worstOpening.name}: ${losses}/${worstOpening.games.length} losses — review the early plan.`,
      gameId: worstOpening.games[worstOpening.games.length - 1].id,
      weight: 45 + (50 - worstOpening.wr) * 0.5,
    });
  }

  // Nemesis — opponent who beat the user 2+ times
  const lossCounts = new Map<string, GameRecord[]>();
  for (const g of current) {
    if (g.player.result !== 'loss') continue;
    const key = g.opponent.username.toLowerCase();
    const list = lossCounts.get(key) ?? [];
    list.push(g);
    lossCounts.set(key, list);
  }
  let nemesis: { username: string; losses: GameRecord[] } | null = null;
  for (const [, ls] of lossCounts) {
    if (ls.length < 2) continue;
    if (!nemesis || ls.length > nemesis.losses.length) {
      nemesis = { username: ls[0].opponent.username, losses: ls };
    }
  }
  if (nemesis) {
    const latest = nemesis.losses[nemesis.losses.length - 1];
    candidates.push({
      tone: 'improve',
      title: 'Recurring matchup',
      body: `Lost to ${nemesis.username} ${nemesis.losses.length} times this period — stylistic mismatch.`,
      gameId: latest.id,
      weight: 40 + nemesis.losses.length * 5,
    });
  }

  // Decision-speed — moving too fast on average
  const avgMoveTime = (gs: GameRecord[]) => {
    let total = 0, count = 0;
    for (const g of gs) {
      const a = analysisById.get(g.id);
      if (!a?.moves) continue;
      for (const m of a.moves) {
        if (m.color !== a.summary.playerColor) continue;
        if (typeof m.timeSpent === 'number' && m.timeSpent > 0) { total += m.timeSpent; count++; }
      }
    }
    return count > 0 ? total / count : null;
  };
  const tCurrent = avgMoveTime(current);
  const tPrior = avgMoveTime(prior);
  if (tCurrent !== null && tCurrent < 4) {
    candidates.push({
      tone: 'improve',
      title: 'Moving too fast',
      body: `Avg ${tCurrent.toFixed(1)}s per move${tPrior !== null ? ` (was ${tPrior.toFixed(1)}s)` : ''} — slow critical positions.`,
      weight: 35 + (4 - tCurrent) * 8,
    });
  }

  // ── Pick top 5 with guaranteed Strong/Improve mix ──
  const strongs = candidates.filter((c) => c.tone === 'strong').sort((a, b) => b.weight - a.weight);
  const improves = candidates.filter((c) => c.tone === 'improve').sort((a, b) => b.weight - a.weight);
  const picked: Candidate[] = [];
  // Reserve at least 2 of each tone when available, then fill by weight.
  const minStrong = Math.min(strongs.length, 2);
  const minImprove = Math.min(improves.length, 2);
  for (let i = 0; i < minStrong; i++) picked.push(strongs[i]);
  for (let i = 0; i < minImprove; i++) picked.push(improves[i]);
  const remaining = [...strongs.slice(minStrong), ...improves.slice(minImprove)].sort((a, b) => b.weight - a.weight);
  while (picked.length < 5 && remaining.length > 0) picked.push(remaining.shift()!);
  // Final order: Strong-first, then Improve. Within each group, highest
  // weight first. Reads like the per-game card insights — wins on top,
  // things to fix below.
  picked.sort((a, b) => {
    if (a.tone !== b.tone) return a.tone === 'strong' ? -1 : 1;
    return b.weight - a.weight;
  });
  const bullets: ProgressBullet[] = picked.map(({ weight: _w, ...rest }) => rest);

  // ── Headline derived from the top Strong + top Improve ──
  const topStrongCand = strongs[0];
  const topImproveCand = improves[0];
  let headline: string;
  let headlineCallout: string | null = null;
  if (ratingDelta >= 50 && topStrongCand) {
    headline = `+${ratingDelta} pts climb — ${topStrongCand.title.toLowerCase()} carried it.`;
    headlineCallout = period === 'week' ? 'Best week in a month' : 'Climbing two periods running';
  } else if (ratingDelta <= -40 && topImproveCand) {
    headline = `Down ${ratingDelta} pts — ${topImproveCand.title.toLowerCase()} is the leak.`;
  } else if (topStrongCand && topImproveCand) {
    headline = `${topStrongCand.title} held — but ${topImproveCand.title.toLowerCase()} bled rating back.`;
  } else if (topStrongCand) {
    headline = `${topStrongCand.title} was the highlight.`;
  } else if (topImproveCand) {
    headline = `Quiet stretch — ${topImproveCand.title.toLowerCase()} stands out.`;
  } else if (current.length < 5) {
    headline = `Just ${current.length} game${current.length === 1 ? '' : 's'} — keep playing for sharper trends.`;
  } else {
    headline = period === 'week' ? 'Steady week — small adjustments showing.' : period === 'month' ? 'Steady month — small adjustments showing.' : 'Career view — your patterns over time.';
  }

  if (bullets.length === 0) {
    bullets.push({
      tone: 'improve',
      title: 'Not enough signal',
      body: `${current.length} game${current.length === 1 ? '' : 's'} this period — a few more and the patterns will sharpen.`,
    });
  }

  // Focus-next CTA — prefer the user's worst real pattern (already
  // sorted by impact in CurrentPatterns) so the button drops straight
  // into Replays for that exact theme. Falls back to a generic skill
  // drill suggestion if no patterns are available yet.
  let focusNext: ProgressSnapshot['focusNext'] = null;
  const worstPattern = patterns.patterns[0];
  if (worstPattern) {
    const ratingPointsLost = Math.max(1, Math.round((worstPattern.severity * worstPattern.occurrences) / 100));
    focusNext = {
      kicker: `Replay your ${ratingPointsLost > 1 ? `${ratingPointsLost} pts` : 'biggest leak'}`,
      title: PATTERN_LABEL_MAP[worstPattern.theme] ?? humanizeTheme(worstPattern.theme),
      subtitle: `${worstPattern.gamesAffected} games hit by this — practice the exact positions you missed.`,
      theme: worstPattern.theme,
    };
  } else if (endgameCurrent !== null && endgameCurrent < 60) {
    focusNext = {
      kicker: 'Focus next · 8 min',
      minutes: 8,
      title: 'Rook endgames',
      subtitle: 'Drill the K+R vs K+pawn conversions you missed.',
    };
  } else if (tacticsCurrent !== null && tacticsCurrent < 65) {
    focusNext = {
      kicker: 'Focus next · 10 min',
      minutes: 10,
      title: 'Tactics: pins & forks',
      subtitle: 'Spot the motif before you move.',
    };
  } else if (tCurrent !== null && tCurrent < 4) {
    focusNext = {
      kicker: 'Focus next · 12 min',
      minutes: 12,
      title: 'Time management drills',
      subtitle: 'Your average move dropped under 4 seconds — slow critical positions.',
    };
  }

  return {
    windowLabel,
    priorLabel,
    headlineCallout,
    headline,
    bullets: bullets.slice(0, 5),
    focusNext,
    deltas,
    currentRating,
    ratingDelta,
    ratingSeries: ratingSeries.length >= 2 ? ratingSeries : [currentRating, currentRating],
    timeClassLabel: current[current.length - 1].timeClass.charAt(0).toUpperCase() + current[current.length - 1].timeClass.slice(1),
  };
}

/* ─────────────── Most-interesting (10 takeaway kinds) ─────────────── */

interface InterestingItem {
  kind: 'biggest_swing' | 'best_game' | 'pattern_match' | 'giant_slayer'
       | 'brilliancy' | 'nemesis' | 'critical_save' | 'streak'
       | 'opening_trend' | 'time_trouble' | 'trap_used' | 'trap_hit';
  kindLabel: string;
  accentHex: string;
  gameId: string;
  gameResult: 'win' | 'loss' | 'draw';
  dateStr: string;
  metaSuffix: string;
  title: string;
  subtitle: string;
  linkedRowTitle: string;
  linkedRowSubtitle: string;
  /** Move number to deep-link into when present (e.g. the slip move,
   *  the brilliant move, the recovery move). Falls back to game start. */
  moveNumber?: number;
  /** For trap_used / trap_hit cards: the trap ID, used to deep-link into
   *  GameDetail with the matching trap auto-selected in the Patterns tab. */
  trapId?: string;
  /** Sort weight — higher = more compelling. */
  weight: number;
}

function computeInterestingTakeaways(games: GameRecord[], analyses: GameAnalysis[], trapStats?: TrapStats): InterestingItem[] {
  if (games.length === 0) return [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff = now - 30 * dayMs;
  const window = games.filter((g) => g.playedAt >= cutoff);
  if (window.length === 0) return [];
  const byId = new Map(analyses.map((a) => [a.gameId, a] as const));
  const gameById = new Map(games.map((g) => [g.id, g] as const));
  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const items: InterestingItem[] = [];

  // BEST_GAME — highest accuracy in the window.
  let best: { g: GameRecord; a: GameAnalysis; acc: number } | null = null;
  for (const g of window) {
    const a = byId.get(g.id);
    if (!a?.summary?.accuracy) continue;
    if (!best || a.summary.accuracy > best.acc) best = { g, a, acc: a.summary.accuracy };
  }
  if (best && best.acc >= 80) {
    items.push({
      kind: 'best_game',
      kindLabel: 'Best game',
      accentHex: '#4ade80',
      gameId: best.g.id,
      gameResult: best.g.player.result,
      dateStr: fmtDate(best.g.playedAt),
      metaSuffix: `${best.g.totalMoves} moves`,
      title: `${Math.round(best.acc)}% accuracy — your highest in 30 days`,
      subtitle: `${best.g.opening?.name ?? 'Game'} vs ${best.g.opponent.username} — clean play, clinical finish.`,
      linkedRowTitle: best.g.opening?.name ?? `${best.g.opponent.username}`,
      linkedRowSubtitle: `Opp ${best.g.opponent.rating} · ${best.acc.toFixed(1)}% acc`,
      weight: 90 + best.acc,
    });
  }

  // GIANT_SLAYER — biggest rating-diff win.
  let slayer: { g: GameRecord; diff: number } | null = null;
  for (const g of window) {
    if (g.player.result !== 'win') continue;
    const diff = (g.opponent.rating ?? 0) - (g.player.rating ?? 0);
    if (diff <= 30) continue;
    if (!slayer || diff > slayer.diff) slayer = { g, diff };
  }
  if (slayer) {
    const a = byId.get(slayer.g.id);
    items.push({
      kind: 'giant_slayer',
      kindLabel: 'Giant slayer',
      accentHex: '#a78bfa',
      gameId: slayer.g.id,
      gameResult: 'win',
      dateStr: fmtDate(slayer.g.playedAt),
      metaSuffix: `${slayer.g.totalMoves} moves`,
      title: `Beat a player rated +${slayer.diff} above you`,
      subtitle: 'Your biggest scalp this month — punched well above your weight.',
      linkedRowTitle: `${slayer.g.opening?.name ?? 'Win'} vs ${slayer.g.opponent.username}`,
      linkedRowSubtitle: `Opp ${slayer.g.opponent.rating} · ${a?.summary?.accuracy?.toFixed(1) ?? '—'}% acc`,
      weight: 80 + slayer.diff,
    });
  }

  // BIGGEST_SWING — game where eval went from clearly winning to clearly losing.
  let swing: { g: GameRecord; from: number; to: number; window: number; troughMoveNumber: number } | null = null;
  for (const g of window) {
    const a = byId.get(g.id);
    if (!a?.moves || a.moves.length < 6) continue;
    const myColor = a.summary.playerColor;
    const myMoves = a.moves.filter((m) => m.color === myColor);
    const myEvals = myMoves.map((m) => {
      const ev = m.evalAfter;
      if (ev?.scoreType === 'cp') return Math.max(-10, Math.min(10, (ev.score ?? 0) / 100));
      if (ev?.scoreType === 'mate') return (ev.score ?? 0) > 0 ? 10 : -10;
      return 0;
    });
    if (myEvals.length < 6) continue;
    // Look for the largest drop from a peak to a later trough within 5 moves.
    for (let i = 0; i < myEvals.length - 3; i++) {
      const peak = myEvals[i];
      if (peak < 1.5) continue;
      for (let j = i + 1; j <= Math.min(i + 5, myEvals.length - 1); j++) {
        const trough = myEvals[j];
        if (peak - trough < 4) continue;
        if (!swing || peak - trough > Math.abs(swing.from - swing.to)) {
          swing = { g, from: peak, to: trough, window: j - i, troughMoveNumber: myMoves[j].moveNumber };
        }
      }
    }
  }
  if (swing) {
    const a = byId.get(swing.g.id);
    const slipMove = a?.moves.find((m) => m.moveNumber === swing.troughMoveNumber && m.color === a.summary.playerColor);
    const slipDescriptor = slipMove?.quality === 'blunder' ? 'Blunder'
      : slipMove?.quality === 'mistake' ? 'Mistake'
      : slipMove?.quality === 'inaccuracy' ? 'Inaccuracy'
      : 'Critical slip';
    items.push({
      kind: 'biggest_swing',
      kindLabel: 'Biggest swing',
      accentHex: '#f59e0b',
      gameId: swing.g.id,
      gameResult: swing.g.player.result,
      dateStr: fmtDate(swing.g.playedAt),
      metaSuffix: `${swing.g.totalMoves} moves`,
      title: `+${swing.from.toFixed(1)} → ${swing.to.toFixed(1)} on move ${swing.troughMoveNumber}`,
      subtitle: `You were winning vs ${swing.g.opponent.username} — then a slip on move ${swing.troughMoveNumber} cost it.`,
      linkedRowTitle: `${slipDescriptor} · Move ${swing.troughMoveNumber}`,
      linkedRowSubtitle: `vs ${swing.g.opponent.username} (${swing.g.opponent.rating}) · ${a?.summary?.accuracy?.toFixed(1) ?? '—'}% acc`,
      moveNumber: swing.troughMoveNumber,
      weight: 75 + (swing.from - swing.to) * 5,
    });
  }

  // BRILLIANCY — game with brilliantMoves > 0.
  for (const g of window) {
    const a = byId.get(g.id);
    if (!a?.summary || (a.summary.brilliantMoves ?? 0) === 0) continue;
    const myColor = a.summary.playerColor;
    const brilliantMove = a.moves.find((m) => m.color === myColor && m.quality === 'brilliant');
    const moveNumber = brilliantMove?.moveNumber;
    items.push({
      kind: 'brilliancy',
      kindLabel: 'Brilliancy',
      accentHex: '#22d3ee',
      gameId: g.id,
      gameResult: g.player.result,
      dateStr: fmtDate(g.playedAt),
      metaSuffix: `${g.totalMoves} moves`,
      title: moveNumber
        ? `Brilliant move ${brilliantMove?.moveSan} on move ${moveNumber}`
        : `Brilliant move spotted vs ${g.opponent.username}`,
      subtitle: 'Stockfish flagged a move only the engine usually finds.',
      linkedRowTitle: moveNumber
        ? `Brilliancy · Move ${moveNumber}`
        : 'See the brilliancy',
      linkedRowSubtitle: `vs ${g.opponent.username} (${g.opponent.rating}) · ${a.summary.accuracy?.toFixed(1) ?? '—'}% acc`,
      moveNumber,
      weight: 85,
    });
    break;
  }

  // NEMESIS — opponent who beat the user 2+ times.
  const lossCounts = new Map<string, GameRecord[]>();
  for (const g of window) {
    if (g.player.result !== 'loss') continue;
    const key = g.opponent.username.toLowerCase();
    const list = lossCounts.get(key) ?? [];
    list.push(g);
    lossCounts.set(key, list);
  }
  for (const [, ls] of lossCounts) {
    if (ls.length < 2) continue;
    const latest = ls[ls.length - 1];
    items.push({
      kind: 'nemesis',
      kindLabel: 'Nemesis',
      accentHex: '#ef4444',
      gameId: latest.id,
      gameResult: 'loss',
      dateStr: fmtDate(latest.playedAt),
      metaSuffix: `${ls.length} losses`,
      title: `Lost to ${latest.opponent.username} ${ls.length} times this month`,
      subtitle: 'Watch the patterns — there\'s a recurring weakness against this style.',
      linkedRowTitle: `Latest vs ${latest.opponent.username}`,
      linkedRowSubtitle: `Opp ${latest.opponent.rating}`,
      weight: 60 + ls.length * 5,
    });
    break;
  }

  // STREAK — longest run of wins (3+).
  let streakBest = 0;
  let streakEndIdx = -1;
  let cur = 0;
  for (let i = 0; i < window.length; i++) {
    if (window[i].player.result === 'win') {
      cur++;
      if (cur > streakBest) { streakBest = cur; streakEndIdx = i; }
    } else cur = 0;
  }
  if (streakBest >= 3 && streakEndIdx >= 0) {
    const g = window[streakEndIdx];
    items.push({
      kind: 'streak',
      kindLabel: 'Streak',
      accentHex: '#fbbf24',
      gameId: g.id,
      gameResult: 'win',
      dateStr: fmtDate(g.playedAt),
      metaSuffix: `${streakBest} wins`,
      title: `${streakBest}-game win streak`,
      subtitle: 'Hot stretch — momentum likely from the same opening prep.',
      linkedRowTitle: `Last win vs ${g.opponent.username}`,
      linkedRowSubtitle: `Opp ${g.opponent.rating}`,
      weight: 60 + streakBest * 5,
    });
  }

  // OPENING_TREND — most-played opening with win rate ≥ 60% (5+ games).
  const openingStats = new Map<string, { games: GameRecord[]; wins: number }>();
  for (const g of window) {
    const key = g.opening?.name?.split(':')[0] ?? 'Unknown';
    const e = openingStats.get(key) ?? { games: [], wins: 0 };
    e.games.push(g);
    if (g.player.result === 'win') e.wins++;
    openingStats.set(key, e);
  }
  for (const [name, e] of openingStats) {
    if (e.games.length < 5) continue;
    const wr = (e.wins / e.games.length) * 100;
    if (wr < 60) continue;
    const latest = e.games[e.games.length - 1];
    items.push({
      kind: 'opening_trend',
      kindLabel: 'Opening trend',
      accentHex: '#60a5fa',
      gameId: latest.id,
      gameResult: latest.player.result,
      dateStr: fmtDate(latest.playedAt),
      metaSuffix: `${e.games.length} games`,
      title: `${name}: ${Math.round(wr)}% win rate`,
      subtitle: `Played ${e.games.length} times this month — your most reliable repertoire.`,
      linkedRowTitle: `Latest: ${latest.opponent.username}`,
      linkedRowSubtitle: `Opp ${latest.opponent.rating}`,
      weight: 55 + wr / 2,
    });
    break;
  }

  // TIME_TROUBLE — games ending with low clock-remaining when losing.
  let timeTroubleCount = 0;
  let timeTroubleLatest: GameRecord | null = null;
  for (const g of window) {
    if (g.player.result !== 'loss') continue;
    const a = byId.get(g.id);
    if (!a?.moves) continue;
    const lastMyMove = [...a.moves].reverse().find((m) => m.color === a.summary.playerColor);
    if (lastMyMove && typeof lastMyMove.clockRemaining === 'number' && lastMyMove.clockRemaining < 30) {
      timeTroubleCount++;
      timeTroubleLatest = g;
    }
  }
  if (timeTroubleCount >= 3 && timeTroubleLatest) {
    items.push({
      kind: 'time_trouble',
      kindLabel: 'Time trouble',
      accentHex: '#fb923c',
      gameId: timeTroubleLatest.id,
      gameResult: 'loss',
      dateStr: fmtDate(timeTroubleLatest.playedAt),
      metaSuffix: `${timeTroubleCount} games`,
      title: `${timeTroubleCount} games lost under 30s on the clock`,
      subtitle: 'Time pressure is doing the damage, not the position.',
      linkedRowTitle: `Latest vs ${timeTroubleLatest.opponent.username}`,
      linkedRowSubtitle: `Opp ${timeTroubleLatest.opponent.rating}`,
      weight: 50 + timeTroubleCount * 5,
    });
  }

  // CRITICAL_SAVE — game where eval went very negative then recovered to draw/win.
  for (const g of window) {
    if (g.player.result === 'loss') continue;
    const a = byId.get(g.id);
    if (!a?.moves || a.moves.length < 4) continue;
    const myMoves = a.moves.filter((m) => m.color === a.summary.playerColor);
    const myEvals = myMoves.map((m) => {
      const ev = m.evalAfter;
      if (ev?.scoreType === 'cp') return Math.max(-10, Math.min(10, (ev.score ?? 0) / 100));
      if (ev?.scoreType === 'mate') return (ev.score ?? 0) > 0 ? 10 : -10;
      return 0;
    });
    const minEval = Math.min(...myEvals);
    const finalEval = myEvals[myEvals.length - 1];
    if (minEval <= -2 && finalEval >= -0.3) {
      const lowIdx = myEvals.indexOf(minEval);
      const lowMoveNumber = myMoves[lowIdx]?.moveNumber;
      items.push({
        kind: 'critical_save',
        kindLabel: 'Critical save',
        accentHex: '#34d399',
        gameId: g.id,
        gameResult: g.player.result,
        dateStr: fmtDate(g.playedAt),
        metaSuffix: `${g.totalMoves} moves`,
        title: lowMoveNumber
          ? `Held ${minEval.toFixed(1)} on move ${lowMoveNumber} → ${g.player.result === 'win' ? 'win' : 'draw'}`
          : `Held a ${minEval.toFixed(1)} position to a ${g.player.result === 'win' ? 'win' : 'draw'}`,
        subtitle: 'Defensive resourcefulness paid off — track how this came back.',
        linkedRowTitle: lowMoveNumber ? `Defensive resource · Move ${lowMoveNumber}` : `vs ${g.opponent.username}`,
        linkedRowSubtitle: `vs ${g.opponent.username} (${g.opponent.rating}) · ${a.summary.accuracy?.toFixed(1) ?? '—'}% acc`,
        moveNumber: lowMoveNumber,
        weight: 65 + Math.abs(minEval) * 3,
      });
      break;
    }
  }

  // TRAP_USED / TRAP_HIT — top opening traps with deep-link into the most
  // recent example game. Aggregated across the whole filtered set (not just
  // the 30-day window) so rare traps still get a story card.
  if (trapStats) {
    const trapToItem = (
      stat: typeof trapStats.used[number],
      side: 'used' | 'fellInto',
    ): InterestingItem | null => {
      const latest = stat.occurrences[0];
      if (!latest) return null;
      const exampleGame = gameById.get(latest.gameId);
      if (!exampleGame) return null;
      const total = stat.count;
      const scorePct = Math.round(((stat.wins + stat.draws * 0.5) / Math.max(1, total)) * 100);
      const freqLabel = capitalize(stat.frequencyBucket);
      const isUsed = side === 'used';
      // Weight: traps land between Streak (low 80s) and Brilliancy (90s).
      // Frequent and recent traps surface higher.
      const recencyBoost = latest.playedAt > cutoff ? 5 : 0;
      const weight = 70 + Math.min(15, stat.count) + recencyBoost;
      return {
        kind: isUsed ? 'trap_used' : 'trap_hit',
        kindLabel: isUsed ? 'Trap used' : 'Trap hit',
        accentHex: isUsed ? '#4ade80' : '#ef4444',
        gameId: exampleGame.id,
        gameResult: exampleGame.player.result,
        dateStr: fmtDate(latest.playedAt),
        metaSuffix: `${freqLabel} · ${total}×`,
        title: isUsed
          ? `${stat.trapName} sprung ${total}× — ${scorePct}% wins`
          : `${stat.trapName} caught you ${total}× — ${scorePct}% score`,
        subtitle: isUsed
          ? `You played this trap ${total} time${total === 1 ? '' : 's'}. Latest victim: ${exampleGame.opponent.username}.`
          : `Opponents sprung this on you ${total} time${total === 1 ? '' : 's'}. Latest: vs ${exampleGame.opponent.username}.`,
        linkedRowTitle: exampleGame.opponent.username,
        linkedRowSubtitle: `Opp ${exampleGame.opponent.rating} · ${exampleGame.opening?.name ?? 'Opening'}`,
        trapId: stat.trapId,
        weight,
      };
    };

    // Top 2 of each side — keeps the feed varied without flooding it.
    for (const stat of trapStats.used.slice(0, 2)) {
      const item = trapToItem(stat, 'used');
      if (item) items.push(item);
    }
    for (const stat of trapStats.fellInto.slice(0, 2)) {
      const item = trapToItem(stat, 'fellInto');
      if (item) items.push(item);
    }
  }

  return items.sort((a, b) => b.weight - a.weight);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
