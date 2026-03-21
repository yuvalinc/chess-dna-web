import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';

/* ── Colors ── */
// Series colors stay fixed (they distinguish data series, not UI chrome)
// Infrastructure colors use CSS variables for theme support
export const CHART_COLORS = {
  accent: '#4ade80',
  accentBg: 'rgba(74,222,128,0.08)',
  blue: '#38bdf8',
  blueBg: 'rgba(56,189,248,0.08)',
  openingBlue: '#3b82f6',
  openingBlueBg: 'rgba(59,130,246,0.05)',
  endgamePurple: '#a855f7',
  endgamePurpleBg: 'rgba(168,85,247,0.05)',
  blunder: '#e74c3c',
  warning: '#f59e0b',
  grid: 'var(--chess-overlay)',
  axis: 'var(--chess-grid-stroke)',
  tick: 'rgb(var(--chess-text-secondary))',
  tooltipBg: 'var(--chess-tooltip-bg)',
  tooltipBorder: 'var(--chess-tooltip-border)',
} as const;

/* ── Axis tick style ── */
export const AXIS_TICK = { fill: CHART_COLORS.tick, fontSize: 10 } as const;

/* ── Date formatter ── */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/* ── Pearson correlation coefficient ── */
export function computeCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumX2 += xs[i] * xs[i];
    sumY2 += ys[i] * ys[i];
  }

  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

export interface CorrelationInfo {
  r: number;
  label: string;
  color: string;
}

export function getCorrelationInfo(r: number): CorrelationInfo {
  if (r > 0.5) return { r, label: 'Strong ↑', color: '#4ade80' };
  if (r > 0.2) return { r, label: 'Moderate ↗', color: '#f59e0b' };
  if (r > -0.2) return { r, label: 'Weak →', color: '#94a3b8' };
  return { r, label: 'Inverse ↘', color: '#e74c3c' };
}

/* ── Shared data builders ── */

export interface TrainingImpactPoint {
  date: number;
  dateLabel: string;
  elo: number;
  accuracy: number;
  rollingAvg: number;
}

export function buildTrainingImpactData(
  games: GameRecord[],
  analyses: GameAnalysis[],
): TrainingImpactPoint[] {
  const analysisMap = new Map(analyses.map((a) => [a.gameId, a]));
  const sorted = [...games]
    .filter((g) => analysisMap.has(g.id) && g.player?.rating)
    .sort((a, b) => a.playedAt - b.playedAt);

  const windowSize = Math.min(3, sorted.length);
  const buf: number[] = [];
  let sum = 0;

  return sorted.map((g) => {
    const analysis = analysisMap.get(g.id)!;
    const acc = analysis.summary.accuracy;

    buf.push(acc);
    sum += acc;
    if (buf.length > windowSize) {
      sum -= buf.shift()!;
    }

    return {
      date: g.playedAt,
      dateLabel: formatDate(g.playedAt),
      elo: g.player.rating,
      accuracy: Math.round(acc * 10) / 10,
      rollingAvg: Math.round((sum / buf.length) * 10) / 10,
    };
  });
}

export interface PhaseAccuracyPoint {
  date: number;
  dateLabel: string;
  opening: number;
  middlegame: number;
  endgame: number;
}

export function buildPhaseAccuracyData(
  games: GameRecord[],
  analyses: GameAnalysis[],
): PhaseAccuracyPoint[] {
  const analysisMap = new Map(analyses.map((a) => [a.gameId, a]));
  return [...games]
    .filter((g) => analysisMap.has(g.id))
    .sort((a, b) => a.playedAt - b.playedAt)
    .map((g) => {
      const a = analysisMap.get(g.id)!;
      return {
        date: g.playedAt,
        dateLabel: formatDate(g.playedAt),
        opening: Math.round(a.summary.phaseAccuracy.opening * 10) / 10,
        middlegame: Math.round(a.summary.phaseAccuracy.middlegame * 10) / 10,
        endgame: Math.round(a.summary.phaseAccuracy.endgame * 10) / 10,
      };
    });
}

export interface DimensionPoint {
  date: number;
  dateLabel: string;
  [dimensionId: string]: number | string;
}

/**
 * Build approximate dimension scores over time using running averages.
 * Shows the top 4 dimensions (2 strongest + 2 weakest from current profile).
 */
export function buildDimensionOverTimeData(
  games: GameRecord[],
  analyses: GameAnalysis[],
  selectedDimIds: string[],
): DimensionPoint[] {
  const analysisMap = new Map(analyses.map((a) => [a.gameId, a]));
  const sorted = [...games]
    .filter((g) => analysisMap.has(g.id))
    .sort((a, b) => a.playedAt - b.playedAt);

  // Running averages for each accuracy metric
  let runOpeningAcc = 0;
  let runMiddlegameAcc = 0;
  let runEndgameAcc = 0;
  let runOverallAcc = 0;
  let runBestMoveRate = 0;
  let runBlunders = 0;
  let count = 0;

  return sorted.map((g) => {
    const a = analysisMap.get(g.id)!;
    count++;

    // Running averages
    runOpeningAcc += (a.summary.phaseAccuracy.opening - runOpeningAcc) / count;
    runMiddlegameAcc += (a.summary.phaseAccuracy.middlegame - runMiddlegameAcc) / count;
    runEndgameAcc += (a.summary.phaseAccuracy.endgame - runEndgameAcc) / count;
    runOverallAcc += (a.summary.accuracy - runOverallAcc) / count;
    runBestMoveRate += (a.summary.bestMoves / Math.max(1, a.summary.totalMoves) - runBestMoveRate) / count;
    runBlunders += (a.summary.blunders - runBlunders) / count;

    // Approximate dimension scores using the blending formula
    const clamp = (v: number) => Math.max(10, Math.min(99, Math.round(v)));

    const point: DimensionPoint = {
      date: g.playedAt,
      dateLabel: formatDate(g.playedAt),
    };

    // Only compute scores for selected dimensions
    const dimScores: Record<string, number> = {
      openings: clamp(runOpeningAcc * 0.5 + runOpeningAcc * 0.5),    // ~openingAcc (no patterns in running)
      tactics: clamp(runMiddlegameAcc * 0.5 + runMiddlegameAcc * 0.5),
      defense: clamp(runOverallAcc * 0.5 + runOverallAcc * 0.5),
      positional: clamp(runMiddlegameAcc * 0.5 + runMiddlegameAcc * 0.5),
      endgame: clamp(runEndgameAcc * 0.5 + runEndgameAcc * 0.5),
      calculation: clamp(runOverallAcc * 0.7 + runBestMoveRate * 100 * 0.3),
      time_management: clamp((() => {
        const phases = [runOpeningAcc, runMiddlegameAcc, runEndgameAcc];
        const avg = phases.reduce((a, b) => a + b, 0) / 3;
        const v = phases.reduce((s, p) => s + (p - avg) ** 2, 0) / 3;
        return (100 - Math.sqrt(v) * 2) * 0.6 + runOverallAcc * 0.4;
      })()),
      resilience: clamp(99 - runBlunders * 10),
    };

    for (const id of selectedDimIds) {
      point[id] = dimScores[id] ?? 50;
    }

    return point;
  });
}

/* ── No data placeholder text ── */
export const MIN_GAMES_FOR_CHARTS = 3;
