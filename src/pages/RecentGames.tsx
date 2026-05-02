import { useMemo, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import { useChessData } from '@/contexts/ChessDataContext';
import { useTheme } from '@/components/ThemeContext';
import { useT } from '@/i18n/index';
import PlayerAvatar from '@/components/PlayerAvatar';
import ThemedChessboard from '@/components/ThemedChessboard';
import { prefetchAvatars } from '@/api/chess-com-avatar';
import { useFlag } from '@/hooks/useFlag';
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis, MoveAnalysis } from '@shared/types/analysis';
import { DataAttribution } from '@/components/PlatformBadge';
import ShareComposer from '@/components/share/ShareComposer';
import { captureCardAsBlob, shareImage, downloadImage, copyImageToClipboard } from '@/utils/share-image';

const PAGE_SIZE = 20;

type TabId = 'all' | 'achievements';

export default function RecentGames() {
  const { allGames: rawGames, allAnalyses, gamesLoading: loading, profile } = useChessData();
  const { settings } = useTheme();
  const { t, language } = useT();
  const timeClassFilter = settings.selectedTimeClass ?? null;
  const navigate = useNavigate();

  const [tab, setTab] = useState<TabId>('all');
  const [opponentSearch, setOpponentSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [shareTarget, setShareTarget] = useState<Achievement | null>(null);
  const [achActiveIdx, setAchActiveIdx] = useState(0);
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
      {/* Tabs — prominent, full-row, icon + label + count */}
      <div className="flex gap-2 mb-4">
        <TabButton active={tab === 'all'} onClick={() => setTab('all')} Icon={ListIcon} label="All" count={gamesList.length} />
        <TabButton
          active={tab === 'achievements'}
          onClick={() => setTab('achievements')}
          Icon={TrophyIcon}
          label="Achievements"
          count={achievements.length}
          activeTintHex={tab === 'achievements' ? achievements[achActiveIdx]?.toneHex : undefined}
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
                  onClick={() => navigate(`/games/${game.id}`)}
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

      {tab === 'achievements' && (
        <AchievementsView
          achievements={achievements}
          language={language}
          onViewGame={(id) => navigate(`/games/${id}`)}
          onActiveIndexChange={(idx) => {
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

/* ── Tab button ── */

function TabButton({
  active,
  onClick,
  Icon,
  label,
  count,
  activeTintHex,
  hasUnread,
}: {
  active: boolean;
  onClick: () => void;
  Icon: IconComponent;
  label: string;
  count: number;
  /** When provided and active, recolors the tab to this hex (with derived bg/border). */
  activeTintHex?: string;
  /** When true, shows a small blue dot on the tab — used for new-content nudges. */
  hasUnread?: boolean;
}) {
  const tintStyle = active && activeTintHex
    ? { color: activeTintHex, background: `${activeTintHex}26`, borderColor: `${activeTintHex}4d` }
    : undefined;
  const countStyle = active && activeTintHex ? { color: `${activeTintHex}b3` } : undefined;
  return (
    <button
      onClick={onClick}
      style={tintStyle}
      className={`relative flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-base font-bold transition-all border ${
        active
          ? activeTintHex
            ? '' /* colors come from inline style */
            : 'bg-chess-accent/15 text-chess-accent border-chess-accent/30'
          : 'text-gray-400 hover:text-chess-text hover:bg-white/[0.04] border-chess-border/20'
      }`}
    >
      <Icon size={22} />
      <span>{label}</span>
      <span
        style={countStyle}
        className={`text-xs font-semibold tabular-nums ${active && !activeTintHex ? 'text-chess-accent/70' : !active ? 'text-gray-500' : ''}`}
      >
        {count}
      </span>
      {hasUnread && (
        <span
          aria-hidden
          className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.7)]"
        />
      )}
    </button>
  );
}

function ListIcon({ className, size }: { className?: string; size?: number }) {
  return (
    <svg {...baseIconProps(className, size)}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="4" cy="6" r="1.5" />
      <circle cx="4" cy="12" r="1.5" />
      <circle cx="4" cy="18" r="1.5" />
    </svg>
  );
}

function TrophyIcon({ className, size }: { className?: string; size?: number }) {
  return (
    <svg {...baseIconProps(className, size)}>
      <path d="M7 4h10v4a5 5 0 0 1-10 0z" />
      <path d="M17 6h2.5a2.5 2.5 0 0 1 0 5H17" />
      <path d="M7 6H4.5a2.5 2.5 0 0 0 0 5H7" />
      <path d="M10 14h4" />
      <path d="M12 14v4" />
      <path d="M8 20h8" />
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
  const timeStr = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

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
              {game.timeControl ? ` \u00B7 ${game.timeControl.replace(/\+/, '+')}` : ''}
              {' \u00B7 '}
              {dateStr} {timeStr}
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
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 22h14" />
      <path d="M5 2h14" />
      <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
      <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
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
    const cardEl = cardRefs.current[activeIdx];
    if (!cardEl || busy) return;
    setBusy(true);
    try {
      const blob = await captureCardAsBlob(cardEl);
      const ach = achievements[activeIdx];
      const filename = `chess-dna-${ach.id}-${ach.game.id}.png`;
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await shareImage(blob, filename);
      } else {
        // Desktop fallback — copy image to clipboard, else download.
        const ok = await copyImageToClipboard(blob);
        if (!ok) downloadImage(blob, filename);
      }
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

        {/* Swipe hint — floats above the card on the right edge, with a
            subtle horizontal nudge animation to read as a discoverable
            indicator, not part of the card. Fades out after the user
            nudges the carousel. */}
        {achievements.length - activeIdx - 1 > 0 && (
          <div
            aria-hidden
            className={`pointer-events-none absolute right-2 -bottom-3 transition-opacity duration-300 z-10 ${
              hasInteracted ? 'opacity-0' : 'opacity-100'
            }`}
            style={{ animation: 'swipe-nudge 1.6s ease-in-out infinite' }}
          >
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white text-[11px] font-extrabold uppercase tracking-[1.4px] text-black"
              style={{ boxShadow: '0 0 12px 1px rgba(255,255,255,0.18), 0 4px 12px rgba(0,0,0,0.4)' }}
            >
              <span>{achievements.length - activeIdx - 1} more</span>
              <svg className="w-3 h-3 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
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
        <div className="min-w-0 leading-tight">
          <div className="text-[10px] font-bold uppercase tracking-[1.8px] text-chess-text-tertiary">
            Your personal best
          </div>
          <div className={`text-[20px] font-extrabold ${achievement.tone} truncate`}>
            {achievement.title}
          </div>
        </div>
      </div>

      {/* Hero stat */}
      <div className="relative px-4 pt-3 pb-2 text-center">
        <div
          className={`font-black tabular-nums leading-none tracking-[-0.04em] ${achievement.tone}`}
          style={{
            fontSize: 'clamp(72px, 18vw, 112px)',
          }}
        >
          {achievement.statValue}
        </div>
        {achievement.statUnit && (
          <div className="text-[11px] font-bold text-chess-text-tertiary uppercase tracking-[2px] mt-2">
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
            <span className="text-[13px] font-semibold text-chess-text truncate">
              vs {game.opponent.username}
            </span>
            <OpponentFlag username={game.opponent.username} small />
            <span className="text-[10px] text-chess-text-tertiary shrink-0">
              ({game.opponent.rating})
            </span>
          </div>
          <div className="text-[10px] text-chess-text-tertiary truncate">
            {game.totalMoves} {t('common_moves')} {'\u00B7 '} {dateStr}
          </div>
        </div>
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

