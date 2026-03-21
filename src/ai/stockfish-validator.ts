import type { Exercise, LessonPosition } from '@shared/types/ai';
import { StockfishClient } from '@/engine/stockfish-client';
import { VALIDATION_DEPTH, VALIDATION_TOLERANCE_CP } from '@shared/constants';
import { uciToSan, sanToUci, applyMoveToFen } from '@shared/utils/chess-utils';

/** Tolerance for opponent (non-player) moves — more lenient than player moves */
const OPPONENT_TOLERANCE_CP = 200;

/**
 * Result of validating a single position/solution against Stockfish.
 */
export interface StockfishValidationResult {
  isValid: boolean;
  stockfishBestMove: string;       // UCI format
  stockfishBestMoveSan: string;    // SAN format
  stockfishScore: number;          // centipawns (or mate-as-cp) from side-to-move perspective
  stockfishScoreType: 'cp' | 'mate';
  suggestedMoveScore: number | null; // eval after suggested move (normalized to mover's perspective), null if couldn't evaluate
  scoreDifference: number;          // centipawn gap between best and suggested
}

/**
 * Convert a Stockfish score to centipawns from the side-to-move's perspective.
 * Mate scores are converted to large cp values: mate-in-N = sign * (10000 - |N|).
 */
function evalToCp(scoreType: 'cp' | 'mate', score: number): number {
  if (scoreType === 'mate') {
    const sign = score > 0 ? 1 : -1;
    return sign * (10000 - Math.abs(score));
  }
  return score;
}

/**
 * Validate an exercise's first solution move against Stockfish.
 * Returns whether the move is correct (within tolerance) and Stockfish's analysis.
 */
export async function validateExercise(
  exercise: Exercise,
  depth: number = VALIDATION_DEPTH,
  tolerance: number = VALIDATION_TOLERANCE_CP,
): Promise<StockfishValidationResult> {
  const client = StockfishClient.getInstance();
  await client.initialize();

  // Analyze the position at the given depth
  const posEval = await client.analyzePosition(exercise.fen, depth);

  const stockfishBestMove = posEval.bestMove;
  const stockfishBestMoveSan = uciToSan(exercise.fen, stockfishBestMove);
  const stockfishCp = evalToCp(posEval.scoreType, posEval.score);

  // The first move of the solution is the critical one the player must find
  const suggestedMoveUci = exercise.solution[0];
  if (!suggestedMoveUci) {
    return {
      isValid: false,
      stockfishBestMove,
      stockfishBestMoveSan,
      stockfishScore: posEval.score,
      stockfishScoreType: posEval.scoreType,
      suggestedMoveScore: null,
      scoreDifference: Infinity,
    };
  }

  // Exact match — the AI's suggestion is Stockfish's top choice
  if (suggestedMoveUci === stockfishBestMove) {
    return {
      isValid: true,
      stockfishBestMove,
      stockfishBestMoveSan,
      stockfishScore: posEval.score,
      stockfishScoreType: posEval.scoreType,
      suggestedMoveScore: stockfishCp,
      scoreDifference: 0,
    };
  }

  // Not an exact match — evaluate the position after the suggested move
  // to see how much worse it is
  const fenAfterSuggested = applyMoveToFen(exercise.fen, suggestedMoveUci);
  if (!fenAfterSuggested) {
    // Illegal move — definitely invalid
    return {
      isValid: false,
      stockfishBestMove,
      stockfishBestMoveSan,
      stockfishScore: posEval.score,
      stockfishScoreType: posEval.scoreType,
      suggestedMoveScore: null,
      scoreDifference: Infinity,
    };
  }

  const evalAfterSuggested = await client.analyzePosition(fenAfterSuggested, depth);

  // evalAfterSuggested is from the OPPONENT's perspective (side-to-move flipped).
  // Negate to get it from the original mover's perspective for comparison.
  const suggestedMoveCp = -evalToCp(evalAfterSuggested.scoreType, evalAfterSuggested.score);

  const scoreDiff = Math.abs(stockfishCp - suggestedMoveCp);

  console.log(
    `[Chess DNA] Validation: suggested=${suggestedMoveUci} (${suggestedMoveCp}cp), ` +
    `best=${stockfishBestMove} (${stockfishCp}cp), diff=${scoreDiff}cp, ` +
    `tolerance=${tolerance}cp → ${scoreDiff <= tolerance ? 'VALID' : 'INVALID'}`,
  );

  return {
    isValid: scoreDiff <= tolerance,
    stockfishBestMove,
    stockfishBestMoveSan,
    stockfishScore: posEval.score,
    stockfishScoreType: posEval.scoreType,
    suggestedMoveScore: suggestedMoveCp,
    scoreDifference: scoreDiff,
  };
}

/**
 * Validate a lesson position's correctMove against Stockfish.
 * The correctMove is in SAN notation and must be converted to UCI for comparison.
 */
export async function validateLessonPosition(
  position: LessonPosition,
  depth: number = VALIDATION_DEPTH,
  tolerance: number = VALIDATION_TOLERANCE_CP,
): Promise<StockfishValidationResult> {
  const client = StockfishClient.getInstance();
  await client.initialize();

  // Analyze the position
  const posEval = await client.analyzePosition(position.fen, depth);

  const stockfishBestMove = posEval.bestMove;
  const stockfishBestMoveSan = uciToSan(position.fen, stockfishBestMove);
  const stockfishCp = evalToCp(posEval.scoreType, posEval.score);

  // Convert the lesson's SAN correctMove to UCI for comparison
  const suggestedMoveUci = sanToUci(position.fen, position.correctMove);
  if (!suggestedMoveUci) {
    // Invalid SAN move — can't evaluate
    return {
      isValid: false,
      stockfishBestMove,
      stockfishBestMoveSan,
      stockfishScore: posEval.score,
      stockfishScoreType: posEval.scoreType,
      suggestedMoveScore: null,
      scoreDifference: Infinity,
    };
  }

  // Exact match
  if (suggestedMoveUci === stockfishBestMove) {
    return {
      isValid: true,
      stockfishBestMove,
      stockfishBestMoveSan,
      stockfishScore: posEval.score,
      stockfishScoreType: posEval.scoreType,
      suggestedMoveScore: stockfishCp,
      scoreDifference: 0,
    };
  }

  // Evaluate position after the suggested move
  const fenAfterSuggested = applyMoveToFen(position.fen, suggestedMoveUci);
  if (!fenAfterSuggested) {
    return {
      isValid: false,
      stockfishBestMove,
      stockfishBestMoveSan,
      stockfishScore: posEval.score,
      stockfishScoreType: posEval.scoreType,
      suggestedMoveScore: null,
      scoreDifference: Infinity,
    };
  }

  const evalAfterSuggested = await client.analyzePosition(fenAfterSuggested, depth);
  const suggestedMoveCp = -evalToCp(evalAfterSuggested.scoreType, evalAfterSuggested.score);
  const scoreDiff = Math.abs(stockfishCp - suggestedMoveCp);

  console.log(
    `[Chess DNA] Lesson validation: suggested=${position.correctMove} (${suggestedMoveCp}cp), ` +
    `best=${stockfishBestMoveSan} (${stockfishCp}cp), diff=${scoreDiff}cp → ${scoreDiff <= tolerance ? 'VALID' : 'INVALID'}`,
  );

  return {
    isValid: scoreDiff <= tolerance,
    stockfishBestMove,
    stockfishBestMoveSan,
    stockfishScore: posEval.score,
    stockfishScoreType: posEval.scoreType,
    suggestedMoveScore: suggestedMoveCp,
    scoreDifference: scoreDiff,
  };
}

/* ══════════════════════════════════════════════════════════════
 *  Multi-move sequence validation
 *  Walks through every move in an exercise solution, validating
 *  each player move within VALIDATION_TOLERANCE_CP and each
 *  opponent move within a looser OPPONENT_TOLERANCE_CP.
 * ══════════════════════════════════════════════════════════════ */

export interface SequenceMoveResult {
  moveIndex: number;
  moveUci: string;
  moveSan: string;
  isPlayerMove: boolean;
  isValid: boolean;
  stockfishBestMove: string;
  stockfishBestMoveSan: string;
  scoreDifference: number;
}

export interface SequenceValidationResult {
  isValid: boolean;
  moveResults: SequenceMoveResult[];
  /** Index of first failed move, or null if all passed */
  firstFailedIndex: number | null;
  /** Overall Stockfish best move for the starting position (for retry prompts) */
  stockfishBestMove: string;
  stockfishBestMoveSan: string;
  stockfishScore: number;
  stockfishScoreType: 'cp' | 'mate';
  scoreDifference: number;
}

/**
 * Validate every move in an exercise solution against Stockfish.
 * Works for single-move and multi-move solutions alike.
 *
 * Player moves (matching exercise.playerColor) are held to VALIDATION_TOLERANCE_CP.
 * Opponent moves are held to a looser OPPONENT_TOLERANCE_CP — they just need to
 * be reasonable, not the absolute best.
 */
export async function validateExerciseSequence(
  exercise: Exercise,
  depth: number = VALIDATION_DEPTH,
  tolerance: number = VALIDATION_TOLERANCE_CP,
  opponentTolerance: number = OPPONENT_TOLERANCE_CP,
): Promise<SequenceValidationResult> {
  const client = StockfishClient.getInstance();
  await client.initialize();

  const moveResults: SequenceMoveResult[] = [];
  let currentFen = exercise.fen;
  let firstFailedIndex: number | null = null;
  let allValid = true;

  // Determine side-to-move from FEN: the char after first space is 'w' or 'b'
  const startingSide = currentFen.split(' ')[1] as 'w' | 'b';
  const playerSide = exercise.playerColor === 'white' ? 'w' : 'b';

  // Capture first-position eval for retry prompt compatibility
  const firstEval = await client.analyzePosition(currentFen, depth);
  const firstBestMove = firstEval.bestMove;
  const firstBestMoveSan = uciToSan(currentFen, firstBestMove);

  for (let i = 0; i < exercise.solution.length; i++) {
    const moveUci = exercise.solution[i];
    const moveSan = exercise.solutionSan[i] ?? uciToSan(currentFen, moveUci);

    // Which side is moving at this index?
    const sideAtIdx = (i % 2 === 0) ? startingSide : (startingSide === 'w' ? 'b' : 'w');
    const isPlayerMove = sideAtIdx === playerSide;
    const tol = isPlayerMove ? tolerance : opponentTolerance;

    // Analyze current position (reuse firstEval for index 0)
    const posEval = (i === 0) ? firstEval : await client.analyzePosition(currentFen, depth);
    const bestMove = posEval.bestMove;

    // Guard: if Stockfish returned no best move (e.g. game-over position), mark invalid
    if (!bestMove) {
      console.warn(`[Chess DNA] Stockfish returned no best move at position ${i}: ${currentFen}`);
      moveResults.push({
        moveIndex: i, moveUci, moveSan, isPlayerMove, isValid: false,
        stockfishBestMove: '', stockfishBestMoveSan: '', scoreDifference: Infinity,
      });
      if (firstFailedIndex === null) { firstFailedIndex = i; allValid = false; }
      const nextFen = applyMoveToFen(currentFen, moveUci);
      if (!nextFen) break;
      currentFen = nextFen;
      continue;
    }

    const bestMoveSan = uciToSan(currentFen, bestMove);
    const bestCp = evalToCp(posEval.scoreType, posEval.score);

    let moveValid = false;
    let scoreDiff = Infinity;

    if (moveUci === bestMove) {
      // Exact match
      moveValid = true;
      scoreDiff = 0;
    } else {
      // Evaluate position after suggested move
      const fenAfter = applyMoveToFen(currentFen, moveUci);
      if (!fenAfter) {
        // Illegal move
        moveValid = false;
        scoreDiff = Infinity;
      } else {
        const evalAfter = await client.analyzePosition(fenAfter, depth);
        const suggestedCp = -evalToCp(evalAfter.scoreType, evalAfter.score);
        scoreDiff = Math.abs(bestCp - suggestedCp);
        moveValid = scoreDiff <= tol;
      }
    }

    console.log(
      `[Chess DNA] Seq validation [${i}] ${isPlayerMove ? 'PLAYER' : 'OPPONENT'}: ` +
      `move=${moveUci}(${moveSan}), best=${bestMove}(${bestMoveSan}), ` +
      `diff=${scoreDiff === Infinity ? '∞' : scoreDiff + 'cp'}, tol=${tol}cp → ${moveValid ? 'VALID' : 'INVALID'}`,
    );

    moveResults.push({
      moveIndex: i,
      moveUci,
      moveSan,
      isPlayerMove,
      isValid: moveValid,
      stockfishBestMove: bestMove,
      stockfishBestMoveSan: bestMoveSan,
      scoreDifference: scoreDiff,
    });

    if (!moveValid && firstFailedIndex === null) {
      firstFailedIndex = i;
      allValid = false;
    }

    // Apply the move to advance to next position (even if invalid, for logging consistency)
    const nextFen = applyMoveToFen(currentFen, moveUci);
    if (!nextFen) {
      // Can't advance — remaining moves are also invalid
      allValid = false;
      if (firstFailedIndex === null) firstFailedIndex = i;
      break;
    }
    currentFen = nextFen;
  }

  // Compute overall scoreDifference (first player move's diff, for retry prompt compat)
  const firstPlayerResult = moveResults.find(r => r.isPlayerMove);
  const overallScoreDiff = firstPlayerResult?.scoreDifference ?? (moveResults[0]?.scoreDifference ?? Infinity);

  return {
    isValid: allValid,
    moveResults,
    firstFailedIndex,
    stockfishBestMove: firstBestMove,
    stockfishBestMoveSan: firstBestMoveSan,
    stockfishScore: firstEval.score,
    stockfishScoreType: firstEval.scoreType,
    scoreDifference: overallScoreDiff,
  };
}
