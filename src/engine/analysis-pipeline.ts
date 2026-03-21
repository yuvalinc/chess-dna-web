/**
 * Analysis pipeline for the web app.
 * Replaces Chrome extension's analysis-pipeline.ts.
 * Uses Base44 entity CRUD instead of Chrome storage.
 */
import { analyzeGame } from './game-analyzer';
import { analysisEvents } from './analysis-events';
import { isError } from './eval-classifier';
import { base44 } from '@/api/base44Client';
import { StockfishClient } from './stockfish-client';
import { createSnapshot, computePatterns, assignThemes } from '@/patterns/pattern-engine';
import { DEFAULT_WINDOW_SIZE } from '@shared/constants';
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { PatternExample, PatternSnapshot } from '@shared/types/patterns';
import type { Lesson, Exercise } from '@shared/types/ai';

// Helper to access Base44 entities
const entities = base44.entities as Record<string, any>;

/**
 * Deserialize a raw Analysis record from Base44.
 * Base44 stores `moves` as string[] (each move JSON-serialized).
 * `summary` is stored as a native object.
 * This converts moves back to their proper object types.
 */
export function deserializeAnalysis(raw: Record<string, unknown>): GameAnalysis {
  const moves = Array.isArray(raw.moves)
    ? raw.moves.map((m: unknown) => (typeof m === 'string' ? JSON.parse(m) : m))
    : [];
  return {
    ...(raw as unknown as GameAnalysis),
    moves,
  };
}

/**
 * Deserialize a raw PatternSnapshot from Base44.
 */
export function deserializePatternSnapshot(raw: Record<string, unknown>): PatternSnapshot {
  const themes = Array.isArray(raw.themes)
    ? raw.themes.map((t: unknown) => (typeof t === 'string' ? JSON.parse(t) : t))
    : [];
  return { ...(raw as unknown as PatternSnapshot), themes };
}

/**
 * Deserialize a raw Pattern (CurrentPatterns) from Base44.
 */
export function deserializePattern(raw: Record<string, unknown>): Record<string, unknown> {
  const patterns = Array.isArray(raw.patterns)
    ? raw.patterns.map((p: unknown) => (typeof p === 'string' ? JSON.parse(p) : p))
    : [];
  return { ...raw, patterns };
}

/**
 * Deserialize a raw TrainingPlan state from Base44.
 * Base44 stores `options` as string[] (each plan JSON-serialized).
 */
export function deserializeTrainingPlan(raw: Record<string, unknown>): Record<string, unknown> {
  const options = Array.isArray(raw.options)
    ? raw.options.map((o: unknown) => (typeof o === 'string' ? JSON.parse(o) : o))
    : [];
  return { ...raw, options };
}

/**
 * Serialize a TrainingPlan state for Base44 storage.
 * Converts `options` array of objects to string[].
 */
export function serializeTrainingPlan(data: Record<string, unknown>): Record<string, unknown> {
  if (!data.options) return data;
  const options = Array.isArray(data.options)
    ? data.options.map((o: unknown) => (typeof o === 'string' ? o : JSON.stringify(o)))
    : [];
  return { ...data, options };
}

/**
 * Deserialize a raw Lesson from Base44.
 * Maps themeId → theme, deserializes examplePositions from string[].
 */
export function deserializeLesson(raw: unknown): Lesson {
  const r = raw as Record<string, unknown>;
  const examplePositions = Array.isArray(r.examplePositions)
    ? r.examplePositions.map((p: unknown) => (typeof p === 'string' ? JSON.parse(p) : p))
    : [];
  const keyTakeaways = Array.isArray(r.keyTakeaways) ? r.keyTakeaways : [];
  return {
    ...r,
    theme: r.theme ?? r.themeId,
    examplePositions,
    keyTakeaways,
    conceptExplanation: r.conceptExplanation ?? r.explanation ?? '',
    difficulty: r.difficulty ?? 'beginner',
    isCompleted: r.isCompleted ?? false,
  } as Lesson;
}

/**
 * Deserialize a raw Exercise from Base44.
 * Maps themeId → theme, position → fen, deserializes solution arrays.
 */
export function deserializeExercise(raw: unknown): Exercise {
  const r = raw as Record<string, unknown>;
  const parseSafe = (v: unknown) => {
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
    return v;
  };
  return {
    ...r,
    theme: r.theme ?? r.themeId,
    fen: r.fen ?? r.position ?? '',
    solution: Array.isArray(r.solution) ? r.solution : (parseSafe(r.solution) ?? []),
    solutionSan: Array.isArray(r.solutionSan) ? r.solutionSan : (parseSafe(r.solutionSan) ?? []),
    isCompleted: r.isCompleted ?? false,
    wasCorrect: r.wasCorrect ?? null,
    attemptedAt: r.attemptedAt ?? null,
  } as Exercise;
}

/**
 * Run the full analysis pipeline for a single game.
 * 1. Load game
 * 2. Analyze with Stockfish
 * 3. Save analysis
 * 4. Update patterns
 * 5. Emit events
 */
export async function runAnalysisPipeline(
  gameId: string,
  depth: number = 18,
): Promise<GameAnalysis | null> {
  // Load game
  let game: GameRecord;
  try {
    game = await entities.Game.get(gameId);
  } catch {
    console.error('[Chess DNA] Game not found:', gameId);
    return null;
  }

  if (game.analysisStatus === 'complete') {
    console.log('[Chess DNA] Game already analyzed:', gameId);
    return null;
  }

  // Mark as analyzing
  try {
    await entities.Game.update(gameId, { analysisStatus: 'analyzing' });
  } catch (err) {
    console.warn('[Chess DNA] Failed to update game status:', err);
  }

  try {
    // Run Stockfish analysis
    const analysis = await analyzeGame(game, depth, (moveIndex, totalMoves) => {
      analysisEvents.emit({
        type: 'progress',
        gameId,
        moveIndex,
        totalMoves,
      });
    });

    // Save analysis results
    // Base44 `moves` field expects string[], so serialize each move object as JSON
    // `summary` is typed as object in the schema, so pass it as-is
    try {
      await entities.Analysis.create({
        gameId: analysis.gameId,
        moves: analysis.moves.map((m: unknown) => JSON.stringify(m)),
        summary: analysis.summary,
        analyzedAt: analysis.analyzedAt,
        engineDepth: analysis.engineDepth,
        engineVersion: analysis.engineVersion,
      });
    } catch (err) {
      console.warn('[Chess DNA] Failed to save analysis entity:', err);
    }

    // Update game record
    try {
      await entities.Game.update(gameId, {
        analysisStatus: 'complete',
        analyzedAt: Date.now(),
      });
    } catch (err) {
      console.warn('[Chess DNA] Failed to update game:', err);
    }

    // Generate pattern snapshot from mistakes
    try {
      await updatePatterns(analysis, game);
    } catch (patternErr) {
      console.warn('[Chess DNA] Pattern generation failed:', patternErr);
      // Non-fatal — analysis is still saved
    }

    // Broadcast completion
    analysisEvents.emit({ type: 'complete', gameId });
    console.log(`[Chess DNA] Analysis complete for game ${gameId}`);

    return analysis;
  } catch (err) {
    console.error('[Chess DNA] Analysis failed:', err);

    // Mark as error
    try {
      await entities.Game.update(gameId, { analysisStatus: 'error' });
    } catch {
      // Best effort
    }

    analysisEvents.emit({
      type: 'error',
      gameId,
      error: String(err),
    });

    return null;
  }
}

/**
 * Run analysis pipeline for multiple games sequentially.
 * Includes health checks and auto-restart of the Stockfish worker
 * if it becomes unresponsive (e.g. WASM memory exhaustion).
 */
export async function runBatchAnalysis(
  gameIds: string[],
  depth: number = 18,
): Promise<void> {
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  for (let i = 0; i < gameIds.length; i++) {
    const gameId = gameIds[i];

    // Health check the Stockfish worker before each game.
    // This detects crashes/hangs early and restarts the worker.
    try {
      const sf = StockfishClient.getInstance();
      await sf.ensureHealthy();
    } catch (err) {
      console.warn('[Chess DNA] Worker health check failed, attempting restart:', err);
      try {
        const sf = StockfishClient.getInstance();
        await sf.restart();
      } catch (restartErr) {
        console.error('[Chess DNA] Worker restart failed, aborting batch:', restartErr);
        break;
      }
    }

    const result = await runAnalysisPipeline(gameId, depth);

    if (result === null) {
      // Check if it was an error (not just "already analyzed")
      try {
        const game = await entities.Game.get(gameId);
        if (game.analysisStatus === 'error') {
          consecutiveFailures++;
          console.warn(`[Chess DNA] Game ${gameId} failed (consecutive failures: ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.warn('[Chess DNA] Too many consecutive failures — restarting worker and retrying');
            try {
              const sf = StockfishClient.getInstance();
              await sf.restart();
              consecutiveFailures = 0; // reset after restart
              // Retry the current game once
              const retry = await runAnalysisPipeline(gameId, depth);
              if (!retry) {
                console.error('[Chess DNA] Retry failed after worker restart — aborting remaining games');
                break;
              }
            } catch {
              console.error('[Chess DNA] Worker restart failed — aborting batch');
              break;
            }
          }
        } else {
          // Game was already analyzed or skipped — not a real failure
          consecutiveFailures = 0;
        }
      } catch {
        // Couldn't check game status — treat as failure
        consecutiveFailures++;
      }
    } else {
      consecutiveFailures = 0; // success
    }
  }

  analysisEvents.emit({ type: 'all_complete' });
}

/**
 * Update patterns after a game analysis.
 */
async function updatePatterns(
  analysis: GameAnalysis,
  game: GameRecord,
): Promise<void> {
  const mistakes = analysis.moves.filter((m) => isError(m.quality));
  const openingName = game.opening?.name ?? '';
  const snapshot = createSnapshot(game.id, mistakes, openingName);

  // Save pattern snapshot
  // Base44 arrays expect strings, so serialize theme objects
  let allSnapshots: PatternSnapshot[];
  try {
    // RLS handles user scoping server-side
    const existing = await entities.PatternSnapshot.list();
    allSnapshots = Array.isArray(existing)
      ? existing.map(deserializePatternSnapshot)
      : [];

    await entities.PatternSnapshot.create({
      ...snapshot,
      themes: snapshot.themes.map((t: unknown) => JSON.stringify(t)),
    });
    allSnapshots.push(snapshot);
  } catch {
    // If PatternSnapshot entity doesn't exist, store in localStorage
    const stored = localStorage.getItem('chess-dna:pattern-snapshots');
    allSnapshots = stored ? JSON.parse(stored) : [];
    allSnapshots.push(snapshot);
    localStorage.setItem('chess-dna:pattern-snapshots', JSON.stringify(allSnapshots));
  }

  // Build pattern examples
  const storedExamples = localStorage.getItem('chess-dna:pattern-examples');
  const existingExamples: Record<string, PatternExample[]> = storedExamples
    ? JSON.parse(storedExamples)
    : {};

  for (const mistake of mistakes) {
    const themes = assignThemes(mistake, openingName);
    for (const theme of themes) {
      const key = theme as string;
      const examples = existingExamples[key] ?? [];
      examples.push({
        gameId: game.id,
        moveIndex: mistake.halfMoveIndex,
        fen: mistake.fenBefore,
        movePlayed: mistake.moveSan,
        bestMove: mistake.bestMoveSan,
        cpLoss: mistake.cpLoss,
      } satisfies PatternExample);
      existingExamples[key] = examples.slice(-10);
    }
  }
  localStorage.setItem('chess-dna:pattern-examples', JSON.stringify(existingExamples));

  // Recompute current patterns
  const examplesByTheme = new Map<string, PatternExample[]>(
    Object.entries(existingExamples),
  );
  const patterns = computePatterns(allSnapshots, DEFAULT_WINDOW_SIZE, examplesByTheme);

  // Save current patterns
  // Base44 arrays expect strings, so serialize pattern objects
  const serializedPatterns = {
    ...patterns,
    patterns: patterns.patterns.map((p: unknown) => JSON.stringify(p)),
  };
  try {
    // RLS handles user scoping server-side
    const existingPatterns = await entities.Pattern.list();
    if (Array.isArray(existingPatterns) && existingPatterns.length > 0) {
      await entities.Pattern.update(existingPatterns[0].id, serializedPatterns);
    } else {
      await entities.Pattern.create(serializedPatterns);
    }
  } catch {
    // Fallback to localStorage
    localStorage.setItem('chess-dna:current-patterns', JSON.stringify(patterns));
  }

  console.log(
    `[Chess DNA] Patterns updated: ${patterns.patterns.length} patterns from ${patterns.gamesInWindow} games`,
  );
}
