/**
 * Game analyzer — orchestrates Stockfish across all moves in a PGN.
 *
 * Port of src/engine/game-analyzer.ts in the main app, adapted to:
 *   - Receive PGN + playerColor as input (the engine service has no Game entity)
 *   - Use a per-job StockfishProcess instead of the singleton StockfishClient
 *   - Report progress via callback (the HTTP layer fans this out to SSE)
 *
 * Keep the eval/classification logic in sync with the main app's version.
 */
import { Chess } from 'chess.js';
import type { GameAnalysis, GameSummary, MoveAnalysis, MoveQuality, PositionEval } from './types.js';
import { StockfishProcess } from './stockfish.js';
import {
  classifyMove,
  calcWinChanceLoss,
  detectSacrifice,
} from './engine/eval-classifier.js';
import { cpLossToAccuracy } from './engine/uci-parser.js';
import { detectPhase, countMaterial } from './engine/phase-detector.js';
import { detectTacticalMotifs, deriveAdditionalMotifs } from './engine/tactical-detector.js';

export interface AnalyzeOptions {
  gameId: string;
  pgn: string;
  depth: number;
  playerColor: 'white' | 'black';
  onProgress?: (moveIndex: number, totalMoves: number) => void;
}

export async function analyzeGame(opts: AnalyzeOptions): Promise<GameAnalysis> {
  const { gameId, pgn, depth, playerColor, onProgress } = opts;

  const sf = new StockfishProcess();
  try {
    await sf.start();
    await sf.newGame();

    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history({ verbose: true });

    const clockTimes = parseClockTimes(pgn);

    chess.reset();

    const moves: MoveAnalysis[] = [];
    let prevEval: PositionEval | null = null;
    let prevMoveWasBlunder = false;
    let prevWhiteClock: number | null = null;
    let prevBlackClock: number | null = null;

    for (let i = 0; i < history.length; i++) {
      const fenBefore = chess.fen();
      const move = history[i]!;
      const isWhite = move.color === 'w';

      const legalMoves = chess.moves();
      const legalMoveCount = legalMoves.length;

      const materialBefore = countMaterial(fenBefore);

      // Reuse cached eval from previous iteration when possible.
      // If cached bestMove is illegal in current position (i.e. stored for the
      // other side), strip it so we don't credit playedBestMove incorrectly.
      let evalBefore: PositionEval;
      if (prevEval) {
        if (prevEval.bestMove && !isLegalUci(fenBefore, prevEval.bestMove)) {
          evalBefore = { ...prevEval, bestMove: '' };
        } else {
          evalBefore = prevEval;
        }
      } else {
        evalBefore = await sf.analyzePosition(fenBefore, depth);
      }

      chess.move(move.san);
      const fenAfter = chess.fen();

      const materialAfter = countMaterial(fenAfter);

      const evalAfter = await sf.analyzePosition(fenAfter, depth);

      const cpBefore = evalToCpForSideToMove(evalBefore);
      const cpAfter = -evalToCpForSideToMove(evalAfter);

      const moveUci = `${move.from}${move.to}${move.promotion ?? ''}`;
      const playedBestMove = moveUci === evalBefore.bestMove;
      let cpLoss = playedBestMove ? 0 : Math.max(0, cpBefore - cpAfter);
      let winChanceLoss = playedBestMove ? 0 : calcWinChanceLoss(cpBefore, cpAfter);

      // Sanity cap: huge cpLoss on a capture-while-still-winning is almost
      // always a Stockfish quirk (TT, mate↔cp transition). Cap aggressively.
      if (!!move.captured && cpAfter > 200 && cpLoss > 0) {
        if (winChanceLoss > 0.15 && cpAfter > 400) {
          console.warn(`[engine] Capping suspicious cpLoss for capture: ${move.san} cpLoss=${cpLoss} cpBefore=${cpBefore} cpAfter=${cpAfter}`);
          cpLoss = Math.min(cpLoss, 100);
          winChanceLoss = Math.min(winChanceLoss, 0.05);
        }
      }

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

      const fullMoveNumber = Math.floor(i / 2) + 1;
      const phase = detectPhase(fenBefore, fullMoveNumber);

      const isBookMove = false; // Enhanced later with opening DB
      const isMissedOpportunity = prevMoveWasBlunder && winChanceLoss > 0.10 && cpBefore > 150;

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

      prevMoveWasBlunder = quality === 'blunder';

      const bestMoveSan = uciToSan(fenBefore, evalBefore.bestMove);
      const pvSan = pvToSan(fenBefore, evalBefore.pv);

      const baseMotifs = cpLoss > 30
        ? detectTacticalMotifs(fenBefore, evalBefore.bestMove, moveUci)
        : detectTacticalMotifs(fenBefore, evalBefore.bestMove, '');

      const extraMotifs = deriveAdditionalMotifs({
        fenBefore,
        fenAfter,
        moveSan: move.san,
        moveUci,
        isCheck: chess.inCheck(),
        isCastling: move.san === 'O-O' || move.san === 'O-O-O',
        evalBefore,
        evalAfter,
      });
      const tacticalMotifs = [...new Set([...baseMotifs, ...extraMotifs])];

      const normalizedEvalBefore = normalizeEvalToWhite(evalBefore, isWhite);
      const normalizedEvalAfter = normalizeEvalToWhite(evalAfter, !isWhite);

      const clockRemaining = clockTimes[i] ?? null;
      let timeSpent: number | null = null;
      if (clockRemaining !== null) {
        const prevClock = isWhite ? prevWhiteClock : prevBlackClock;
        if (prevClock !== null) {
          timeSpent = Math.max(0, prevClock - clockRemaining);
        }
        if (isWhite) prevWhiteClock = clockRemaining;
        else prevBlackClock = clockRemaining;
      }

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
        timeSpent,
        clockRemaining,
      });

      onProgress?.(i + 1, history.length);

      prevEval = evalAfter;
    }

    const summary = computeSummary(moves, playerColor);

    return {
      gameId,
      moves,
      summary,
      analyzedAt: Date.now(),
      engineDepth: depth,
      engineVersion: 'Stockfish 17.1 native',
    };
  } finally {
    await sf.stop();
  }
}

function normalizeEvalToWhite(eval_: PositionEval, sideToMoveIsWhite: boolean): PositionEval {
  if (sideToMoveIsWhite) return eval_;
  return { ...eval_, score: -eval_.score };
}

function evalToCpForSideToMove(eval_: PositionEval): number {
  if (eval_.scoreType === 'mate') {
    const sign = eval_.score > 0 ? 1 : -1;
    const raw = 1000 + Math.max(0, 50 - Math.abs(eval_.score)) * 10;
    return sign * Math.min(1500, raw);
  }
  return eval_.score;
}

function isLegalUci(fen: string, uci: string): boolean {
  if (!uci || uci.length < 4) return false;
  try {
    const chess = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    const result = chess.move({ from, to, promotion });
    return result !== null;
  } catch {
    return false;
  }
}

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

  const accuracies = playerMoves.map((m) => cpLossToAccuracy(m.cpLoss));
  const accuracy = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length;

  const phaseAccuracy = computePhaseAccuracy(playerMoves);

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
    opening: phases.opening.length > 0 ? Math.round(avg(phases.opening) * 10) / 10 : 100,
    middlegame: phases.middlegame.length > 0 ? Math.round(avg(phases.middlegame) * 10) / 10 : 100,
    endgame: phases.endgame.length > 0 ? Math.round(avg(phases.endgame) * 10) / 10 : 100,
  };
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function parseClockTimes(pgn: string): (number | null)[] {
  const times: (number | null)[] = [];
  const regex = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/g;
  let match;
  while ((match = regex.exec(pgn)) !== null) {
    const hours = parseInt(match[1]!, 10);
    const minutes = parseInt(match[2]!, 10);
    const seconds = parseFloat(match[3]!);
    times.push(hours * 3600 + minutes * 60 + seconds);
  }
  return times;
}
