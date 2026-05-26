/**
 * Constants mirrored from src/shared/constants.ts in the main app.
 * Keep in sync manually until we factor into a shared package.
 */

export const WIN_CHANCE_THRESHOLDS = {
  BEST: 0.0,
  EXCELLENT: 0.02,
  GOOD: 0.05,
  INACCURACY: 0.10,
  MISTAKE: 0.20,
} as const;

export const PHASE_WEIGHTS = {
  p: 0,
  n: 1,
  b: 1,
  r: 2,
  q: 4,
} as const;

// 4 knights + 4 bishops + 4 rooks + 2 queens = 4 + 4 + 8 + 8 = 24
export const TOTAL_PHASE_MATERIAL = 4 * 1 + 4 * 1 + 4 * 2 + 2 * 4;
