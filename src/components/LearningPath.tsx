import { useEntityList } from '@/hooks/useEntity';
import { useAuth } from '@/contexts/AuthContext';
import type { SkillDimension } from '@shared/types/patterns';
import type { WeaknessTheme } from '@shared/types/patterns';
import type { Lesson } from '@shared/types/ai';
import type { Exercise } from '@shared/types/ai';
import { deserializeLesson, deserializeExercise } from '@/engine/analysis-pipeline';

interface LearningPathProps {
  dimension: SkillDimension;
  onStartLesson: (theme: WeaknessTheme) => void;
  onStartExercise: (theme: WeaknessTheme) => void;
}

export default function LearningPath({
  dimension,
  onStartLesson,
  onStartExercise,
}: LearningPathProps) {
  const { authResolved } = useAuth();
  // RLS handles user scoping server-side
  const [lessons] = useEntityList<Lesson>('Lesson', undefined, deserializeLesson as (raw: unknown) => Lesson, !authResolved);
  const [exercises] = useEntityList<Exercise>('Exercise', undefined, deserializeExercise as (raw: unknown) => Exercise, !authResolved);

  const primaryTheme = dimension.relatedThemes[0] ?? null;

  // Check if we have lessons/exercises for any of this dimension's themes
  const lessonsForDim = lessons.filter((l) =>
    dimension.relatedThemes.includes(l.theme),
  );
  const exercisesForDim = exercises.filter((e) =>
    dimension.relatedThemes.includes(e.theme),
  );
  const completedExercises = exercisesForDim.filter((e) => e.isCompleted && e.wasCorrect);

  const hasLesson = lessonsForDim.length > 0;
  const hasCompletedLesson = lessonsForDim.some((l) => l.isCompleted);
  const hasExercises = exercisesForDim.length > 0;
  const allExercisesDone =
    exercisesForDim.length > 0 && exercisesForDim.every((e) => e.isCompleted);

  // Step progress
  const step1Done = hasCompletedLesson;
  const step2Done = allExercisesDone;
  const step3Done = false; // "Play & Review" is always a suggestion

  const currentStep = step1Done ? (step2Done ? 3 : 2) : 1;

  return (
    <div className="bg-chess-bg/50 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-chess-text">
          Learning Path: {dimension.label}
        </span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            dimension.score >= 75
              ? 'bg-chess-accent/10 text-chess-accent'
              : dimension.score >= 50
                ? 'bg-chess-inaccuracy/10 text-chess-inaccuracy'
                : 'bg-chess-blunder/10 text-chess-blunder'
          }`}
        >
          Score: {dimension.score}
        </span>
      </div>

      <div className="space-y-3">
        {/* Step 1: Learn theory */}
        <Step
          number={1}
          title="Understand the concept"
          description={
            hasLesson
              ? `${lessonsForDim.length} lesson${lessonsForDim.length > 1 ? 's' : ''} available`
              : 'Generate a lesson to learn the theory'
          }
          isActive={currentStep === 1}
          isDone={step1Done}
          actionLabel={hasLesson ? 'Review Lesson' : 'Start Lesson'}
          onAction={() => primaryTheme && onStartLesson(primaryTheme)}
          disabled={!primaryTheme}
        />

        {/* Step 2: Practice */}
        <Step
          number={2}
          title="Practice with puzzles"
          description={
            hasExercises
              ? `${completedExercises.length}/${exercisesForDim.length} exercises completed`
              : 'Generate exercises to practice'
          }
          isActive={currentStep === 2}
          isDone={step2Done}
          actionLabel={hasExercises ? 'Continue Practice' : 'Start Practice'}
          onAction={() => primaryTheme && onStartExercise(primaryTheme)}
          disabled={!primaryTheme}
        />

        {/* Step 3: Play & review */}
        <Step
          number={3}
          title="Play and review"
          description="Play a game on chess.com, then review your performance on this skill"
          isActive={currentStep === 3}
          isDone={step3Done}
          actionLabel="Play on chess.com"
          onAction={() => window.open('https://www.chess.com/play/online', '_blank')}
        />
      </div>
    </div>
  );
}

/* ── Step sub-component ── */

interface StepProps {
  number: number;
  title: string;
  description: string;
  isActive: boolean;
  isDone: boolean;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
}

function Step({
  number,
  title,
  description,
  isActive,
  isDone,
  actionLabel,
  onAction,
  disabled = false,
}: StepProps) {
  const circleBg = isDone
    ? 'bg-chess-accent text-chess-bg'
    : isActive
      ? 'bg-chess-accent/20 text-chess-accent border-2 border-chess-accent'
      : 'bg-chess-muted text-gray-500';

  return (
    <div className={`flex items-start gap-3 ${isActive ? '' : 'opacity-60'}`}>
      {/* Step number / checkmark */}
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${circleBg}`}
      >
        {isDone ? '\u2713' : number}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <h4 className={`text-sm font-medium ${isActive ? 'text-chess-text' : 'text-gray-400'}`}>
            {title}
          </h4>
          {(isActive || isDone) && !disabled && (
            <button
              onClick={onAction}
              className={`text-xs px-3 py-1 rounded-md transition-colors shrink-0 ${
                isActive
                  ? 'bg-chess-accent text-chess-bg hover:brightness-110'
                  : 'bg-chess-muted text-chess-text-secondary hover:bg-chess-border/60'
              }`}
            >
              {actionLabel}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
    </div>
  );
}
