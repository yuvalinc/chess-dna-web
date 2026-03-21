import type { SkillProfile, CurrentPatterns, WeaknessTheme, PatternSnapshot, SkillDimensionId } from '@shared/types/patterns';
import type { Exercise, Lesson } from '@shared/types/ai';
import type { TrainingPlan, TrainingPlanState, TrainingStage, TrainingAccuracy } from '@shared/types/training';
import { getWeakestDimensions, getPrimaryThemeForDimension } from './skill-calculator';
import { getThemeLabel } from './pattern-engine';

/**
 * Build a single training plan for a given dimension.
 */
function buildPlanForDimension(
  dim: { id: SkillDimensionId; label: string; relatedThemes: WeaknessTheme[] },
  patterns: CurrentPatterns,
  now: number,
  salt: number,
): TrainingPlan {
  // Find the most impactful pattern for this dimension
  let targetTheme: WeaknessTheme | undefined;
  const primaryTheme = getPrimaryThemeForDimension(dim.id);

  if (primaryTheme) {
    const matchingPattern = patterns.patterns.find(p => p.theme === primaryTheme);
    if (matchingPattern) {
      targetTheme = primaryTheme;
    }
  }

  if (!targetTheme && dim.relatedThemes.length > 0) {
    const relatedPatterns = patterns.patterns
      .filter(p => dim.relatedThemes.includes(p.theme))
      .sort((a, b) => b.severity - a.severity);
    if (relatedPatterns.length > 0) {
      targetTheme = relatedPatterns[0].theme;
    }
  }

  // Fallback: use primary theme even without detected pattern
  if (!targetTheme) {
    targetTheme = primaryTheme ?? undefined;
  }

  // Last resort: pick the most severe detected pattern overall
  if (!targetTheme && patterns.patterns.length > 0) {
    const sorted = [...patterns.patterns].sort((a, b) => b.severity - a.severity);
    targetTheme = sorted[0].theme;
  }

  const label = targetTheme
    ? `Improve ${dim.label}: ${getThemeLabel(targetTheme)}`
    : `Improve ${dim.label}`;

  const planId = `plan_${now}_${salt}`;

  const stages: TrainingStage[] = [
    { id: `${planId}_s1`, type: 'lesson', label: 'Learn the concept', targetCount: 1, completedCount: 0 },
    { id: `${planId}_s2`, type: 'puzzle', label: 'Practice: Solve 3 puzzles', targetCount: 3, completedCount: 0 },
    { id: `${planId}_s3`, type: 'game-check', label: 'Play a real game', targetCount: 1, completedCount: 0 },
    { id: `${planId}_s4`, type: 'puzzle', label: 'Challenge: 4 puzzles (60%+)', targetCount: 4, completedCount: 0, targetAccuracy: 60 },
    { id: `${planId}_s5`, type: 'milestone', label: 'Pattern mastered', targetCount: 1, completedCount: 0 },
  ];

  return {
    id: planId,
    createdAt: now,
    targetDimension: dim.id,
    targetPattern: targetTheme,
    targetPatternLabel: label,
    stages,
    currentStageIndex: 0,
    isComplete: false,
  };
}

/**
 * Generate 3 training plan options from the 3 weakest dimensions.
 * Returns null if there's not enough data.
 */
export function generateTrainingPlanOptions(
  profile: SkillProfile,
  patterns: CurrentPatterns,
): TrainingPlanState | null {
  if (profile.gamesUsed < 3) return null;

  const weakest = getWeakestDimensions(profile, 3);
  if (weakest.length === 0) return null;

  const now = Date.now();
  const options = weakest.map((dim, i) =>
    buildPlanForDimension(dim, patterns, now, i)
  );

  // Pad to 3 if fewer dimensions available
  while (options.length < 3 && weakest.length > 0) {
    options.push(buildPlanForDimension(weakest[0], patterns, now, options.length));
  }

  return {
    options,
    activeIndex: 0,
    generatedAt: now,
  };
}

/**
 * Generate a training plan targeting the user's weakest skill area.
 * Returns null if there's not enough data.
 * @deprecated Use generateTrainingPlanOptions for the 3-option picker.
 */
export function generateTrainingPlan(
  profile: SkillProfile,
  patterns: CurrentPatterns,
  _exercises: Exercise[],
  _lessons: Lesson[],
): TrainingPlan | null {
  if (profile.gamesUsed < 3) return null;

  const weakest = getWeakestDimensions(profile, 1);
  if (weakest.length === 0) return null;
  const dim = weakest[0];

  const now = Date.now();
  return buildPlanForDimension(dim, patterns, now, 0);
}

/**
 * Recompute plan progress from the current set of exercises and lessons.
 * Returns a new plan object with updated counts and stage advancement.
 */
export function updatePlanProgress(
  plan: TrainingPlan,
  exercises: Exercise[],
  lessons: Lesson[],
): TrainingPlan {
  const updated = { ...plan, stages: plan.stages.map(s => ({ ...s })) };

  // Filter exercises/lessons matching the plan's target theme
  const matchingExercises = plan.targetPattern
    ? exercises.filter(e => e.theme === plan.targetPattern && e.generatedAt >= plan.createdAt)
    : [];
  const matchingLessons = plan.targetPattern
    ? lessons.filter(l => l.theme === plan.targetPattern && l.generatedAt >= plan.createdAt)
    : [];

  const completedExercises = matchingExercises.filter(e => e.isCompleted);
  const completedLessons = matchingLessons.filter(l => l.isCompleted);
  const correctExercises = matchingExercises.filter(e => e.wasCorrect === true);

  // Track cumulative puzzle completion for stages
  let puzzlesUsed = 0;
  let lessonsUsed = 0;

  for (let i = 0; i < updated.stages.length; i++) {
    const stage = updated.stages[i];

    if (stage.type === 'puzzle') {
      const available = completedExercises.length - puzzlesUsed;
      stage.completedCount = Math.min(stage.targetCount, Math.max(0, available));
      puzzlesUsed += stage.completedCount;

      // Check accuracy target for this stage
      if (stage.targetAccuracy !== undefined && stage.completedCount >= stage.targetCount) {
        const stageCorrect = correctExercises.slice(puzzlesUsed - stage.completedCount, puzzlesUsed).length;
        const stageAccuracy = stage.completedCount > 0 ? (stageCorrect / stage.completedCount) * 100 : 0;
        if (stageAccuracy < stage.targetAccuracy) {
          // Accuracy not met — don't count as fully complete
          // But still show the count for progress UI
        }
      }
    } else if (stage.type === 'lesson') {
      const available = completedLessons.length - lessonsUsed;
      stage.completedCount = Math.min(stage.targetCount, Math.max(0, available));
      lessonsUsed += stage.completedCount;
    } else if (stage.type === 'game-check') {
      // Game-check: manually confirmed by user in the training session UI
      // completedCount is set directly when user clicks "I've played a game"
      // Don't reset it here — preserve the stored value
    } else if (stage.type === 'milestone') {
      // Milestone auto-completes when all previous stages are done
      const allPreviousDone = updated.stages
        .slice(0, i)
        .every(s => s.completedCount >= s.targetCount);
      stage.completedCount = allPreviousDone ? 1 : 0;
    }
  }

  // Advance current stage index
  let newStageIndex = 0;
  for (let i = 0; i < updated.stages.length; i++) {
    if (updated.stages[i].completedCount >= updated.stages[i].targetCount) {
      newStageIndex = Math.min(i + 1, updated.stages.length - 1);
    } else {
      break;
    }
  }
  // Never regress: take the max of computed vs stored index
  // (stored may be ahead if user advanced but entity lists haven't refetched yet)
  updated.currentStageIndex = Math.max(newStageIndex, plan.currentStageIndex);

  // Check if all stages are complete
  const allDone = updated.stages.every(s => s.completedCount >= s.targetCount);
  if (allDone && !updated.isComplete) {
    updated.isComplete = true;
    updated.completedAt = Date.now();
  }

  return updated;
}

/**
 * Compute game accuracy for a specific theme from pattern snapshots.
 * Returns practice accuracy (from exercises) and game accuracy (from real games).
 */
export function computeTrainingAccuracy(
  plan: TrainingPlan,
  exercises: Exercise[],
  snapshots: PatternSnapshot[],
): TrainingAccuracy {
  const theme = plan.targetPattern;

  // Practice accuracy from exercises (sorted by attempt time)
  const matchingExercises = theme
    ? exercises
        .filter(e => e.theme === theme && e.isCompleted && e.generatedAt >= plan.createdAt)
        .sort((a, b) => (a.attemptedAt ?? a.generatedAt) - (b.attemptedAt ?? b.generatedAt))
    : [];
  const practiceCorrect = matchingExercises.filter(e => e.wasCorrect === true).length;
  const practiceTotal = matchingExercises.length;
  const practiceAccuracy = practiceTotal > 0
    ? Math.round((practiceCorrect / practiceTotal) * 100)
    : 0;

  // Puzzle accuracy trend: cumulative accuracy after each puzzle
  const puzzleAccuracyTrend: number[] = [];
  let runningCorrect = 0;
  for (let i = 0; i < matchingExercises.length; i++) {
    if (matchingExercises[i].wasCorrect === true) runningCorrect++;
    puzzleAccuracyTrend.push(Math.round((runningCorrect / (i + 1)) * 100));
  }

  // Game accuracy from pattern snapshots
  // A game is "clean" for this theme if the theme doesn't appear in its snapshot
  const recentSnapshots = snapshots
    .filter(s => s.timestamp >= plan.createdAt)
    .sort((a, b) => a.timestamp - b.timestamp);

  const gameAccuracyTrend: number[] = [];
  let cleanGames = 0;
  let totalGames = recentSnapshots.length;

  for (const snap of recentSnapshots) {
    const themeEntry = theme ? snap.themes.find(t => t.theme === theme) : null;
    const isClean = !themeEntry || themeEntry.count === 0;
    if (isClean) cleanGames++;
    // Per-game accuracy: 100 if clean, 0 if pattern appeared
    gameAccuracyTrend.push(isClean ? 100 : 0);
  }

  const gameAccuracy = totalGames > 0
    ? Math.round((cleanGames / totalGames) * 100)
    : 0;

  // Last game report
  let lastGame: TrainingAccuracy['lastGame'] = null;
  if (recentSnapshots.length > 0) {
    const last = recentSnapshots[recentSnapshots.length - 1];
    const themeEntry = theme ? last.themes.find(t => t.theme === theme) : null;
    const patternCount = themeEntry?.count ?? 0;
    const themeLabel = theme ? getThemeLabel(theme).toLowerCase() : 'pattern';
    lastGame = {
      accuracy: patternCount === 0 ? 100 : 0,
      patternCount,
      details: patternCount === 0
        ? `No ${themeLabel} in last game`
        : `${patternCount} ${themeLabel} in last game`,
    };
  }

  return {
    practiceAccuracy,
    practiceTotal,
    practiceCorrect,
    puzzleAccuracyTrend,
    gameAccuracy,
    gameAccuracyTrend,
    lastGame,
  };
}
