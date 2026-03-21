import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChessData } from '@/contexts/ChessDataContext';
import type { GameRecord, TimeClass } from '@shared/types/game';

interface RecentGamesProps {
  timeClassFilter?: TimeClass | null;
}

export default function RecentGames({ timeClassFilter }: RecentGamesProps = {}) {
  const { allGames: rawGames, gamesLoading: loading } = useChessData();
  const navigate = useNavigate();

  const allGames = useMemo(() => [...rawGames].sort((a, b) => b.playedAt - a.playedAt), [rawGames]);
  const gamesList = useMemo(
    () => timeClassFilter ? allGames.filter((g) => g.timeClass === timeClassFilter) : allGames,
    [allGames, timeClassFilter],
  );

  if (loading) {
    return <div className="text-gray-400">Loading games...</div>;
  }

  if (gamesList.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-4">&#9812;</div>
        <h2 className="text-xl mb-2">No Games Yet</h2>
        <p className="text-gray-400 text-sm">
          Import your chess.com games from Settings and they will appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Recent Games</h2>
      <div className="space-y-2">
        {gamesList.map((game) => (
          <GameRow key={game.id} game={game} onClick={() => navigate(`/games/${game.id}`)} />
        ))}
      </div>
    </div>
  );
}

function GameRow({ game, onClick }: { game: GameRecord; onClick: () => void }) {
  const date = new Date(game.playedAt);
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const resultColor =
    game.player.result === 'win'
      ? 'text-chess-accent'
      : game.player.result === 'loss'
        ? 'text-chess-blunder'
        : 'text-gray-400';

  return (
    <div
      onClick={onClick}
      className="bg-chess-surface rounded-lg p-4 flex items-center justify-between hover:bg-chess-border/30 transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-4">
        {/* Result indicator */}
        <div
          className={`w-1 h-10 rounded-full ${
            game.player.result === 'win'
              ? 'bg-chess-accent'
              : game.player.result === 'loss'
                ? 'bg-chess-blunder'
                : 'bg-gray-500'
          }`}
        />

        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">
              vs {game.opponent.username}
            </span>
            <span className="text-xs text-gray-400">
              ({game.opponent.rating})
            </span>
            <span className={`text-sm font-bold ${resultColor}`}>
              {game.player.result.toUpperCase()}
            </span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {game.opening.name || 'Unknown'} &middot; {game.totalMoves} moves &middot;{' '}
            {game.timeClass} &middot; {dateStr}
          </div>
        </div>
      </div>

      <div className="text-right">
        {game.analysisStatus === 'complete' ? (
          <span className="text-xs bg-chess-accent/20 text-chess-accent px-2 py-1 rounded">
            Analyzed
          </span>
        ) : game.analysisStatus === 'analyzing' ? (
          <span className="text-xs bg-chess-inaccuracy/20 text-chess-inaccuracy px-2 py-1 rounded">
            Analyzing...
          </span>
        ) : (
          <span className="text-xs bg-gray-600/50 text-gray-400 px-2 py-1 rounded">
            Pending
          </span>
        )}
      </div>
    </div>
  );
}
