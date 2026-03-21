import type { CurrentPatterns, SkillProfile, SkillDimension, SkillDimensionId } from '@shared/types/patterns';
import { WeaknessTheme } from '@shared/types/patterns';
import type { GameAnalysis, MoveAnalysis } from '@shared/types/analysis';
import type { GameRecord } from '@shared/types/game';

/* ────────────────────────────────────────────────────────────
 *  Constants
 * ──────────────────────────────────────────────────────────── */

/** Platform-average ELO used as the baseline for opponent rating multiplier */
const BENCHMARK_RATING = 1200;

/* ────────────────────────────────────────────────────────────
 *  Dimension definitions — which weakness themes map to each
 * ──────────────────────────────────────────────────────────── */

interface DimensionDef {
  id: SkillDimensionId;
  label: string;
  themes: WeaknessTheme[];
  description: string;
  /** Weight for overall rating (should sum to ~1.0 across all) */
  weight: number;
}

const DIMENSION_DEFS: DimensionDef[] = [
  {
    id: 'openings',
    label: 'Openings',
    themes: [WeaknessTheme.OPENING_INACCURACY, WeaknessTheme.OPENING_SPECIFIC],
    description: 'How well you handle the opening phase — following principles, developing pieces, and preparing for the middlegame.',
    weight: 0.12,
  },
  {
    id: 'tactics',
    label: 'Tactics',
    themes: [
      WeaknessTheme.MISSED_FORK,
      WeaknessTheme.MISSED_PIN,
      WeaknessTheme.MISSED_SKEWER,
      WeaknessTheme.MISSED_TACTIC_OTHER,
      WeaknessTheme.MIDDLEGAME_TACTICS,
    ],
    description: 'Your ability to spot forks, pins, skewers, and other tactical combinations that win material or deliver checkmate.',
    weight: 0.18,
  },
  {
    id: 'defense',
    label: 'Defense',
    themes: [WeaknessTheme.HANGING_PIECE, WeaknessTheme.BACK_RANK_WEAKNESS, WeaknessTheme.KING_SAFETY],
    description: 'How well you protect your pieces and king — avoiding hanging pieces, back-rank mates, and keeping your king safe.',
    weight: 0.15,
  },
  {
    id: 'positional',
    label: 'Positional',
    themes: [WeaknessTheme.PAWN_STRUCTURE, WeaknessTheme.PIECE_ACTIVITY, WeaknessTheme.SPACE_CONTROL],
    description: 'Your understanding of pawn structure, piece placement, and controlling space on the board.',
    weight: 0.13,
  },
  {
    id: 'endgame',
    label: 'Endgame',
    themes: [WeaknessTheme.ENDGAME_TECHNIQUE, WeaknessTheme.ENDGAME_PAWN_PLAY],
    description: 'Your technique in endgames — king activity, pawn promotion, and converting advantages.',
    weight: 0.13,
  },
  {
    id: 'calculation',
    label: 'Calculation',
    themes: [], // Derived from complex-position best-move rate, not from specific patterns
    description: 'How precisely you calculate moves — finding the best move in complex positions where multiple options exist.',
    weight: 0.15,
  },
  {
    id: 'time_management',
    label: 'Time Management',
    themes: [WeaknessTheme.TIME_PRESSURE_BLUNDER],
    description: 'How well you manage your clock — maintaining time advantage and avoiding rushed decisions under time pressure.',
    weight: 0.10,
  },
  {
    id: 'resilience',
    label: 'Resilience',
    themes: [],
    description: 'How well you fight back from losing positions — maintaining accuracy and composure when behind.',
    weight: 0.07,
  },
];

/* ────────────────────────────────────────────────────────────
 *  Main calculation
 * ──────────────────────────────────────────────────────────── */

export function calculateSkillProfile(
  patterns: CurrentPatterns | null,
  games: GameRecord[],
  analyses: GameAnalysis[],
): SkillProfile {
  const analyzedGames = games.filter((g) => g.analysisStatus === 'complete');
  const gamesUsed = analyzedGames.length;

  // Build a lookup: theme → { frequency, severity, trend }
  const patternMap = new Map<
    WeaknessTheme,
    { frequency: number; severity: number; trend: 'improving' | 'worsening' | 'stable' }
  >();
  if (patterns) {
    for (const p of patterns.patterns) {
      patternMap.set(p.theme, {
        frequency: p.frequency,
        severity: p.severity,
        trend: p.trend,
      });
    }
  }

  // Aggregate game-level stats with opponent rating multiplier
  const gameStats = computeGameStats(analyses, analyzedGames);

  // Calculate each dimension — no ELO normalization, opponent adjustment is baked into gameStats
  const dimensions: SkillDimension[] = DIMENSION_DEFS.map((def) => {
    const score = calculateDimensionScore(def, patternMap, gameStats, gamesUsed);
    const trend = calculateDimensionTrend(def, patternMap);

    return {
      id: def.id,
      label: def.label,
      score: Math.round(clamp(score, 0, 99)),
      trend,
      relatedThemes: def.themes,
      description: def.description,
    };
  });

  // Overall rating = weighted average
  let overallRating = 0;
  let totalWeight = 0;
  for (let i = 0; i < dimensions.length; i++) {
    overallRating += dimensions[i].score * DIMENSION_DEFS[i].weight;
    totalWeight += DIMENSION_DEFS[i].weight;
  }
  overallRating = Math.round(overallRating / totalWeight);

  return {
    dimensions,
    overallRating,
    calculatedAt: Date.now(),
    gamesUsed,
  };
}

/* ────────────────────────────────────────────────────────────
 *  Per-dimension scoring
 * ──────────────────────────────────────────────────────────── */

interface GameStats {
  avgAccuracy: number;
  avgBestMoveRate: number;
  avgBlundersPerGame: number;
  avgOpeningAccuracy: number;
  avgMiddlegameAccuracy: number;
  avgEndgameAccuracy: number;
  /** Best-move rate in complex positions only (legalMoveCount >= 8, not opening, |eval| <= 500cp) */
  avgComplexBestMoveRate: number;
  /** Accuracy in losing positions only (eval <= -150cp from player's perspective) */
  avgLosingPositionAccuracy: number;
}

/**
 * Compute aggregated game stats with opponent rating multiplier.
 * Each game's stats are multiplied by (opponentRating / BENCHMARK_RATING)
 * before averaging, so accuracy against stronger opponents counts more.
 */
function computeGameStats(analyses: GameAnalysis[], games: GameRecord[]): GameStats {
  if (analyses.length === 0) {
    return {
      avgAccuracy: 50,
      avgBestMoveRate: 0.2,
      avgBlundersPerGame: 2,
      avgOpeningAccuracy: 50,
      avgMiddlegameAccuracy: 50,
      avgEndgameAccuracy: 50,
      avgComplexBestMoveRate: 0.3,
      avgLosingPositionAccuracy: 90,
    };
  }

  // Build gameId → opponent rating lookup
  const ratingMap = new Map<string, number>();
  for (const g of games) {
    ratingMap.set(g.id, g.opponent.rating);
  }

  let totalAccuracy = 0;
  let totalBestRate = 0;
  let totalBlunders = 0;
  let totalOpeningAcc = 0;
  let totalMiddlegameAcc = 0;
  let totalEndgameAcc = 0;
  let totalComplexBestMoveRate = 0;
  let totalLosingAccuracy = 0;
  let gamesWithComplexPositions = 0;
  let gamesWithLosingPositions = 0;

  for (const a of analyses) {
    const opponentRating = ratingMap.get(a.gameId) ?? BENCHMARK_RATING;
    const multiplier = opponentRating / BENCHMARK_RATING;

    totalAccuracy += a.summary.accuracy * multiplier;
    totalBestRate += (a.summary.bestMoves / Math.max(1, a.summary.totalMoves)) * multiplier;
    totalBlunders += a.summary.blunders * multiplier;
    totalOpeningAcc += a.summary.phaseAccuracy.opening * multiplier;
    totalMiddlegameAcc += a.summary.phaseAccuracy.middlegame * multiplier;
    totalEndgameAcc += a.summary.phaseAccuracy.endgame * multiplier;

    // Calculation: complex position best-move rate
    const complexRate = computeComplexBestMoveRate(a.moves);
    if (complexRate !== null) {
      totalComplexBestMoveRate += complexRate * multiplier;
      gamesWithComplexPositions++;
    }

    // Resilience: accuracy in losing positions
    const losingAcc = computeLosingPositionAccuracy(a.moves, a.summary.playerColor);
    if (losingAcc !== null) {
      totalLosingAccuracy += losingAcc * multiplier;
      gamesWithLosingPositions++;
    }
  }

  const n = analyses.length;
  return {
    avgAccuracy: totalAccuracy / n,
    avgBestMoveRate: totalBestRate / n,
    avgBlundersPerGame: totalBlunders / n,
    avgOpeningAccuracy: totalOpeningAcc / n,
    avgMiddlegameAccuracy: totalMiddlegameAcc / n,
    avgEndgameAccuracy: totalEndgameAcc / n,
    avgComplexBestMoveRate: gamesWithComplexPositions > 0
      ? totalComplexBestMoveRate / gamesWithComplexPositions
      : 0.3, // default if no complex positions found in any game
    avgLosingPositionAccuracy: gamesWithLosingPositions > 0
      ? totalLosingAccuracy / gamesWithLosingPositions
      : 90, // never losing = high resilience
  };
}

/**
 * Compute best-move rate in complex positions for a single game.
 * Complex = legalMoveCount >= 8, phase !== 'opening', |eval| <= 500cp.
 * Returns null if no complex positions found.
 */
function computeComplexBestMoveRate(moves: MoveAnalysis[]): number | null {
  let complexCount = 0;
  let bestCount = 0;

  for (const m of moves) {
    if (
      m.legalMoveCount >= 8 &&
      m.phase !== 'opening' &&
      m.evalBefore.scoreType === 'cp' &&
      Math.abs(m.evalBefore.score) <= 500
    ) {
      complexCount++;
      if (m.quality === 'best' || m.quality === 'brilliant' || m.quality === 'great') {
        bestCount++;
      }
    }
  }

  if (complexCount === 0) return null;
  return bestCount / complexCount;
}

/**
 * Compute accuracy in losing positions for a single game.
 * Losing = eval <= -150cp from the player's perspective.
 * Returns null if no losing positions found (player was never behind).
 */
function computeLosingPositionAccuracy(
  moves: MoveAnalysis[],
  playerColor: 'white' | 'black',
): number | null {
  let totalWinChanceLoss = 0;
  let losingMoveCount = 0;

  for (const m of moves) {
    // Only look at the player's own moves
    if (m.color !== playerColor) continue;

    if (m.evalBefore.scoreType === 'cp') {
      // Convert eval to player's perspective (evalBefore.score is from white's perspective)
      const playerEval = playerColor === 'white' ? m.evalBefore.score : -m.evalBefore.score;

      if (playerEval <= -150) {
        totalWinChanceLoss += m.winChanceLoss;
        losingMoveCount++;
      }
    }
  }

  if (losingMoveCount === 0) return null;
  // Convert winChanceLoss (0.0 = perfect, 1.0 = worst) to accuracy (100 = perfect, 0 = worst)
  const avgWinChanceLoss = totalWinChanceLoss / losingMoveCount;
  return clamp(100 - avgWinChanceLoss * 100, 0, 100);
}

function calculateDimensionScore(
  def: DimensionDef,
  patternMap: Map<WeaknessTheme, { frequency: number; severity: number }>,
  gameStats: GameStats,
  gamesUsed: number,
): number {
  // If no games analyzed, return neutral score
  if (gamesUsed === 0) return 50;

  switch (def.id) {
    case 'openings':
      return scoreFromPatterns(def.themes, patternMap, 15, gameStats) * 0.5 +
        gameStats.avgOpeningAccuracy * 0.5;

    case 'tactics':
      return scoreFromPatterns(def.themes, patternMap, 10, gameStats) * 0.5 +
        gameStats.avgMiddlegameAccuracy * 0.5;

    case 'defense':
      return scoreFromPatterns(def.themes, patternMap, 12, gameStats) * 0.5 +
        gameStats.avgAccuracy * 0.5;

    case 'positional':
      return scoreFromPatterns(def.themes, patternMap, 15, gameStats) * 0.5 +
        gameStats.avgMiddlegameAccuracy * 0.5;

    case 'endgame':
      return scoreFromPatterns(def.themes, patternMap, 15, gameStats) * 0.5 +
        gameStats.avgEndgameAccuracy * 0.5;

    case 'calculation':
      return clamp(gameStats.avgComplexBestMoveRate * 100, 10, 99);

    case 'time_management': {
      const timePressure = patternMap.get(WeaknessTheme.TIME_PRESSURE_BLUNDER);
      const timePenalty = timePressure ? timePressure.frequency * 25 : 0;
      // Consistency: low variance between phase accuracies = good time management
      const phases = [gameStats.avgOpeningAccuracy, gameStats.avgMiddlegameAccuracy, gameStats.avgEndgameAccuracy];
      const avgPhase = phases.reduce((a, b) => a + b, 0) / 3;
      const variance = phases.reduce((s, p) => s + (p - avgPhase) ** 2, 0) / 3;
      const consistencyScore = clamp(100 - Math.sqrt(variance) * 2, 0, 100);
      return clamp(consistencyScore * 0.6 - timePenalty + gameStats.avgAccuracy * 0.4, 10, 99);
    }

    case 'resilience':
      return clamp(gameStats.avgLosingPositionAccuracy, 10, 99);

    default:
      return 50;
  }
}

/**
 * Score from pattern frequency/severity.
 * Start at 90, subtract based on how frequent + severe the mistakes are.
 * `divisor` controls sensitivity (lower = harsher penalties).
 */
function scoreFromPatterns(
  themes: WeaknessTheme[],
  patternMap: Map<WeaknessTheme, { frequency: number; severity: number }>,
  divisor: number,
  gameStats?: GameStats,
): number {
  let combinedFreq = 0;
  let totalSeverity = 0;
  let count = 0;

  for (const theme of themes) {
    const p = patternMap.get(theme);
    if (p) {
      combinedFreq += p.frequency;
      totalSeverity += p.severity;
      count++;
    }
  }

  if (count === 0) {
    // No patterns detected — derive from accuracy instead of flat 85
    if (gameStats) {
      return clamp(
        gameStats.avgAccuracy * 0.8 + gameStats.avgBestMoveRate * 100 * 0.2,
        20, 95,
      );
    }
    return 85; // absolute fallback if no stats available
  }

  const avgSeverity = totalSeverity / count;
  const penalty = combinedFreq * (avgSeverity / divisor);

  return clamp(99 - penalty, 10, 99);
}

function calculateDimensionTrend(
  def: DimensionDef,
  patternMap: Map<WeaknessTheme, { trend: 'improving' | 'worsening' | 'stable' }>,
): 'improving' | 'worsening' | 'stable' {
  let improving = 0;
  let worsening = 0;

  for (const theme of def.themes) {
    const p = patternMap.get(theme);
    if (p) {
      if (p.trend === 'improving') improving++;
      else if (p.trend === 'worsening') worsening++;
    }
  }

  if (improving > worsening) return 'improving';
  if (worsening > improving) return 'worsening';
  return 'stable';
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/* ────────────────────────────────────────────────────────────
 *  Exports for UI
 * ──────────────────────────────────────────────────────────── */

export function getDimensionDefs(): DimensionDef[] {
  return DIMENSION_DEFS;
}

/**
 * Returns the top N weakest dimensions (lowest scores).
 */
export function getWeakestDimensions(profile: SkillProfile, n: number = 3): SkillDimension[] {
  return [...profile.dimensions]
    .sort((a, b) => a.score - b.score)
    .slice(0, n);
}

/**
 * Returns the top N strongest dimensions (highest scores).
 */
export function getStrongestDimensions(profile: SkillProfile, n: number = 3): SkillDimension[] {
  return [...profile.dimensions]
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

/**
 * Get the primary WeaknessTheme to use for lesson/exercise generation
 * for a given skill dimension.
 */
export function getPrimaryThemeForDimension(dimensionId: SkillDimensionId): WeaknessTheme | null {
  const def = DIMENSION_DEFS.find((d) => d.id === dimensionId);
  if (!def || def.themes.length === 0) return null;
  return def.themes[0];
}
