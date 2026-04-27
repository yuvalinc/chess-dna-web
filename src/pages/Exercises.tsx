import { useState } from 'react';
import ThemedChessboard from '@/components/ThemedChessboard';
import { useTheme } from '@/components/ThemeContext';
import { useT } from '@/i18n/index';
import { useChessData } from '@/contexts/ChessDataContext';
import { useEntityList } from '@/hooks/useEntity';
import { useAuth } from '@/contexts/AuthContext';
import type { Exercise } from '@shared/types/ai';
import { getThemeLabel } from '@/patterns/pattern-engine';
import { generateExercises } from '@/ai/exercise-generator';
import { saveExercise } from '@/storage/insight-store';
import { hasAnyProvider } from '@/ai/ai-router';
import { deserializeExercise } from '@/engine/analysis-pipeline';

interface ExercisesProps {
  themeFilter?: string;
  onClearFilter?: () => void;
}

export default function Exercises({ themeFilter: _themeFilter, onClearFilter: _onClearFilter }: ExercisesProps = {}) {
  const { settings } = useTheme();
  const { t } = useT();
  const { patterns } = useChessData();
  const { authResolved } = useAuth();
  // RLS handles user scoping server-side
  const [exercisesList, exercisesLoading] = useEntityList<Exercise>('Exercise', undefined, deserializeExercise as (raw: unknown) => Exercise, !authResolved);
  const [generating, setGenerating] = useState(false);
  const [activeExercise, setActiveExercise] = useState<Exercise | null>(null);

  const exercises = [...exercisesList].sort(
    (a, b) => b.generatedAt - a.generatedAt,
  );

  const hasProvider = hasAnyProvider(settings);

  const handleGenerate = async () => {
    if (!hasProvider || !patterns?.patterns.length) return;

    setGenerating(true);
    try {
      const topPattern = patterns.patterns[0];
      const newExercises = await generateExercises(
        settings,
        topPattern,
        1500,
        3,
      );

      for (const exercise of newExercises) {
        await saveExercise(exercise);
      }
    } catch (err) {
      console.error('[Chess DNA] Failed to generate exercises:', err);
    } finally {
      setGenerating(false);
    }
  };

  if (!hasProvider) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-4">&#9823;</div>
        <h2 className="text-xl mb-2">{t('exercises_title')}</h2>
        <p className="text-chess-muted text-sm">
          Configure an AI provider API key (Claude, OpenAI, or Gemini) in Settings to generate targeted exercises.
        </p>
      </div>
    );
  }

  if (activeExercise) {
    return (
      <ExerciseView
        exercise={activeExercise}
        onBack={() => setActiveExercise(null)}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">{t('exercises_title')}</h2>
        <button
          onClick={handleGenerate}
          disabled={generating || !patterns?.patterns.length}
          className="bg-chess-accent text-white px-4 py-2 rounded-lg text-sm hover:brightness-110 transition-all disabled:opacity-50"
        >
          {generating ? t('exercises_generating') : t('exercises_generate')}
        </button>
      </div>

      {exercisesLoading ? (
        <div className="text-gray-400">Loading exercises...</div>
      ) : exercises.length === 0 ? (
        <div className="text-center py-12 text-chess-muted">
          <p>{t('exercises_empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {exercises.map((exercise) => (
            <div
              key={exercise.id}
              onClick={() => setActiveExercise(exercise)}
              className="bg-chess-surface rounded-lg p-4 cursor-pointer hover:bg-chess-border/30 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-chess-muted capitalize">
                  {exercise.difficulty}
                </span>
                <div className="flex items-center gap-1">
                  {exercise.stockfishVerified && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-chess-accent/10 text-chess-accent font-bold">
                      ✓ Engine Verified
                    </span>
                  )}
                  {exercise.isCompleted && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        exercise.wasCorrect
                          ? 'bg-chess-best/20 text-chess-best'
                          : 'bg-chess-blunder/20 text-chess-blunder'
                      }`}
                    >
                      {exercise.wasCorrect ? 'Solved' : 'Failed'}
                    </span>
                  )}
                </div>
              </div>
              <div className="w-full aspect-square mb-2">
                <ThemedChessboard
                  position={exercise.fen}
                  boardOrientation={exercise.playerColor}
                  boardWidth={200}
                  arePiecesDraggable={false}
                />
              </div>
              <div className="text-xs text-chess-muted">
                {getThemeLabel(exercise.theme)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExerciseView({
  exercise,
  onBack,
}: {
  exercise: Exercise;
  onBack: () => void;
}) {
  const { t } = useT();
  const [showSolution, setShowSolution] = useState(false);
  const [showHint, setShowHint] = useState(false);

  return (
    <div>
      <button
        onClick={onBack}
        className="text-chess-muted hover:text-chess-text transition-colors mb-4"
      >
        {t('exercises_back')}
      </button>

      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-xl font-bold">Find the Best Move</h2>
        <span className="text-xs text-chess-muted capitalize bg-chess-border px-2 py-1 rounded">
          {exercise.difficulty}
        </span>
        {exercise.stockfishVerified && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-chess-accent/10 text-chess-accent font-bold">
            ✓ Engine Verified
          </span>
        )}
      </div>

      <div className="flex gap-6">
        <div className="w-[440px] shrink-0">
          <ThemedChessboard
            position={exercise.fen}
            boardOrientation={exercise.playerColor}
            boardWidth={440}
            arePiecesDraggable={false}
          />
        </div>

        <div className="flex-1 space-y-3">
          <div className="bg-chess-surface rounded-lg p-4">
            <div className="text-sm text-chess-muted mb-1">Theme</div>
            <div className="font-medium">{getThemeLabel(exercise.theme)}</div>
          </div>

          <div className="bg-chess-surface rounded-lg p-4">
            <div className="text-sm text-chess-muted mb-1">
              {exercise.playerColor === 'white' ? 'White' : 'Black'} to move
            </div>
          </div>

          {/* Hint */}
          {!showHint ? (
            <button
              onClick={() => setShowHint(true)}
              className="w-full bg-chess-border text-chess-text px-4 py-2 rounded-lg text-sm hover:bg-chess-border/80 transition-colors"
            >
              Show Hint
            </button>
          ) : (
            <div className="bg-chess-surface rounded-lg p-4">
              <div className="text-sm text-chess-muted mb-1">Hint</div>
              <div className="text-sm">{exercise.hint}</div>
            </div>
          )}

          {/* Solution */}
          {!showSolution ? (
            <button
              onClick={() => setShowSolution(true)}
              className="w-full bg-chess-accent text-white px-4 py-2 rounded-lg text-sm hover:brightness-110 transition-all"
            >
              Show Solution
            </button>
          ) : (
            <div className="bg-chess-surface rounded-lg p-4">
              <div className="text-sm text-chess-muted mb-1">Solution</div>
              <div className="text-lg font-bold text-chess-accent mb-2">
                {exercise.solutionSan.join(' ')}
              </div>
              <div className="text-sm text-chess-text">
                {exercise.explanation}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
