import { sendWithFallback } from './ai-router';
import { SYSTEM_PROMPT, buildExercisePrompt, buildExerciseRetryPrompt } from './prompt-builder';
import { validateExerciseSequence } from './stockfish-validator';
import type { SequenceValidationResult } from './stockfish-validator';
import type { Exercise } from '@shared/types/ai';
import type { WeaknessPattern } from '@shared/types/patterns';
import type { UserSettings } from '@shared/types/storage';
import { VALIDATION_MAX_RETRIES } from '@shared/constants';
import { sanToUci, applyMoveToFen, uciToSan } from '@shared/utils/chess-utils';
import { validateFen } from '@/patterns/real-position-puzzles';

/**
 * Generate exercises targeting a specific weakness.
 * Uses the AI router to try all configured providers with fallback.
 * After generation, validates each exercise against Stockfish and retries if needed.
 */
export async function generateExercises(
  settings: UserSettings,
  weakness: WeaknessPattern,
  playerRating: number,
  count: number = 3,
): Promise<Exercise[]> {
  const prompt = buildExercisePrompt(weakness, playerRating, count);

  const response = await sendWithFallback(
    settings,
    SYSTEM_PROMPT,
    [{ role: 'user', content: prompt }],
  );

  const exercises = parseExerciseResponse(response, weakness);

  // Validate each exercise against Stockfish (sequentially — singleton engine)
  const validated: Exercise[] = [];
  for (const exercise of exercises) {
    const result = await validateAndRetryExercise(
      exercise,
      settings,
      weakness,
      playerRating,
    );
    validated.push(result);
  }

  return validated;
}

/**
 * Validate an exercise against Stockfish.
 * If invalid and retries remain, regenerate with engine feedback and re-validate.
 */
async function validateAndRetryExercise(
  exercise: Exercise,
  settings: UserSettings,
  weakness: WeaknessPattern,
  playerRating: number,
  attempt: number = 0,
): Promise<Exercise> {
  try {
    const validation: SequenceValidationResult = await validateExerciseSequence(exercise);

    if (validation.isValid) {
      const moveCount = exercise.solution.length;
      console.log(
        `[Chess DNA] Exercise validated ✓ (attempt ${attempt + 1}): all ${moveCount} move(s) verified`,
      );
      return { ...exercise, stockfishVerified: true };
    }

    // Invalid — retry if we have attempts left
    if (attempt < VALIDATION_MAX_RETRIES) {
      const failedIdx = validation.firstFailedIndex ?? 0;
      const failedMove = validation.moveResults[failedIdx];
      console.log(
        `[Chess DNA] Exercise invalid ✗ (attempt ${attempt + 1}), ` +
        `move[${failedIdx}] ${failedMove?.moveUci ?? '?'} failed, retrying with Stockfish feedback...`,
      );

      const retryPrompt = buildExerciseRetryPrompt(
        exercise,
        validation,
        weakness,
        playerRating,
      );

      const retryResponse = await sendWithFallback(
        settings,
        SYSTEM_PROMPT,
        [{ role: 'user', content: retryPrompt }],
      );

      const retried = parseExerciseResponse(retryResponse, weakness);
      if (retried.length > 0) {
        // Preserve original id and generatedAt
        const corrected: Exercise = {
          ...retried[0],
          id: exercise.id,
          generatedAt: exercise.generatedAt,
        };

        return validateAndRetryExercise(
          corrected,
          settings,
          weakness,
          playerRating,
          attempt + 1,
        );
      }
    }

    // Out of retries or retry failed to parse — keep but mark as unverified
    console.log(
      `[Chess DNA] Exercise could not be verified after ${attempt + 1} attempt(s): ${exercise.solution[0]}`,
    );
    return { ...exercise, stockfishVerified: false };
  } catch (error) {
    // Engine error — don't block generation, just mark as unverified
    console.error('[Chess DNA] Stockfish validation error:', error);
    return { ...exercise, stockfishVerified: false };
  }
}

/** Regex matching valid UCI move format: e.g. e2e4, d7d8q */
const UCI_REGEX = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/**
 * Normalize solution moves: ensure all moves are in UCI format.
 * AI sometimes provides SAN (e.g. "Kc3") instead of UCI ("d3c3").
 * Walk through moves, converting SAN→UCI where needed, and rebuild solutionSan.
 */
function normalizeSolutionMoves(
  fen: string,
  rawSolution: string[],
  rawSolutionSan: string[],
): { solution: string[]; solutionSan: string[] } | null {
  const solution: string[] = [];
  const solutionSan: string[] = [];
  let currentFen = fen;

  for (let i = 0; i < rawSolution.length; i++) {
    let moveUci = rawSolution[i];
    let moveSan = rawSolutionSan[i] ?? '';

    if (!UCI_REGEX.test(moveUci)) {
      // Looks like SAN — try to convert to UCI
      const converted = sanToUci(currentFen, moveUci);
      if (converted) {
        moveSan = moveUci; // the original was SAN, keep it
        moveUci = converted;
        console.log(`[Chess DNA] Normalized SAN→UCI: "${rawSolution[i]}" → "${moveUci}"`);
      } else {
        // Can't convert — try treating the solutionSan entry as backup
        const backupConverted = moveSan ? sanToUci(currentFen, moveSan) : null;
        if (backupConverted) {
          moveUci = backupConverted;
          console.log(`[Chess DNA] Used solutionSan fallback: "${moveSan}" → "${moveUci}"`);
        } else {
          console.warn(`[Chess DNA] Cannot normalize move[${i}]: "${rawSolution[i]}" at FEN: ${currentFen}`);
          return null; // Entire solution is broken
        }
      }
    } else {
      // Valid UCI — derive SAN if missing
      if (!moveSan) {
        moveSan = uciToSan(currentFen, moveUci) ?? moveUci;
      }
    }

    solution.push(moveUci);
    solutionSan.push(moveSan);

    // Advance FEN for next move
    const nextFen = applyMoveToFen(currentFen, moveUci);
    if (!nextFen) {
      console.warn(`[Chess DNA] Illegal move[${i}] "${moveUci}" at FEN: ${currentFen}`);
      return null;
    }
    currentFen = nextFen;
  }

  return { solution, solutionSan };
}

function parseExerciseResponse(
  response: string,
  weakness: WeaknessPattern,
): Exercise[] {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    const exercises = parsed.exercises;

    if (!Array.isArray(exercises)) return [];

    const results: Exercise[] = [];

    for (let index = 0; index < exercises.length; index++) {
      const item = exercises[index] as {
        fen: string;
        playerColor: string;
        solution: string[];
        solutionSan: string[];
        hint: string;
        explanation: string;
        difficulty: string;
      };

      const fen = item.fen ?? '';

      // Validate FEN is a legal chess position (prevents hallucinated positions)
      if (!fen || !validateFen(fen)) {
        console.warn(`[Chess DNA] Skipping exercise ${index}: invalid FEN "${fen}"`);
        continue;
      }

      const rawSolution = Array.isArray(item.solution) ? item.solution : [];
      const rawSolutionSan = Array.isArray(item.solutionSan) ? item.solutionSan : [];

      // Normalize solution moves: convert any SAN→UCI, validate legality
      const normalized = normalizeSolutionMoves(fen, rawSolution, rawSolutionSan);
      if (!normalized) {
        console.warn(`[Chess DNA] Skipping exercise ${index}: moves could not be normalized`);
        continue; // Skip this exercise entirely — broken moves
      }

      results.push({
        id: `exercise-${Date.now()}-${index}`,
        generatedAt: Date.now(),
        theme: weakness.theme,
        fen,
        playerColor: (item.playerColor === 'black' ? 'black' : 'white') as
          | 'white'
          | 'black',
        solution: normalized.solution,
        solutionSan: normalized.solutionSan,
        hint: item.hint ?? '',
        explanation: item.explanation ?? '',
        difficulty: (['beginner', 'intermediate', 'advanced'].includes(
          item.difficulty,
        )
          ? item.difficulty
          : 'intermediate') as 'beginner' | 'intermediate' | 'advanced',
        isCompleted: false,
        wasCorrect: null,
        attemptedAt: null,
      });
    }

    return results;
  } catch {
    console.error('[Chess Tutor] Failed to parse exercise response');
    return [];
  }
}
