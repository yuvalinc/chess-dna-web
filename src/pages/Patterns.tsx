import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ThemedChessboard from '@/components/ThemedChessboard';
import { useChessData } from '@/contexts/ChessDataContext';
import type { WeaknessPattern, PatternExample } from '@shared/types/patterns';
import type { GameRecord } from '@shared/types/game';
import { getThemeLabel, getThemeDescription, getThemeActionItems } from '@/patterns/pattern-engine';

export default function Patterns() {
  const navigate = useNavigate();
  const {
    patterns,
    games,
    gamesMap,
    filteredAnalyzedCount: analyzedCount,
    filteredAnalyzingCount,
  } = useChessData();
  const pendingCount = games.length - analyzedCount - filteredAnalyzingCount;

  const [expandedPatternId, setExpandedPatternId] = useState<string | null>(null);

  if (!patterns || patterns.patterns.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-4">&#128269;</div>
        <h2 className="text-xl mb-2">Building Your Profile</h2>
        <p className="text-gray-400 text-sm max-w-md mx-auto">
          {analyzedCount === 0
            ? 'Play a game on chess.com to start your personalized training. Your tutor will analyze each game and identify your specific weaknesses.'
            : pendingCount > 0
              ? `Analyzing ${pendingCount} game${pendingCount !== 1 ? 's' : ''}... Your tutor is studying your play to find patterns.`
              : `${analyzedCount} game${analyzedCount !== 1 ? 's' : ''} analyzed so far. Keep playing to let your tutor identify recurring patterns in your play.`}
        </p>
        {analyzedCount > 0 && (
          <div className="mt-6 bg-chess-surface rounded-lg p-4 max-w-sm mx-auto text-left">
            <div className="text-xs text-gray-400 mb-2">Analysis Progress</div>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-chess-muted rounded-full h-2">
                <div
                  className="bg-chess-accent rounded-full h-2 transition-all"
                  style={{ width: `${Math.min(100, (analyzedCount / Math.max(3, games.length)) * 100)}%` }}
                />
              </div>
              <span className="text-sm text-chess-text-secondary">{analyzedCount} / {games.length}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl font-bold">Your Weakness Patterns</h2>
          <span className="text-sm text-gray-400">
            Based on {patterns.gamesInWindow} game{patterns.gamesInWindow !== 1 ? 's' : ''}
          </span>
        </div>
        <p className="text-sm text-gray-400">
          Your tutor has identified these recurring themes in your play.
          Click a pattern to see a detailed breakdown with game examples and an improvement plan.
        </p>
      </div>

      {/* Pattern list */}
      <div className="space-y-3">
        {patterns.patterns.map((pattern, index) => (
          <PatternCard
            key={pattern.id}
            pattern={pattern}
            rank={index + 1}
            isExpanded={expandedPatternId === pattern.id}
            onToggle={() =>
              setExpandedPatternId(
                expandedPatternId === pattern.id ? null : pattern.id,
              )
            }
            gamesMap={gamesMap}
            onNavigateToGame={(gameId, moveIndex) => navigate(`/games/${gameId}`, { state: { moveIndex } })}
          />
        ))}
      </div>

    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Pattern Card (collapsed + expanded)                        */
/* ──────────────────────────────────────────────────────────── */

interface PatternCardProps {
  pattern: WeaknessPattern;
  rank: number;
  isExpanded: boolean;
  onToggle: () => void;
  gamesMap: Record<string, GameRecord>;
  onNavigateToGame: (gameId: string, moveIndex?: number) => void;
}

function PatternCard({
  pattern,
  rank,
  isExpanded,
  onToggle,
  gamesMap,
  onNavigateToGame,
}: PatternCardProps) {
  const trendLabel =
    pattern.trend === 'improving'
      ? 'Improving'
      : pattern.trend === 'worsening'
        ? 'Getting worse'
        : 'Stable';

  const trendArrow =
    pattern.trend === 'improving' ? '\u2198' : pattern.trend === 'worsening' ? '\u2197' : '\u2192';

  const severityColor =
    pattern.severity > 150
      ? 'text-chess-blunder'
      : pattern.severity > 80
        ? 'text-chess-mistake'
        : 'text-chess-inaccuracy';

  const impactScore = Math.min(100, (pattern.severity * pattern.frequency) / 3);

  return (
    <div className="bg-chess-surface rounded-lg overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        onClick={onToggle}
        className="w-full text-left p-4 hover:bg-chess-muted/40 transition-colors"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span
              className="text-[9px] font-bold w-5 h-5 rounded-full flex items-center justify-center border bg-chess-muted/50 text-gray-400 border-chess-border/40"
            >
              {rank}
            </span>
            <div>
              <h3 className="font-medium text-chess-text text-base">
                {getThemeLabel(pattern.theme)}
              </h3>
              <div className="flex items-center gap-3 mt-0.5">
                {pattern.phase && (
                  <span className="text-xs text-gray-500 capitalize">{pattern.phase}</span>
                )}
                <span className="text-xs text-gray-500">
                  {pattern.frequency.toFixed(1)}/game · ~{pattern.severity} cp
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Trend — neutral */}
            <div className="text-sm text-gray-500 flex items-center gap-1">
              <span>{trendArrow}</span>
              <span className="text-xs">{trendLabel}</span>
            </div>
            {/* Expand chevron */}
            <span
              className={`text-gray-500 transition-transform duration-200 ${
                isExpanded ? 'rotate-180' : ''
              }`}
            >
              &#9660;
            </span>
          </div>
        </div>

        {/* Impact bar — compact */}
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-14">Impact</span>
            <div className="flex-1 bg-chess-muted rounded-full h-1.5">
              <div
                className="rounded-full h-1.5 transition-all bg-gray-500"
                style={{ width: `${impactScore}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 w-8 text-right">
              {Math.round(impactScore)}%
            </span>
          </div>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-chess-border/30">
          {/* ---- What this means ---- */}
          <div className="p-4 pb-3">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              What this means
            </h4>
            <p className="text-sm text-chess-text-secondary leading-relaxed">
              {getThemeDescription(pattern.theme)}
            </p>
          </div>

          {/* ---- Stats detail ---- */}
          <div className="px-4 pb-4">
            <div className="grid grid-cols-4 gap-3">
              <MiniStat label="Total occurrences" value={String(pattern.occurrences)} />
              <MiniStat label="Games affected" value={String(pattern.gamesAffected)} />
              <MiniStat label="Avg CP loss" value={String(pattern.severity)} color={severityColor} />
              <MiniStat label="Per game" value={pattern.frequency.toFixed(1)} />
            </div>
          </div>

          {/* ---- Trend detail ---- */}
          <div className="px-4 pb-4">
            <TrendSection pattern={pattern} />
          </div>

          {/* ---- Game examples ---- */}
          {pattern.examplePositions.length > 0 && (
            <div className="px-4 pb-4">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                From your games
              </h4>
              <div className="space-y-2">
                {pattern.examplePositions.slice(0, 5).map((ex, i) => (
                  <GameExampleRow
                    key={`${ex.gameId}-${ex.moveIndex}-${i}`}
                    example={ex}
                    game={gamesMap[ex.gameId]}
                    onNavigateToGame={onNavigateToGame}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ---- Action items ---- */}
          <div className="px-4 pb-4">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              How to improve
            </h4>
            <div className="space-y-2">
              {getThemeActionItems(pattern.theme).map((action, i) => (
                <ActionItem key={i} action={action} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Sub-components                                             */
/* ──────────────────────────────────────────────────────────── */

function MiniStat({
  label,
  value,
  color = 'text-chess-text',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-chess-bg/50 rounded-md p-2">
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function TrendSection({ pattern }: { pattern: WeaknessPattern }) {
  const trendColor =
    pattern.trend === 'improving'
      ? 'text-chess-best'
      : pattern.trend === 'worsening'
        ? 'text-chess-blunder'
        : 'text-gray-400';

  const trendBg =
    pattern.trend === 'improving'
      ? 'bg-chess-best/10 border-chess-best/20'
      : pattern.trend === 'worsening'
        ? 'bg-chess-blunder/10 border-chess-blunder/20'
        : 'bg-chess-muted/50 border-chess-border/40';

  const trendMessage =
    pattern.trend === 'improving'
      ? `Good progress! This weakness is appearing ${pattern.trendPercent}% less frequently in your recent games compared to earlier ones. Keep focusing on it.`
      : pattern.trend === 'worsening'
        ? `This pattern is appearing ${pattern.trendPercent}% more frequently in your recent games. It needs attention — reviewing the examples below and working through exercises will help.`
        : 'This pattern is relatively stable across your recent games. Consistent practice will help bring it down.';

  return (
    <div className={`rounded-lg p-3 border ${trendBg}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-sm font-medium ${trendColor}`}>
          {pattern.trend === 'improving'
            ? 'Trending down'
            : pattern.trend === 'worsening'
              ? 'Trending up'
              : 'Holding steady'}
        </span>
        {pattern.trendPercent > 0 && (
          <span className={`text-xs ${trendColor} opacity-70`}>
            ({pattern.trend === 'improving' ? '-' : '+'}{pattern.trendPercent}%)
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400 leading-relaxed">{trendMessage}</p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Game example row — shows board thumbnail + move info       */
/* ──────────────────────────────────────────────────────────── */

interface GameExampleRowProps {
  example: PatternExample;
  game?: GameRecord;
  onNavigateToGame: (gameId: string, moveIndex?: number) => void;
}

function GameExampleRow({ example, game, onNavigateToGame }: GameExampleRowProps) {
  const [showBoard, setShowBoard] = useState(false);

  const handleNavigate = () => {
    onNavigateToGame(example.gameId, example.moveIndex);
  };

  const qualityLabel =
    example.cpLoss >= 200 ? 'Blunder' : example.cpLoss >= 80 ? 'Mistake' : 'Inaccuracy';
  const qualityColor =
    example.cpLoss >= 200
      ? 'text-chess-blunder'
      : example.cpLoss >= 80
        ? 'text-chess-mistake'
        : 'text-chess-inaccuracy';
  const qualityBg =
    example.cpLoss >= 200
      ? 'bg-chess-blunder/10'
      : example.cpLoss >= 80
        ? 'bg-chess-mistake/10'
        : 'bg-chess-inaccuracy/10';

  const opponentName = game?.opponent?.username ?? 'Unknown';
  const gameDate = game ? new Date(game.playedAt).toLocaleDateString() : '';

  return (
    <div className={`rounded-lg ${qualityBg} overflow-hidden`}>
      {/* Main row */}
      <div className="flex items-center gap-3 p-2.5">
        {/* Toggle board preview */}
        <button
          onClick={() => setShowBoard(!showBoard)}
          className="w-8 h-8 rounded bg-chess-surface flex items-center justify-center text-gray-400 hover:text-chess-text transition-colors shrink-0"
          title={showBoard ? 'Hide board' : 'Show position'}
        >
          {showBoard ? '\u25B2' : '\u25BC'}
        </button>

        {/* Move info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${qualityColor}`}>{qualityLabel}</span>
            <span className="text-sm text-chess-text">
              played <span className="font-mono font-medium">{example.movePlayed}</span>
            </span>
            <span className="text-xs text-gray-500">
              instead of{' '}
              <span className="font-mono text-chess-accent">{example.bestMove}</span>
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            vs {opponentName} {gameDate && `\u00B7 ${gameDate}`} \u00B7 {example.cpLoss} cp lost
          </div>
        </div>

        {/* Navigate to game button */}
        <button
          onClick={handleNavigate}
          className="px-3 py-1.5 rounded-md bg-chess-accent/10 text-chess-accent text-xs font-medium hover:bg-chess-accent/20 transition-colors shrink-0"
          title="View this move in the game"
        >
          View in game &rarr;
        </button>
      </div>

      {/* Board preview — toggleable */}
      {showBoard && (
        <div className="px-2.5 pb-2.5">
          <div className="flex gap-3 items-start">
            <div className="w-[180px] shrink-0">
              <ThemedChessboard
                position={example.fen}
                boardWidth={180}
                arePiecesDraggable={false}
              />
            </div>
            <div className="flex-1 text-xs text-gray-400 pt-1 space-y-1.5">
              <div>
                <span className="text-gray-500">Position before the mistake.</span>
              </div>
              <div>
                <span className="text-gray-500">You played</span>{' '}
                <span className={`font-mono font-medium ${qualityColor}`}>{example.movePlayed}</span>
              </div>
              <div>
                <span className="text-gray-500">Best was</span>{' '}
                <span className="font-mono font-medium text-chess-accent">{example.bestMove}</span>
              </div>
              <div>
                <span className="text-gray-500">Cost:</span>{' '}
                <span className={`font-medium ${qualityColor}`}>{example.cpLoss} centipawns</span>
              </div>
              <button
                onClick={handleNavigate}
                className="mt-2 px-3 py-1.5 rounded-md bg-chess-accent text-chess-bg text-xs font-medium hover:brightness-110 transition-all inline-block"
              >
                Open game at this move &rarr;
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Action Item                                                 */
/* ──────────────────────────────────────────────────────────── */

function ActionItem({
  action,
}: {
  action: { text: string; type: 'lesson' | 'exercise' | 'tip' };
}) {
  const iconMap = {
    lesson: '\uD83D\uDCD6',
    exercise: '\uD83C\uDFAF',
    tip: '\uD83D\uDCA1',
  };

  const labelMap = {
    lesson: 'Lesson',
    exercise: 'Exercise',
    tip: 'Quick Tip',
  };

  const colorMap = {
    lesson: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    exercise: 'bg-chess-accent/10 text-chess-accent border-chess-accent/20',
    tip: 'bg-chess-inaccuracy/10 text-chess-inaccuracy border-chess-inaccuracy/20',
  };

  return (
    <div className="flex items-start gap-3 p-2.5 rounded-lg bg-chess-bg/50 hover:bg-chess-bg/80 transition-colors">
      <span className="text-base mt-0.5">{iconMap[action.type]}</span>
      <div className="flex-1">
        <div className="text-sm text-gray-200">{action.text}</div>
        <span
          className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full border ${colorMap[action.type]}`}
        >
          {labelMap[action.type]}
        </span>
      </div>
    </div>
  );
}
