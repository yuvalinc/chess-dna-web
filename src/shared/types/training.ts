import type { SkillDimensionId, WeaknessTheme } from './patterns';

export interface TrainingStage {
  id: string;
  type: 'puzzle' | 'lesson' | 'milestone' | 'game-check';
  label: string;
  targetCount: number;
  completedCount: number;
  targetAccuracy?: number; // practice accuracy target (puzzles), e.g. 60
}

export interface TrainingPlan {
  id: string;
  createdAt: number;
  targetDimension: SkillDimensionId;
  targetPattern?: WeaknessTheme;
  targetPatternLabel: string;
  stages: TrainingStage[];
  currentStageIndex: number;
  isComplete: boolean;
  completedAt?: number;
}

/**
 * Stored state: 3 plan options the user can choose from + the active selection.
 * All 3 plans are always maintained; user picks which one to focus on.
 */
export interface TrainingPlanState {
  options: TrainingPlan[];        // always 3 plans (from 3 weakest dimensions)
  activeIndex: number;            // which of the 3 is currently selected (0-2)
  generatedAt: number;            // when the options were last generated
}

/** Computed live (not stored) — derived from exercises + pattern snapshots */
export interface TrainingAccuracy {
  practiceAccuracy: number; // % puzzles solved correctly for this theme
  practiceTotal: number; // total puzzles attempted
  practiceCorrect: number; // total puzzles correct
  puzzleAccuracyTrend: number[]; // rolling puzzle accuracy over batches for trend chart
  gameAccuracy: number; // % games where the pattern was NOT triggered
  gameAccuracyTrend: number[]; // per-game trend over last N games for sparkline
  lastGame: {
    accuracy: number; // 0-100
    patternCount: number; // how many times pattern appeared
    details: string; // e.g. "0 missed forks in 32 moves"
  } | null;
}
