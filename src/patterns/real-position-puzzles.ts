import { Chess } from 'chess.js';
import type { Exercise } from '@shared/types/ai';
import type { WeaknessPattern, PatternExample, WeaknessTheme } from '@shared/types/patterns';
import { getThemeLabel } from './pattern-engine';
import { uciToSan } from '@shared/utils/chess-utils';

/**
 * Theme-specific hints for puzzles generated from real game positions.
 */
const THEME_HINTS: Partial<Record<WeaknessTheme, string>> = {
  missed_fork: 'Look for a move that attacks two pieces at once.',
  missed_pin: 'Look for a piece that can pin an opponent\'s piece to a more valuable one.',
  missed_skewer: 'Look for a check or attack that forces a piece to move, exposing another.',
  hanging_piece: 'One of the opponent\'s pieces is unprotected.',
  back_rank_weakness: 'Look at the opponent\'s back rank.',
  missed_tactic_other: 'There\'s a tactical idea in this position.',
  pawn_structure: 'Think about how to improve your pawn structure.',
  piece_activity: 'Find the best square for your most passive piece.',
  king_safety: 'Consider king safety in this position.',
  space_control: 'Look for a move that controls more of the board.',
  opening_inaccuracy: 'What\'s the best developing move here?',
  opening_specific: 'Find the strongest continuation in this opening.',
  middlegame_tactics: 'There\'s a tactical opportunity in the middlegame.',
  endgame_technique: 'Find the best endgame technique.',
  endgame_pawn_play: 'Think about pawn advancement and promotion.',
  time_pressure_blunder: 'Take your time and find the best move.',
};

/**
 * Validate that a FEN string represents a legal chess position.
 */
export function validateFen(fen: string): boolean {
  try {
    const chess = new Chess(fen);
    return chess.fen() === fen || chess.fen().split(' ').slice(0, 4).join(' ') === fen.split(' ').slice(0, 4).join(' ');
  } catch {
    return false;
  }
}

/**
 * Create a single-move puzzle from a real game position where the player made a mistake.
 * The player must find the best move (which they missed in the actual game).
 */
export function createRealPositionPuzzle(
  example: PatternExample,
  theme: WeaknessTheme,
  _index: number,
): Exercise | null {
  // Validate the FEN
  if (!validateFen(example.fen)) {
    console.warn(`[Chess DNA] Invalid FEN in real position puzzle: ${example.fen}`);
    return null;
  }

  // Determine player color from FEN (whose turn it is)
  const fenParts = example.fen.split(' ');
  const playerColor: 'white' | 'black' = fenParts[1] === 'w' ? 'white' : 'black';

  // Convert bestMove to SAN if it's in UCI format
  let bestMoveSan = example.bestMove;
  let bestMoveUci = example.bestMove;

  // If bestMove looks like SAN (contains uppercase letters or 'O-O'), keep as-is
  // If it looks like UCI (4-5 chars, all lowercase letters/digits), convert
  const isUci = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(example.bestMove);
  if (isUci) {
    bestMoveUci = example.bestMove;
    bestMoveSan = uciToSan(example.fen, example.bestMove) ?? example.bestMove;
  } else {
    // It's SAN — try to get UCI
    try {
      const chess = new Chess(example.fen);
      const move = chess.move(example.bestMove);
      if (move) {
        bestMoveUci = move.from + move.to + (move.promotion ?? '');
        bestMoveSan = example.bestMove;
      }
    } catch {
      // Keep original
    }
  }

  const themeLabel = getThemeLabel(theme).toLowerCase();
  const hint = THEME_HINTS[theme] ?? 'Find the best move in this position.';

  return {
    id: `real-${example.gameId}-${example.moveIndex}`,
    generatedAt: Date.now(),
    theme,
    fen: example.fen,
    playerColor,
    solution: [bestMoveUci],
    solutionSan: [bestMoveSan],
    hint,
    explanation: `In your game, you played ${example.movePlayed} (losing ~${example.cpLoss}cp). The best move was ${bestMoveSan}. This is a ${themeLabel} pattern from one of your real games.`,
    difficulty: example.cpLoss > 200 ? 'beginner' : example.cpLoss > 100 ? 'intermediate' : 'advanced',
    isCompleted: false,
    wasCorrect: null,
    attemptedAt: null,
    stockfishVerified: true,
  };
}

/**
 * Fisher-Yates shuffle — returns a new shuffled copy.
 */
function shuffle<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Generate puzzles from real game positions matching a weakness theme.
 * Returns up to `count` puzzles from a shuffled pool of top candidates.
 * Pass `excludeIds` to skip puzzles already served in the current session.
 */
export function generateRealPositionPuzzles(
  patterns: WeaknessPattern[],
  theme: WeaknessTheme,
  count: number = 3,
  excludeIds?: Set<string>,
): Exercise[] {
  // Collect all example positions for this theme
  const matching = patterns.filter((p) => p.theme === theme);
  const allExamples: PatternExample[] = [];
  for (const pattern of matching) {
    allExamples.push(...pattern.examplePositions);
  }

  if (allExamples.length === 0) return [];

  // Sort by cpLoss descending, take a wider pool, then shuffle for variety
  allExamples.sort((a, b) => b.cpLoss - a.cpLoss);
  const poolSize = Math.min(allExamples.length, count * 3);
  const pool = shuffle(allExamples.slice(0, poolSize));

  // Create puzzles, skipping excluded IDs and invalid FENs
  const puzzles: Exercise[] = [];
  for (let i = 0; i < pool.length && puzzles.length < count; i++) {
    const puzzle = createRealPositionPuzzle(pool[i], theme, i);
    if (puzzle && (!excludeIds || !excludeIds.has(puzzle.id))) {
      puzzles.push(puzzle);
    }
  }

  // If exclusions filtered too many, try the rest of the pool without exclusion filter
  if (puzzles.length < count) {
    for (let i = 0; i < pool.length && puzzles.length < count; i++) {
      const puzzle = createRealPositionPuzzle(pool[i], theme, i);
      if (puzzle && !puzzles.some(p => p.id === puzzle.id)) {
        puzzles.push(puzzle);
      }
    }
  }

  return puzzles;
}

/**
 * Generate puzzles from any available weakness patterns, regardless of theme.
 * Useful as a fallback when no specific theme has enough examples.
 */
export function generateAnyRealPositionPuzzles(
  patterns: WeaknessPattern[],
  count: number = 3,
  excludeTheme?: WeaknessTheme,
  excludeIds?: Set<string>,
): Exercise[] {
  const allExamples: { example: PatternExample; theme: WeaknessTheme }[] = [];
  for (const pattern of patterns) {
    if (excludeTheme && pattern.theme === excludeTheme) continue;
    for (const ex of pattern.examplePositions) {
      allExamples.push({ example: ex, theme: pattern.theme });
    }
  }

  // Sort by cpLoss descending, take wider pool, then shuffle
  allExamples.sort((a, b) => b.example.cpLoss - a.example.cpLoss);
  const poolSize = Math.min(allExamples.length, count * 3);
  const pool = shuffle(allExamples.slice(0, poolSize));

  const puzzles: Exercise[] = [];
  for (let i = 0; i < pool.length && puzzles.length < count; i++) {
    const { example, theme } = pool[i];
    const puzzle = createRealPositionPuzzle(example, theme, i);
    if (puzzle && (!excludeIds || !excludeIds.has(puzzle.id))) {
      puzzles.push(puzzle);
    }
  }

  return puzzles;
}
