/**
 * Game phase detection + material counting.
 * Verbatim port of src/engine/phase-detector.ts. Keep in sync.
 */
import type { GamePhase } from '../types.js';
import { PHASE_WEIGHTS, TOTAL_PHASE_MATERIAL } from '../constants.js';

export function detectPhase(fen: string, moveNumber: number): GamePhase {
  const piecePart = fen.split(' ')[0]!;
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

  if (moveNumber <= 15 && phaseRatio > 0.85) return 'opening';
  if (moveNumber <= 20 && phaseRatio > 0.90) return 'opening';
  if (moveNumber <= 25 && phaseRatio > 0.95) return 'opening';

  if (phaseRatio <= 0.40) return 'endgame';
  if (!hasQueens && phaseRatio <= 0.55) return 'endgame';

  return 'middlegame';
}

export function countMaterial(fen: string): { white: number; black: number } {
  const piecePart = fen.split(' ')[0]!;
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
        black += pieceValues[lower]!;
      } else {
        white += pieceValues[lower]!;
      }
    }
  }

  return { white, black };
}
