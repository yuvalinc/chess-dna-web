import type { MoveQuality } from '@shared/types/analysis';
import { WIN_CHANCE_THRESHOLDS } from '@shared/constants';
import { cpToWinPercent } from './uci-parser';

/**
 * Convert a centipawn evaluation to expected points (0.0 to 1.0).
 * Uses the same sigmoid model as chess.com's Expected Points system.
 * 1.0 = completely winning, 0.0 = completely losing, 0.5 = even.
 */
export function cpToExpectedPoints(cp: number): number {
  return cpToWinPercent(cp) / 100;
}

/**
 * Calculate the win chance loss between two evaluations.
 * Returns a value between 0.0 (no loss) and 1.0 (total loss).
 */
export function calcWinChanceLoss(
  evalBeforeCp: number,
  evalAfterCp: number,
): number {
  const epBefore = cpToExpectedPoints(evalBeforeCp);
  const epAfter = cpToExpectedPoints(evalAfterCp);
  return Math.max(0, epBefore - epAfter);
}

/**
 * Classify a move using chess.com-style Expected Points model.
 *
 * Categories:
 * - brilliant: Sacrifice move that's also the best/excellent move
 * - great: The ONLY good move — all alternatives lose significant win chance
 * - best: Top engine choice (0 win chance loss)
 * - excellent: Negligible win chance loss (≤2%)
 * - good: Minor win chance loss (≤5%)
 * - book: Opening theory move (determined externally)
 * - forced: Only one legal move available
 * - inaccuracy: 5-10% win chance loss
 * - mistake: 10-20% win chance loss
 * - miss: Failed to punish opponent's error (opponent blundered, we didn't capitalize)
 * - blunder: >20% win chance loss
 */
export function classifyMove(opts: {
  cpLoss: number;
  winChanceLoss: number;
  evalBeforeCp: number;
  evalAfterCp: number;
  isSacrifice: boolean;
  legalMoveCount: number;
  isBookMove: boolean;
  /** True if opponent's previous move was a blunder and this move didn't capitalize */
  isMissedOpportunity: boolean;
}): MoveQuality {
  const {
    winChanceLoss,
    isSacrifice,
    legalMoveCount,
    isBookMove,
    isMissedOpportunity,
  } = opts;

  // Forced: only one legal move
  if (legalMoveCount === 1) return 'forced';

  // Book: opening theory
  if (isBookMove) return 'book';

  // Best or near-best moves — check for special brilliant/great
  if (winChanceLoss <= WIN_CHANCE_THRESHOLDS.BEST) {
    // Brilliant: it's a sacrifice AND the best move
    if (isSacrifice) return 'brilliant';
    return 'best';
  }

  if (winChanceLoss <= WIN_CHANCE_THRESHOLDS.EXCELLENT) {
    // Brilliant can also be an excellent move if it's a sacrifice
    if (isSacrifice) return 'brilliant';
    return 'excellent';
  }

  if (winChanceLoss <= WIN_CHANCE_THRESHOLDS.GOOD) {
    return 'good';
  }

  // Error moves
  if (winChanceLoss <= WIN_CHANCE_THRESHOLDS.INACCURACY) {
    return 'inaccuracy';
  }

  if (winChanceLoss <= WIN_CHANCE_THRESHOLDS.MISTAKE) {
    // Miss: opponent blundered and we didn't capitalize
    if (isMissedOpportunity) return 'miss';
    return 'mistake';
  }

  // >20% win chance loss = blunder
  // Miss variant: opponent blundered and we gave back even more
  if (isMissedOpportunity) return 'miss';
  return 'blunder';
}

/**
 * Get the annotation symbol for a move quality.
 */
export function getAnnotationSymbol(quality: MoveQuality): string {
  switch (quality) {
    case 'brilliant':
      return '!!';
    case 'great':
      return '!';
    case 'best':
      return '';
    case 'excellent':
      return '';
    case 'good':
      return '';
    case 'book':
      return '';
    case 'forced':
      return '';
    case 'inaccuracy':
      return '?!';
    case 'mistake':
      return '?';
    case 'miss':
      return '?';
    case 'blunder':
      return '??';
  }
}

/**
 * Get a display color class for a move quality.
 */
export function getQualityColor(quality: MoveQuality): string {
  switch (quality) {
    case 'brilliant':
      return '#1baca6'; // Teal — chess.com brilliant
    case 'great':
      return '#5c8bb0'; // Blue — chess.com great
    case 'best':
      return '#96bc4b'; // Green — chess.com best
    case 'excellent':
      return '#96bc4b'; // Green
    case 'good':
      return '#96bc4b'; // Green (lighter context)
    case 'book':
      return '#a88764'; // Brown — chess.com book
    case 'forced':
      return '#a0a0a0'; // Gray — neutral
    case 'inaccuracy':
      return '#f7c631'; // Yellow — chess.com inaccuracy
    case 'mistake':
      return '#e58f2a'; // Orange — chess.com mistake
    case 'miss':
      return '#e58f2a'; // Orange
    case 'blunder':
      return '#ca3431'; // Red — chess.com blunder
  }
}

/**
 * Check if a move quality represents an error (inaccuracy or worse).
 */
export function isError(quality: MoveQuality): boolean {
  return (
    quality === 'inaccuracy' ||
    quality === 'mistake' ||
    quality === 'miss' ||
    quality === 'blunder'
  );
}

/**
 * Check if a move quality represents a "good" move (not an error).
 */
export function isGoodMove(quality: MoveQuality): boolean {
  return (
    quality === 'brilliant' ||
    quality === 'great' ||
    quality === 'best' ||
    quality === 'excellent' ||
    quality === 'good' ||
    quality === 'book' ||
    quality === 'forced'
  );
}

/**
 * Detect if a move is a sacrifice by comparing material before and after.
 * A sacrifice means the player intentionally gave up material.
 */
export function detectSacrifice(
  _cpLoss: number,
  _isCapture: boolean,
  _evalBeforeCp: number,
  _evalAfterCp: number,
  materialBeforeWhite: number,
  materialAfterWhite: number,
  materialBeforeBlack: number,
  materialAfterBlack: number,
  isWhite: boolean,
): boolean {
  // Check for net material loss — the caller validates that engine still approves the move
  const playerMaterialBefore = isWhite ? materialBeforeWhite : materialBeforeBlack;
  const playerMaterialAfter = isWhite ? materialAfterWhite : materialAfterBlack;
  const opponentMaterialBefore = isWhite ? materialBeforeBlack : materialBeforeWhite;
  const opponentMaterialAfter = isWhite ? materialAfterBlack : materialAfterWhite;

  // Net material exchange: did the player lose more material than the opponent?
  const playerLost = playerMaterialBefore - playerMaterialAfter;
  const opponentLost = opponentMaterialBefore - opponentMaterialAfter;
  const netMaterialLoss = playerLost - opponentLost;

  // Sacrifice = player gives up material (net loss ≥ threshold) but engine still approves
  return netMaterialLoss >= 2; // At least a minor piece value given up
}
