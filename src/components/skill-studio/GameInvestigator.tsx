import { useState, useMemo } from 'react';
import { useChessData } from '@/contexts/ChessDataContext';
import ThemedChessboard from '@/components/ThemedChessboard';
import type { MoveAnalysis } from '@shared/types/analysis';
import type { DimensionConfig, MoveFilter } from '@shared/types/skill-config';
import { scoreMoveByBucket } from '@/patterns/skill-calculator';
import { DEFAULT_BUCKET_SCORES } from '@shared/constants';

// Dimension colors for the move list pills
const DIM_COLORS = [
  'bg-blue-500/20 text-blue-400',
  'bg-purple-500/20 text-purple-400',
  'bg-amber-500/20 text-amber-400',
  'bg-emerald-500/20 text-emerald-400',
  'bg-cyan-500/20 text-cyan-400',
  'bg-pink-500/20 text-pink-400',
  'bg-orange-500/20 text-orange-400',
  'bg-lime-500/20 text-lime-400',
  'bg-red-500/20 text-red-400',
  'bg-indigo-500/20 text-indigo-400',
];

const QUALITY_COLORS: Record<string, string> = {
  brilliant: 'text-teal-400',
  great: 'text-blue-400',
  best: 'text-green-400',
  excellent: 'text-green-300',
  good: 'text-chess-text',
  book: 'text-chess-text-secondary',
  forced: 'text-chess-text-disabled',
  inaccuracy: 'text-yellow-400',
  mistake: 'text-amber-400',
  miss: 'text-orange-400',
  blunder: 'text-red-400',
};

interface GameInvestigatorProps {
  dimensions: DimensionConfig[];
}

/** Check if a move matches ANY filter in a filter array */
function moveMatchesFilters(move: MoveAnalysis, filters: MoveFilter[]): boolean {
  if (filters.length === 0) return true;
  return filters.some((f) => {
    if (f.phases?.length && !f.phases.includes(move.phase)) return false;
    if (f.hasTactics === true && move.tacticalMotifs.length === 0) return false;
    if (f.hasTactics === false && move.tacticalMotifs.length > 0) return false;
    if (f.tacticalMotifs?.length && !f.tacticalMotifs.some((m) => move.tacticalMotifs.includes(m))) return false;
    if (f.evalRange) {
      if (move.evalBefore.scoreType !== 'cp') return false;
      const playerEval = move.color === 'white' ? move.evalBefore.score : -move.evalBefore.score;
      if (playerEval < f.evalRange.min || playerEval > f.evalRange.max) return false;
    }
    if (f.complexityRange) {
      if (move.legalMoveCount < f.complexityRange.min || move.legalMoveCount > f.complexityRange.max) return false;
    }
    if (f.excludeForced && move.legalMoveCount <= 1) return false;
    if (f.moveTypes?.length) {
      const has = f.moveTypes.some((t) =>
        t === 'capture' ? move.isCapture : t === 'check' ? move.isCheck : t === 'castling' ? move.isCastling : t === 'sacrifice' ? move.isSacrifice : false
      );
      if (!has) return false;
    }
    if (f.timeRange) {
      if (move.timeSpent == null) return false;
      if (move.timeSpent < f.timeRange.min || move.timeSpent > f.timeRange.max) return false;
    }
    return true;
  });
}

/** Find ALL dimensions a move belongs to (a move can match multiple skills) */
function classifyMove(move: MoveAnalysis, dimensions: DimensionConfig[]): { dimIndex: number; dimLabel: string }[] {
  const matches: { dimIndex: number; dimLabel: string }[] = [];
  for (let i = 0; i < dimensions.length; i++) {
    if (moveMatchesFilters(move, dimensions[i].filters)) {
      matches.push({ dimIndex: i, dimLabel: dimensions[i].label });
    }
  }
  return matches;
}

export default function GameInvestigator({ dimensions }: GameInvestigatorProps) {
  const { games, analyses } = useChessData();
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedMoveIdx, setSelectedMoveIdx] = useState(0);

  const recentGames = useMemo(
    () => games.filter((g) => g.analysisStatus === 'complete').sort((a, b) => b.playedAt - a.playedAt).slice(0, 30),
    [games],
  );

  const gameAnalysis = useMemo(
    () => selectedGameId ? analyses.find((a) => a.gameId === selectedGameId) ?? null : null,
    [selectedGameId, analyses],
  );

  const game = useMemo(
    () => selectedGameId ? games.find((g) => g.id === selectedGameId) ?? null : null,
    [selectedGameId, games],
  );

  const playerColor = game?.player.color ?? 'white';

  // Classify all player moves (multi-tag: each move can match multiple dimensions)
  const classifiedMoves = useMemo(() => {
    if (!gameAnalysis) return [];
    return gameAnalysis.moves
      .filter((m) => m.color === playerColor)
      .map((m) => ({
        move: m,
        dims: classifyMove(m, dimensions),
        bucketScore: scoreMoveByBucket(m.quality, DEFAULT_BUCKET_SCORES) ?? 0,
      }));
  }, [gameAnalysis, playerColor, dimensions]);

  // Per-dimension summary for this game (a move counts in every matching dimension)
  const dimSummary = useMemo(() => {
    const map: Record<string, { count: number; totalScore: number }> = {};
    for (const cm of classifiedMoves) {
      for (const d of cm.dims) {
        if (!map[d.dimLabel]) map[d.dimLabel] = { count: 0, totalScore: 0 };
        map[d.dimLabel].count++;
        map[d.dimLabel].totalScore += cm.bucketScore;
      }
    }
    return Object.entries(map).map(([label, s]) => ({
      label,
      count: s.count,
      avgScore: Math.round(s.totalScore / s.count),
    }));
  }, [classifiedMoves]);

  // Current FEN for chessboard
  const currentFen = classifiedMoves[selectedMoveIdx]?.move.fenAfter
    ?? classifiedMoves[selectedMoveIdx]?.move.fenBefore
    ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  return (
    <div className="flex flex-col h-full">
      {/* Game picker */}
      <div className="px-3 py-2 border-b border-chess-border/20">
        <select
          value={selectedGameId ?? ''}
          onChange={(e) => { setSelectedGameId(e.target.value || null); setSelectedMoveIdx(0); }}
          className="w-full bg-chess-overlay text-chess-text text-[10px] rounded px-2 py-1.5 border border-chess-border/30"
        >
          <option value="">Select a game to investigate...</option>
          {recentGames.map((g) => (
            <option key={g.id} value={g.id}>
              vs {g.opponent.username} ({g.opponent.rating}) · {g.player.result} · {g.timeClass} · {new Date(g.playedAt).toLocaleDateString()}
            </option>
          ))}
        </select>
      </div>

      {!selectedGameId ? (
        <div className="flex-1 flex items-center justify-center text-chess-text-disabled text-xs text-center px-4">
          Pick a game to see how each move gets classified into skill dimensions.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Chessboard */}
          <div className="flex justify-center py-3 px-2">
            <ThemedChessboard
              position={currentFen}
              boardWidth={220}
              arePiecesDraggable={false}
            />
          </div>

          {/* Dimension summary for this game */}
          {dimSummary.length > 0 && (
            <div className="px-3 pb-2 flex flex-wrap gap-1">
              {dimSummary.map((s) => (
                <span key={s.label} className="text-[8px] bg-chess-overlay px-1.5 py-0.5 rounded-full text-chess-text-secondary">
                  {s.label}: {s.count} moves · avg {s.avgScore}
                </span>
              ))}
            </div>
          )}

          {/* Classified move list */}
          <div className="px-2 pb-3 space-y-0.5">
            {classifiedMoves.map((cm, idx) => {
              const isSelected = idx === selectedMoveIdx;
              const qualColor = QUALITY_COLORS[cm.move.quality] ?? 'text-chess-text';
              const scoreColor = cm.bucketScore >= 80 ? 'text-green-400' : cm.bucketScore >= 50 ? 'text-chess-text' : cm.bucketScore >= 20 ? 'text-yellow-400' : 'text-red-400';

              return (
                <button
                  key={cm.move.halfMoveIndex}
                  onClick={() => setSelectedMoveIdx(idx)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left transition-colors ${
                    isSelected ? 'bg-chess-accent/10 border border-chess-accent/30' : 'hover:bg-chess-overlay/50 border border-transparent'
                  }`}
                >
                  <span className="text-[9px] text-chess-text-disabled w-5 shrink-0">{cm.move.moveNumber}.</span>
                  <span className="text-[10px] font-mono text-chess-text w-10 shrink-0">{cm.move.moveSan}</span>
                  <span className={`text-[8px] font-semibold capitalize ${qualColor} w-14 shrink-0`}>{cm.move.quality}</span>
                  <span className={`text-[9px] font-semibold ${scoreColor} w-6 shrink-0 text-right`}>{cm.bucketScore}</span>
                  <span className="flex flex-wrap gap-0.5 min-w-0">
                    {cm.dims.length > 0 ? cm.dims.map((d) => (
                      <span
                        key={d.dimIndex}
                        className={`text-[7px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${DIM_COLORS[d.dimIndex % DIM_COLORS.length]}`}
                      >
                        {d.dimLabel}
                      </span>
                    )) : (
                      <span className="text-[7px] text-chess-text-disabled px-1.5 py-0.5">—</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {classifiedMoves.length === 0 && gameAnalysis && (
            <div className="text-center text-chess-text-disabled text-xs py-8">No player moves found.</div>
          )}
        </div>
      )}
    </div>
  );
}
