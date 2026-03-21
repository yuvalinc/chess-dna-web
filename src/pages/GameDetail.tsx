import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import ThemedChessboard from '@/components/ThemedChessboard';
import EvalBar from '@/components/EvalBar';
import MoveList from '@/components/MoveList';
import { useChessData } from '@/contexts/ChessDataContext';
import { useTheme } from '@/components/ThemeContext';
import { useAudioPlayer } from '@/contexts/AudioPlayerContext';
import { runAnalysisPipeline } from '@/engine/analysis-pipeline';
import { useResponsiveBoardSize } from '@/hooks/useResponsiveBoardSize';
import { detectGamePatterns, getThemeDescription } from '@/patterns/pattern-engine';
import { hasAnyProvider } from '@/ai/ai-router';
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis, MoveAnalysis } from '@shared/types/analysis';

export default function GameDetail() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const initialMoveIndex = (location.state as { moveIndex?: number } | null)?.moveIndex;

  const { settings } = useTheme();
  const { state: audioState, controls: audioControls } = useAudioPlayer();

  const { allGames, gamesLoading: gameLoading, allAnalyses, analysesLoading: analysisLoading } = useChessData();
  const game = useMemo(() => allGames.find(g => g.id === gameId) ?? null, [allGames, gameId]);
  const analysis = useMemo(() => allAnalyses.find(a => a.gameId === gameId) ?? null, [allAnalyses, gameId]);

  const [currentMoveIndex, setCurrentMoveIndex] = useState(initialMoveIndex ?? 0);
  const [showBoard, setShowBoard] = useState(true);
  const { containerRef, boardSize } = useResponsiveBoardSize(300);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!analysis) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCurrentMoveIndex((prev) => Math.min(prev + 1, analysis.moves.length - 1));
        if (!showBoard) setShowBoard(true);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCurrentMoveIndex((prev) => Math.max(prev - 1, -1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setCurrentMoveIndex(-1);
      } else if (e.key === 'End') {
        e.preventDefault();
        setCurrentMoveIndex(analysis.moves.length - 1);
      }
    },
    [analysis, showBoard],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const gamePatterns = useMemo(() => {
    if (!analysis || !game) return [];
    return detectGamePatterns(analysis.moves, game.player.color, game.opening?.name ?? '');
  }, [analysis, game]);

  const keyMoments = useMemo(() => {
    if (!analysis || !game) return [];
    const playerMoves = analysis.moves.filter(m => m.color === game.player.color);

    const mistakes = playerMoves
      .filter(m => m.cpLoss > 30 && (m.quality === 'inaccuracy' || m.quality === 'mistake' || m.quality === 'miss' || m.quality === 'blunder'))
      .sort((a, b) => b.cpLoss - a.cpLoss)
      .slice(0, 3)
      .map(m => ({ ...m, momentType: 'mistake' as const }));

    const brilliants = playerMoves
      .filter(m => m.quality === 'brilliant' || m.quality === 'great')
      .map(m => ({ ...m, momentType: 'brilliant' as const }));

    return [...mistakes, ...brilliants].sort((a, b) => a.halfMoveIndex - b.halfMoveIndex);
  }, [analysis, game]);

  const hasKeyMoments = keyMoments.length > 0;
  const hasPatterns = gamePatterns.length > 0;
  const [insightTab, setInsightTab] = useState<'moments' | 'patterns'>(
    hasKeyMoments ? 'moments' : 'patterns',
  );
  const [selectedPatternIdx, setSelectedPatternIdx] = useState(0);
  const [selectedMomentIdx, setSelectedMomentIdx] = useState(0);

  useEffect(() => {
    if (!hasKeyMoments && hasPatterns) setInsightTab('patterns');
  }, [hasKeyMoments, hasPatterns]);

  if (gameLoading || analysisLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-8">
        <div className="w-4 h-4 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" />
        Loading game...
      </div>
    );
  }

  if (!game) {
    return (
      <div className="text-gray-400 py-8">
        <p>Game not found</p>
        <button onClick={() => navigate(-1)} className="text-chess-accent text-sm mt-2 hover:underline">
          &larr; Go back
        </button>
      </div>
    );
  }

  const currentFen =
    currentMoveIndex >= 0 && analysis
      ? analysis.moves[currentMoveIndex].fenAfter
      : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const currentMove: MoveAnalysis | undefined =
    currentMoveIndex >= 0 && analysis
      ? analysis.moves[currentMoveIndex]
      : undefined;

  const currentEval = currentMove?.evalAfter;
  const boardOrientation = game.player.color === 'black' ? 'black' : 'white';

  const requestAnalysis = async () => {
    if (!game || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      await runAnalysisPipeline(game.id, settings.analysisDepth ?? 18);
      window.location.reload();
    } catch (err) {
      console.error('[GameDetail] Analysis failed:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const jumpToMove = (moveIndex: number) => {
    setCurrentMoveIndex(moveIndex);
    setShowBoard(true);
  };

  const handleAudioGenerate = () => {
    if (!game || !analysis || audioState.isGenerating) return;
    audioControls.generateGameAndPlay(settings, game, analysis);
  };

  // Check if audio is already loaded for this game (for replay)
  const audioHasThisGame = !!(
    audioState.script &&
    audioState.script.source.type === 'game' &&
    audioState.script.source.gameId === gameId &&
    audioState.ttsData &&
    !audioState.isPlaying
  );

  const resultColors: Record<string, string> = {
    win: 'bg-chess-accent/12 text-chess-accent border-chess-accent/25',
    loss: 'bg-chess-blunder/12 text-chess-blunder border-chess-blunder/25',
    draw: 'bg-gray-500/12 text-gray-400 border-gray-500/25',
  };
  const resultClass = resultColors[game.player.result] ?? resultColors.draw;

  return (
    <div className="max-w-2xl mx-auto">
      {/* ── HEADER: back + result ── */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => navigate(-1)}
          className="text-gray-400 hover:text-chess-text transition-colors text-sm"
        >
          &larr;
        </button>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${resultClass}`}>
          {game.player.result.toUpperCase()}
        </span>
      </div>

      {/* ── NAME ROW: opponent + listen CTA ── */}
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-base font-bold text-chess-text flex-1 min-w-0 truncate">
          vs {game.opponent.username}{' '}
          <span className="text-sm font-normal text-gray-400">({game.opponent.rating})</span>
        </h2>
        {analysis && hasAnyProvider(settings) && (
          <button
            onClick={audioHasThisGame ? () => audioControls.play() : handleAudioGenerate}
            disabled={audioState.isGenerating}
            className="shrink-0 flex items-center gap-1 bg-chess-accent/10 text-chess-accent px-2.5 py-1 rounded-lg text-[11px] font-bold hover:bg-chess-accent/20 transition-all disabled:opacity-50"
          >
            {audioState.isGenerating ? (
              <span className="w-3 h-3 border-[1.5px] border-chess-accent border-t-transparent rounded-full animate-spin" />
            ) : (
              <span className="text-xs">&#9654;</span>
            )}
            {audioHasThisGame ? 'Replay' : 'Listen'}
          </button>
        )}
      </div>

      {/* Meta line */}
      <div className="text-[11px] text-gray-500 mb-2">
        {game.opening.name || 'Unknown opening'} &middot; {game.timeClass} &middot;{' '}
        {new Date(game.playedAt).toLocaleDateString()}
      </div>

      {/* ── ACCURACY SUMMARY (compact) ── */}
      {analysis && (
        <div className="flex items-center gap-3 bg-chess-surface rounded-lg px-3 py-2 mb-3">
          <AccuracyRing accuracy={analysis.summary.accuracy} size={44} />
          <PhaseBar phases={analysis.summary.phaseAccuracy} />
        </div>
      )}

      {/* No analysis state */}
      {!analysis && game.analysisStatus !== 'analyzing' && (
        <div className="bg-chess-surface rounded-xl p-5 text-center">
          <p className="text-gray-400 mb-2 text-sm">This game hasn&apos;t been analyzed yet.</p>
          <button
            onClick={requestAnalysis}
            disabled={isAnalyzing}
            className="bg-chess-accent text-white px-4 py-2 rounded-lg text-sm font-medium hover:brightness-110 transition-all disabled:opacity-50"
          >
            {isAnalyzing ? 'Analyzing...' : 'Analyze Now'}
          </button>
        </div>
      )}

      {game.analysisStatus === 'analyzing' && !analysis && (
        <div className="bg-chess-surface rounded-xl p-5 text-center">
          <div className="text-chess-inaccuracy animate-pulse text-sm">Analyzing game...</div>
        </div>
      )}

      {/* ── INSIGHTS TABS ── */}
      {analysis && (hasKeyMoments || hasPatterns) && (
        <div className="mt-3">
          {/* Tab pills */}
          <div className="flex gap-1 mb-2">
            {hasKeyMoments && (
              <button
                onClick={() => setInsightTab('moments')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                  insightTab === 'moments'
                    ? 'bg-chess-accent/15 text-chess-accent'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Key Moments <span className="opacity-60">{keyMoments.length}</span>
              </button>
            )}
            {hasPatterns && (
              <button
                onClick={() => setInsightTab('patterns')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                  insightTab === 'patterns'
                    ? 'bg-chess-accent/15 text-chess-accent'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Patterns <span className="opacity-60">{gamePatterns.length}</span>
              </button>
            )}
          </div>

          {/* Key Moments — horizontal scroll, no scrollbar */}
          {insightTab === 'moments' && hasKeyMoments && (
            <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {keyMoments.map((moment, idx) => (
                <KeyMomentCard
                  key={idx}
                  moment={moment}
                  onClick={() => jumpToMove(moment.halfMoveIndex)}
                  isActive={currentMoveIndex === moment.halfMoveIndex}
                />
              ))}
            </div>
          )}

          {/* Patterns — selector cards + moves row */}
          {insightTab === 'patterns' && hasPatterns && (
            <>
              <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                {gamePatterns.map((pattern, idx) => {
                  const severity = pattern.totalCpLoss >= 400 ? 'High' : pattern.totalCpLoss >= 150 ? 'Medium' : 'Low';
                  const sevColor = severity === 'High' ? 'text-chess-blunder' : severity === 'Medium' ? 'text-chess-mistake' : 'text-chess-inaccuracy';
                  const isSelected = selectedPatternIdx === idx;
                  return (
                    <button
                      key={pattern.theme}
                      onClick={() => { setSelectedPatternIdx(idx); jumpToMove(gamePatterns[idx].moves[0]?.moveIndex); }}
                      title={getThemeDescription(pattern.theme as Parameters<typeof getThemeDescription>[0])}
                      className={`shrink-0 w-[130px] rounded-lg p-1.5 text-left transition-all border ${
                        isSelected
                          ? 'border-chess-accent/50 bg-chess-accent/8'
                          : 'border-chess-border/20 bg-chess-surface hover:border-chess-border/40'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[8px] text-chess-blunder font-bold">{pattern.moves.length}&times;</span>
                        <span className={`text-[8px] font-bold ${sevColor}`}>{severity}</span>
                      </div>
                      <div className="text-[10px] font-medium text-chess-text leading-tight mb-0.5">{pattern.label}</div>
                      <div className="text-[8px] text-gray-500 tabular-nums">&minus;{pattern.totalCpLoss}cp</div>
                    </button>
                  );
                })}
              </div>
              {/* Selected pattern's moves */}
              {gamePatterns[selectedPatternIdx] && (
                <div className="flex gap-1 overflow-x-auto mt-1" style={{ scrollbarWidth: 'none' }}>
                  {gamePatterns[selectedPatternIdx].moves.map((move) => {
                    const isMovActive = currentMoveIndex === move.moveIndex;
                    return (
                      <button
                        key={move.moveIndex}
                        onClick={() => jumpToMove(move.moveIndex)}
                        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono transition-all ${
                          isMovActive
                            ? 'bg-chess-accent text-white'
                            : 'bg-chess-surface text-chess-text hover:bg-chess-accent/20'
                        }`}
                      >
                        {move.moveSan}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── BOARD (toggle, no strip when open) ── */}
      {analysis && (
        <div className="mt-3">
          {!showBoard ? (
            <button
              onClick={() => setShowBoard(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-chess-surface rounded-lg text-xs text-gray-400 hover:text-chess-text transition-colors"
            >
              <span>&#9823;</span> Show board
            </button>
          ) : (
            <div className="space-y-2">
              {/* Close board button */}
              <div className="flex justify-end">
                <button
                  onClick={() => setShowBoard(false)}
                  className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Hide board &times;
                </button>
              </div>

              <div className="flex flex-col md:flex-row gap-2">
                <div className="flex gap-1.5 shrink-0">
                  {currentEval && (
                    <EvalBar
                      score={currentEval.score}
                      scoreType={currentEval.scoreType}
                      height={boardSize}
                    />
                  )}
                  <div ref={containerRef} className="w-full max-w-[300px]">
                    <ThemedChessboard
                      position={currentFen}
                      boardOrientation={boardOrientation}
                      boardWidth={boardSize}
                      arePiecesDraggable={false}
                    />
                  </div>
                </div>

                <div className="flex-1 min-w-0 md:min-w-[200px]">
                  <div className="bg-chess-surface rounded-lg overflow-hidden">
                    <MoveList
                      moves={analysis.moves}
                      currentMoveIndex={currentMoveIndex}
                      onMoveClick={setCurrentMoveIndex}
                    />
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>
      )}

      {/* ── WHAT TO WORK ON ── */}
      {analysis && hasPatterns && (
        <div className="mt-4 mb-6">
          <WorkOnCTA patterns={gamePatterns} navigate={navigate} />
        </div>
      )}
    </div>
  );
}

/* ── AccuracyRing (compact) ── */

function AccuracyRing({ accuracy, size }: { accuracy: number; size: number }) {
  const stroke = 3.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (accuracy / 100) * circumference;
  const colorClass = accuracy >= 90 ? 'text-chess-best' : accuracy >= 75 ? 'text-chess-accent' : accuracy >= 60 ? 'text-chess-inaccuracy' : 'text-chess-blunder';

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className={`-rotate-90 ${colorClass}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} opacity={0.15} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${progress} ${circumference}`} style={{ transition: 'stroke-dasharray 0.8s ease-out' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-black text-chess-text leading-none">{accuracy}%</span>
      </div>
    </div>
  );
}

/* ── PhaseBar (compact, inline) ── */

function PhaseBar({ phases }: { phases: { opening: number; middlegame: number; endgame: number } }) {
  const getBarColor = (acc: number) => {
    if (acc >= 90) return 'bg-chess-best';
    if (acc >= 75) return 'bg-chess-accent';
    if (acc >= 60) return 'bg-chess-inaccuracy';
    return 'bg-chess-blunder';
  };

  const segments: Array<{ short: string; accuracy: number }> = [
    { short: 'Op', accuracy: phases.opening },
    { short: 'Mid', accuracy: phases.middlegame },
    { short: 'End', accuracy: phases.endgame },
  ];

  return (
    <div className="flex-1 min-w-0 space-y-1">
      <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden bg-chess-border/10">
        {segments.map((seg) => (
          <div
            key={seg.short}
            className={`flex-1 rounded-full ${getBarColor(seg.accuracy)}`}
            style={{ opacity: 0.3 + (seg.accuracy / 100) * 0.7 }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-gray-500">
        {segments.map((seg) => (
          <span key={seg.short}>
            {seg.short}{' '}
            <span className={seg.accuracy >= 75 ? 'text-chess-accent' : seg.accuracy >= 60 ? 'text-chess-inaccuracy' : 'text-chess-blunder'}>
              {seg.accuracy}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── KeyMomentCard ── */

function KeyMomentCard({
  moment,
  onClick,
  isActive,
}: {
  moment: MoveAnalysis & { momentType: 'mistake' | 'brilliant' };
  onClick: () => void;
  isActive: boolean;
}) {
  const isMistake = moment.momentType === 'mistake';
  const qualityConfig: Record<string, { bg: string; text: string; label: string }> = {
    brilliant: { bg: 'bg-[#1baca6]/15', text: 'text-[#1baca6]', label: 'Brilliant' },
    great: { bg: 'bg-[#5c8bb0]/15', text: 'text-[#5c8bb0]', label: 'Great' },
    blunder: { bg: 'bg-chess-blunder/15', text: 'text-chess-blunder', label: 'Blunder' },
    mistake: { bg: 'bg-chess-mistake/15', text: 'text-chess-mistake', label: 'Mistake' },
    miss: { bg: 'bg-chess-mistake/15', text: 'text-chess-mistake', label: 'Miss' },
    inaccuracy: { bg: 'bg-chess-inaccuracy/15', text: 'text-chess-inaccuracy', label: 'Inaccuracy' },
  };
  const config = qualityConfig[moment.quality] ?? qualityConfig.inaccuracy;

  return (
    <button
      onClick={onClick}
      className={`shrink-0 w-[130px] rounded-lg p-1.5 text-left transition-all border ${
        isActive
          ? 'border-chess-accent/50 bg-chess-accent/8'
          : 'border-chess-border/20 bg-chess-surface hover:border-chess-border/40'
      }`}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[8px] text-gray-500">Move {moment.moveNumber}</span>
        <span className={`text-[8px] font-bold px-1 py-px rounded ${config.bg} ${config.text}`}>{config.label}</span>
      </div>
      <div className="font-mono text-xs font-bold text-chess-text">{moment.moveSan}</div>
      {isMistake && moment.bestMoveSan && moment.moveSan !== moment.bestMoveSan && (
        <div className="text-[9px] text-gray-500">Best: <span className="text-chess-accent font-mono">{moment.bestMoveSan}</span></div>
      )}
    </button>
  );
}

/* ── WorkOnCTA ── */

function WorkOnCTA({
  patterns,
  navigate,
}: {
  patterns: Array<{ theme: string; label: string; moves: Array<unknown>; totalCpLoss: number }>;
  navigate: (path: string, opts?: { state?: unknown }) => void;
}) {
  const sorted = [...patterns].sort((a, b) => b.totalCpLoss - a.totalCpLoss);
  const worst = sorted[0];
  const others = sorted.slice(1, 3);

  return (
    <div>
      <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 px-0.5">
        What to Work On
      </h3>
      <button
        onClick={() => navigate('/training', { state: { preselectedTheme: worst.theme } })}
        className="w-full bg-chess-surface rounded-lg p-3 text-left hover:border-chess-accent/40 border border-chess-border/20 transition-all group"
      >
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-sm font-bold text-chess-text">{worst.label}</span>
          <span className="text-xs font-bold text-chess-accent opacity-70 group-hover:opacity-100 transition-opacity">Train &rarr;</span>
        </div>
        <div className="text-[11px] text-gray-500">
          {worst.moves.length} occurrence{worst.moves.length !== 1 ? 's' : ''} &middot; &minus;{worst.totalCpLoss}cp lost
        </div>
      </button>
      {others.length > 0 && (
        <div className="mt-1.5 px-1 text-[10px] text-gray-500">
          Also: {others.map((p, i) => (
            <span key={p.theme}>
              <button
                onClick={() => navigate('/training', { state: { preselectedTheme: p.theme } })}
                className="text-gray-400 hover:text-chess-accent transition-colors underline decoration-dotted underline-offset-2"
              >{p.label}</button>{i < others.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
