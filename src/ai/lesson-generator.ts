import { sendWithFallback } from './ai-router';
import { SYSTEM_PROMPT, buildLessonPrompt, buildLessonPositionRetryPrompt } from './prompt-builder';
import { validateLessonPosition } from './stockfish-validator';
import type { Lesson, LessonPosition } from '@shared/types/ai';
import type { WeaknessPattern } from '@shared/types/patterns';
import type { UserSettings } from '@shared/types/storage';
import { VALIDATION_MAX_RETRIES } from '@shared/constants';
import { validateFen } from '@/patterns/real-position-puzzles';

/**
 * Generate a lesson for a specific weakness theme.
 * Uses the AI router to try all configured providers with fallback.
 * After generation, validates each example position against Stockfish and retries if needed.
 * Positions matching real player game positions skip Stockfish validation (already verified).
 */
export async function generateLesson(
  settings: UserSettings,
  weakness: WeaknessPattern,
  playerRating: number,
): Promise<Lesson | null> {
  const prompt = buildLessonPrompt(weakness, playerRating);

  // Collect real FENs from the weakness pattern for skip-validation matching
  const realFens = new Set(
    weakness.examplePositions.slice(0, 3).map((ex) => ex.fen.split(' ').slice(0, 4).join(' ')),
  );

  const response = await sendWithFallback(
    settings,
    SYSTEM_PROMPT,
    [{ role: 'user', content: prompt }],
  );

  const lesson = parseLessonResponse(response, weakness);
  if (!lesson) return null;

  // Validate each example position against Stockfish (sequentially — singleton engine)
  // Skip validation for positions whose FEN matches a real player position
  const validatedPositions: LessonPosition[] = [];
  let allVerified = true;

  for (const position of lesson.examplePositions) {
    const fenKey = position.fen.split(' ').slice(0, 4).join(' ');
    if (realFens.has(fenKey)) {
      // Real position from player's games — already verified, skip Stockfish
      console.log(`[Chess DNA] Lesson position is from player's games, skipping validation: ${position.fen.slice(0, 40)}...`);
      validatedPositions.push({ ...position, stockfishVerified: true });
      continue;
    }

    const result = await validateAndRetryPosition(
      position,
      settings,
      weakness,
      playerRating,
    );
    validatedPositions.push(result);
    if (!result.stockfishVerified) {
      allVerified = false;
    }
  }

  return {
    ...lesson,
    examplePositions: validatedPositions,
    stockfishVerified: allVerified,
  };
}

/**
 * Validate a lesson position against Stockfish.
 * If invalid and retries remain, regenerate with engine feedback and re-validate.
 */
async function validateAndRetryPosition(
  position: LessonPosition,
  settings: UserSettings,
  weakness: WeaknessPattern,
  playerRating: number,
  attempt: number = 0,
): Promise<LessonPosition> {
  try {
    const validation = await validateLessonPosition(position);

    if (validation.isValid) {
      console.log(
        `[Chess DNA] Lesson position validated ✓ (attempt ${attempt + 1}): ${position.correctMove} matches engine within tolerance`,
      );
      return { ...position, stockfishVerified: true };
    }

    // Invalid — retry if we have attempts left
    if (attempt < VALIDATION_MAX_RETRIES) {
      console.log(
        `[Chess DNA] Lesson position invalid ✗ (attempt ${attempt + 1}), retrying with Stockfish feedback...`,
      );

      const retryPrompt = buildLessonPositionRetryPrompt(
        position,
        validation,
        weakness,
        playerRating,
      );

      const retryResponse = await sendWithFallback(
        settings,
        SYSTEM_PROMPT,
        [{ role: 'user', content: retryPrompt }],
      );

      const retried = parseSingleLessonPosition(retryResponse);
      if (retried) {
        return validateAndRetryPosition(
          retried,
          settings,
          weakness,
          playerRating,
          attempt + 1,
        );
      }
    }

    // Out of retries or retry failed — keep but mark as unverified
    console.log(
      `[Chess DNA] Lesson position could not be verified after ${attempt + 1} attempt(s): ${position.correctMove}`,
    );
    return { ...position, stockfishVerified: false };
  } catch (error) {
    // Engine error — don't block generation, just mark as unverified
    console.error('[Chess DNA] Stockfish validation error:', error);
    return { ...position, stockfishVerified: false };
  }
}

/**
 * Parse a single LessonPosition from a retry response.
 * The retry prompt asks for a single position JSON (not wrapped in a lesson).
 */
function parseSingleLessonPosition(response: string): LessonPosition | null {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate required fields
    if (!parsed.fen || !parsed.correctMove) return null;

    return {
      fen: parsed.fen,
      description: parsed.description ?? '',
      correctMove: parsed.correctMove,
      explanation: parsed.explanation ?? '',
    };
  } catch {
    console.error('[Chess DNA] Failed to parse single lesson position retry response');
    return null;
  }
}

function parseLessonResponse(
  response: string,
  weakness: WeaknessPattern,
): Lesson | null {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    const examplePositions: LessonPosition[] = (parsed.examplePositions ?? [])
      .filter((pos: { fen?: string }) => pos.fen && validateFen(pos.fen))
      .map(
        (pos: { fen: string; description: string; correctMove: string; explanation: string }) => ({
          fen: pos.fen ?? '',
          description: pos.description ?? '',
          correctMove: pos.correctMove ?? '',
          explanation: pos.explanation ?? '',
        }),
      );

    return {
      id: `lesson-${Date.now()}-${weakness.theme}`,
      generatedAt: Date.now(),
      theme: weakness.theme,
      title: parsed.title ?? `Improving ${weakness.theme}`,
      difficulty: (['beginner', 'intermediate', 'advanced'].includes(parsed.difficulty)
        ? parsed.difficulty
        : 'intermediate') as 'beginner' | 'intermediate' | 'advanced',
      conceptExplanation: parsed.conceptExplanation ?? '',
      examplePositions,
      keyTakeaways: Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways : [],
      isCompleted: false,
    };
  } catch {
    console.error('[Chess Tutor] Failed to parse lesson response');
    return null;
  }
}
