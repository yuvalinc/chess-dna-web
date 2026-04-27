import type { CurrentPatterns, SkillProfile, SkillDimension, SkillDimensionId } from '@shared/types/patterns';
import type { GameAnalysis, MoveAnalysis } from '@shared/types/analysis';
import type { GameRecord } from '@shared/types/game';
import type { SkillCalcConfigSchema, DimensionConfig, MoveFilter } from '@shared/types/skill-config';
import { getDefaultConfig } from './skill-config-loader';
import { DEFAULT_BUCKET_SCORES } from '@shared/constants';

/* ────────────────────────────────────────────────────────────
 *  Main calculation — filter-based scoring
 *
 *  Each dimension score = average accuracy of moves matching
 *  the dimension's filters, optionally adjusted by opponent's
 *  actual accuracy in each game.
 * ──────────────────────────────────────────────────────────── */

export function calculateSkillProfile(
  _patterns: CurrentPatterns | null,
  games: GameRecord[],
  analyses: GameAnalysis[],
  config?: SkillCalcConfigSchema,
): SkillProfile {
  const cfg = config ?? getDefaultConfig();
  const analyzedGames = games.filter((g) => g.analysisStatus === 'complete');
  const gamesUsed = analyzedGames.length;

  if (gamesUsed === 0) {
    return {
      dimensions: cfg.dimensions.map((d) => ({
        id: d.id as SkillDimensionId,
        label: d.label,
        score: 50,
        trend: 'stable' as const,
        relatedThemes: [],
        description: d.description,
      })),
      overallRating: 50,
      calculatedAt: Date.now(),
      gamesUsed: 0,
    };
  }

  // Build lookup: gameId → opponent accuracy (for opponent adjustment)
  const opponentAccuracyMap = buildOpponentAccuracyMap(analyses, analyzedGames);

  // Collect all player moves with their game context
  const allPlayerMoves = collectPlayerMoves(analyses, analyzedGames);

  // Calculate each dimension
  const dimensions: SkillDimension[] = cfg.dimensions.map((dimCfg) => {
    const score = calculateDimensionScore(dimCfg, allPlayerMoves, opponentAccuracyMap, cfg.baselineAccuracy);

    return {
      id: dimCfg.id as SkillDimensionId,
      label: dimCfg.label,
      score: Math.round(clamp(score, dimCfg.clampMin, dimCfg.clampMax)),
      trend: 'stable' as const, // TODO: compute from recent vs older games
      relatedThemes: [],
      description: dimCfg.description,
    };
  });

  // Overall rating = weighted average
  let overallRating = 0;
  let totalWeight = 0;
  for (let i = 0; i < dimensions.length; i++) {
    overallRating += dimensions[i].score * cfg.dimensions[i].weight;
    totalWeight += cfg.dimensions[i].weight;
  }
  overallRating = Math.round(totalWeight > 0 ? overallRating / totalWeight : 50);

  return {
    dimensions,
    overallRating,
    calculatedAt: Date.now(),
    gamesUsed,
  };
}

/* ────────────────────────────────────────────────────────────
 *  Complexity weight — harder positions count more
 *
 *  This separates strong from weak players: both may play
 *  "best" moves, but strong players do it in complex positions.
 * ──────────────────────────────────────────────────────────── */

function getComplexityWeight(move: MoveAnalysis): number {
  let weight = 1.0;

  // More candidate moves = harder position
  const moves = move.legalMoveCount;
  if (moves <= 3) weight *= 0.5;
  else if (moves <= 7) weight *= 0.8;
  else if (moves <= 15) weight *= 1.0;
  else if (moves <= 25) weight *= 1.3;
  else weight *= 1.5;

  // Equal positions are harder than decisive ones
  if (move.evalBefore.scoreType === 'cp') {
    const absEval = Math.abs(move.evalBefore.score);
    if (absEval < 100) weight *= 1.2;       // roughly equal — hardest
    else if (absEval < 300) weight *= 1.0;   // slight advantage
    else if (absEval < 600) weight *= 0.8;   // clear advantage — easier
    else weight *= 0.6;                       // winning/losing — easiest
  }

  // Tactical positions are harder to navigate
  if (move.tacticalMotifs.length > 0) weight *= 1.15;

  return weight;
}

/* ────────────────────────────────────────────────────────────
 *  Per-dimension scoring — filter + complexity-weighted average
 * ──────────────────────────────────────────────────────────── */

interface PlayerMove {
  move: MoveAnalysis;
  gameId: string;
  playerColor: 'white' | 'black';
}

/** Resolve bucket scores: dimension-specific overrides merged with defaults */
function resolveBuckets(dimCfg: DimensionConfig): Record<string, number | null> {
  const custom = dimCfg.scoring?.buckets;
  if (!custom || Object.keys(custom).length === 0) return DEFAULT_BUCKET_SCORES;
  return { ...DEFAULT_BUCKET_SCORES, ...custom };
}

/** Score a single move using quality bucket lookup. Returns null if excluded. */
export function scoreMoveByBucket(quality: string, buckets: Record<string, number | null>): number | null {
  const val = buckets[quality];
  if (val === undefined) return DEFAULT_BUCKET_SCORES[quality] ?? null;
  return val;
}

function calculateDimensionScore(
  dimCfg: DimensionConfig,
  allMoves: PlayerMove[],
  opponentAccuracyMap: Map<string, number>,
  baselineAccuracy: number,
): number {
  // Filter moves that match this dimension
  const matching = allMoves.filter((pm) => matchesFilters(pm.move, dimCfg.filters));

  if (matching.length === 0) return 50; // no data

  const buckets = resolveBuckets(dimCfg);

  if (dimCfg.opponentAdjust) {
    let totalScore = 0;
    let totalWeight = 0;
    for (const pm of matching) {
      const moveScore = scoreMoveByBucket(pm.move.quality, buckets);
      if (moveScore == null) continue; // excluded (e.g. forced)
      const oppAcc = opponentAccuracyMap.get(pm.gameId) ?? baselineAccuracy;
      const cw = getComplexityWeight(pm.move);
      const weight = (oppAcc / baselineAccuracy) * cw;
      totalScore += moveScore * weight;
      totalWeight += weight;
    }
    return totalWeight > 0 ? totalScore / totalWeight : 50;
  } else {
    let totalScore = 0;
    let totalWeight = 0;
    for (const pm of matching) {
      const moveScore = scoreMoveByBucket(pm.move.quality, buckets);
      if (moveScore == null) continue;
      const cw = getComplexityWeight(pm.move);
      totalScore += moveScore * cw;
      totalWeight += cw;
    }
    return totalWeight > 0 ? totalScore / totalWeight : 50;
  }
}

/* ────────────────────────────────────────────────────────────
 *  Move filter matching
 * ──────────────────────────────────────────────────────────── */

function matchesFilters(move: MoveAnalysis, filters: MoveFilter[]): boolean {
  if (filters.length === 0) return true; // no filters = match all
  // OR logic: match if ANY filter passes
  return filters.some((f) => matchesSingleFilter(move, f));
}

function matchesSingleFilter(move: MoveAnalysis, filter: MoveFilter): boolean {
  // Phase filter
  if (filter.phases && filter.phases.length > 0) {
    if (!filter.phases.includes(move.phase)) return false;
  }

  // Tactical motifs
  if (filter.hasTactics === true && move.tacticalMotifs.length === 0) return false;
  if (filter.hasTactics === false && move.tacticalMotifs.length > 0) return false;

  if (filter.tacticalMotifs && filter.tacticalMotifs.length > 0) {
    const hasMatch = filter.tacticalMotifs.some((m) => move.tacticalMotifs.includes(m));
    if (!hasMatch) return false;
  }

  // Eval range (player perspective)
  if (filter.evalRange) {
    if (move.evalBefore.scoreType !== 'cp') return false;
    // evalBefore.score is from white's perspective; convert to player's
    const playerEval = move.color === 'white' ? move.evalBefore.score : -move.evalBefore.score;
    if (playerEval < filter.evalRange.min || playerEval > filter.evalRange.max) return false;
  }

  // Complexity range
  if (filter.complexityRange) {
    if (move.legalMoveCount < filter.complexityRange.min) return false;
    if (move.legalMoveCount > filter.complexityRange.max) return false;
  }

  // Exclude forced moves
  if (filter.excludeForced && move.legalMoveCount <= 1) return false;

  // Move types
  if (filter.moveTypes && filter.moveTypes.length > 0) {
    const hasType = filter.moveTypes.some((t) => {
      switch (t) {
        case 'capture': return move.isCapture;
        case 'check': return move.isCheck;
        case 'castling': return move.isCastling;
        case 'sacrifice': return move.isSacrifice;
        default: return false;
      }
    });
    if (!hasType) return false;
  }

  // Time range (only if clock data available)
  if (filter.timeRange) {
    if (move.timeSpent == null) return false;
    if (move.timeSpent < filter.timeRange.min || move.timeSpent > filter.timeRange.max) return false;
  }

  return true;
}

/* ────────────────────────────────────────────────────────────
 *  Helper: collect all player moves across games
 * ──────────────────────────────────────────────────────────── */

function collectPlayerMoves(analyses: GameAnalysis[], games: GameRecord[]): PlayerMove[] {
  // Primary: match by Base44 entity ID
  const gameMap = new Map<string, GameRecord>();
  for (const g of games) gameMap.set(g.id, g);

  const result: PlayerMove[] = [];
  let matched = 0;
  let unmatched = 0;

  for (const a of analyses) {
    const game = gameMap.get(a.gameId);
    if (game) {
      matched++;
      const playerColor = game.player.color;
      for (const move of a.moves) {
        if (move.color === playerColor) {
          result.push({ move, gameId: a.gameId, playerColor });
        }
      }
    } else {
      unmatched++;
    }
  }

  // Fallback: if most analyses couldn't match games (duplicate record issue),
  // use the analysis summary's playerColor directly without game lookup.
  // Use a lenient threshold: if more than half of analyses are unmatched, use fallback.
  if (unmatched > matched && analyses.length > 0) {
    console.warn(`[Chess DNA Skill] collectPlayerMoves fallback: ${unmatched} unmatched > ${matched} matched — using summary.playerColor`);
    const fallbackResult: PlayerMove[] = [];
    for (const a of analyses) {
      // Use summary.playerColor if available, else guess from first move
      const playerColor = a.summary?.playerColor || (a.moves[0]?.color === 'white' ? 'white' : 'black');
      if (!playerColor) continue;
      for (const move of a.moves) {
        if (move.color === playerColor) {
          fallbackResult.push({ move, gameId: a.gameId, playerColor });
        }
      }
    }
    return fallbackResult;
  }

  return result;
}

/* ────────────────────────────────────────────────────────────
 *  Helper: opponent accuracy map
 *  For each game, compute the OPPONENT's actual accuracy
 *  (not their ELO). This is used to weight the player's
 *  accuracy — harder opponents (higher actual accuracy)
 *  give a bonus.
 * ──────────────────────────────────────────────────────────── */

function buildOpponentAccuracyMap(
  analyses: GameAnalysis[],
  games: GameRecord[],
): Map<string, number> {
  const gameMap = new Map<string, GameRecord>();
  for (const g of games) gameMap.set(g.id, g);

  const map = new Map<string, number>();

  for (const a of analyses) {
    const game = gameMap.get(a.gameId);
    // Derive opponent color: from game if matched, else from summary
    const playerColor = game?.player?.color || a.summary?.playerColor || 'white';
    const opponentColor = playerColor === 'white' ? 'black' : 'white';
    const opponentMoves = a.moves.filter((m) => m.color === opponentColor);

    if (opponentMoves.length === 0) {
      map.set(a.gameId, 50);
      continue;
    }

    // Opponent accuracy = average (100 - winChanceLoss × 100)
    const totalAcc = opponentMoves.reduce((sum, m) => sum + (100 - m.winChanceLoss * 100), 0);
    map.set(a.gameId, totalAcc / opponentMoves.length);
  }

  return map;
}

/* ────────────────────────────────────────────────────────────
 *  Utility
 * ──────────────────────────────────────────────────────────── */

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/* ────────────────────────────────────────────────────────────
 *  Exports for UI
 * ──────────────────────────────────────────────────────────── */

export function getDimensionDefs() {
  const cfg = getDefaultConfig();
  return cfg.dimensions.map((d) => ({
    id: d.id,
    label: d.label,
    description: d.description,
    weight: d.weight,
    filters: d.filters,
  }));
}

export function getWeakestDimensions(profile: SkillProfile, n: number = 3): SkillDimension[] {
  return [...profile.dimensions]
    .sort((a, b) => a.score - b.score)
    .slice(0, n);
}

export function getStrongestDimensions(profile: SkillProfile, n: number = 3): SkillDimension[] {
  return [...profile.dimensions]
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

export function getPrimaryThemeForDimension(_dimensionId: SkillDimensionId) {
  // With filter-based scoring, dimensions don't map to specific themes anymore.
  // Return null — callers should use dimension filters instead.
  return null;
}

/**
 * Compute how many moves match a dimension's filters.
 * Used by the Studio UI to show "Potential: N moves".
 */
export function countMatchingMoves(
  dimCfg: DimensionConfig,
  analyses: GameAnalysis[],
  games: GameRecord[],
): { matching: number; total: number; avgAccuracy: number } {
  const allMoves = collectPlayerMoves(analyses, games);
  const matching = allMoves.filter((pm) => matchesFilters(pm.move, dimCfg.filters));

  const buckets = resolveBuckets(dimCfg);
  let totalScore = 0;
  let count = 0;
  for (const pm of matching) {
    const moveScore = scoreMoveByBucket(pm.move.quality, buckets);
    if (moveScore == null) continue;
    totalScore += moveScore;
    count++;
  }

  return {
    matching: matching.length,
    total: allMoves.length,
    avgAccuracy: count > 0 ? totalScore / count : 0,
  };
}
