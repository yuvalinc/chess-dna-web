import { useState, useCallback, useMemo } from 'react';
import SkillRadar from './SkillRadar';
import { useChessData } from '@/contexts/ChessDataContext';
import { useTheme } from './ThemeContext';
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

export default function FriendCompare() {
  const { profile, playerElo } = useChessData();
  const { theme, settings } = useTheme();
  const [username, setUsername] = useState('');
  const [friend, setFriend] = useState<FriendProfile | null>(null);
  const [progress, setProgress] = useState<FriendAnalysisProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedFriends, setSavedFriends] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('chess-dna-friends');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const isLoading = progress !== null && progress.phase !== 'done' && progress.phase !== 'error';

  const saveFriend = useCallback((target: string) => {
    setSavedFriends(prev => {
      const updated = [target, ...prev.filter(f => f.toLowerCase() !== target.toLowerCase())].slice(0, 5);
      localStorage.setItem('chess-dna-friends', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleCompare = useCallback(async (name?: string, forceRefresh = false) => {
    const target = (name ?? username).trim();
    if (!target) return;
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

    setProgress({ phase: 'fetching', current: 0, total: 0, message: `Fetching ${target}'s games...` });

    try {
      const result = await fetchFriendProfile(
        target,
        'all',
        15,
        settings.analysisDepth ? Math.min(settings.analysisDepth, 14) : 14,
        setProgress,
      );
      setFriend(result);
      cacheFriendProfile(result);
      trackEvent(Events.FRIEND_COMPARED, { friend: target, gamesAnalyzed: result.gamesAnalyzed, cached: false });
      saveFriend(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze friend');
      setProgress(null);
    }
  }, [username, settings.analysisDepth, saveFriend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCompare();
  };

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="chess.com username"
          className="flex-1 bg-chess-surface border border-chess-border/30 rounded-lg px-3 py-2 text-sm text-chess-text placeholder:text-gray-500 focus:outline-none focus:border-chess-accent/50"
          disabled={isLoading}
        />
        <button
          onClick={() => handleCompare()}
          disabled={isLoading || !username.trim()}
          className="bg-chess-accent text-white px-4 py-2 rounded-lg text-sm font-medium hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Compare
        </button>
      </div>

      {/* Saved friends chips */}
      {savedFriends.length > 0 && !friend && (
        <div className="flex flex-wrap gap-1.5">
          {savedFriends.map(name => (
            <button
              key={name}
              onClick={() => { setUsername(name); handleCompare(name); }}
              disabled={isLoading}
              className="px-2.5 py-1 rounded-full bg-chess-surface border border-chess-border/20 text-xs text-chess-text-secondary hover:border-chess-accent/40 transition-all disabled:opacity-40"
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Progress indicator */}
      {isLoading && progress && (
        <div className="bg-chess-surface rounded-lg p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-4 h-4 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-chess-text">{progress.message}</span>
          </div>
          {progress.phase === 'analyzing' && progress.total > 0 && (
            <div className="w-full bg-chess-border/20 rounded-full h-1.5 mt-2">
              <div
                className="bg-chess-accent h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          )}
          <p className="text-[10px] text-gray-500 mt-2">
            This may take a few minutes — Stockfish is analyzing each game
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
          theme={theme}
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
  theme,
  onRefresh,
  onReset,
}: {
  profile: import('@shared/types/patterns').SkillProfile;
  friend: FriendProfile | CachedFriendProfile;
  playerElo: number;
  theme: 'dark' | 'light';
  onRefresh: () => void;
  onReset: () => void;
}) {
  // Build benchmarks from friend's dimensions for overlay radar
  const friendBenchmarks = useMemo(() => {
    const map: Record<string, number> = {};
    for (const dim of friend.skillProfile.dimensions) {
      map[dim.id] = dim.score;
    }
    return map;
  }, [friend.skillProfile.dimensions]);

  const isCached = 'cachedAt' in friend;
  const tier = getTierForScore(profile.overallRating);
  const tierColor = getTierColor(tier, theme);

  return (
    <div className="space-y-4">
      {/* Score comparison header */}
      <div className="flex items-center justify-between bg-chess-surface rounded-lg p-3">
        <PlayerBadge label="You" score={profile.overallRating} elo={playerElo} theme={theme} />
        <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">vs</span>
        <PlayerBadge label={friend.username} score={friend.skillProfile.overallRating} elo={friend.elo} theme={theme} />
      </div>

      {/* Cache indicator */}
      {isCached && (
        <div className="flex items-center justify-between text-[10px] text-gray-500 px-1">
          <span>Last compared {formatTimeAgo((friend as CachedFriendProfile).cachedAt)}</span>
          <button onClick={onRefresh} className="text-chess-accent hover:underline font-medium">
            Refresh analysis
          </button>
        </div>
      )}

      {/* Overlay radar comparison */}
      <div className="flex flex-col items-center">
        {/* Legend */}
        <div className="flex items-center gap-5 mb-1">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: tierColor, opacity: 0.7 }} />
            <span className="text-[10px] text-chess-text-secondary font-medium">You</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0 border-t-2 border-dashed border-white/60 inline-block" />
            <span className="text-[10px] text-chess-text-secondary font-medium">{friend.username}</span>
          </div>
        </div>

        <SkillRadar
          profile={profile}
          benchmarks={friendBenchmarks}
          benchmarkLabel={friend.username}
          size={280}
          animated={false}
        />
      </div>

      {/* Dimension-by-dimension comparison */}
      <div className="space-y-1.5">
        <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Dimension Breakdown</h4>
        {profile.dimensions.map((dim, i) => {
          const friendDim = friend.skillProfile.dimensions[i];
          if (!friendDim) return null;
          const delta = dim.score - friendDim.score;
          return (
            <DimensionRow
              key={dim.id}
              label={dim.label}
              myScore={dim.score}
              friendScore={friendDim.score}
              delta={delta}
              theme={theme}
            />
          );
        })}
      </div>

      {/* Invite CTA */}
      <div className="bg-chess-surface/50 rounded-lg p-3 text-center border border-chess-border/20">
        <p className="text-xs text-gray-400 mb-2">
          Think {friend.username} would enjoy analyzing their chess DNA?
        </p>
        <InviteShareButtons friendName={friend.username} myScore={profile.overallRating} />
      </div>

      {/* Compare another */}
      <button
        onClick={onReset}
        className="text-xs text-gray-500 hover:text-chess-text transition-colors"
      >
        &larr; Compare another friend
      </button>
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function PlayerBadge({ label, score, elo, theme }: { label: string; score: number; elo: number; theme: 'dark' | 'light' }) {
  const tier = getTierForScore(score);
  const color = getTierColor(tier, theme);
  return (
    <div className="text-center">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-2xl font-black" style={{ color }}>{score}</div>
      <div className="text-[10px] text-gray-500">{tier.icon} {tier.name} · {elo}</div>
    </div>
  );
}

function InviteShareButtons({ friendName, myScore }: { friendName: string; myScore: number }) {
  const shareText = `Hey ${friendName}! I just analyzed my chess DNA — my score is ${myScore}. Want to compare? Check it out: https://chessdna.com`;

  const links = [
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
      name: 'Copy Link',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      ),
      color: 'hover:text-chess-accent',
      url: null,
    },
  ];

  const handleShare = (url: string | null) => {
    if (url) {
      window.open(url, '_blank', 'width=600,height=400');
    } else {
      navigator.clipboard.writeText(shareText);
    }
  };

  return (
    <div className="flex items-center justify-center gap-3">
      {links.map((link) => (
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
  );
}

function DimensionRow({ label, myScore, friendScore, delta, theme }: {
  label: string;
  myScore: number;
  friendScore: number;
  delta: number;
  theme: 'dark' | 'light';
}) {
  const myTier = getTierForScore(myScore);
  const friendTier = getTierForScore(friendScore);
  const myColor = getTierColor(myTier, theme);
  const friendColor = getTierColor(friendTier, theme);

  return (
    <div className="flex items-center gap-2 bg-chess-surface/50 rounded px-2.5 py-1.5">
      <span className="text-xs text-chess-text-secondary w-28 shrink-0 truncate">{label}</span>
      <span className="text-xs font-bold w-8 text-right" style={{ color: myColor }}>{myScore}</span>
      <div className="flex-1 relative h-1.5 bg-chess-border/20 rounded-full mx-1">
        <div
          className="absolute h-1.5 rounded-full"
          style={{ width: `${(myScore / 99) * 100}%`, backgroundColor: myColor, opacity: 0.6 }}
        />
        <div
          className="absolute h-1.5 rounded-full"
          style={{ width: `${(friendScore / 99) * 100}%`, backgroundColor: friendColor, opacity: 0.3 }}
        />
      </div>
      <span className="text-xs font-bold w-8 text-left" style={{ color: friendColor }}>{friendScore}</span>
      <span className={`text-[10px] font-bold w-8 text-right ${delta > 0 ? 'text-chess-accent' : delta < 0 ? 'text-chess-blunder' : 'text-gray-500'}`}>
        {delta > 0 ? '+' : ''}{delta}
      </span>
    </div>
  );
}
