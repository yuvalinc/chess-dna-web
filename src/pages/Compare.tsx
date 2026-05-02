import { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useChessData } from '@/contexts/ChessDataContext';
import { useTheme } from '@/components/ThemeContext';
import { useT } from '@/i18n/index';
import FriendCompare from '@/components/FriendCompare';
import {
  fetchLeaderboard,
  fetchPlayerCountry,
  extractCountryCode,
  countryToFlag,
  type LeaderboardPlayer,
} from '@/api/chess-com-leaderboard';
import { prefetchAvatars, getCachedCountry } from '@/api/chess-com-avatar';

type DiscoverTab = 'opponents' | 'international' | 'country';
type LeaderboardTimeClass = 'live_blitz' | 'live_rapid' | 'live_bullet';

/**
 * Compare page — pick a player at the top, comparison appears below.
 * Everything above the fold.
 */
export default function Compare() {
  const { allGames } = useChessData();
  const { settings } = useTheme();
  const { t } = useT();
  const location = useLocation();
  const navState = location.state as { autoCompare?: string } | null;

  // Derive username from settings or from game data as fallback
  const chesscomUsername = settings.chesscomUsername
    ?? (allGames.length > 0 ? allGames[0].player?.username : null)
    ?? null;

  // Auto-load last compared player from localStorage
  const lastCompared = useMemo(() => {
    try { return localStorage.getItem('chess-dna-last-compare') || null; } catch { return null; }
  }, []);

  const [compareTarget, setCompareTarget] = useState<string | null>(navState?.autoCompare ?? lastCompared);
  const [discoverTab, setDiscoverTab] = useState<DiscoverTab>('opponents');
  // Use the global time class filter from AppShell dropdown
  const gameType = settings.selectedTimeClass ?? 'all';

  // Merge saved friends + top opponents into one deduplicated list
  const savedFriends = useMemo(() => {
    try {
      const stored = localStorage.getItem('chess-dna-friends');
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch { return []; }
  }, []);

  const topOpponents = useMemo(() => {
    const counts: Record<string, { username: string; rating: number; count: number }> = {};
    for (const g of allGames) {
      // Filter by selected game type
      if (gameType !== 'all' && g.timeClass !== gameType) continue;
      const opp = g.opponent?.username;
      if (!opp) continue;
      const key = opp.toLowerCase();
      if (!counts[key]) counts[key] = { username: opp, rating: g.opponent.rating ?? 0, count: 0 };
      counts[key].count++;
      // Keep the most recent rating
      if (g.opponent.rating) counts[key].rating = g.opponent.rating;
    }
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [allGames, gameType]);

  const quickCompareList = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ username: string; rating?: number; count?: number }> = [];
    for (const name of savedFriends) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const opp = topOpponents.find(o => o.username.toLowerCase() === key);
      list.push({ username: name, rating: opp?.rating, count: opp?.count });
    }
    for (const opp of topOpponents) {
      if (seen.has(opp.username.toLowerCase())) continue;
      seen.add(opp.username.toLowerCase());
      list.push({ username: opp.username, rating: opp.rating, count: opp.count });
    }
    return list;
  }, [savedFriends, topOpponents]);

  const handleComparePlayer = (username: string) => {
    setCompareTarget(username);
    try { localStorage.setItem('chess-dna-last-compare', username); } catch { /* ignore */ }
  };

  const dtClass = (tab: DiscoverTab) =>
    `px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
      discoverTab === tab ? 'bg-chess-accent/15 text-chess-accent' : 'text-gray-500 hover:text-gray-300'
    }`;

  // Prefetch country flags for the opponents list so chips show flags as
  // soon as chess.com profile data arrives.
  useEffect(() => {
    const names = quickCompareList.map((x) => x.username);
    if (names.length > 0) prefetchAvatars(names);
  }, [quickCompareList]);

  return (
    <div className="max-w-[800px] mx-auto">
      <h1 className="text-lg font-black text-chess-text mb-1">{t('compare_title')}</h1>

      {/* ── TOP: Pick a player (discover tabs + quick list) ──
           The single username input lives inside <FriendCompare /> below,
           so we don't double up. */}
      <div className="mb-3" data-tutorial-target="compare-pick">
        <div className="flex gap-1 mb-2">
          <button onClick={() => setDiscoverTab('opponents')} className={dtClass('opponents')}>{t('compare_players')}</button>
          <button onClick={() => setDiscoverTab('international')} className={dtClass('international')}>{t('compare_international')}</button>
          <button onClick={() => setDiscoverTab('country')} className={dtClass('country')}>{t('compare_top_country')}</button>
        </div>

        {discoverTab === 'opponents' && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 md:flex-wrap md:overflow-x-visible" style={{ scrollbarWidth: 'none' }}>
            {quickCompareList.map((item) => (
              <OpponentChip
                key={item.username}
                username={item.username}
                rating={item.rating}
                count={item.count}
                active={compareTarget === item.username}
                onClick={() => handleComparePlayer(item.username)}
              />
            ))}
          </div>
        )}

        {(discoverTab === 'international' || discoverTab === 'country') && (
          <LeaderboardList
            chesscomUsername={chesscomUsername}
            showCountryOnly={discoverTab === 'country'}
            onCompare={handleComparePlayer}
            gameType={gameType}
          />
        )}
      </div>

      {/* ── MAIN: FriendCompare always renders so its input serves as the
           single search box; without a compareTarget it just sits idle. ──
           Wrapped in two markers (`compare-result` for the radar/side-by-side,
           `compare-diff` for the per-skill diff) so the tutorial coachmark
           can spotlight progressively. Since both currently point to the
           same wrapper, the tooltip text differs but the spotlight matches —
           good enough until FriendCompare exposes finer hooks. */}
      <div data-tutorial-target="compare-result">
        <div data-tutorial-target="compare-diff">
          <FriendCompare
            key={`${compareTarget ?? 'empty'}-${gameType}`}
            initialCompareUsername={compareTarget}
            timeClass={gameType}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Single opponent chip with flag prefix ── */

function OpponentChip({
  username,
  rating,
  count,
  active,
  onClick,
}: {
  username: string;
  rating?: number;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  // Re-render when the cached country lands (fetched via prefetchAvatars).
  const [, tick] = useState(0);
  const code = getCachedCountry(username);
  useEffect(() => {
    if (code !== undefined) return;
    const id = setInterval(() => {
      if (getCachedCountry(username) !== undefined) {
        tick((n) => n + 1);
        clearInterval(id);
      }
    }, 250);
    return () => clearInterval(id);
  }, [username, code]);
  const flag = code ? countryToFlag(code) : '';

  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-lg px-2.5 py-1.5 border text-left transition-all text-xs ${
        active
          ? 'border-chess-accent/50 bg-chess-accent/10 text-chess-accent font-bold'
          : 'border-chess-border/20 bg-chess-surface hover:border-chess-accent/40 text-chess-text'
      }`}
    >
      {flag && <span className="me-1">{flag}</span>}
      <span className="font-bold">{username}</span>
      {rating ? <span className="text-gray-500 ml-1">{rating}</span> : null}
      {count && count > 1 ? <span className="text-gray-600 ml-1">{count}g</span> : null}
    </button>
  );
}

/* ── Leaderboard List (compact) ── */

function LeaderboardList({
  chesscomUsername,
  showCountryOnly,
  onCompare,
  gameType,
}: {
  chesscomUsername: string | null;
  showCountryOnly: boolean;
  onCompare: (username: string) => void;
  gameType: string;
}) {
  // Map the global game type filter to leaderboard time class
  const timeClass: LeaderboardTimeClass = gameType === 'bullet' ? 'live_bullet' : gameType === 'rapid' ? 'live_rapid' : 'live_blitz';
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [userCountry, setUserCountry] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [leaderboard, country] = await Promise.all([
          fetchLeaderboard(),
          chesscomUsername ? fetchPlayerCountry(chesscomUsername) : Promise.resolve(''),
        ]);
        if (cancelled) return;
        setPlayers(leaderboard[timeClass] ?? []);
        setUserCountry(country);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [timeClass, chesscomUsername]);

  const displayPlayers = useMemo(() => {
    if (showCountryOnly && userCountry) {
      return players.filter(p => extractCountryCode(p.country) === userCountry);
    }
    return players;
  }, [players, showCountryOnly, userCountry]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-3 justify-center">
        <div className="w-3 h-3 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" />
        <span className="text-xs">Loading...</span>
      </div>
    );
  }

  if (error) return <div className="text-chess-blunder text-xs py-2">{error}</div>;

  if (showCountryOnly && !chesscomUsername) {
    return <p className="text-xs text-gray-500 py-2">Set your chess.com username in Settings to see top players in your country.</p>;
  }

  if (showCountryOnly && !userCountry) {
    return <p className="text-xs text-gray-500 py-2">Could not detect your country from chess.com profile.</p>;
  }

  if (showCountryOnly && displayPlayers.length === 0) {
    return <p className="text-xs text-gray-500 py-2">{countryToFlag(userCountry)} No players from your country in the global top 50 for this time class. The chess.com leaderboard only includes the world&apos;s top 50 players.</p>;
  }

  return (
    <div>
      {showCountryOnly && userCountry && (
        <p className="text-xs text-gray-500 mb-1">{countryToFlag(userCountry)} From your country in the global top 50</p>
      )}

      {/* Compact horizontal scrollable list */}
      <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
        {displayPlayers.slice(0, 20).map((p, i) => {
          const flag = countryToFlag(extractCountryCode(p.country));
          return (
            <button
              key={p.username}
              onClick={() => onCompare(p.username)}
              className="shrink-0 rounded-lg px-2.5 py-1.5 border border-chess-border/20 bg-chess-surface hover:border-chess-accent/40 transition-all text-left text-xs"
            >
              <div className="flex items-center gap-1">
                <span className="text-gray-500 tabular-nums">{p.rank || i + 1}.</span>
                {p.title && <span className="font-bold text-chess-accent">{p.title}</span>}
                <span className="font-bold text-chess-text">{flag} {p.name || p.username}</span>
              </div>
              <div className="text-gray-500 tabular-nums">{p.score}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
