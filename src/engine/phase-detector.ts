import type { GamePhase } from '@shared/types/analysis';
import { PHASE_WEIGHTS, TOTAL_PHASE_MATERIAL } from '@shared/constants';

/**
 * Detect the game phase based on material remaining on the board.
 * Uses a tapered evaluation approach (Fruit-style material counting)
 * with flexible thresholds that handle slow openings and queenless middlegames.
 */
export function detectPhase(fen: string, moveNumber: number): GamePhase {
  const piecePart = fen.split(' ')[0];
  let materialPhase = 0;
  let hasWhiteQueen = false;
  let hasBlackQueen = false;

  for (const char of piecePart) {
    if (char === 'Q') hasWhiteQueen = true;
    if (char === 'q') hasBlackQueen = true;
    const lower = char.toLowerCase();
    if (lower in PHASE_WEIGHTS) {
      materialPhase += PHASE_WEIGHTS[lower as keyof typeof PHASE_WEIGHTS];
    }
  }

  const phaseRatio = materialPhase / TOTAL_PHASE_MATERIAL;
  const hasQueens = hasWhiteQueen || hasBlackQueen;

  // ── Opening detection ──
  // Standard opening: early moves with most pieces
  if (moveNumber <= 15 && phaseRatio > 0.85) return 'opening';
  // Slow/closed openings: can extend a bit longer if no material traded
  if (moveNumber <= 20 && phaseRatio > 0.90) return 'opening';
  // Very slow openings (e.g., KID, hedgehog): up to move 25 if nearly all pieces remain
  if (moveNumber <= 25 && phaseRatio > 0.95) return 'opening';

  // ── Endgame detection ──
  // Standard endgame: significant material traded
  if (phaseRatio <= 0.40) return 'endgame';
  // Queenless middlegame → treat as endgame if material is moderately low
  if (!hasQueens && phaseRatio <= 0.55) return 'endgame';

  // Everything else is middlegame
  return 'middlegame';
}

/**
 * Count total material on the board from a FEN string.
 * Returns separate counts for white and black using standard piece values.
 */
export function countMaterial(fen: string): { white: number; black: number } {
  const piecePart = fen.split(' ')[0];
  const pieceValues: Record<string, number> = {
    p: 1,
    n: 3,
    b: 3,
    r: 5,
    q: 9,
  };

  let white = 0;
  let black = 0;

  for (const char of piecePart) {
    const lower = char.toLowerCase();
    if (lower in pieceValues) {
      if (char === lower) {
        black += pieceValues[lower];
      } else {
        white += pieceValues[lower];
      }
    }
  }

  return { white, black };
}
