/**
 * Move quality classification + sacrifice detection.
 * Verbatim port of src/engine/eval-classifier.ts (sans the UI helpers we don't need
 * server-side: getAnnotationSymbol, getQualityColor).
 * Keep in sync.
 */
import type { MoveQuality } from '../types.js';
import { WIN_CHANCE_THRESHOLDS } from '../constants.js';
import { cpToWinPercent } from './uci-parser.js';

export function cpToExpectedPoints(cp: number): number {
  return cpToWinPercent(cp) / 100;
}

export function calcWinChanceLoss(
  evalBeforeCp: number,
  evalAfterCp: number,
): number {
  const epBefore = cpToExpectedPoints(evalBeforeCp);
  const epAfter = cpToExpectedPoints(evalAfterCp);
  return Math.max(0, epBefore - epAfter);
}

export function classifyMove(opts: {
  cpLoss: number;
  winChanceLoss: number;
  evalBeforeCp: number;
  evalAfterCp: number;
  isSacrifice: boolean;
  legalMoveCount: number;
  isBookMove: boolean;
  isMissedOpportunity: boolean;
}): MoveQuality {
  const {
    winChanceLoss,
    isSacrifice,
    legalMoveCount,
    isBookMove,
    isMissedOpportunity,
  } = opts;

  if (legalMoveCount === 1) return 'forced';
  if (isBookMove) return 'book';

  if (winChanceLoss <= WIN_CHANCE_THRESHOLDS.BEST) {
    if (isSacrifice) return 'brilliant';
    return 'best';
  }

  if (winChanceLoss <= WIN_CHANCE_THRESHOLDS.EXCELLENT) {
    if (isSacrifice) return 'brilliant';
    return 'excellent';
  }

  if (winChanceLoss <= WIN_CHANCE_THRESHOLDS.GOOD) {
    return 'good';
  }

  if (winChanceLoss <= WIN_CHANCE_THRESHOLDS.INACCURACY) {
    return 'inaccuracy';
  }

  if (winChanceLoss <= WIN_CHANCE_THRESHOLDS.MISTAKE) {
    if (isMissedOpportunity) return 'miss';
    return 'mistake';
  }

  if (isMissedOpportunity) return 'miss';
  return 'blunder';
}

export function isError(quality: MoveQuality): boolean {
  return (
    quality === 'inaccuracy' ||
    quality === 'mistake' ||
    quality === 'miss' ||
    quality === 'blunder'
  );
}

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
  const playerMaterialBefore = isWhite ? materialBeforeWhite : materialBeforeBlack;
  const playerMaterialAfter = isWhite ? materialAfterWhite : materialAfterBlack;
  const opponentMaterialBefore = isWhite ? materialBeforeBlack : materialBeforeWhite;
  const opponentMaterialAfter = isWhite ? materialAfterBlack : materialAfterWhite;

  const playerLost = playerMaterialBefore - playerMaterialAfter;
  const opponentLost = opponentMaterialBefore - opponentMaterialAfter;
  const netMaterialLoss = playerLost - opponentLost;

  return netMaterialLoss >= 2;
}
