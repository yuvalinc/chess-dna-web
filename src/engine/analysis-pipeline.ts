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
import { shouldUseFlyEngine } from './backend-config';
import { getCurrentUserEmail } from '@/contexts/AuthContext';
import { createSnapshot, computePatterns, assignThemes } from '@/patterns/pattern-engine';
import { DEFAULT_WINDOW_SIZE, MAX_PATTERN_SNAPSHOTS } from '@shared/constants';
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { PatternExample, PatternSnapshot } from '@shared/types/patterns';
import {
  getGuestEntities, createGuestEntity, updateGuestEntity, deleteGuestEntity,
  setGuestSingleton,
} from '@shared/utils/guest-storage';

// Helper to access Base44 entities
const entities = base44.entities as Record<string, any>;

/** Check if running in guest mode (no Base44 token) */
function isGuestMode(): boolean {
  try {
    return !localStorage.getItem('base44_access_token') && !localStorage.getItem('token');
  } catch {
    return false;
  }
}

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
  force: boolean = false,
): Promise<GameAnalysis | null> {
  const guest = isGuestMode();

  // Load game
  let game: GameRecord;
  try {
    if (guest) {
      const guestGames = getGuestEntities<GameRecord>('Game');
      const found = guestGames.find(g => (g as any).id === gameId);
      if (!found) throw new Error('Not found');
      game = found;
    } else {
      game = await entities.Game.get(gameId);
    }
  } catch {
    // Game not in current 5000-record API window — skip silently
    console.warn('[Chess DNA] Game not in current window, skipping:', gameId);
    return null;
  }

  if (game.analysisStatus === 'complete' && !force) {
    console.log('[Chess DNA] Game already analyzed:', gameId);
    return null;
  }

  // Force re-analysis: delete existing Analysis entity
  if (force) {
    try {
      if (guest) {
        const guestAnalyses = getGuestEntities<{ gameId: string }>('Analysis');
        const existing = guestAnalyses.find(a => a.gameId === gameId);
        if (existing) deleteGuestEntity('Analysis', (existing as any).id);
      } else {
        const existingList = await entities.Analysis.list();
        const existing = existingList.find((a: any) => a.gameId === gameId);
        if (existing) await entities.Analysis.delete((existing as any).id);
      }
      console.log('[Chess DNA] Deleted existing analysis for re-analysis:', gameId);
    } catch (err) {
      console.warn('[Chess DNA] Failed to delete existing analysis:', err);
    }
  }

  // Mark as analyzing
  try {
    if (guest) {
      updateGuestEntity('Game', gameId, { analysisStatus: 'analyzing' });
    } else {
      await entities.Game.update(gameId, { analysisStatus: 'analyzing' });
    }
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
    try {
      const analysisData = {
        gameId: analysis.gameId,
        // Store chess.com gameId for stable matching across re-imports
        chessGameId: (game as unknown as Record<string, unknown>).gameId as string | undefined,
        // Flat, server-filterable field mirroring the Game's playerUsername
        // so the Analysis fetch can also be scoped per-user (see Game create).
        playerUsername: ((game.player?.username ?? '') as string).toLowerCase(),
        moves: analysis.moves.map((m: unknown) => JSON.stringify(m)),
        summary: analysis.summary,
        analyzedAt: analysis.analyzedAt,
        engineDepth: analysis.engineDepth,
        engineVersion: analysis.engineVersion,
      };
      if (guest) {
        createGuestEntity('Analysis', analysisData);
      } else {
        await entities.Analysis.create(analysisData);
      }
    } catch (err) {
      console.warn('[Chess DNA] Failed to save analysis entity:', err);
    }

    // Update game record
    try {
      const gameUpdate = { analysisStatus: 'complete', analyzedAt: Date.now() };
      if (guest) {
        updateGuestEntity('Game', gameId, gameUpdate);
      } else {
        await entities.Game.update(gameId, gameUpdate);
      }
    } catch (err) {
      console.warn('[Chess DNA] Failed to update game:', err);
    }

    // Generate pattern snapshot from mistakes
    try {
      await updatePatterns(analysis, game);
    } catch (patternErr) {
      console.warn('[Chess DNA] Pattern generation failed:', patternErr);
    }

    // Broadcast completion
    analysisEvents.emit({ type: 'complete', gameId });
    console.log(`[Chess DNA] Analysis complete for game ${gameId}`);

    return analysis;
  } catch (err) {
    console.error('[Chess DNA] Analysis failed:', err);

    try {
      if (guest) {
        updateGuestEntity('Game', gameId, { analysisStatus: 'error' });
      } else {
        await entities.Game.update(gameId, { analysisStatus: 'error' });
      }
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
  // When the current user routes through Fly, the WASM worker is never used —
  // skip the local-worker health check / restart to avoid spinning it up for
  // nothing. The Fly client manages its own retries inside `analyzeGameRemote`.
  const usingFly = shouldUseFlyEngine(getCurrentUserEmail());

  for (let i = 0; i < gameIds.length; i++) {
    const gameId = gameIds[i];

    if (!usingFly) {
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
    }

    const result = await runAnalysisPipeline(gameId, depth);

    if (result === null) {
      // Check if it was an error (not just "already analyzed")
      try {
        let game: GameRecord;
        if (isGuestMode()) {
          const guestGames = getGuestEntities<GameRecord>('Game');
          game = guestGames.find(g => (g as any).id === gameId) as GameRecord;
        } else {
          game = await entities.Game.get(gameId);
        }
        if (game?.analysisStatus === 'error') {
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
 * Write to localStorage with quota fallback. iOS Safari enforces a ~5MB
 * cap per origin and throws QuotaExceededError on overflow — uncaught,
 * this crashes the analysis pipeline and triggers a white screen on
 * iPhone. On failure, drops the lowest-priority pattern caches and
 * retries once before giving up.
 */
function safeWritePatternStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    return;
  } catch (err) {
    console.warn(`[Chess DNA] localStorage quota hit for ${key} — pruning ancillary pattern caches and retrying`, err);
  }
  // Free space: drop the largest disposable caches first.
  for (const fallbackKey of ['chess-dna:pattern-examples', 'chess-dna:current-patterns']) {
    if (fallbackKey === key) continue;
    try { localStorage.removeItem(fallbackKey); } catch { /* noop */ }
  }
  try {
    localStorage.setItem(key, value);
  } catch (retryErr) {
    console.warn(`[Chess DNA] localStorage still over quota after cleanup; skipping write for ${key}`, retryErr);
  }
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
  if (isGuestMode()) {
    // Guest: always use localStorage
    let stored: string | null = null;
    try { stored = localStorage.getItem('chess-dna:pattern-snapshots'); } catch { /* noop */ }
    try {
      allSnapshots = stored ? JSON.parse(stored) : [];
    } catch {
      allSnapshots = [];
    }
    allSnapshots.push(snapshot);
    // Cap to prevent unbounded growth — pattern window is DEFAULT_WINDOW_SIZE,
    // we keep ~4x that for trending/history.
    if (allSnapshots.length > MAX_PATTERN_SNAPSHOTS) {
      allSnapshots = allSnapshots.slice(-MAX_PATTERN_SNAPSHOTS);
    }
    safeWritePatternStorage('chess-dna:pattern-snapshots', JSON.stringify(allSnapshots));
  } else {
    try {
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
      let stored: string | null = null;
      try { stored = localStorage.getItem('chess-dna:pattern-snapshots'); } catch { /* noop */ }
      try {
        allSnapshots = stored ? JSON.parse(stored) : [];
      } catch {
        allSnapshots = [];
      }
      allSnapshots.push(snapshot);
      if (allSnapshots.length > MAX_PATTERN_SNAPSHOTS) {
        allSnapshots = allSnapshots.slice(-MAX_PATTERN_SNAPSHOTS);
      }
      safeWritePatternStorage('chess-dna:pattern-snapshots', JSON.stringify(allSnapshots));
    }
  }

  // Build pattern examples
  let storedExamples: string | null = null;
  try { storedExamples = localStorage.getItem('chess-dna:pattern-examples'); } catch { /* noop */ }
  let existingExamples: Record<string, PatternExample[]> = {};
  if (storedExamples) {
    try { existingExamples = JSON.parse(storedExamples); } catch { existingExamples = {}; }
  }

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
  safeWritePatternStorage('chess-dna:pattern-examples', JSON.stringify(existingExamples));

  // Recompute current patterns
  const examplesByTheme = new Map<string, PatternExample[]>(
    Object.entries(existingExamples),
  );
  const patterns = computePatterns(allSnapshots, DEFAULT_WINDOW_SIZE, examplesByTheme);

  // Save current patterns
  if (isGuestMode()) {
    // Guest: save to guest storage
    setGuestSingleton('Pattern', patterns);
  } else {
    // Authenticated: save to Base44
    const serializedPatterns = {
      ...patterns,
      patterns: patterns.patterns.map((p: unknown) => JSON.stringify(p)),
    };
    try {
      const existingPatterns = await entities.Pattern.list();
      if (Array.isArray(existingPatterns) && existingPatterns.length > 0) {
        await entities.Pattern.update(existingPatterns[0].id, serializedPatterns);
      } else {
        await entities.Pattern.create(serializedPatterns);
      }
    } catch {
      safeWritePatternStorage('chess-dna:current-patterns', JSON.stringify(patterns));
    }
  }

  console.log(
    `[Chess DNA] Patterns updated: ${patterns.patterns.length} patterns from ${patterns.gamesInWindow} games`,
  );
}
