import { useState } from 'react';
import ThemedChessboard from '@/components/ThemedChessboard';
import { useTheme } from '@/components/ThemeContext';
import { useChessData } from '@/contexts/ChessDataContext';
import { useEntityList } from '@/hooks/useEntity';
import { useAuth } from '@/contexts/AuthContext';
import type { Lesson } from '@shared/types/ai';
import { getThemeLabel } from '@/patterns/pattern-engine';
import { generateLesson } from '@/ai/lesson-generator';
import { saveLesson } from '@/storage/insight-store';
import { hasAnyProvider } from '@/ai/ai-router';
import { deserializeLesson } from '@/engine/analysis-pipeline';

interface LessonsProps {
  themeFilter?: string;
  onClearFilter?: () => void;
}

export default function Lessons({ themeFilter: _themeFilter, onClearFilter: _onClearFilter }: LessonsProps = {}) {
  const { settings } = useTheme();
  const { patterns } = useChessData();
  const { authResolved } = useAuth();
  // RLS handles user scoping server-side
  const [lessonsList, lessonsLoading] = useEntityList<Lesson>('Lesson', undefined, deserializeLesson as (raw: unknown) => Lesson, !authResolved);
  const [generating, setGenerating] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);

  const lessons = [...lessonsList].sort((a, b) => b.generatedAt - a.generatedAt);

  const hasProvider = hasAnyProvider(settings);

  const handleGenerate = async () => {
    if (!hasProvider || !patterns?.patterns.length) return;

    setGenerating(true);
    try {
      // Generate a lesson for the top weakness pattern
      const topPattern = patterns.patterns[0];
      const lesson = await generateLesson(
        settings,
        topPattern,
        1500, // Default rating, could be dynamic
      );

      if (lesson) {
        await saveLesson(lesson);
      }
    } catch (err) {
      console.error('[Chess DNA] Failed to generate lesson:', err);
    } finally {
      setGenerating(false);
    }
  };

  if (!hasProvider) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-4">&#128218;</div>
        <h2 className="text-xl mb-2">AI Lessons</h2>
        <p className="text-gray-400 text-sm">
          Configure an AI provider API key (Claude, OpenAI, or Gemini) in Settings to generate personalized lessons.
        </p>
      </div>
    );
  }

  if (selectedLesson) {
    return <LessonView lesson={selectedLesson} onBack={() => setSelectedLesson(null)} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Lessons</h2>
        <button
          onClick={handleGenerate}
          disabled={generating || !patterns?.patterns.length}
          className="bg-chess-accent text-white px-4 py-2 rounded-lg text-sm hover:brightness-110 transition-all disabled:opacity-50"
        >
          {generating ? 'Generating...' : 'Generate Lesson'}
        </button>
      </div>

      {lessonsLoading ? (
        <div className="text-gray-400">Loading lessons...</div>
      ) : lessons.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p>No lessons yet. Generate one based on your weakness patterns!</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {lessons.map((lesson) => (
            <div
              key={lesson.id}
              onClick={() => setSelectedLesson(lesson)}
              className="bg-chess-surface rounded-lg p-4 cursor-pointer hover:bg-chess-border/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{lesson.title}</h3>
                <span className="text-xs text-gray-400 capitalize">
                  {lesson.difficulty}
                </span>
              </div>
              <div className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
                <span>{getThemeLabel(lesson.theme)} &middot; {new Date(lesson.generatedAt).toLocaleDateString()}</span>
                {lesson.stockfishVerified && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-chess-accent/10 text-chess-accent font-bold">
                    ✓ Engine Verified
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LessonView({ lesson, onBack }: { lesson: Lesson; onBack: () => void }) {
  const [posIndex, setPosIndex] = useState(0);

  return (
    <div>
      <button
        onClick={onBack}
        className="text-gray-400 hover:text-chess-text transition-colors mb-4"
      >
        &larr; Back to Lessons
      </button>

      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-xl font-bold">{lesson.title}</h2>
        {lesson.stockfishVerified && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-chess-accent/10 text-chess-accent font-bold">
            ✓ Engine Verified
          </span>
        )}
      </div>
      <div className="text-sm text-gray-400 mb-4">
        {getThemeLabel(lesson.theme)} &middot; {lesson.difficulty}
      </div>

      {/* Concept explanation */}
      <div className="bg-chess-surface rounded-lg p-4 mb-4">
        <div className="prose prose-invert text-sm whitespace-pre-wrap">
          {lesson.conceptExplanation}
        </div>
      </div>

      {/* Example positions */}
      {lesson.examplePositions.length > 0 && (
        <div className="mb-4">
          <h3 className="font-medium mb-3">
            Example {posIndex + 1} of {lesson.examplePositions.length}
          </h3>

          <div className="flex gap-4">
            <div className="w-[320px] shrink-0">
              <ThemedChessboard
                position={lesson.examplePositions[posIndex].fen}
                boardWidth={320}
                arePiecesDraggable={false}
              />
            </div>

            <div className="flex-1">
              <div className="bg-chess-surface rounded-lg p-3">
                <p className="text-sm mb-2">
                  {lesson.examplePositions[posIndex].description}
                </p>
                <div className="text-sm text-chess-accent font-medium flex items-center gap-1.5">
                  <span>Best: {lesson.examplePositions[posIndex].correctMove}</span>
                  {lesson.examplePositions[posIndex].stockfishVerified && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-chess-accent/10 text-chess-accent font-bold">
                      ✓ Verified
                    </span>
                  )}
                  {lesson.examplePositions[posIndex].stockfishVerified === false && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-gray-500/10 text-gray-500 font-bold">
                      Unverified
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-400 mt-2">
                  {lesson.examplePositions[posIndex].explanation}
                </p>
              </div>
            </div>
          </div>

          {lesson.examplePositions.length > 1 && (
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setPosIndex((i) => Math.max(0, i - 1))}
                disabled={posIndex === 0}
                className="px-3 py-1 rounded bg-chess-border text-sm disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() =>
                  setPosIndex((i) =>
                    Math.min(lesson.examplePositions.length - 1, i + 1),
                  )
                }
                disabled={posIndex === lesson.examplePositions.length - 1}
                className="px-3 py-1 rounded bg-chess-border text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Key takeaways */}
      {lesson.keyTakeaways.length > 0 && (
        <div className="bg-chess-surface rounded-lg p-4">
          <h3 className="font-medium mb-2">Key Takeaways</h3>
          <ul className="space-y-1">
            {lesson.keyTakeaways.map((takeaway, i) => (
              <li key={i} className="text-sm text-chess-text-secondary flex items-start gap-2">
                <span className="text-chess-accent">&#8226;</span>
                {takeaway}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
