import type { MoveAnalysis } from '@shared/types/analysis';
import type { TacticalMotif } from '@shared/types/engine';
import {
  WeaknessTheme,
  type WeaknessPattern,
  type PatternSnapshot,
  type PatternExample,
  type CurrentPatterns,
} from '@shared/types/patterns';
import { PATTERN_MIN_GAMES } from '@shared/constants';

/**
 * Tag a mistake (a move with significant cpLoss) with weakness themes.
 */
export function assignThemes(
  move: MoveAnalysis,
  openingName: string,
): WeaknessTheme[] {
  const themes: WeaknessTheme[] = [];

  // Tactical motif themes
  if (move.tacticalMotifs.includes('fork' as TacticalMotif)) themes.push(WeaknessTheme.MISSED_FORK);
  if (move.tacticalMotifs.includes('pin' as TacticalMotif)) themes.push(WeaknessTheme.MISSED_PIN);
  if (move.tacticalMotifs.includes('skewer' as TacticalMotif)) themes.push(WeaknessTheme.MISSED_SKEWER);
  if (move.tacticalMotifs.includes('back_rank' as TacticalMotif)) themes.push(WeaknessTheme.BACK_RANK_WEAKNESS);
  if (move.tacticalMotifs.includes('hanging_piece' as TacticalMotif)) themes.push(WeaknessTheme.HANGING_PIECE);

  // Phase-specific themes
  if (move.phase === 'opening') {
    themes.push(WeaknessTheme.OPENING_INACCURACY);
    if (openingName) themes.push(WeaknessTheme.OPENING_SPECIFIC);
  }

  if (move.phase === 'middlegame' && move.tacticalMotifs.length > 0) {
    themes.push(WeaknessTheme.MIDDLEGAME_TACTICS);
  }

  if (move.phase === 'endgame') {
    themes.push(WeaknessTheme.ENDGAME_TECHNIQUE);
  }

  // Fallback: if we have motifs but no specific theme matched
  if (themes.length === 0 && move.tacticalMotifs.length > 0) {
    themes.push(WeaknessTheme.MISSED_TACTIC_OTHER);
  }

  // If no themes could be assigned at all, assign a phase-generic one
  if (themes.length === 0) {
    switch (move.phase) {
      case 'opening':
        themes.push(WeaknessTheme.OPENING_INACCURACY);
        break;
      case 'middlegame':
        themes.push(WeaknessTheme.PIECE_ACTIVITY);
        break;
      case 'endgame':
        themes.push(WeaknessTheme.ENDGAME_TECHNIQUE);
        break;
    }
  }

  return themes;
}

/**
 * Create a PatternSnapshot from an analyzed game's mistakes.
 */
export function createSnapshot(
  gameId: string,
  mistakes: MoveAnalysis[],
  openingName: string,
): PatternSnapshot {
  const themeMap = new Map<WeaknessTheme, { count: number; totalCpLoss: number }>();

  for (const move of mistakes) {
    const themes = assignThemes(move, openingName);
    for (const theme of themes) {
      const existing = themeMap.get(theme) ?? { count: 0, totalCpLoss: 0 };
      existing.count++;
      existing.totalCpLoss += move.cpLoss;
      themeMap.set(theme, existing);
    }
  }

  return {
    gameId,
    timestamp: Date.now(),
    themes: Array.from(themeMap.entries()).map(([theme, data]) => ({
      theme,
      count: data.count,
      totalCpLoss: data.totalCpLoss,
    })),
  };
}

/**
 * Compute weakness patterns from a collection of snapshots.
 * Uses a rolling window approach.
 */
export function computePatterns(
  snapshots: PatternSnapshot[],
  windowSize: number,
  examplesByTheme: Map<string, PatternExample[]> = new Map(),
): CurrentPatterns {
  const window = snapshots.slice(-windowSize);
  const gamesInWindow = window.length;

  if (gamesInWindow === 0) {
    return { patterns: [], lastUpdated: Date.now(), gamesInWindow: 0 };
  }

  // Aggregate by theme
  const themeAgg = new Map<
    WeaknessTheme,
    {
      count: number;
      totalCpLoss: number;
      gamesAffected: Set<string>;
    }
  >();

  for (const snapshot of window) {
    for (const entry of snapshot.themes) {
      const agg = themeAgg.get(entry.theme) ?? {
        count: 0,
        totalCpLoss: 0,
        gamesAffected: new Set<string>(),
      };
      agg.count += entry.count;
      agg.totalCpLoss += entry.totalCpLoss;
      agg.gamesAffected.add(snapshot.gameId);
      themeAgg.set(entry.theme, agg);
    }
  }

  // Filter: at least PATTERN_MIN_GAMES games affected
  const patterns: WeaknessPattern[] = [];

  for (const [theme, agg] of themeAgg) {
    if (agg.gamesAffected.size < PATTERN_MIN_GAMES) continue;

    const frequency = agg.count / gamesInWindow;
    const severity = agg.totalCpLoss / agg.count;

    // Calculate trend
    const trend = calculateTrend(snapshots, theme, windowSize);

    patterns.push({
      id: theme,
      theme,
      frequency: Math.round(frequency * 100) / 100,
      severity: Math.round(severity),
      occurrences: agg.count,
      gamesAffected: agg.gamesAffected.size,
      trend: trend.direction,
      trendPercent: Math.round(trend.percent),
      examplePositions: examplesByTheme.get(theme)?.slice(0, 5) ?? [],
      firstSeen: window.find((s) =>
        s.themes.some((t) => t.theme === theme),
      )?.timestamp ?? Date.now(),
      lastSeen: [...window]
        .reverse()
        .find((s) => s.themes.some((t) => t.theme === theme))?.timestamp ?? Date.now(),
    });
  }

  // Sort by impact (severity * frequency)
  patterns.sort((a, b) => b.severity * b.frequency - a.severity * a.frequency);

  return {
    patterns,
    lastUpdated: Date.now(),
    gamesInWindow,
  };
}

/**
 * Calculate the trend for a specific theme over the rolling window.
 * Compares the recent half vs the previous half.
 */
function calculateTrend(
  snapshots: PatternSnapshot[],
  theme: WeaknessTheme,
  windowSize: number,
): { direction: 'improving' | 'worsening' | 'stable'; percent: number } {
  const window = snapshots.slice(-windowSize);
  const half = Math.floor(window.length / 2);

  if (half < 2) return { direction: 'stable', percent: 0 };

  const recent = window.slice(-half);
  const previous = window.slice(0, half);

  const recentFreq = computeFrequency(recent, theme);
  const previousFreq = computeFrequency(previous, theme);

  if (previousFreq === 0 && recentFreq === 0) return { direction: 'stable', percent: 0 };
  if (previousFreq === 0) return { direction: 'worsening', percent: 100 };

  const change = ((recentFreq - previousFreq) / previousFreq) * 100;

  if (change < -15) return { direction: 'improving', percent: Math.abs(change) };
  if (change > 15) return { direction: 'worsening', percent: change };
  return { direction: 'stable', percent: Math.abs(change) };
}

function computeFrequency(
  snapshots: PatternSnapshot[],
  theme: WeaknessTheme,
): number {
  if (snapshots.length === 0) return 0;

  let total = 0;
  for (const snapshot of snapshots) {
    const entry = snapshot.themes.find((t) => t.theme === theme);
    if (entry) total += entry.count;
  }

  return total / snapshots.length;
}

/**
 * Get a human-readable label for a weakness theme.
 */
export function getThemeLabel(theme: WeaknessTheme): string {
  const labels: Record<WeaknessTheme, string> = {
    [WeaknessTheme.MISSED_FORK]: 'Missed Forks',
    [WeaknessTheme.MISSED_PIN]: 'Missed Pins',
    [WeaknessTheme.MISSED_SKEWER]: 'Missed Skewers',
    [WeaknessTheme.HANGING_PIECE]: 'Hanging Pieces',
    [WeaknessTheme.BACK_RANK_WEAKNESS]: 'Back Rank Weakness',
    [WeaknessTheme.MISSED_TACTIC_OTHER]: 'Missed Tactics',
    [WeaknessTheme.PAWN_STRUCTURE]: 'Pawn Structure',
    [WeaknessTheme.PIECE_ACTIVITY]: 'Piece Activity',
    [WeaknessTheme.KING_SAFETY]: 'King Safety',
    [WeaknessTheme.SPACE_CONTROL]: 'Space Control',
    [WeaknessTheme.OPENING_INACCURACY]: 'Opening Inaccuracies',
    [WeaknessTheme.OPENING_SPECIFIC]: 'Opening Preparation',
    [WeaknessTheme.MIDDLEGAME_TACTICS]: 'Middlegame Tactics',
    [WeaknessTheme.ENDGAME_TECHNIQUE]: 'Endgame Technique',
    [WeaknessTheme.ENDGAME_PAWN_PLAY]: 'Endgame Pawn Play',
    [WeaknessTheme.TIME_PRESSURE_BLUNDER]: 'Time Pressure Blunders',
  };
  return labels[theme] ?? theme;
}

/**
 * Get a tutor-style explanation of what a weakness theme means.
 */
export function getThemeDescription(theme: WeaknessTheme): string {
  const descriptions: Record<WeaknessTheme, string> = {
    [WeaknessTheme.MISSED_FORK]: 'A fork is when one piece attacks two or more enemy pieces at once. You\'re missing opportunities to play forks, or failing to see when your opponent threatens one. Recognizing double-attack patterns is one of the fastest ways to gain rating.',
    [WeaknessTheme.MISSED_PIN]: 'A pin restricts a piece from moving because it would expose a more valuable piece behind it. You\'re not spotting pin opportunities or are leaving your pieces vulnerable to pins. Learning to use pins is essential for tactical play.',
    [WeaknessTheme.MISSED_SKEWER]: 'A skewer forces a valuable piece to move, exposing a piece behind it to capture. You\'re missing these linear attack patterns. Skewers often decide games in the middlegame and endgame.',
    [WeaknessTheme.HANGING_PIECE]: 'You\'re leaving pieces undefended or moving them to squares where they can be captured for free. Before every move, check: "Is my piece safe on this square? Am I leaving anything unprotected?"',
    [WeaknessTheme.BACK_RANK_WEAKNESS]: 'Your king is trapped on the back rank without escape squares, making it vulnerable to checkmate. Create a "luft" (escape square) by pushing a pawn in front of your king when the position requires it.',
    [WeaknessTheme.MISSED_TACTIC_OTHER]: 'You\'re missing tactical opportunities in your games. Tactics are short sequences of forced moves that win material or achieve checkmate. Regular puzzle practice will sharpen your tactical vision.',
    [WeaknessTheme.PAWN_STRUCTURE]: 'Your pawn moves are creating weaknesses like doubled pawns, isolated pawns, or backward pawns. Pawns can\'t go backward, so every pawn move permanently changes the position. Think twice before pushing.',
    [WeaknessTheme.PIECE_ACTIVITY]: 'Your pieces aren\'t working together effectively. Active pieces control key squares and coordinate with each other. Look for ways to improve your worst-placed piece each move.',
    [WeaknessTheme.KING_SAFETY]: 'Your king is exposed to attacks. Keep your king safe by castling early, maintaining a solid pawn shield, and being cautious about opening files near your king.',
    [WeaknessTheme.SPACE_CONTROL]: 'You\'re not controlling enough of the board. Pieces need space to maneuver. Control the center with pawns and pieces, and restrict your opponent\'s options.',
    [WeaknessTheme.OPENING_INACCURACY]: 'You\'re making inaccurate moves in the opening phase. Focus on the three opening principles: control the center, develop your pieces, and castle your king to safety.',
    [WeaknessTheme.OPENING_SPECIFIC]: 'You\'re struggling in specific opening lines you play. Study the key ideas and typical plans in your openings. Even learning 5-6 moves of theory can make a big difference.',
    [WeaknessTheme.MIDDLEGAME_TACTICS]: 'In the middlegame, you\'re missing tactical patterns. This is where most games are decided. Scan for checks, captures, and threats (CCT) before choosing your move.',
    [WeaknessTheme.ENDGAME_TECHNIQUE]: 'Your endgame play needs work. Endgames require precise technique. Focus on king activity, passed pawn creation, and learning basic endgame positions (K+P vs K, rook endgames).',
    [WeaknessTheme.ENDGAME_PAWN_PLAY]: 'Your pawn play in the endgame is costing you. In endgames, pawns become much more important as they can promote. Learn about passed pawns, opposition, and pawn breakthroughs.',
    [WeaknessTheme.TIME_PRESSURE_BLUNDER]: 'You\'re making serious errors when time is running low. Practice playing with increment, improve your time management, and develop reliable instincts for fast play.',
  };
  return descriptions[theme] ?? 'Focus on understanding this pattern to improve your play.';
}

/**
 * Get action items for improving a specific weakness.
 */
export function getThemeActionItems(theme: WeaknessTheme): Array<{ text: string; type: 'lesson' | 'exercise' | 'tip' }> {
  const actions: Record<WeaknessTheme, Array<{ text: string; type: 'lesson' | 'exercise' | 'tip' }>> = {
    [WeaknessTheme.MISSED_FORK]: [
      { text: 'Practice fork puzzles to build pattern recognition', type: 'exercise' },
      { text: 'Learn common knight fork patterns (especially on f7/f2)', type: 'lesson' },
      { text: 'Before each move, check if any piece can attack two targets', type: 'tip' },
    ],
    [WeaknessTheme.MISSED_PIN]: [
      { text: 'Practice pin and skewer tactical puzzles', type: 'exercise' },
      { text: 'Study how bishops and rooks create pins along lines', type: 'lesson' },
      { text: 'Look for alignments between enemy pieces on ranks, files, and diagonals', type: 'tip' },
    ],
    [WeaknessTheme.MISSED_SKEWER]: [
      { text: 'Practice skewer pattern recognition exercises', type: 'exercise' },
      { text: 'Learn skewer patterns with rooks and bishops', type: 'lesson' },
      { text: 'Watch for enemy high-value pieces aligned on the same line', type: 'tip' },
    ],
    [WeaknessTheme.HANGING_PIECE]: [
      { text: 'Practice "blunder check" exercises: spot the hanging piece', type: 'exercise' },
      { text: 'Learn the CHECKS-CAPTURES-THREATS scan method', type: 'lesson' },
      { text: 'Before every move, ask: "What is my opponent threatening?"', type: 'tip' },
    ],
    [WeaknessTheme.BACK_RANK_WEAKNESS]: [
      { text: 'Solve back-rank checkmate puzzles', type: 'exercise' },
      { text: 'Study when to create luft (escape square) for your king', type: 'lesson' },
      { text: 'After castling, consider h3/h6 or g3/g6 as a prophylactic move', type: 'tip' },
    ],
    [WeaknessTheme.MISSED_TACTIC_OTHER]: [
      { text: 'Do 10-15 tactical puzzles daily on a consistent schedule', type: 'exercise' },
      { text: 'Study common tactical motifs: discovered attacks, deflection, decoy', type: 'lesson' },
      { text: 'Use the CCT method: Checks, Captures, Threats on every move', type: 'tip' },
    ],
    [WeaknessTheme.PAWN_STRUCTURE]: [
      { text: 'Practice positions with pawn structure decisions', type: 'exercise' },
      { text: 'Learn about pawn structure types: isolated, doubled, backward, passed', type: 'lesson' },
      { text: 'Think about long-term pawn structure consequences before pushing', type: 'tip' },
    ],
    [WeaknessTheme.PIECE_ACTIVITY]: [
      { text: 'Practice finding the best square for your worst piece', type: 'exercise' },
      { text: 'Study piece coordination and ideal piece placement', type: 'lesson' },
      { text: 'Each move, identify your least active piece and improve it', type: 'tip' },
    ],
    [WeaknessTheme.KING_SAFETY]: [
      { text: 'Practice defensive positions where king safety is critical', type: 'exercise' },
      { text: 'Learn pawn storm and king attack patterns to defend against', type: 'lesson' },
      { text: 'Castle early and don\'t weaken your pawn shield without good reason', type: 'tip' },
    ],
    [WeaknessTheme.SPACE_CONTROL]: [
      { text: 'Practice positions focused on space advantage and piece maneuvering', type: 'exercise' },
      { text: 'Study how grandmasters use space advantage to restrict opponents', type: 'lesson' },
      { text: 'Control the center with pawns, then expand your influence outward', type: 'tip' },
    ],
    [WeaknessTheme.OPENING_INACCURACY]: [
      { text: 'Practice opening principle positions and puzzles', type: 'exercise' },
      { text: 'Review the three opening principles in depth', type: 'lesson' },
      { text: 'Develop knights before bishops, don\'t move the same piece twice', type: 'tip' },
    ],
    [WeaknessTheme.OPENING_SPECIFIC]: [
      { text: 'Practice critical positions in your main opening repertoire', type: 'exercise' },
      { text: 'Study the key plans and ideas in your main openings', type: 'lesson' },
      { text: 'Build a small, solid repertoire and learn the first 8-10 moves deeply', type: 'tip' },
    ],
    [WeaknessTheme.MIDDLEGAME_TACTICS]: [
      { text: 'Practice middlegame tactical combinations (2-3 move sequences)', type: 'exercise' },
      { text: 'Study middlegame planning: when to attack and when to maneuver', type: 'lesson' },
      { text: 'Scan for tactical opportunities before making positional moves', type: 'tip' },
    ],
    [WeaknessTheme.ENDGAME_TECHNIQUE]: [
      { text: 'Practice fundamental endgame positions (K+P, rook endings)', type: 'exercise' },
      { text: 'Learn the Lucena and Philidor positions in rook endgames', type: 'lesson' },
      { text: 'Activate your king early in the endgame — it becomes a strong piece', type: 'tip' },
    ],
    [WeaknessTheme.ENDGAME_PAWN_PLAY]: [
      { text: 'Practice pawn endgame positions: opposition, key squares', type: 'exercise' },
      { text: 'Study passed pawn creation and pawn breakthrough patterns', type: 'lesson' },
      { text: 'Create passed pawns and use your king to support their advance', type: 'tip' },
    ],
    [WeaknessTheme.TIME_PRESSURE_BLUNDER]: [
      { text: 'Practice speed puzzles to build instinct under time pressure', type: 'exercise' },
      { text: 'Learn time management: when to spend time and when to move fast', type: 'lesson' },
      { text: 'Play with increment (e.g. 3+2 instead of 3+0) to reduce time panic', type: 'tip' },
    ],
  };
  return actions[theme] ?? [
    { text: 'Practice related tactical puzzles', type: 'exercise' as const },
    { text: 'Study the concept in a lesson', type: 'lesson' as const },
    { text: 'Review your games focusing on this theme', type: 'tip' as const },
  ];
}

/* ══════════════════════════════════════════════════════════════
 *  Per-game pattern detection — shows which patterns a single game triggered
 * ══════════════════════════════════════════════════════════════ */

export interface GamePatternMatch {
  theme: WeaknessTheme;
  label: string;
  moves: Array<{
    moveIndex: number;
    moveSan: string;
    bestMoveSan: string;
    cpLoss: number;
    phase: string;
  }>;
  totalCpLoss: number;
}

/**
 * Detect which weakness patterns a specific game's analysis triggered.
 * Reuses assignThemes() to match each mistake to pattern themes.
 */
export function detectGamePatterns(
  moves: MoveAnalysis[],
  playerColor: 'white' | 'black',
  openingName: string,
): GamePatternMatch[] {
  const playerMistakes = moves.filter(
    (m) =>
      m.color === playerColor &&
      (m.quality === 'inaccuracy' || m.quality === 'mistake' || m.quality === 'miss' || m.quality === 'blunder'),
  );

  const themeMap = new Map<WeaknessTheme, GamePatternMatch['moves']>();

  for (const move of playerMistakes) {
    const themes = assignThemes(move, openingName);
    for (const theme of themes) {
      const existing = themeMap.get(theme) ?? [];
      existing.push({
        moveIndex: move.halfMoveIndex,
        moveSan: move.moveSan,
        bestMoveSan: move.bestMoveSan,
        cpLoss: move.cpLoss,
        phase: move.phase,
      });
      themeMap.set(theme, existing);
    }
  }

  return Array.from(themeMap.entries())
    .map(([theme, themeMoves]) => ({
      theme,
      label: getThemeLabel(theme),
      moves: themeMoves,
      totalCpLoss: themeMoves.reduce((sum, m) => sum + m.cpLoss, 0),
    }))
    .sort((a, b) => b.totalCpLoss - a.totalCpLoss);
}
