import type { GameAnalysis } from '@shared/types/analysis';
import type { GameRecord } from '@shared/types/game';
import type {
  CurrentPatterns,
  WeaknessPattern,
  PatternExample,
  SkillProfile,
} from '@shared/types/patterns';
import { WeaknessTheme } from '@shared/types/patterns';
import { assignThemes } from './pattern-engine';
import { isError } from '@/engine/eval-classifier';
import { calculateSkillProfile } from './skill-calculator';

/* ────────────────────────────────────────────────────────────
 *  Time-Window definitions
 * ──────────────────────────────────────────────────────────── */

export type TimeWindowId = 'ability' | 'form' | 'trend' | 'delta';

export interface TimeWindow {
  id: TimeWindowId;
  label: string;
  gameCount: number;
}

export const TIME_WINDOWS: TimeWindow[] = [
  { id: 'ability', label: 'Ability', gameCount: 30 },
  { id: 'form', label: 'Form', gameCount: 5 },
  { id: 'trend', label: 'Trend', gameCount: 3 },
  { id: 'delta', label: 'Delta', gameCount: 1 },
];

export const DEFAULT_WINDOW: TimeWindowId = 'form';

/* ────────────────────────────────────────────────────────────
 *  Impact labels (user-facing terminology for severity)
 * ──────────────────────────────────────────────────────────── */

export type ImpactLevel = 'low' | 'medium' | 'high';

export function getImpactLevel(severityCp: number): ImpactLevel {
  if (severityCp <= 80) return 'low';
  if (severityCp <= 150) return 'medium';
  return 'high';
}

export function getImpactLabel(severityCp: number): string {
  const level = getImpactLevel(severityCp);
  switch (level) {
    case 'low': return 'Low impact';
    case 'medium': return 'Medium impact';
    case 'high': return 'High impact';
  }
}

/* ────────────────────────────────────────────────────────────
 *  Compute patterns directly from game analyses (no snapshots)
 * ──────────────────────────────────────────────────────────── */

/**
 * Lightweight pattern computation directly from GameAnalysis moves.
 * No stored snapshots needed — works on any subset of games.
 *
 * @param games - Game records (for player color + opening info)
 * @param analyses - Matching analyses
 * @param minGames - Minimum games affected for a theme to be reported (default 3, use 1 for small windows)
 */
export function computePatternsFromGames(
  games: GameRecord[],
  analyses: GameAnalysis[],
  minGames: number = 3,
): CurrentPatterns {
  const gamesInWindow = analyses.length;

  if (gamesInWindow === 0) {
    return { patterns: [], lastUpdated: Date.now(), gamesInWindow: 0 };
  }

  // Build gameId → GameRecord lookup
  const gameMap = new Map<string, GameRecord>();
  for (const g of games) {
    gameMap.set(g.id, g);
  }

  // Aggregate by theme
  const themeAgg = new Map<
    WeaknessTheme,
    { count: number; totalCpLoss: number; gamesAffected: Set<string> }
  >();
  const examplesByTheme = new Map<WeaknessTheme, PatternExample[]>();

  for (const analysis of analyses) {
    const game = gameMap.get(analysis.gameId);
    if (!game) continue;

    const playerColor = game.player.color;
    const openingName = game.opening?.name ?? '';

    // Filter to player's mistake moves
    const mistakes = analysis.moves.filter(
      (m) => m.color === playerColor && isError(m.quality),
    );

    for (const mistake of mistakes) {
      const themes = assignThemes(mistake, openingName);
      for (const theme of themes) {
        const agg = themeAgg.get(theme) ?? {
          count: 0,
          totalCpLoss: 0,
          gamesAffected: new Set<string>(),
        };
        agg.count++;
        agg.totalCpLoss += mistake.cpLoss;
        agg.gamesAffected.add(analysis.gameId);
        themeAgg.set(theme, agg);

        // Collect example positions (max 5 per theme)
        const examples = examplesByTheme.get(theme) ?? [];
        if (examples.length < 5) {
          examples.push({
            gameId: game.id,
            moveIndex: mistake.halfMoveIndex,
            fen: mistake.fenBefore,
            movePlayed: mistake.moveSan,
            bestMove: mistake.bestMoveSan ?? '?',
            cpLoss: mistake.cpLoss,
          });
          examplesByTheme.set(theme, examples);
        }
      }
    }
  }

  // Build patterns, filtering by minGames
  const patterns: WeaknessPattern[] = [];

  for (const [theme, agg] of themeAgg) {
    if (agg.gamesAffected.size < minGames) continue;

    const frequency = agg.count / gamesInWindow;
    const severity = agg.totalCpLoss / agg.count;

    // Trend: only meaningful for windows ≥ 5 games
    let trend: 'improving' | 'worsening' | 'stable' = 'stable';
    if (gamesInWindow >= 5) {
      trend = computeSimpleTrend(analyses, gameMap, theme);
    }

    patterns.push({
      id: theme,
      theme,
      frequency: Math.round(frequency * 100) / 100,
      severity: Math.round(severity),
      occurrences: agg.count,
      gamesAffected: agg.gamesAffected.size,
      trend,
      trendPercent: 0,
      examplePositions: examplesByTheme.get(theme)?.slice(0, 5) ?? [],
      firstSeen: Date.now(),
      lastSeen: Date.now(),
    });
  }

  // Sort by impact (severity × frequency)
  patterns.sort((a, b) => b.severity * b.frequency - a.severity * a.frequency);

  return {
    patterns,
    lastUpdated: Date.now(),
    gamesInWindow,
  };
}

/**
 * Simple trend: compare first half of analyses vs second half
 * for a specific theme's frequency.
 */
function computeSimpleTrend(
  analyses: GameAnalysis[],
  gameMap: Map<string, GameRecord>,
  theme: WeaknessTheme,
): 'improving' | 'worsening' | 'stable' {
  const half = Math.floor(analyses.length / 2);
  if (half < 2) return 'stable';

  const firstHalf = analyses.slice(0, half);
  const secondHalf = analyses.slice(-half);

  const freqFirst = countThemeFrequency(firstHalf, gameMap, theme);
  const freqSecond = countThemeFrequency(secondHalf, gameMap, theme);

  if (freqFirst === 0 && freqSecond === 0) return 'stable';
  if (freqFirst === 0) return 'worsening';

  const change = ((freqSecond - freqFirst) / freqFirst) * 100;

  if (change < -15) return 'improving';
  if (change > 15) return 'worsening';
  return 'stable';
}

function countThemeFrequency(
  analyses: GameAnalysis[],
  gameMap: Map<string, GameRecord>,
  theme: WeaknessTheme,
): number {
  if (analyses.length === 0) return 0;

  let total = 0;
  for (const analysis of analyses) {
    const game = gameMap.get(analysis.gameId);
    if (!game) continue;

    const playerColor = game.player.color;
    const openingName = game.opening?.name ?? '';

    const mistakes = analysis.moves.filter(
      (m) => m.color === playerColor && isError(m.quality),
    );

    for (const mistake of mistakes) {
      const themes = assignThemes(mistake, openingName);
      if (themes.includes(theme)) total++;
    }
  }

  return total / analyses.length;
}

/* ────────────────────────────────────────────────────────────
 *  Compute a full SkillProfile for a specific time window
 * ──────────────────────────────────────────────────────────── */

export interface WindowedProfileResult {
  profile: SkillProfile;
  patterns: CurrentPatterns;
  games: GameRecord[];
}

/**
 * Compute a SkillProfile for the most recent N analyzed games.
 */
export function computeWindowedProfile(
  allGames: GameRecord[],
  allAnalyses: GameAnalysis[],
  windowSize: number,
): WindowedProfileResult {
  // Sort games by playedAt descending, take those with complete analysis
  const analyzedGames = allGames
    .filter((g) => g.analysisStatus === 'complete')
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, windowSize);

  // Match analyses to the windowed games by entity ID
  const gameIds = new Set(analyzedGames.map((g) => g.id));
  let windowAnalyses = allAnalyses.filter((a) => gameIds.has(a.gameId));

  // Fallback: if most analyses can't match games (duplicate record issue),
  // use ALL analyses. The skill calculator will use summary.playerColor.
  if (windowAnalyses.length < analyzedGames.length / 2 && allAnalyses.length > 10) {
    windowAnalyses = allAnalyses;
  }

  // Always use minGames = 1 to ensure patterns are detected even with few games
  // This prevents the radar from showing uniform ~85 scores when no patterns are found
  const patterns = computePatternsFromGames(analyzedGames, windowAnalyses, 1);
  const profile = calculateSkillProfile(patterns, analyzedGames, windowAnalyses);

  return { profile, patterns, games: analyzedGames };
}
