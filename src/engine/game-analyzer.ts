import { Chess } from 'chess.js';
import type { GameAnalysis, GameSummary, MoveAnalysis, MoveQuality } from '@shared/types/analysis';
import type { PositionEval } from '@shared/types/engine';
import type { GameRecord } from '@shared/types/game';
import { StockfishClient } from './stockfish-client';
import {
  classifyMove,
  calcWinChanceLoss,
  detectSacrifice,
} from './eval-classifier';
import { cpLossToAccuracy } from './uci-parser';
import { detectPhase, countMaterial } from './phase-detector';
import { detectTacticalMotifs } from './tactical-detector';

type ProgressCallback = (moveIndex: number, totalMoves: number) => void;

/**
 * Analyze an entire game move by move using Stockfish.
 * Uses chess.com-style Expected Points model for move classification.
 */
export async function analyzeGame(
  game: GameRecord,
  depth: number,
  onProgress?: ProgressCallback,
): Promise<GameAnalysis> {
  const client = StockfishClient.getInstance();
  await client.initialize();
  await client.newGame();

  // Enable WDL display
  await client.setOption('UCI_ShowWDL', 'true');

  const chess = new Chess();
  chess.loadPgn(game.pgn);
  const history = chess.history({ verbose: true });

  // Reset and replay
  chess.reset();

  const moves: MoveAnalysis[] = [];
  let prevEval: PositionEval | null = null;
  let prevMoveWasBlunder = false; // Track if opponent's last move was a blunder

  // Analyze each position
  for (let i = 0; i < history.length; i++) {
    const fenBefore = chess.fen();
    const move = history[i];
    const isWhite = move.color === 'w';

    // Count legal moves before making the move
    const legalMoves = chess.moves();
    const legalMoveCount = legalMoves.length;

    // Get material before the move
    const materialBefore = countMaterial(fenBefore);

    // Get engine eval for the position BEFORE the move
    const evalBefore = prevEval ?? (await client.analyzePosition(fenBefore, depth));

    // Make the move
    chess.move(move.san);
    const fenAfter = chess.fen();

    // Get material after the move
    const materialAfter = countMaterial(fenAfter);

    // Get engine eval for the position AFTER the move
    const evalAfter = await client.analyzePosition(fenAfter, depth);

    // Calculate centipawn loss from the perspective of the side that moved.
    const cpBefore = evalToCpForSideToMove(evalBefore);
    const cpAfter = -evalToCpForSideToMove(evalAfter);
    const cpLoss = Math.max(0, cpBefore - cpAfter);

    // Calculate win chance loss (chess.com Expected Points model)
    const winChanceLoss = calcWinChanceLoss(cpBefore, cpAfter);

    // Detect sacrifice
    const isSacrifice = detectSacrifice(
      cpLoss,
      !!move.captured,
      cpBefore,
      cpAfter,
      materialBefore.white,
      materialAfter.white,
      materialBefore.black,
      materialAfter.black,
      isWhite,
    );

    // Detect game phase
    const fullMoveNumber = Math.floor(i / 2) + 1;
    const phase = detectPhase(fenBefore, fullMoveNumber);

    const isBookMove = false; // Will be enhanced later with opening DB

    // Miss detection
    const isMissedOpportunity = prevMoveWasBlunder && winChanceLoss > 0.10 && cpBefore > 150;

    // Classify the move using chess.com-style Expected Points
    const quality = classifyMove({
      cpLoss,
      winChanceLoss,
      evalBeforeCp: cpBefore,
      evalAfterCp: cpAfter,
      isSacrifice,
      legalMoveCount,
      isBookMove,
      isMissedOpportunity,
    });

    // Track if this move was a blunder (for opponent's "miss" detection)
    prevMoveWasBlunder = quality === 'blunder';

    // Convert best move from UCI to SAN
    const bestMoveSan = uciToSan(fenBefore, evalBefore.bestMove);

    // Convert PV to SAN
    const pvSan = pvToSan(fenBefore, evalBefore.pv);

    // Detect tactical motifs
    const moveUci = `${move.from}${move.to}${move.promotion ?? ''}`;
    const tacticalMotifs = cpLoss > 30
      ? detectTacticalMotifs(fenBefore, evalBefore.bestMove, moveUci)
      : detectTacticalMotifs(fenBefore, evalBefore.bestMove, '');

    // Normalize eval scores to always be from White's perspective for storage/display.
    const normalizedEvalBefore = normalizeEvalToWhite(evalBefore, isWhite);
    const normalizedEvalAfter = normalizeEvalToWhite(evalAfter, !isWhite);

    moves.push({
      moveNumber: fullMoveNumber,
      halfMoveIndex: i,
      color: isWhite ? 'white' : 'black',
      moveSan: move.san,
      moveUci,
      fenBefore,
      fenAfter,
      evalBefore: { ...normalizedEvalBefore, bestMoveSan },
      evalAfter: { ...normalizedEvalAfter, bestMoveSan: '' },
      cpLoss,
      winChanceLoss: Math.round(winChanceLoss * 1000) / 1000,
      quality,
      phase,
      bestMoveSan,
      bestMoveUci: evalBefore.bestMove,
      pvSan,
      tacticalMotifs,
      isCapture: !!move.captured,
      isCheck: chess.inCheck(),
      isCastling: move.san === 'O-O' || move.san === 'O-O-O',
      isSacrifice,
      legalMoveCount,
    });

    // Report progress
    onProgress?.(i + 1, history.length);

    // Cache the eval for the next iteration
    prevEval = evalAfter;
  }

  // Compute summary
  const playerColor = game.player.color;
  const summary = computeSummary(moves, playerColor);

  return {
    gameId: game.id,
    moves,
    summary,
    analyzedAt: Date.now(),
    engineDepth: depth,
    engineVersion: 'Stockfish 17.1 NNUE Lite',
  };
}

/**
 * Normalize a PositionEval so that the score is from White's perspective.
 */
function normalizeEvalToWhite(eval_: PositionEval, sideToMoveIsWhite: boolean): PositionEval {
  if (sideToMoveIsWhite) return eval_;
  return {
    ...eval_,
    score: -eval_.score,
  };
}

/**
 * Convert an eval to centipawns from the side-to-move's perspective.
 */
function evalToCpForSideToMove(eval_: PositionEval): number {
  if (eval_.scoreType === 'mate') {
    const sign = eval_.score > 0 ? 1 : -1;
    return sign * (10000 - Math.abs(eval_.score));
  }
  return eval_.score;
}

/**
 * Convert a UCI move string to SAN notation.
 */
function uciToSan(fen: string, uci: string): string {
  if (!uci) return '';
  try {
    const chess = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    const move = chess.move({ from, to, promotion });
    return move?.san ?? uci;
  } catch {
    return uci;
  }
}

/**
 * Convert a PV (sequence of UCI moves) to SAN notation.
 */
function pvToSan(fen: string, pv: string[]): string[] {
  if (pv.length === 0) return [];

  try {
    const chess = new Chess(fen);
    const sanMoves: string[] = [];

    for (const uci of pv) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.length > 4 ? uci[4] : undefined;
      const move = chess.move({ from, to, promotion });
      if (!move) break;
      sanMoves.push(move.san);
    }

    return sanMoves;
  } catch {
    return [];
  }
}

/**
 * Compute aggregate summary statistics for a game.
 */
function computeSummary(
  moves: MoveAnalysis[],
  playerColor: 'white' | 'black',
): GameSummary {
  const playerMoves = moves.filter((m) => m.color === playerColor);

  if (playerMoves.length === 0) {
    return {
      playerColor,
      totalMoves: moves.length,
      accuracy: 100,
      acpl: 0,
      brilliantMoves: 0,
      greatMoves: 0,
      bestMoves: 0,
      excellentMoves: 0,
      goodMoves: 0,
      bookMoves: 0,
      forcedMoves: 0,
      inaccuracies: 0,
      mistakes: 0,
      misses: 0,
      blunders: 0,
      phaseAccuracy: { opening: 100, middlegame: 100, endgame: 100 },
      biggestMistake: null,
    };
  }

  const count = (q: MoveQuality) => playerMoves.filter((m) => m.quality === q).length;

  const totalCpLoss = playerMoves.reduce((sum, m) => sum + m.cpLoss, 0);
  const acpl = totalCpLoss / playerMoves.length;

  // Per-move accuracy using Lichess formula, then averaged
  const accuracies = playerMoves.map((m) => cpLossToAccuracy(m.cpLoss));
  const accuracy = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length;

  // Phase-specific accuracy
  const phaseAccuracy = computePhaseAccuracy(playerMoves);

  // Find biggest mistake
  let biggestMistake: GameSummary['biggestMistake'] = null;
  for (const move of playerMoves) {
    if (!biggestMistake || move.cpLoss > biggestMistake.cpLoss) {
      biggestMistake = {
        moveNumber: move.moveNumber,
        cpLoss: move.cpLoss,
        moveSan: move.moveSan,
        bestMoveSan: move.bestMoveSan,
      };
    }
  }

  return {
    playerColor,
    totalMoves: moves.length,
    accuracy: Math.round(accuracy * 10) / 10,
    acpl: Math.round(acpl * 10) / 10,
    brilliantMoves: count('brilliant'),
    greatMoves: count('great'),
    bestMoves: count('best'),
    excellentMoves: count('excellent'),
    goodMoves: count('good'),
    bookMoves: count('book'),
    forcedMoves: count('forced'),
    inaccuracies: count('inaccuracy'),
    mistakes: count('mistake'),
    misses: count('miss'),
    blunders: count('blunder'),
    phaseAccuracy,
    biggestMistake,
  };
}

function computePhaseAccuracy(
  playerMoves: MoveAnalysis[],
): { opening: number; middlegame: number; endgame: number } {
  const phases = {
    opening: [] as number[],
    middlegame: [] as number[],
    endgame: [] as number[],
  };

  for (const move of playerMoves) {
    phases[move.phase].push(cpLossToAccuracy(move.cpLoss));
  }

  return {
    opening: phases.opening.length > 0
      ? Math.round(avg(phases.opening) * 10) / 10
      : 100,
    middlegame: phases.middlegame.length > 0
      ? Math.round(avg(phases.middlegame) * 10) / 10
      : 100,
    endgame: phases.endgame.length > 0
      ? Math.round(avg(phases.endgame) * 10) / 10
      : 100,
  };
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}
