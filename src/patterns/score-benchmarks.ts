import type { SkillDimensionId, SkillProfile } from '@shared/types/patterns';

/* ────────────────────────────────────────────────────────────
 *  ELO-based skill benchmarks
 *
 *  Hardcoded benchmark data estimated from chess research.
 *  Each ELO anchor has expected dimension scores.
 *  We interpolate between anchors for smooth curves.
 * ──────────────────────────────────────────────────────────── */

export type BenchmarkRow = Record<SkillDimensionId, number>;

/**
 * Benchmark anchors — expected dimension scores per ELO level.
 * These are rough estimates based on typical player skill curves.
 */
export const BENCHMARKS: Record<number, BenchmarkRow> = {
  400: {
    openings: 18, tactics: 12, defense: 22, positional: 14,
    endgame: 10, calculation: 18, time_management: 18, resilience: 28,
  },
  600: {
    openings: 25, tactics: 20, defense: 30, positional: 20,
    endgame: 15, calculation: 25, time_management: 25, resilience: 35,
  },
  800: {
    openings: 35, tactics: 30, defense: 38, positional: 28,
    endgame: 22, calculation: 33, time_management: 32, resilience: 40,
  },
  1000: {
    openings: 42, tactics: 38, defense: 45, positional: 35,
    endgame: 30, calculation: 40, time_management: 38, resilience: 45,
  },
  1200: {
    openings: 50, tactics: 48, defense: 52, positional: 42,
    endgame: 38, calculation: 48, time_management: 44, resilience: 50,
  },
  1400: {
    openings: 56, tactics: 55, defense: 58, positional: 50,
    endgame: 46, calculation: 55, time_management: 50, resilience: 55,
  },
  1600: {
    openings: 62, tactics: 62, defense: 64, positional: 58,
    endgame: 54, calculation: 62, time_management: 56, resilience: 60,
  },
  1800: {
    openings: 68, tactics: 70, defense: 70, positional: 65,
    endgame: 62, calculation: 70, time_management: 63, resilience: 66,
  },
  2000: {
    openings: 74, tactics: 76, defense: 76, positional: 72,
    endgame: 70, calculation: 77, time_management: 70, resilience: 72,
  },
  2200: {
    openings: 80, tactics: 83, defense: 82, positional: 78,
    endgame: 78, calculation: 84, time_management: 76, resilience: 78,
  },
  2500: {
    openings: 88, tactics: 90, defense: 88, positional: 86,
    endgame: 86, calculation: 92, time_management: 84, resilience: 85,
  },
};

export const ELO_ANCHORS = Object.keys(BENCHMARKS).map(Number).sort((a, b) => a - b);

/**
 * Get interpolated benchmark for a given ELO rating.
 * Clamps to lowest/highest anchor if outside range.
 */
export function getBenchmarkForRating(elo: number): BenchmarkRow {
  const clamped = Math.max(ELO_ANCHORS[0], Math.min(ELO_ANCHORS[ELO_ANCHORS.length - 1], elo));

  // Find surrounding anchors
  let lowerElo = ELO_ANCHORS[0];
  let upperElo = ELO_ANCHORS[ELO_ANCHORS.length - 1];

  for (let i = 0; i < ELO_ANCHORS.length - 1; i++) {
    if (clamped >= ELO_ANCHORS[i] && clamped <= ELO_ANCHORS[i + 1]) {
      lowerElo = ELO_ANCHORS[i];
      upperElo = ELO_ANCHORS[i + 1];
      break;
    }
  }

  // Exact match
  if (lowerElo === upperElo || clamped === lowerElo) {
    return { ...BENCHMARKS[lowerElo] };
  }
  if (clamped === upperElo) {
    return { ...BENCHMARKS[upperElo] };
  }

  // Linear interpolation
  const t = (clamped - lowerElo) / (upperElo - lowerElo);
  const lower = BENCHMARKS[lowerElo];
  const upper = BENCHMARKS[upperElo];

  const result: Partial<BenchmarkRow> = {};
  for (const key of Object.keys(lower) as SkillDimensionId[]) {
    result[key] = Math.round(lower[key] + (upper[key] - lower[key]) * t);
  }

  return result as BenchmarkRow;
}

/**
 * Estimate percentile among players of similar rating.
 * Uses a normal distribution approximation with ~15 point standard deviation.
 * Returns 0-100.
 */
export function getPercentileEstimate(
  myScore: number,
  dimensionId: SkillDimensionId,
  elo: number,
): number {
  const benchmark = getBenchmarkForRating(elo);
  const mean = benchmark[dimensionId];
  const stdDev = 15; // approximate spread

  // z-score
  const z = (myScore - mean) / stdDev;

  // Approximate CDF using logistic sigmoid (close to normal CDF, cheap to compute)
  const percentile = 100 / (1 + Math.exp(-1.7 * z));

  return Math.round(Math.max(1, Math.min(99, percentile)));
}

/**
 * Get a friendly label for an ELO range.
 */
export function getRatingRangeLabel(elo: number): string {
  const lower = Math.floor(elo / 200) * 200;
  const upper = lower + 200;
  return `${lower}–${upper}`;
}

/**
 * Full comparison data for a profile against an ELO benchmark.
 */
export interface ComparisonData {
  dimensionId: SkillDimensionId;
  dimensionLabel: string;
  myScore: number;
  benchmarkScore: number;
  percentile: number;
  delta: number;
}

export function getComparisonData(
  profile: SkillProfile,
  elo: number,
): ComparisonData[] {
  const benchmark = getBenchmarkForRating(elo);

  return profile.dimensions.map((dim) => ({
    dimensionId: dim.id,
    dimensionLabel: dim.label,
    myScore: dim.score,
    benchmarkScore: benchmark[dim.id],
    percentile: getPercentileEstimate(dim.score, dim.id, elo),
    delta: dim.score - benchmark[dim.id],
  }));
}

/**
 * Overall percentile estimate — average across all dimensions.
 */
export function getOverallPercentile(profile: SkillProfile, elo: number): number {
  const comparisons = getComparisonData(profile, elo);
  const avg = comparisons.reduce((sum, c) => sum + c.percentile, 0) / comparisons.length;
  return Math.round(avg);
}

/**
 * Get top "flex" stats — dimensions where you crush your ELO range.
 */
export function getFlexStats(profile: SkillProfile, elo: number, n: number = 2): ComparisonData[] {
  return getComparisonData(profile, elo)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, n);
}

/**
 * Get top "struggle" stats — dimensions where you're below your ELO range.
 */
export function getStruggleStats(profile: SkillProfile, elo: number, n: number = 2): ComparisonData[] {
  return getComparisonData(profile, elo)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, n);
}

/**
 * Hardcoded "top leaders" benchmark — represents 2200+ level play.
 * Used for the "vs Leaders" comparison tab.
 */
export function getLeadersBenchmark(): BenchmarkRow {
  return { ...BENCHMARKS[2200] };
}
