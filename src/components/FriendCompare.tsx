import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SkillRadar from './SkillRadar';
import { useChessData } from '@/contexts/ChessDataContext';
import { useTheme } from './ThemeContext';
import { DataAttribution } from '@/components/PlatformBadge';
import { useT, translateTierName } from '@/i18n/index';
import type { TranslationKey } from '@/i18n/locales/en';
import {
  fetchFriendProfile,
  getCachedFriendProfile,
  cacheFriendProfile,
  clearFriendCache,
  type FriendProfile,
  type CachedFriendProfile,
  type FriendAnalysisProgress,
} from '@/api/friend-profile';
import { trackEvent, Events } from '@/hooks/useAnalytics';
import { getTierForScore, getTierColor } from '@/patterns/rank-tiers';
import { calculateSkillProfile } from '@/patterns/skill-calculator';
import { fetchProfile, getCachedCountry } from '@/api/chess-com-avatar';
import { countryToFlag } from '@/api/chess-com-leaderboard';

/** Tiny hook — fetches the chess.com country flag for a username (cached). */
function useFlag(username: string | null | undefined): string {
  const [, forceUpdate] = useState(0);
  const code = username ? getCachedCountry(username) : null;
  useEffect(() => {
    if (!username) return;
    if (code !== undefined) return; // already resolved (null or string)
    let cancelled = false;
    fetchProfile(username).then(() => {
      if (!cancelled) forceUpdate((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [username, code]);
  return code ? countryToFlag(code) : '';
}

const COMPARE_GAME_COUNT = 5;

export default function FriendCompare({ initialCompareUsername, timeClass = 'all' }: { initialCompareUsername?: string | null; timeClass?: string } = {}) {
  const { t } = useT();
  const { allGames, allAnalyses, playerElo } = useChessData();
  // Compute profile from last 10 analyzed games, filtered by time class
  const profile = useMemo(() => {
    const analyzedGames = allGames
      .filter(g => g.analysisStatus === 'complete')
      .filter(g => timeClass === 'all' || g.timeClass === timeClass)
      .sort((a, b) => b.playedAt - a.playedAt)
      .slice(0, COMPARE_GAME_COUNT);
    const gameIds = new Set(analyzedGames.map(g => g.id));
    const matchingAnalyses = allAnalyses.filter(a => gameIds.has(a.gameId));
    return calculateSkillProfile(null, analyzedGames, matchingAnalyses);
  }, [allGames, allAnalyses, timeClass]);

  const { theme, settings } = useTheme();
  const [username, setUsername] = useState('');
  const [friend, setFriend] = useState<FriendProfile | null>(null);
  const [progress, setProgress] = useState<FriendAnalysisProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setSavedFriends] = useState<string[]>([]);

  const isLoading = progress !== null && progress.phase !== 'done' && progress.phase !== 'error';
  const loadingRef = useRef(false);

  const saveFriend = useCallback((target: string) => {
    setSavedFriends(prev => {
      const updated = [target, ...prev.filter(f => f.toLowerCase() !== target.toLowerCase())].slice(0, 5);
      localStorage.setItem('chess-dna-friends', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleCompare = useCallback(async (name?: string, forceRefresh = false) => {
    const target = (name ?? username).trim();
    if (!target || loadingRef.current) return;
    setError(null);
    setFriend(null);

    // Check cache first (unless forced refresh)
    if (!forceRefresh) {
      const cached = getCachedFriendProfile(target);
      if (cached) {
        setFriend(cached);
        setProgress(null);
        trackEvent(Events.FRIEND_COMPARED, { friend: target, gamesAnalyzed: cached.gamesAnalyzed, cached: true });
        saveFriend(target);
        return;
      }
    }

    loadingRef.current = true;
    setProgress({ phase: 'fetching', current: 0, total: 0, message: `Fetching ${target}'s games...` });

    try {
      const result = await fetchFriendProfile(
        target,
        timeClass as import('@shared/types/game').TimeClass | 'all',
        COMPARE_GAME_COUNT,
        // Compare uses depth 10 for a 2-3s pass; we don't need full
        // 18-ply accuracy here — patterns surface fine at depth 10.
        Math.min(settings.analysisDepth ?? 10, 10),
        setProgress,
      );
      setFriend(result);
      cacheFriendProfile(result);
      trackEvent(Events.FRIEND_COMPARED, { friend: target, gamesAnalyzed: result.gamesAnalyzed, cached: false });
      saveFriend(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze friend');
      setProgress(null);
    } finally {
      loadingRef.current = false;
    }
  }, [username, settings.analysisDepth, saveFriend]);

  // Auto-trigger comparison from external source (e.g. opponent chip click)
  const prevInitialRef = useRef<string | null>(null);
  const handleCompareRef = useRef(handleCompare);
  handleCompareRef.current = handleCompare;
  useEffect(() => {
    if (!initialCompareUsername) return;
    if (initialCompareUsername === prevInitialRef.current) return;
    prevInitialRef.current = initialCompareUsername;
    setUsername(initialCompareUsername);
    handleCompareRef.current(initialCompareUsername);
  }, [initialCompareUsername]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCompare();
  };

  return (
    <div className="space-y-4">
      {/* Add-by-username — promoted to the top per Claude Design.
          Person icon prefix + green Add pill button. */}
      <div className="flex items-center gap-2 bg-chess-surface rounded-xl border border-chess-border/30 px-3 py-2">
        <svg className="w-4 h-4 text-chess-text-tertiary shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M20 21a8 8 0 1 0-16 0" />
        </svg>
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add by username (chess.com / lichess)…"
          className="flex-1 bg-transparent text-sm text-chess-text placeholder:text-chess-text-tertiary/80 focus:outline-none"
          disabled={isLoading}
        />
        <button
          onClick={() => handleCompare()}
          disabled={isLoading || !username.trim()}
          className="bg-chess-accent/15 text-chess-accent border border-chess-accent/40 px-3 py-1 rounded-lg text-xs font-extrabold hover:bg-chess-accent/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          Add
        </button>
      </div>

      {/* Saved friends chips — hidden when used inside Compare page (discover section handles this) */}

      {/* Progress indicator */}
      {isLoading && progress && (
        <div className="bg-chess-surface rounded-lg p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-4 h-4 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-chess-text">
              {progress.phase === 'analyzing' ? t('compare_analyzing_game', { current: String(progress.current), total: String(progress.total) }) : progress.message}
            </span>
          </div>
          {progress.phase === 'analyzing' && progress.total > 0 && (
            <div className="w-full bg-chess-border/20 rounded-full h-1.5 mt-2">
              <div
                className="bg-chess-accent h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          )}
          <p className="text-xs text-gray-500 mt-2">
            {t('compare_analyzing_wait')}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-chess-blunder/10 border border-chess-blunder/30 rounded-lg p-3 text-sm text-chess-blunder">
          {error}
        </div>
      )}

      {/* Comparison results */}
      {friend && profile && (
        <ComparisonResults
          profile={profile}
          friend={friend}
          playerElo={playerElo}
          myGameCount={COMPARE_GAME_COUNT}
          theme={theme}
          allGames={allGames}
          timeClass={timeClass}
          onRefresh={() => {
            clearFriendCache(friend.username);
            setFriend(null);
            handleCompare(friend.username, true);
          }}
          onReset={() => { setFriend(null); setProgress(null); setUsername(''); }}
        />
      )}
    </div>
  );
}

function ComparisonResults({
  profile,
  friend,
  playerElo,
  myGameCount: _myGameCount,
  theme,
  allGames,
  timeClass,
  onRefresh,
  onReset,
}: {
  profile: import('@shared/types/patterns').SkillProfile;
  friend: FriendProfile | CachedFriendProfile;
  playerElo: number;
  myGameCount?: number;
  theme: 'dark' | 'light';
  allGames: import('@shared/types/game').GameRecord[];
  timeClass: string;
  onRefresh: () => void;
  onReset: () => void;
}) {
  const { t, language } = useT();
  const navigate = useNavigate();
  const [gamesExpanded, setGamesExpanded] = useState(false);
  // Build benchmarks from friend's dimensions for overlay radar
  const friendBenchmarks = useMemo(() => {
    const map: Record<string, number> = {};
    for (const dim of friend.skillProfile.dimensions) {
      map[dim.id] = dim.score;
    }
    return map;
  }, [friend.skillProfile.dimensions]);

  const isCached = 'cachedAt' in friend;

  const { settings } = useTheme();
  const myUsername = settings.chesscomUsername ?? allGames[0]?.player?.username ?? null;
  const myFlag = useFlag(myUsername);
  const friendFlag = useFlag(friend.username);

  // Auto-scroll past the filters once the comparison is ready, so the
  // results are the first thing visible.
  const resultsRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      resultsRootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [friend.username]);

  return (
    <div ref={resultsRootRef} className="space-y-4 scroll-mt-4">
      {/* Side-by-side YOU / OPP score cards (per Claude Design).
          Big white score for you, tier-colored score for opp; checkbox top-left
          (decorative for now — will gate radar inclusion in a future tweak). */}
      <div className="grid grid-cols-2 gap-2.5">
        <SideScoreCard
          isMe
          label={t('compare_you')}
          score={profile.overallRating}
          elo={playerElo}
          flag={myFlag}
          theme={theme}
        />
        <SideScoreCard
          label={friend.username}
          score={friend.skillProfile.overallRating}
          elo={friend.elo}
          flag={friendFlag}
          theme={theme}
        />
      </div>

      {/* Cache indicator */}
      {isCached && (
        <div className="flex items-center justify-between text-xs text-gray-500 px-1">
          <span>{t('compare_last_compared', { time: formatTimeAgo((friend as CachedFriendProfile).cachedAt, t) })}</span>
          <button onClick={onRefresh} className="text-chess-accent hover:underline font-medium">
            {t('compare_refresh')}
          </button>
        </div>
      )}

      {/* Overlay radar comparison — solid 'you' line + dashed friend line,
          legend below per Claude Design. */}
      <div className="flex flex-col items-center">
        <SkillRadar
          profile={profile}
          benchmarks={friendBenchmarks}
          benchmarkLabel={friend.username}
          size={280}
          animated={false}
        />
        <div className="flex items-center gap-5 mt-1">
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-[2px] inline-block bg-chess-text-secondary" />
            <span className="text-[11px] text-chess-text-secondary font-medium">{t('compare_you')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block"
              style={{
                width: 16, height: 0,
                borderTop: '2px dashed #60a5fa',
              }}
            />
            <span className="text-[11px] text-chess-text-secondary font-medium">{friend.username}</span>
          </div>
        </div>
      </div>

      {/* Dimension-by-dimension comparison */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t('compare_dimension_breakdown')}</h4>
        {profile.dimensions.map((dim, i) => {
          const friendDim = friend.skillProfile.dimensions[i];
          if (!friendDim) return null;
          const delta = dim.score - friendDim.score;
          return (
            <DimensionRow
              key={dim.id}
              label={t((`skill_${dim.id}`) as TranslationKey)}
              myScore={dim.score}
              friendScore={friendDim.score}
              delta={delta}
              theme={theme}
            />
          );
        })}
      </div>

      {/* Head to Head */}
      {(() => {
        const friendLower = friend.username.toLowerCase();
        const vsGames = allGames
          .filter(g => g.opponent.username.toLowerCase() === friendLower)
          .filter(g => timeClass === 'all' || g.timeClass === timeClass)
          .sort((a, b) => b.playedAt - a.playedAt);
        const wins = vsGames.filter(g => g.player.result === 'win').length;
        const losses = vsGames.filter(g => g.player.result === 'loss').length;
        const draws = vsGames.filter(g => g.player.result === 'draw').length;
        const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';

        return (
          <div className="border border-chess-border/20 rounded-lg overflow-hidden">
            <div className="px-3 py-2.5 bg-chess-surface/30">
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t('compare_head_to_head')}</h4>
            </div>
            {vsGames.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-gray-500">{t('compare_no_games_vs')}</div>
            ) : (
              <>
                {/* W/L/D summary */}
                <div className="px-3 py-3 flex items-center justify-center gap-4">
                  <div className="text-center">
                    <div className="text-lg font-black text-chess-accent">{wins}</div>
                    <div className="text-[10px] text-gray-500 uppercase">W</div>
                  </div>
                  <div className="text-gray-600">{'\u2014'}</div>
                  <div className="text-center">
                    <div className="text-lg font-black text-chess-blunder">{losses}</div>
                    <div className="text-[10px] text-gray-500 uppercase">L</div>
                  </div>
                  <div className="text-gray-600">{'\u2014'}</div>
                  <div className="text-center">
                    <div className="text-lg font-black text-gray-400">{draws}</div>
                    <div className="text-[10px] text-gray-500 uppercase">D</div>
                  </div>
                </div>

                {/* Toggle game list */}
                <button
                  onClick={() => setGamesExpanded(prev => !prev)}
                  className="w-full px-3 py-2 text-[11px] text-gray-400 hover:text-chess-text-secondary transition-colors flex items-center justify-center gap-1 border-t border-chess-border/10"
                >
                  <span>{gamesExpanded ? t('compare_hide_games') : t('compare_show_games')}</span>
                  <svg className={`w-3 h-3 transition-transform ${gamesExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                </button>

                {/* Collapsible game list */}
                {gamesExpanded && (
                  <div className="border-t border-chess-border/10 divide-y divide-chess-border/10">
                    {vsGames.map(g => {
                      const date = new Date(g.playedAt);
                      const resultColor = g.player.result === 'win' ? 'bg-chess-accent/20 text-chess-accent' : g.player.result === 'loss' ? 'bg-chess-blunder/20 text-chess-blunder' : 'bg-gray-500/20 text-gray-400';
                      const resultLabel = g.player.result === 'win' ? 'W' : g.player.result === 'loss' ? 'L' : 'D';
                      return (
                        <div
                          key={g.id}
                          onClick={() => navigate(`/games/${g.id}`)}
                          className="px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-white/[0.03] transition-colors"
                        >
                          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${resultColor}`}>{resultLabel}</span>
                          <div className="flex-1 min-w-0 text-[11px] text-gray-400">
                            <span>{date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</span>
                            <span className="mx-1">{'\u00B7'}</span>
                            <span>{g.totalMoves} {t('common_moves')}</span>
                            <span className="mx-1">{'\u00B7'}</span>
                            <span className="text-gray-500">({g.opponent.rating})</span>
                          </div>
                          <svg className="w-3 h-3 text-gray-600 shrink-0 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* Invite CTA */}
      <div className="bg-chess-surface/50 rounded-lg p-3 text-center border border-chess-border/20">
        <p className="text-xs text-gray-400 mb-2">
          {t('compare_think_enjoy', { name: friend.username })}
        </p>
        <InviteShareButtons friendName={friend.username} myScore={profile.overallRating} />
      </div>

      {/* Compare another */}
      <button
        onClick={onReset}
        className="text-xs text-gray-500 hover:text-chess-text transition-colors"
      >
        {t('compare_another')}
      </button>
      <DataAttribution />
    </div>
  );
}

function formatTimeAgo(timestamp: number, t?: (key: any, params?: any) => string): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (t) {
    if (minutes < 60) return t('compare_min_ago', { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('compare_hours_ago', { n: hours });
    return t('compare_days_ago', { n: Math.floor(hours / 24) });
  }
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function InviteShareButtons({ friendName, myScore }: { friendName: string; myScore: number }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : 'https://chessdna.com';
  const shareText = `Hey ${friendName}! I just analyzed my chess DNA — my score is ${myScore}. Want to compare? Check it out: ${siteUrl}`;
  const hasNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleNativeShare = async () => {
    if (!hasNativeShare) {
      await fallbackCopyLink();
      return;
    }
    try {
      await navigator.share({
        title: 'Chess DNA',
        text: shareText,
        url: siteUrl,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      // Some desktop browsers expose navigator.share but throw on invocation —
      // fall back to clipboard so the user still gets the message.
      await fallbackCopyLink();
    }
  };

  const fallbackCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore — clipboard may be blocked in non-secure contexts.
    }
  };

  // Per-platform deep links — kept as secondary options for users who'd rather
  // skip the native sheet and fire-and-forget into a specific app.
  const platformLinks = [
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
      url: `https://t.me/share/url?url=${encodeURIComponent(siteUrl)}&text=${encodeURIComponent(shareText)}`,
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
  ];

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Primary share — always tries the OS sheet first. */}
      <button
        onClick={handleNativeShare}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-chess-accent/15 text-chess-accent hover:bg-chess-accent/25 transition-colors font-bold text-[13px]"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        {copied ? '✓ Copied' : 'Share'}
      </button>
      <div className="flex items-center justify-center gap-3">
        {platformLinks.map((link) => (
          <button
            key={link.name}
            onClick={() => window.open(link.url, '_blank', 'width=600,height=400')}
            className={`flex flex-col items-center gap-1 text-gray-500 ${link.color} transition-colors p-2 rounded-lg hover:bg-white/5`}
            title={link.name}
          >
            {link.icon}
            <span className="text-[11px]">{link.name}</span>
          </button>
        ))}
        <button
          onClick={fallbackCopyLink}
          className="flex flex-col items-center gap-1 text-gray-500 hover:text-chess-accent transition-colors p-2 rounded-lg hover:bg-white/5"
          title={t('compare_copy_link')}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span className="text-[11px]">{t('compare_copy_link')}</span>
        </button>
      </div>
    </div>
  );
}

function DimensionRow({ label, myScore, friendScore, delta, theme }: {
  label: string;
  myScore: number;
  friendScore: number;
  delta: number;
  theme: 'dark' | 'light';
}) {
  void theme; // Theme-aware colours moved to inline tokens; kept in props for future tweaks.
  return (
    <div className="flex items-center gap-3 px-1 py-2 border-b border-chess-border/15 last:border-b-0">
      <span className="flex-1 text-[13px] text-chess-text font-medium truncate">{label}</span>
      <span className="text-sm font-bold text-chess-text tabular-nums">{myScore}</span>
      <span className="text-[11px] text-chess-text-tertiary uppercase tracking-wider">vs</span>
      <span className="text-sm font-bold text-chess-text-secondary tabular-nums">{friendScore}</span>
      <span
        className={`text-sm font-extrabold w-12 text-end tabular-nums ${
          delta > 0
            ? 'text-chess-accent'
            : delta < 0
              ? 'text-chess-blunder'
              : 'text-chess-text-tertiary'
        }`}
      >
        {delta > 0 ? '+' : ''}{delta}
      </span>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   SideScoreCard — large 2-column YOU / OPP cards used at the top of the
   comparison results (per Claude Design). Big white number for "you",
   tier-colored number for the opponent, with a decorative checkbox in
   the top-left and flag/tier line below.
   ────────────────────────────────────────────────────────────────────── */
function SideScoreCard({
  label,
  score,
  elo,
  flag,
  theme,
  isMe = false,
}: {
  label: string;
  score: number;
  elo: number;
  flag?: string;
  theme: 'dark' | 'light';
  isMe?: boolean;
}) {
  const { t } = useT();
  const tier = getTierForScore(score);
  const tierColor = getTierColor(tier, theme);

  return (
    <div
      className="rounded-xl p-3 relative"
      style={{
        background: 'rgb(var(--chess-surface))',
        border: isMe
          ? '1px solid rgba(74,222,128,0.45)'
          : '1px solid rgba(96,165,250,0.45)',
      }}
    >
      {/* Decorative checkbox top-start */}
      <span
        className="absolute top-2 start-2 w-3 h-3 rounded-[3px] border block"
        style={{
          borderColor: isMe ? 'rgba(74,222,128,0.6)' : 'rgba(96,165,250,0.6)',
          background: isMe ? 'rgba(74,222,128,0.18)' : 'rgba(96,165,250,0.18)',
        }}
      />
      <div className="text-center">
        <div className="flex items-center justify-center gap-1 text-[11px] font-extrabold tracking-[1.6px] uppercase mb-1">
          {flag && <span className="text-base leading-none">{flag}</span>}
          <span
            className="truncate max-w-[110px]"
            style={{ color: isMe ? 'rgb(var(--chess-accent))' : '#60a5fa' }}
          >
            {label}
          </span>
        </div>
        <div
          className="text-[40px] font-black tabular-nums leading-none tracking-[-0.03em]"
          style={{
            color: isMe ? 'rgb(var(--chess-text))' : tierColor,
            filter: isMe ? 'none' : `drop-shadow(0 0 12px ${tierColor}55)`,
          }}
        >
          {score}
        </div>
        <div className="text-[11px] text-chess-text-tertiary mt-1.5 tabular-nums">
          {elo} <span className="mx-1">{'·'}</span>
          <span className="inline-flex items-center gap-0.5">
            <span>{tier.icon}</span> {translateTierName(tier.id, t)}
          </span>
        </div>
      </div>
    </div>
  );
}
