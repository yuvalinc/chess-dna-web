import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Chess } from 'chess.js';
import ThemedChessboard from '@/components/ThemedChessboard';
import { useTheme } from '@/components/ThemeContext';
import { useChessData } from '@/contexts/ChessDataContext';
import { useEntityList } from '@/hooks/useEntity';
import { useAuth } from '@/contexts/AuthContext';
import type { Lesson, Exercise } from '@shared/types/ai';
import type { WeaknessPattern, PatternSnapshot } from '@shared/types/patterns';
import type { GameRecord } from '@shared/types/game';
import type { WeaknessTheme } from '@shared/types/patterns';
import type { UserSettings } from '@shared/types/storage';
import type { TrainingPlanState } from '@shared/types/training';
import { getThemeLabel } from '@/patterns/pattern-engine';
import { generateLesson } from '@/ai/lesson-generator';
import { generateExercises } from '@/ai/exercise-generator';
import { generateRealPositionPuzzles } from '@/patterns/real-position-puzzles';
import { saveLesson, saveExercise } from '@/storage/insight-store';
import { hasAnyProvider } from '@/ai/ai-router';
import { useResponsiveBoardSize } from '@/hooks/useResponsiveBoardSize';
import { computePatternsFromGames, computeWindowedProfile } from '@/patterns/windowed-profile';
import { generateTrainingPlanOptions, updatePlanProgress, computeTrainingAccuracy } from '@/patterns/training-planner';
import { LineChart, Line, ResponsiveContainer, YAxis, ReferenceLine, Tooltip } from 'recharts';
import { deserializePatternSnapshot, deserializeLesson, deserializeExercise } from '@/engine/analysis-pipeline';
import { sanToUci, applyMoveToFen } from '@shared/utils/chess-utils';

interface GettingBetterProps {
  themeFilter?: WeaknessTheme;
  onClearFilter?: () => void;
}

type View =
  | { type: 'list' }
  | { type: 'pattern'; theme: WeaknessTheme }
  | { type: 'lesson'; lesson: Lesson }
  | { type: 'exercise-list'; theme: WeaknessTheme }
  | { type: 'puzzle'; exercise: Exercise }
  | { type: 'training-session'; planIndex: number };

export default function GettingBetter({ themeFilter, onClearFilter }: GettingBetterProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const preselectedTheme = (location.state as { preselectedTheme?: WeaknessTheme } | null)?.preselectedTheme;
  const { settings } = useTheme();
  const { authResolved } = useAuth();
  const { patterns, allGames, allAnalyses, gamesMap } = useChessData();
  // RLS handles user scoping server-side
  const [lessonsList] = useEntityList<Lesson>('Lesson', undefined, deserializeLesson as (raw: unknown) => Lesson, !authResolved);
  const [exercisesList] = useEntityList<Exercise>('Exercise', undefined, deserializeExercise as (raw: unknown) => Exercise, !authResolved);
  const [snapshotsRaw] = useEntityList<PatternSnapshot>('PatternSnapshot', undefined, deserializePatternSnapshot as (raw: unknown) => PatternSnapshot, !authResolved);
  const [generating, setGenerating] = useState<'lesson' | 'exercises' | null>(null);

  // Plan state: use localStorage for persistence
  const [planState, setPlanState] = useState<TrainingPlanState | null>(() => {
    try {
      const stored = localStorage.getItem('chess-dna-training-plan');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  // Persist planState to localStorage whenever it changes
  useEffect(() => {
    if (planState) {
      localStorage.setItem('chess-dna-training-plan', JSON.stringify(planState));
    }
  }, [planState]);

  // Active session index: use localStorage for persistence
  const [activeSessionIndex, setActiveSessionIndex] = useState<number | null>(() => {
    const v = localStorage.getItem('chess-dna-session-view');
    return v ? Number(v) : null;
  });

  // Persist activeSessionIndex
  useEffect(() => {
    if (activeSessionIndex !== null) {
      localStorage.setItem('chess-dna-session-view', String(activeSessionIndex));
    } else {
      localStorage.removeItem('chess-dna-session-view');
    }
  }, [activeSessionIndex]);

  const providerReady = hasAnyProvider(settings);

  // Compute patterns inline so examplePositions are always populated from current game data
  const inlinePatterns = useMemo(() => {
    if (allAnalyses.length === 0) return patterns as CurrentPatterns | null;
    return computePatternsFromGames(allGames, allAnalyses, 1);
  }, [allGames, allAnalyses, patterns]);

  // Training plan: compute profile, update progress, compute accuracy
  const planExercises = useMemo(() => [...exercisesList], [exercisesList]);
  const planLessons = useMemo(() => [...lessonsList], [lessonsList]);

  const profileForPlan = useMemo(() => {
    if (allAnalyses.length < 3) return null;
    const { profile } = computeWindowedProfile(allGames, allAnalyses, 30);
    return profile;
  }, [allGames, allAnalyses]);

  // Update all plan options with progress
  const updatedPlanState = useMemo(() => {
    if (!planState) return null;
    return {
      ...planState,
      options: planState.options.map(p => updatePlanProgress(p, planExercises, planLessons)),
    };
  }, [planState, planExercises, planLessons]);

  const activePlan = updatedPlanState?.options[updatedPlanState.activeIndex] ?? null;

  const planAccuracy = useMemo(() => {
    if (!activePlan) return null;
    return computeTrainingAccuracy(activePlan, planExercises, snapshotsRaw);
  }, [activePlan, planExercises, snapshotsRaw]);

  // Persist updated progress
  useEffect(() => {
    if (updatedPlanState && planState) {
      const anyChanged = updatedPlanState.options.some((p, i) =>
        p.currentStageIndex !== planState.options[i]?.currentStageIndex ||
        p.isComplete !== planState.options[i]?.isComplete
      );
      if (anyChanged) setPlanState(updatedPlanState);
    }
  }, [updatedPlanState, planState]);

  // Auto-generate plan options if none exist
  useEffect(() => {
    if (!planState && profileForPlan && inlinePatterns && inlinePatterns.patterns.length > 0) {
      const newState = generateTrainingPlanOptions(profileForPlan, inlinePatterns);
      if (newState) setPlanState(newState);
    }
  }, [planState, profileForPlan, inlinePatterns]);

  // Auto-select plan matching preselected theme from navigation state (e.g. game review CTA)
  const [didApplyPreselect, setDidApplyPreselect] = useState(false);
  useEffect(() => {
    if (!preselectedTheme || !planState || didApplyPreselect) return;
    const matchIndex = planState.options.findIndex(p => p.targetPattern === preselectedTheme);
    if (matchIndex >= 0) {
      if (matchIndex !== planState.activeIndex) {
        setPlanState({ ...planState, activeIndex: matchIndex });
      }
      setDidApplyPreselect(true);
    }
    // Clear the state so browser back doesn't re-trigger
    window.history.replaceState({}, '');
  }, [preselectedTheme, planState, didApplyPreselect]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRegeneratePlans = useCallback(() => {
    if (profileForPlan && inlinePatterns) {
      const newState = generateTrainingPlanOptions(profileForPlan, inlinePatterns);
      if (newState) setPlanState(newState);
    }
  }, [profileForPlan, inlinePatterns]);

  const handleSelectPlan = useCallback((index: number) => {
    if (updatedPlanState) {
      setPlanState({ ...updatedPlanState, activeIndex: index });
    }
  }, [updatedPlanState]);

  const handleRetrain = useCallback(async (planIdx: number, generateNew: boolean) => {
    if (!updatedPlanState) return;
    const options = [...updatedPlanState.options];
    const plan = options[planIdx];

    // Reset the plan: all stages back to 0, not complete
    const resetPlan = {
      ...plan,
      stages: plan.stages.map(s => ({ ...s, completedCount: 0 })),
      currentStageIndex: 0,
      isComplete: false,
      completedAt: undefined,
      // Bump createdAt when generating new so old exercises are excluded
      createdAt: generateNew ? Date.now() : plan.createdAt,
    };

    if (!generateNew && plan.targetPattern) {
      // Reuse mode: reset isCompleted on existing exercises and lessons so they can be re-served
      const theme = plan.targetPattern;
      const themeExercises = planExercises.filter(e => e.theme === theme && e.generatedAt >= plan.createdAt);
      const themeLessons = planLessons.filter(l => l.theme === theme && l.generatedAt >= plan.createdAt);
      for (const ex of themeExercises) {
        await saveExercise({ ...ex, isCompleted: false, wasCorrect: null, attemptedAt: null });
      }
      for (const l of themeLessons) {
        await saveLesson({ ...l, isCompleted: false });
      }
    }

    options[planIdx] = resetPlan;
    setPlanState({ ...updatedPlanState, options, activeIndex: planIdx });
  }, [updatedPlanState, planExercises, planLessons]);

  const [view, setView] = useState<View>(() => {
    if (themeFilter) return { type: 'pattern', theme: themeFilter };
    return { type: 'list' };
  });

  // Restore active training session from storage (survives tab switches + theme changes)
  useEffect(() => {
    if (activeSessionIndex !== null && view.type === 'list' && !themeFilter) {
      setView({ type: 'training-session', planIndex: activeSessionIndex });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionIndex]);

  // Track which patterns have "Explain More" expanded
  const [expandedPatterns, setExpandedPatterns] = useState<Set<WeaknessTheme>>(new Set());

  // Pattern detail tab (lessons vs puzzles)
  const [patternTab, setPatternTab] = useState<'lessons' | 'puzzles'>('lessons');

  // History stack for back button
  const [history, setHistory] = useState<View[]>([]);

  const pushView = (next: View) => {
    setHistory(prev => [...prev, view]);
    setView(next);
    // Persist active training session so it survives tab switches
    if (next.type === 'training-session') {
      setActiveSessionIndex(next.planIndex);
    }
  };

  const goBack = () => {
    // Clear persisted session if leaving a training session
    if (view.type === 'training-session') {
      setActiveSessionIndex(null);
    }
    const prev = history[history.length - 1];
    if (prev) {
      setHistory(h => h.slice(0, -1));
      setView(prev);
    } else {
      setView({ type: 'list' });
      onClearFilter?.();
    }
  };

  const allLessons = useMemo(() => [...lessonsList].sort((a, b) => b.generatedAt - a.generatedAt), [lessonsList]);
  const allExercises = useMemo(() => [...exercisesList].sort((a, b) => b.generatedAt - a.generatedAt), [exercisesList]);

  // Compute player rating from most recent game
  const playerRating = useMemo(() => {
    if (allGames.length === 0) return 1500;
    const sorted = [...allGames].sort((a, b) => b.playedAt - a.playedAt);
    return sorted[0].player.rating || 1500;
  }, [allGames]);

  const getLessonsForTheme = (theme: WeaknessTheme) => allLessons.filter(l => l.theme === theme);
  const getExercisesForTheme = (theme: WeaknessTheme) => allExercises.filter(e => e.theme === theme);

  const handleGenerateLesson = async (pattern: WeaknessPattern) => {
    if (!providerReady || generating) return;
    setGenerating('lesson');
    try {
      const lesson = await generateLesson(settings, pattern, playerRating);
      if (lesson) {
        await saveLesson(lesson);
        pushView({ type: 'lesson', lesson });
      }
    } catch (err) {
      console.error('[Chess DNA] Failed to generate lesson:', err);
    } finally {
      setGenerating(null);
    }
  };

  const handleGenerateExercises = async (pattern: WeaknessPattern) => {
    if (generating) return;
    setGenerating('exercises');
    try {
      // Try real-position puzzles first (zero hallucination)
      const realPuzzles = generateRealPositionPuzzles([pattern], pattern.theme, 3);
      for (const ex of realPuzzles) {
        await saveExercise(ex);
      }

      // If not enough, supplement with AI-generated
      const aiNeeded = 3 - realPuzzles.length;
      if (aiNeeded > 0 && providerReady) {
        const newExercises = await generateExercises(settings, pattern, playerRating, aiNeeded);
        if (Array.isArray(newExercises)) {
          for (const ex of newExercises) {
            await saveExercise(ex);
          }
        }
      }
    } catch (err) {
      console.error('[Chess DNA] Failed to generate exercises:', err);
    } finally {
      setGenerating(null);
    }
  };

  // ── No patterns yet ──
  const hasUnanalyzedGames = allGames.some(
    (g) => g.analysisStatus !== 'complete',
  );
  if (!inlinePatterns?.patterns?.length && view.type === 'list') {
    return (
      <div className="text-center py-16 max-w-md mx-auto">
        <div className="text-4xl mb-4 opacity-60">{hasUnanalyzedGames ? '\uD83E\uDDEC' : '\u25C8'}</div>
        <h2 className="text-xl font-black mb-2">
          {hasUnanalyzedGames ? 'Analyzing Your Games...' : 'No Patterns Yet'}
        </h2>
        <p className="text-gray-400 text-sm">
          {hasUnanalyzedGames
            ? 'Stockfish is analyzing your games. Patterns will appear here once analysis is complete. This may take a few minutes.'
            : 'Analyze more games in the "Your DNA" tab to discover weakness patterns, then come back here to train on them.'}
        </p>
        {hasUnanalyzedGames && (
          <div className="mt-4 text-2xl animate-spin-slow">{'\uD83E\uDDEC'}</div>
        )}
      </div>
    );
  }

  // ── Puzzle view (full-screen board, chess.com-like) ──
  if (view.type === 'puzzle') {
    return <PuzzleView exercise={view.exercise} onBack={goBack} />;
  }

  // ── Lesson view ──
  if (view.type === 'lesson') {
    return <LessonView lesson={view.lesson} onBack={goBack} />;
  }

  // ── Training session (inline guided experience) ──
  if (view.type === 'training-session') {
    const sessionPlan = updatedPlanState?.options[view.planIndex] ?? null;
    const sessionPattern = sessionPlan?.targetPattern
      ? inlinePatterns?.patterns.find(p => p.theme === sessionPlan.targetPattern) ?? null
      : null;

    return (
      <TrainingSession
        plan={sessionPlan}
        planIndex={view.planIndex}
        pattern={sessionPattern}
        settings={settings}
        exercises={planExercises}
        lessons={planLessons}
        snapshots={snapshotsRaw}
        games={allGames}
        planState={planState}
        onSavePlanState={(state) => setPlanState(state)}
        onBack={goBack}
      />
    );
  }

  // ── Pattern detail: side-by-side lessons + puzzles ──
  if (view.type === 'pattern') {
    const theme = view.theme;
    const pattern = inlinePatterns?.patterns.find(p => p.theme === theme);
    const lessons = getLessonsForTheme(theme);
    const exercises = getExercisesForTheme(theme);

    return (
      <div>
        <button onClick={goBack} className="text-gray-400 hover:text-chess-text transition-colors mb-4 text-sm flex items-center gap-1">
          ← Back
        </button>

        <div className="mb-6">
          <h2 className="text-xl font-black text-chess-text mb-1">{getThemeLabel(theme)}</h2>
          {pattern && (
            <p className="text-xs text-gray-500">
              {pattern.occurrences}× across {pattern.gamesAffected} game{pattern.gamesAffected !== 1 ? 's' : ''} · avg {pattern.severity}cp loss
            </p>
          )}
        </div>

        {/* Tab bar: Lessons | Puzzles */}
        <div className="flex gap-1 mb-4">
          {(['lessons', 'puzzles'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setPatternTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                patternTab === tab
                  ? 'bg-chess-accent/10 text-chess-accent border border-chess-accent/20'
                  : 'text-gray-500 hover:text-chess-text-secondary hover:bg-white/[0.03] border border-transparent'
              }`}
            >
              {tab === 'lessons' ? `Lessons (${lessons.length})` : `Puzzles (${exercises.length})`}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => patternTab === 'lessons'
              ? (pattern && handleGenerateLesson(pattern))
              : (pattern && handleGenerateExercises(pattern))
            }
            disabled={!!generating || !pattern}
            className="text-[10px] px-3 py-1.5 rounded-lg bg-chess-accent text-chess-bg font-bold hover:brightness-110 transition-all disabled:opacity-50"
          >
            {generating ? 'Generating...' : '+ Generate'}
          </button>
        </div>

        {/* Lessons tab content */}
        {patternTab === 'lessons' && (
          <div>
            {lessons.length === 0 ? (
              <div className="rounded-xl p-6 bg-chess-surface/30 border border-chess-border/30 text-center text-gray-500 text-sm">
                No lessons yet. Generate one to get started!
              </div>
            ) : (
              <div className="space-y-2">
                {lessons.map(lesson => (
                  <button
                    key={lesson.id}
                    onClick={() => pushView({ type: 'lesson', lesson })}
                    className="w-full text-left rounded-xl p-3 bg-chess-surface/30 border border-chess-border/30 hover:bg-chess-surface/50 transition-colors"
                  >
                    <div className="text-sm font-medium text-chess-text flex items-center gap-1.5">
                      <span>{lesson.title}</span>
                      {lesson.stockfishVerified && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-chess-accent/10 text-chess-accent font-bold shrink-0">
                          ✓ Engine Verified
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {lesson.difficulty} · {new Date(lesson.generatedAt).toLocaleDateString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Puzzles tab content */}
        {patternTab === 'puzzles' && (
          <div>
            {exercises.length === 0 ? (
              <div className="rounded-xl p-6 bg-chess-surface/30 border border-chess-border/30 text-center text-gray-500 text-sm">
                No puzzles yet. Generate some to practice!
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {exercises.map(exercise => (
                  <button
                    key={exercise.id}
                    onClick={() => pushView({ type: 'puzzle', exercise })}
                    className="rounded-xl bg-chess-surface/30 border border-chess-border/30 hover:bg-chess-surface/50 hover:border-chess-accent/20 transition-all text-left overflow-hidden group"
                  >
                    <div className="w-full aspect-square rounded-t-lg overflow-hidden relative">
                      <ThemedChessboard
                        position={exercise.fen}
                        boardOrientation={exercise.playerColor}
                        boardWidth={200}
                        arePiecesDraggable={false}
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full bg-chess-accent/80 text-chess-bg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                          <span className="text-lg ml-0.5">▶</span>
                        </div>
                      </div>
                    </div>
                    <div className="p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${
                          exercise.playerColor === 'white' ? 'text-chess-text-secondary' : 'text-gray-500'
                        }`}>
                          <span className={`w-2 h-2 rounded-full ${exercise.playerColor === 'white' ? 'bg-white' : 'bg-gray-700 border border-gray-500'}`} />
                          {exercise.playerColor === 'white' ? 'White' : 'Black'} to move
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded capitalize ${
                          exercise.difficulty === 'beginner' ? 'bg-green-500/10 text-green-400' :
                          exercise.difficulty === 'intermediate' ? 'bg-yellow-500/10 text-yellow-400' :
                          'bg-red-500/10 text-red-400'
                        }`}>
                          {exercise.difficulty}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-500 truncate">{exercise.hint}</div>
                      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                        {exercise.stockfishVerified && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-chess-accent/10 text-chess-accent font-bold">
                            ✓ Engine Verified
                          </span>
                        )}
                        {exercise.isCompleted && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                            exercise.wasCorrect ? 'bg-chess-accent/15 text-chess-accent' : 'bg-chess-blunder/15 text-chess-blunder'
                          }`}>
                            {exercise.wasCorrect ? '✓ Solved' : '✗ Failed'}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Pattern list ──
  const patternsList = inlinePatterns?.patterns ?? [];

  // Classify pattern into skill category
  const getPatternSkillCategory = (theme: string): { label: string; color: string } => {
    const defensePatterns = ['missed_defense', 'hanging_pieces', 'back_rank_weakness', 'king_safety'];
    const attackPatterns = ['missed_tactic', 'missed_fork', 'missed_pin', 'missed_skewer', 'missed_discovery', 'premature_attack'];
    if (defensePatterns.some(d => theme.includes(d))) return { label: 'Defence', color: 'text-blue-400' };
    if (attackPatterns.some(a => theme.includes(a))) return { label: 'Attack', color: 'text-red-400' };
    return { label: 'Positional', color: 'text-purple-400' };
  };

  const getPatternDescription = (theme: string, severity: number, occurrences: number): string => {
    if (theme.includes('tactic')) return `A tactical pattern where you miss winning combinations. This has cost you an average of ${severity} centipawns per occurrence across ${occurrences} instances.`;
    if (theme.includes('time')) return `Time management issues causing suboptimal decisions under pressure. Average loss: ${severity}cp across ${occurrences} occurrences.`;
    if (theme.includes('endgame')) return `Endgame technique weakness — converting advantages or holding difficult endings. Average loss: ${severity}cp across ${occurrences} occurrences.`;
    if (theme.includes('opening')) return `Opening preparation gaps leading to unfamiliar or disadvantageous positions. Average loss: ${severity}cp across ${occurrences} occurrences.`;
    return `A recurring pattern where you consistently lose material or positional advantage. It occurred ${occurrences} times with an average centipawn loss of ${severity}.`;
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-black text-chess-text mb-1">Getting Better</h2>
        <p className="text-sm text-gray-400">Choose a weakness pattern to train on.</p>
      </div>

      {/* API key missing banner */}
      {!providerReady && (
        <div className="mb-5 rounded-xl bg-gradient-to-r from-chess-accent/10 via-chess-accent/5 to-transparent border border-chess-accent/25 p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-chess-accent/15 flex items-center justify-center text-xl shrink-0">
              🔑
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-black text-chess-text mb-1">Unlock AI-Powered Training</h3>
              <p className="text-xs text-gray-400 leading-relaxed mb-3">
                Add an API key (Claude, OpenAI, or Gemini) to generate personalized lessons and interactive puzzles tailored to your exact weaknesses.
              </p>
              <button
                onClick={() => navigate('/settings')}
                className="bg-chess-accent text-chess-bg px-5 py-2 rounded-lg text-sm font-bold hover:brightness-110 transition-all shadow-[0_0_12px_rgba(74,222,128,0.2)]"
              >
                Add API Key →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Training Plan Selector + Active Plan Card */}
      {updatedPlanState && updatedPlanState.options.length > 0 && (
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 mt-4">Your Training Plans</div>
      )}
      {updatedPlanState && updatedPlanState.options.length > 0 && (() => {
        const allComplete = updatedPlanState.options.every(p => p.isComplete);

        // CTA navigation — launch inline training session
        const handlePlanCta = () => {
          if (!activePlan) return;
          pushView({ type: 'training-session', planIndex: updatedPlanState.activeIndex });
        };

        // Celebration logic for active plan
        let celebration: string | null = null;
        if (planAccuracy) {
          if (planAccuracy.practiceAccuracy >= 80 && planAccuracy.practiceTotal >= 3) {
            celebration = '80%+ puzzle accuracy! Pattern mastery';
          } else if (planAccuracy.practiceAccuracy >= 60 && planAccuracy.practiceTotal >= 3) {
            celebration = 'Practice accuracy over 60%! You\'re getting it';
          }
          if (planAccuracy.gameAccuracyTrend.length >= 3) {
            const recent = planAccuracy.gameAccuracyTrend.slice(-3);
            const early = planAccuracy.gameAccuracyTrend.slice(0, 3);
            const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
            const earlyAvg = early.reduce((a, b) => a + b, 0) / early.length;
            if (recentAvg > earlyAvg + 10) {
              celebration = 'Game accuracy trending up! Your practice is paying off';
            }
          }
          if (planAccuracy.lastGame && planAccuracy.lastGame.patternCount === 0 && planAccuracy.gameAccuracyTrend.length > 0) {
            celebration = `Clean game! No ${activePlan?.targetPatternLabel.split(': ')[1]?.toLowerCase() || 'pattern'} detected`;
          }
        }

        // Chart data for active plan
        const maxLen = planAccuracy ? Math.max(planAccuracy.puzzleAccuracyTrend.length, planAccuracy.gameAccuracyTrend.length) : 0;
        const chartData = planAccuracy ? Array.from({ length: maxLen }, (_, i) => ({
          idx: i,
          puzzle: i < planAccuracy.puzzleAccuracyTrend.length ? planAccuracy.puzzleAccuracyTrend[i] : undefined,
          game: i < planAccuracy.gameAccuracyTrend.length ? planAccuracy.gameAccuracyTrend[i] : undefined,
        })) : [];
        const hasChartData = maxLen >= 2;

        // Stage guidance
        const currentStage = activePlan?.stages[activePlan.currentStageIndex];
        const stageGuidance: Record<string, string> = {
          lesson: 'Study the concept behind this pattern',
          puzzle: currentStage?.targetAccuracy
            ? `Test your understanding — aim for ${currentStage.targetAccuracy}%+`
            : 'Practice puzzles to build pattern recognition',
          'game-check': 'Play a real game to test your improvement',
          milestone: 'Complete all stages to master the pattern!',
        };
        const guidance = currentStage ? stageGuidance[currentStage.type] || currentStage.label : '';

        return (
          <div className="mb-5">
            {/* Plan option selector — 3 cards */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {updatedPlanState.options.map((plan, i) => {
                const isActive = i === updatedPlanState.activeIndex;
                const completedStages = plan.stages.filter(s => s.completedCount >= s.targetCount).length;
                const progressPct = (completedStages / plan.stages.length) * 100;
                // Extract short label: "Improve Tactics: Missed Forks" → "Tactics"
                const dimLabel = plan.targetPatternLabel.split(':')[0]?.replace('Improve ', '') || plan.targetPatternLabel;
                // Extract pattern label: after ":"
                const patLabel = plan.targetPatternLabel.split(': ')[1] || '';

                return (
                  <button
                    key={plan.id}
                    onClick={() => handleSelectPlan(i)}
                    className={`relative text-left rounded-xl p-3 border transition-all ${
                      isActive
                        ? 'bg-chess-accent/[0.08] border-chess-accent/30 shadow-[0_0_12px_rgba(74,222,128,0.08)]'
                        : 'bg-chess-surface/30 border-chess-border/30 hover:border-chess-border/50'
                    } ${plan.isComplete ? 'opacity-60' : ''}`}
                  >
                    {plan.isComplete && (
                      <span className="absolute top-1.5 right-1.5 text-[9px] text-chess-accent font-bold">Done</span>
                    )}
                    <div className={`text-[11px] font-bold mb-0.5 ${isActive ? 'text-chess-accent' : 'text-chess-text'}`}>
                      {dimLabel}
                    </div>
                    <div className="text-[9px] text-chess-text-secondary truncate mb-1.5">{patLabel}</div>
                    {/* Mini progress bar */}
                    <div className="w-full bg-chess-muted/40 rounded-full h-1 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${isActive ? 'bg-chess-accent' : 'bg-chess-text-tertiary'}`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* All complete → regenerate */}
            {allComplete && (
              <div className="rounded-xl bg-chess-accent/[0.06] border border-chess-accent/25 p-4 text-center">
                <div className="text-sm font-bold text-chess-text mb-1">All Plans Complete</div>
                <p className="text-xs text-chess-text-secondary mb-3">
                  Generate fresh plans based on your latest games.
                </p>
                <button
                  onClick={handleRegeneratePlans}
                  className="w-full py-2.5 rounded-xl bg-chess-accent text-chess-bg font-bold text-sm hover:brightness-110 transition-all"
                >
                  Generate New Plans
                </button>
              </div>
            )}

            {/* Active plan detail card */}
            {activePlan && !activePlan.isComplete && planAccuracy && (
              <div className="rounded-xl bg-chess-surface/30 border border-chess-accent/20 p-4">
                {/* Header row with play button */}
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-chess-text truncate">{activePlan.targetPatternLabel}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-chess-text-secondary">
                        Stage {activePlan.currentStageIndex + 1}/{activePlan.stages.length}
                      </span>
                      {currentStage && (
                        <span className="text-[10px] text-chess-text-tertiary">
                          {currentStage.label} ({currentStage.completedCount}/{currentStage.targetCount})
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Play button CTA */}
                  <button
                    onClick={handlePlanCta}
                    className="w-12 h-12 rounded-full bg-chess-accent text-chess-bg flex items-center justify-center shrink-0 hover:brightness-110 transition-all shadow-[0_0_16px_rgba(74,222,128,0.2)] active:scale-95"
                    title={activePlan.stages.some(s => s.completedCount > 0) ? 'Continue Training' : 'Start Training'}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                      <polygon points="6,3 18,10 6,17" />
                    </svg>
                  </button>
                </div>

                {/* Stage progress dots */}
                <div className="flex items-center gap-1.5 mb-3">
                  {activePlan.stages.map((stage, i) => (
                    <div
                      key={stage.id}
                      className={`h-1.5 rounded-full flex-1 transition-all ${
                        i < activePlan.currentStageIndex ? 'bg-chess-accent'
                        : i === activePlan.currentStageIndex ? 'bg-chess-accent/50'
                        : 'bg-chess-muted/50'
                      }`}
                    />
                  ))}
                </div>

                {/* Celebration banner */}
                {celebration && (
                  <div className="mb-3 rounded-lg bg-chess-accent/10 border border-chess-accent/20 px-3 py-2 text-xs text-chess-accent font-medium">
                    {celebration}
                  </div>
                )}

                {/* Accuracy stat cards */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                  {/* Puzzles card */}
                  <div className="bg-chess-surface/40 rounded-xl p-3 border border-chess-border/20">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-2 h-2 rounded-full bg-chess-accent" />
                      <span className="text-[10px] text-chess-text-tertiary uppercase tracking-widest">Puzzles</span>
                    </div>
                    <div className="text-xl font-black text-chess-text">
                      {planAccuracy.practiceTotal > 0 ? `${planAccuracy.practiceAccuracy}%` : '--'}
                    </div>
                    <div className="text-[10px] text-chess-text-tertiary mt-0.5">
                      {planAccuracy.practiceCorrect}/{planAccuracy.practiceTotal} solved
                    </div>
                    {planAccuracy.practiceTotal > 0 && (
                      <div className="w-full bg-chess-muted/40 rounded-full h-1 mt-2">
                        <div className="h-full rounded-full bg-chess-accent transition-all" style={{ width: `${planAccuracy.practiceAccuracy}%` }} />
                      </div>
                    )}
                  </div>
                  {/* Games card */}
                  <div className="bg-chess-surface/40 rounded-xl p-3 border border-chess-border/20">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-2 h-2 rounded-full bg-[#38bdf8]" />
                      <span className="text-[10px] text-chess-text-tertiary uppercase tracking-widest">Games</span>
                    </div>
                    <div className="text-xl font-black text-chess-text">
                      {planAccuracy.gameAccuracyTrend.length > 0 ? `${planAccuracy.gameAccuracy}%` : '--'}
                    </div>
                    <div className="text-[10px] text-chess-text-tertiary mt-0.5">
                      {planAccuracy.gameAccuracyTrend.length} tracked
                    </div>
                    {planAccuracy.gameAccuracyTrend.length > 0 && (
                      <div className="w-full bg-chess-muted/40 rounded-full h-1 mt-2">
                        <div className="h-full rounded-full bg-[#38bdf8] transition-all" style={{ width: `${planAccuracy.gameAccuracy}%` }} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Accuracy trend chart */}
                {hasChartData && (
                  <div className="mb-3">
                    <div className="flex items-center gap-4 mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-0.5 rounded bg-chess-accent inline-block" />
                        <span className="text-[10px] text-chess-text-secondary">Puzzles</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-0.5 rounded bg-[#38bdf8] inline-block" />
                        <span className="text-[10px] text-chess-text-secondary">Games</span>
                      </div>
                    </div>
                    <div className="h-[120px] bg-chess-surface/30 rounded-lg p-1">
                      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                        <LineChart data={chartData}>
                          <YAxis domain={[0, 100]} hide />
                          <ReferenceLine y={70} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                          <Tooltip
                            content={({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number; stroke?: string }>; label?: number }) => {
                              if (!active || !payload?.length) return null;
                              return (
                                <div className="bg-chess-bg border border-chess-border/60 rounded-lg px-3 py-2 text-xs shadow-lg">
                                  <div className="text-chess-text-secondary mb-1">Session {(label ?? 0) + 1}</div>
                                  {payload.map((p) => (
                                    <div key={String(p.dataKey)} className="flex items-center gap-2">
                                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.stroke }} />
                                      <span className="text-chess-text">{p.value != null ? `${p.value}%` : '--'}</span>
                                    </div>
                                  ))}
                                </div>
                              );
                            }}
                          />
                          <Line type="monotone" dataKey="puzzle" stroke="rgb(var(--chess-accent))" strokeWidth={2} dot={{ r: 2, fill: 'rgb(var(--chess-accent))' }} connectNulls />
                          <Line type="monotone" dataKey="game" stroke="#38bdf8" strokeWidth={2} dot={{ r: 2, fill: '#38bdf8' }} connectNulls strokeDasharray="4 2" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Last game report */}
                {planAccuracy.lastGame && (
                  <div className={`flex items-center gap-2 text-[11px] mb-3 rounded-lg px-3 py-2 border ${
                    planAccuracy.lastGame.patternCount === 0
                      ? 'bg-chess-accent/10 text-chess-accent border-chess-accent/20'
                      : 'bg-chess-blunder/10 text-chess-blunder border-chess-blunder/20'
                  }`}>
                    <span className="text-base shrink-0">{planAccuracy.lastGame.patternCount === 0 ? '\u2714' : '\u26A0'}</span>
                    <span>{planAccuracy.lastGame.details}</span>
                  </div>
                )}

                {/* Stage guidance */}
                {guidance && (
                  <p className="text-[10px] text-chess-text-tertiary italic">{guidance}</p>
                )}
              </div>
            )}

            {/* Active plan is complete — offer retrain options */}
            {activePlan?.isComplete && !allComplete && (
              <div className="rounded-xl bg-chess-accent/[0.06] border border-chess-accent/25 p-4">
                <div className="text-center mb-3">
                  <div className="text-sm font-bold text-chess-text mb-1">Plan Complete!</div>
                  <p className="text-xs text-chess-text-secondary">
                    {activePlan.targetPatternLabel}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRetrain(updatedPlanState.activeIndex, false)}
                    className="flex-1 py-2 rounded-xl bg-chess-surface/50 border border-chess-border/30 text-chess-text text-xs font-medium hover:bg-chess-surface/80 transition-colors"
                  >
                    Retrain
                  </button>
                  <button
                    onClick={() => handleRetrain(updatedPlanState.activeIndex, true)}
                    className="flex-1 py-2 rounded-xl bg-chess-accent text-chess-bg text-xs font-bold hover:brightness-110 transition-all"
                  >
                    New Puzzles
                  </button>
                </div>
                <p className="text-[10px] text-chess-text-tertiary text-center mt-2">
                  Or select another plan above
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {patternsList.length > 0 && (
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 mt-4">Your Weakness Patterns</div>
      )}
      <div className="space-y-3">
        {patternsList.map((p, i) => {
          const lessons = getLessonsForTheme(p.theme);
          const exercises = getExercisesForTheme(p.theme);
          const severityColor = p.severity > 150 ? 'text-chess-blunder' : p.severity > 80 ? 'text-chess-mistake' : 'text-chess-inaccuracy';
          const skillCat = getPatternSkillCategory(p.theme);
          const isExpanded = expandedPatterns.has(p.theme);

          return (
            <div
              key={p.id}
              className="rounded-xl bg-chess-surface/30 border border-chess-border/30 overflow-hidden transition-all"
            >
              {/* Pattern header */}
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 bg-chess-muted/50 text-chess-text-secondary">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-chess-text">{getThemeLabel(p.theme)}</div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-chess-text-secondary">
                      <span>{p.occurrences}× in {p.gamesAffected} games</span>
                      <span className={severityColor}>~{p.severity}cp</span>
                      <span className={`font-bold ${
                        p.trend === 'improving' ? 'text-chess-accent' : p.trend === 'worsening' ? 'text-chess-blunder' : 'text-chess-text-tertiary'
                      }`}>
                        {p.trend === 'improving' ? '↗ Improving' : p.trend === 'worsening' ? '↘ Worsening' : '→ Stable'}
                      </span>
                      <span className={`font-bold ${skillCat.color}`}>{skillCat.label}</span>
                    </div>
                    {(lessons.length > 0 || exercises.length > 0) && (
                      <div className="flex gap-3 mt-1.5 text-[10px]">
                        {lessons.length > 0 && (
                          <span className="text-chess-accent">{lessons.length} lesson{lessons.length !== 1 ? 's' : ''}</span>
                        )}
                        {exercises.length > 0 && (
                          <span className="text-chess-accent">{exercises.length} puzzle{exercises.length !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Two CTAs */}
                <div className="flex gap-2 mt-3 ml-11">
                  <button
                    onClick={() => {
                      setExpandedPatterns(prev => {
                        const next = new Set(prev);
                        if (next.has(p.theme)) next.delete(p.theme); else next.add(p.theme);
                        return next;
                      });
                    }}
                    className={`text-[11px] px-3 py-1.5 rounded-lg border transition-all font-medium ${
                      isExpanded
                        ? 'bg-white/[0.07] text-chess-text border-chess-border/40'
                        : 'bg-chess-surface/50 text-chess-text-secondary border-chess-border/30 hover:text-chess-text hover:border-chess-border/50'
                    }`}
                  >
                    {isExpanded ? 'Show Less ▲' : 'Explain More ▼'}
                  </button>
                  <button
                    onClick={() => pushView({ type: 'pattern', theme: p.theme })}
                    className="text-[11px] px-4 py-1.5 rounded-lg bg-chess-accent text-chess-bg font-bold hover:brightness-110 transition-all shadow-[0_0_8px_rgba(74,222,128,0.15)]"
                  >
                    Let's Start →
                  </button>
                </div>
              </div>

              {/* Expanded "Explain More" panel */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-chess-border/20 animate-fade-in">
                  <div className="mt-3 space-y-3 ml-11">
                    {/* What is this pattern */}
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">What is this pattern?</div>
                      <p className="text-xs text-chess-text-secondary leading-relaxed">
                        {getPatternDescription(p.theme, p.severity, p.occurrences)}
                      </p>
                    </div>

                    {/* Stats row */}
                    <div className="flex gap-4 flex-wrap">
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">Avg Loss</div>
                        <div className="text-sm font-bold text-chess-blunder">{p.severity}cp</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">Occurrences</div>
                        <div className="text-sm font-bold text-chess-text">{p.occurrences}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">Games</div>
                        <div className="text-sm font-bold text-chess-text">{p.gamesAffected}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">Related Skill</div>
                        <div className={`text-sm font-bold ${skillCat.color}`}>{skillCat.label}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">Trend</div>
                        <div className={`text-sm font-bold ${
                          p.trend === 'improving' ? 'text-chess-accent' : p.trend === 'worsening' ? 'text-chess-blunder' : 'text-gray-500'
                        }`}>
                          {p.trend === 'improving' ? '↗ Improving' : p.trend === 'worsening' ? '↘ Worsening' : '→ Stable'}
                        </div>
                      </div>
                    </div>

                    {/* Game position examples */}
                    {p.examplePositions.length > 0 && (
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">From your games</div>
                        <div className="space-y-2">
                          {p.examplePositions.slice(0, 3).map((ex, exIdx) => {
                            const exGame = gamesMap[ex.gameId];
                            return (
                              <div
                                key={`${ex.gameId}-${ex.moveIndex}-${exIdx}`}
                                className="flex items-center gap-3 rounded-lg bg-chess-bg/50 p-2"
                              >
                                <div className="w-[100px] h-[100px] shrink-0 rounded overflow-hidden">
                                  <ThemedChessboard
                                    position={ex.fen}
                                    boardWidth={100}
                                    arePiecesDraggable={false}
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs text-chess-text-secondary">
                                    Played <span className="font-mono font-medium text-chess-text">{ex.movePlayed}</span>
                                    <span className="text-gray-500 mx-1">best</span>
                                    <span className="font-mono font-medium text-chess-accent">{ex.bestMove}</span>
                                  </div>
                                  <div className="text-[10px] text-chess-blunder mt-0.5">−{ex.cpLoss}cp</div>
                                  {exGame && (
                                    <div className="text-[10px] text-gray-500 mt-0.5">
                                      vs {exGame.opponent.username} · {new Date(exGame.playedAt).toLocaleDateString()}
                                    </div>
                                  )}
                                </div>
                                <button
                                  onClick={() => navigate(`/games/${ex.gameId}`, { state: { moveIndex: ex.moveIndex, returnTo: 'training' } })}
                                  className="px-2.5 py-1 rounded-md bg-chess-accent/10 text-chess-accent text-[10px] font-medium hover:bg-chess-accent/20 transition-colors shrink-0"
                                >
                                  View →
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Show all lessons / exercises if any exist without pattern context */}
      {(allLessons.length > 0 || allExercises.length > 0) && (
        <div className="mt-8 pt-6 border-t border-chess-border/20">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-3">All Content</h3>
          <div className="flex gap-4 text-xs text-gray-500">
            <span>{allLessons.length} lesson{allLessons.length !== 1 ? 's' : ''} total</span>
            <span>{allExercises.length} puzzle{allExercises.length !== 1 ? 's' : ''} total</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 *  Lesson Loading — animated progress bar + time estimate
 * ══════════════════════════════════════════════════════════════ */

function LessonLoadingProgress({ stageHeader }: { stageHeader: React.ReactNode }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const duration = 20000; // 0→95% over 20 seconds
    const tick = () => {
      const elapsed = Date.now() - start;
      const pct = Math.min(95, (elapsed / duration) * 95);
      setProgress(pct);
      if (elapsed < duration) requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="max-w-md mx-auto text-center py-12">
      {stageHeader}
      <div className="w-8 h-8 border-2 border-chess-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
      <p className="text-sm text-chess-text-secondary mb-3">Creating a personalized lesson...</p>
      <div className="w-48 mx-auto bg-chess-muted/50 rounded-full h-1.5 overflow-hidden mb-2">
        <div
          className="h-full rounded-full bg-chess-accent transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-[11px] text-chess-text-tertiary">Usually takes 10–30 seconds</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 *  Puzzle View — Interactive chess.com-like experience
 * ══════════════════════════════════════════════════════════════ */

function PuzzleView({ exercise, onBack, onNext, hideBackButton }: {
  exercise: Exercise;
  onBack: () => void;
  onNext?: (wasCorrect: boolean) => void;
  hideBackButton?: boolean;
}) {
  const [showSolution, setShowSolution] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [moveResult, setMoveResult] = useState<'correct' | 'wrong' | null>(null);
  const [currentFen, setCurrentFen] = useState(exercise.fen);
  const [moveIndex, setMoveIndex] = useState(0);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<string[]>([]);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [opponentMoving, setOpponentMoving] = useState(false);

  const { containerRef, boardSize } = useResponsiveBoardSize(560);

  // Determine if solution[idx] is a player move based on starting FEN color and playerColor
  const isPlayerTurn = useCallback((idx: number): boolean => {
    const startingSide = exercise.fen.split(' ')[1]; // 'w' or 'b'
    const sideAtIdx = idx % 2 === 0 ? startingSide : (startingSide === 'w' ? 'b' : 'w');
    const playerSide = exercise.playerColor === 'white' ? 'w' : 'b';
    return sideAtIdx === playerSide;
  }, [exercise.fen, exercise.playerColor]);

  // Determine effective player color for board orientation:
  // - Lichess-style (≥2 moves): use exercise.playerColor (opposite of FEN side-to-move)
  // - Old format (1 move): player controls whoever moves in the FEN
  const effectivePlayerColor = useMemo((): 'white' | 'black' => {
    if (exercise.solution.length >= 2) {
      return exercise.playerColor;
    }
    // Old single-move format: the FEN's side-to-move IS the player
    const fenSide = exercise.fen.split(' ')[1];
    return fenSide === 'w' ? 'white' : 'black';
  }, [exercise.fen, exercise.playerColor, exercise.solution.length]);

  // Auto-show hint for beginner puzzles
  const autoHint = exercise.difficulty === 'beginner';

  // Timer for advanced puzzles
  useEffect(() => {
    if (exercise.difficulty !== 'advanced' || moveResult === 'correct' || showSolution) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [exercise.difficulty, moveResult, showSolution, startTime]);

  // Initialize chess.js for move validation
  const game = useMemo(() => {
    const g = new Chess(exercise.fen);
    return g;
  }, [exercise.fen]);

  // ── Opponent auto-play: after user's correct move, if next move is opponent's, play it ──
  useEffect(() => {
    if (!opponentMoving || moveResult === 'correct' || showSolution) return;

    const timer = setTimeout(() => {
      const opponentMoveUci = exercise.solution[moveIndex];
      if (!opponentMoveUci) {
        setOpponentMoving(false);
        return;
      }

      try {
        const from = opponentMoveUci.slice(0, 2);
        const to = opponentMoveUci.slice(2, 4);
        const promotion = opponentMoveUci.length > 4 ? opponentMoveUci[4] : undefined;
        const move = game.move({ from, to, promotion });

        if (move) {
          setMoveHistory(prev => [...prev, move.san]);
          setCurrentFen(game.fen());
          const nextIdx = moveIndex + 1;
          setMoveIndex(nextIdx);

          if (nextIdx >= exercise.solution.length) {
            setMoveResult('correct');
          } else if (!isPlayerTurn(nextIdx)) {
            // Next is also opponent's move (shouldn't happen normally, but handle it)
            // Keep opponentMoving true to trigger another iteration
            setOpponentMoving(true);
            return;
          }
        }
      } catch {
        // Invalid opponent move in solution data — skip
      }

      setOpponentMoving(false);
    }, 400);

    return () => clearTimeout(timer);
  }, [opponentMoving, moveIndex, exercise.solution, game, moveResult, showSolution, isPlayerTurn]);

  // ── If puzzle starts on opponent's turn (Lichess-style), auto-play the setup move on mount ──
  // Only for multi-move solutions (≥2 moves). Single-move solutions are always the player's move.
  useEffect(() => {
    if (exercise.solution.length >= 2 && !isPlayerTurn(0)) {
      setOpponentMoving(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDrop = useCallback((sourceSquare: string, targetSquare: string) => {
    if (moveResult === 'correct' || showSolution || opponentMoving) return false;

    try {
      // Try to make the move
      const move = game.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q', // always promote to queen for simplicity
      });

      if (!move) return false;

      const moveSan = move.san;

      // Check if move matches the expected solution
      const expectedMove = exercise.solution[moveIndex];
      const expectedSan = exercise.solutionSan[moveIndex];

      // Compare with both UCI and SAN formats
      const moveUci = `${sourceSquare}${targetSquare}`;
      const isCorrect = moveUci === expectedMove || moveSan === expectedSan;

      if (isCorrect) {
        const newHistory = [...moveHistory, moveSan];
        setMoveHistory(newHistory);
        setCurrentFen(game.fen());
        const nextIdx = moveIndex + 1;
        setMoveIndex(nextIdx);

        if (nextIdx >= exercise.solution.length) {
          // Puzzle complete!
          setMoveResult('correct');
        } else if (!isPlayerTurn(nextIdx)) {
          // Next move is opponent's — trigger auto-play
          setOpponentMoving(true);
        }
        return true;
      } else {
        // Wrong move — undo it
        game.undo();
        setMoveResult('wrong');
        return false;
      }
    } catch {
      return false;
    }
  }, [game, moveIndex, exercise.solution, exercise.solutionSan, moveResult, showSolution, moveHistory, opponentMoving, isPlayerTurn]);

  // Click-to-select → click-to-move handler
  const handleSquareClick = useCallback((square: string) => {
    if (moveResult === 'correct' || showSolution || opponentMoving) return;

    if (selectedSquare) {
      // Second click: attempt the move
      onDrop(selectedSquare, square);
      setSelectedSquare(null);
      setLegalMoves([]);
    } else {
      // First click: select piece, show legal moves
      try {
        const moves = game.moves({ square: square as never, verbose: true });
        if (moves.length > 0) {
          setSelectedSquare(square);
          setLegalMoves(moves.map((m: { to: string }) => m.to));
        }
      } catch {
        // Invalid square or no piece
      }
    }
  }, [selectedSquare, game, moveResult, showSolution, opponentMoving, onDrop]);

  // Build custom square styles for selection + legal move hints + solution highlights
  const customSquareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (selectedSquare) {
      styles[selectedSquare] = { backgroundColor: 'rgba(74,222,128,0.35)' };
    }
    for (const sq of legalMoves) {
      styles[sq] = {
        background: 'radial-gradient(circle, rgba(74,222,128,0.25) 25%, transparent 25%)',
        borderRadius: '50%',
      };
    }
    // Highlight solution squares when solution is shown
    if (showSolution || moveResult === 'correct') {
      for (const uci of exercise.solution) {
        const from = uci.slice(0, 2);
        const to = uci.slice(2, 4);
        styles[from] = { ...styles[from], backgroundColor: 'rgba(74,222,128,0.2)' };
        styles[to] = { ...styles[to], backgroundColor: 'rgba(74,222,128,0.3)' };
      }
    }
    return styles;
  }, [selectedSquare, legalMoves, showSolution, moveResult, exercise.solution]);

  // Solution arrows for the board (cast to Square type for react-chessboard)
  type ChessSquare = 'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'a6' | 'a7' | 'a8' | 'b1' | 'b2' | 'b3' | 'b4' | 'b5' | 'b6' | 'b7' | 'b8' | 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7' | 'c8' | 'd1' | 'd2' | 'd3' | 'd4' | 'd5' | 'd6' | 'd7' | 'd8' | 'e1' | 'e2' | 'e3' | 'e4' | 'e5' | 'e6' | 'e7' | 'e8' | 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6' | 'f7' | 'f8' | 'g1' | 'g2' | 'g3' | 'g4' | 'g5' | 'g6' | 'g7' | 'g8' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'h7' | 'h8';
  const solutionArrows = useMemo((): [ChessSquare, ChessSquare, string][] | undefined => {
    if (!showSolution && moveResult !== 'correct') return undefined;
    // Only show arrows from the current moveIndex onwards (moves already played are on the board)
    return exercise.solution.slice(moveIndex).map((uci, i) => [
      uci.slice(0, 2) as ChessSquare,
      uci.slice(2, 4) as ChessSquare,
      i === 0 ? 'rgba(74,222,128,0.9)' : 'rgba(74,222,128,0.4)', // first remaining move brighter
    ]);
  }, [showSolution, moveResult, exercise.solution, moveIndex]);

  const handleRetry = () => {
    game.load(exercise.fen);
    setCurrentFen(exercise.fen);
    setMoveIndex(0);
    setMoveHistory([]);
    setMoveResult(null);
    setShowHint(false);
    setSelectedSquare(null);
    setLegalMoves([]);
    setOpponentMoving(false);
    // If puzzle starts on opponent's turn (Lichess-style ≥2 moves), re-trigger auto-play
    if (exercise.solution.length >= 2 && !isPlayerTurn(0)) {
      setTimeout(() => setOpponentMoving(true), 50);
    }
  };

  const puzzleDone = moveResult === 'correct' || showSolution;
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="flex flex-col items-center">
      <div className="w-full flex items-center mb-4">
        {/* Left: Back button (hidden when inside training session) */}
        {!hideBackButton ? (
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-chess-text transition-colors text-sm flex items-center gap-1"
          >
            ← Back
          </button>
        ) : (
          <div className="w-12" />
        )}
        <div className="flex-1 text-center">
          <span className="text-xs text-gray-500">{getThemeLabel(exercise.theme)}</span>
          <span className="mx-2 text-gray-600">·</span>
          <span className="text-xs text-gray-500 capitalize">{exercise.difficulty}</span>
          {exercise.stockfishVerified && (
            <>
              <span className="mx-2 text-gray-600">·</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-chess-accent/10 text-chess-accent font-bold">
                ✓ Engine Verified
              </span>
            </>
          )}
          {exercise.difficulty === 'advanced' && !puzzleDone && elapsed > 0 && (
            <>
              <span className="mx-2 text-gray-600">·</span>
              <span className="text-xs text-gray-500 tabular-nums">{formatTime(elapsed)}</span>
            </>
          )}
        </div>
        {/* Right: Next button (appears when puzzle done, mirrors Back position) */}
        {puzzleDone && onNext ? (
          <button
            onClick={() => onNext(moveResult === 'correct')}
            className="text-chess-accent font-bold text-sm hover:brightness-110 transition-all flex items-center gap-1"
          >
            Next →
          </button>
        ) : (
          <div className="w-12" />
        )}
      </div>

      {/* Color to move indicator — shows which side the player controls */}
      <div className="mb-3">
        <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold ${
          effectivePlayerColor === 'white'
            ? 'bg-white/10 text-white'
            : 'bg-gray-800 text-gray-200 border border-gray-700'
        }`}>
          <span className={`w-3 h-3 rounded-full ${effectivePlayerColor === 'white' ? 'bg-white' : 'bg-gray-900 border border-gray-600'}`} />
          Play as {effectivePlayerColor === 'white' ? 'White' : 'Black'}
        </span>
      </div>

      {/* Result badge */}
      {moveResult === 'correct' && (
        <div className="mb-3 px-4 py-2 rounded-xl bg-chess-accent/10 border border-chess-accent/30 text-chess-accent text-sm font-bold animate-fade-in flex items-center gap-2">
          <span className="text-lg">✓</span> Correct! Great find.
        </div>
      )}
      {moveResult === 'wrong' && (
        <div className="mb-3 px-4 py-2 rounded-xl bg-chess-blunder/10 border border-chess-blunder/30 text-chess-blunder text-sm font-bold animate-fade-in flex items-center gap-2">
          <span className="text-lg">✗</span> Not quite — try again or see the solution.
        </div>
      )}

      {/* Responsive board */}
      <div ref={containerRef} className="w-full max-w-[560px] mb-4">
        <ThemedChessboard
          position={currentFen}
          boardOrientation={effectivePlayerColor}
          boardWidth={boardSize}
          arePiecesDraggable={moveResult !== 'correct' && !showSolution && !opponentMoving}
          onPieceDrop={onDrop}
          onSquareClick={handleSquareClick}
          customSquareStyles={customSquareStyles}
          customArrows={solutionArrows}
          customArrowColor="rgba(74,222,128,0.8)"
          customBoardStyle={{ borderRadius: '8px' }}
          animationDuration={200}
        />
      </div>

      {/* Move history display */}
      {moveHistory.length > 0 && (
        <div className="w-full max-w-[560px] mb-3">
          <div className="flex items-center gap-2 text-xs text-gray-400 px-1">
            <span className="text-[10px] uppercase tracking-widest text-gray-500">Moves:</span>
            {moveHistory.map((m, i) => (
              <span key={i} className="text-chess-accent font-bold">{m}</span>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="w-full max-w-[560px] space-y-3">
        {/* Hint — auto-shown for beginner puzzles */}
        {(autoHint || showHint) && moveResult !== 'correct' ? (
          <div className="bg-chess-surface/50 border border-chess-border/30 rounded-xl p-4">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">💡 Hint</div>
            <div className="text-sm text-chess-text">{exercise.hint}</div>
          </div>
        ) : !showHint && moveResult !== 'correct' ? (
          <button
            onClick={() => setShowHint(true)}
            className="w-full bg-chess-surface/50 border border-chess-border/30 text-chess-text px-4 py-3 rounded-xl text-sm font-medium hover:bg-chess-surface/80 transition-colors"
          >
            💡 Show Hint
          </button>
        ) : null}

        {/* Retry button (after wrong) */}
        {moveResult === 'wrong' && !showSolution && (
          <button
            onClick={handleRetry}
            className="w-full bg-chess-surface/50 border border-chess-border/30 text-chess-text px-4 py-3 rounded-xl text-sm font-medium hover:bg-chess-surface/80 transition-colors"
          >
            🔄 Try Again
          </button>
        )}

        {/* Solution + Skip */}
        {!showSolution && moveResult !== 'correct' ? (
          <div className="flex gap-2">
            <button
              onClick={() => setShowSolution(true)}
              className="flex-1 bg-chess-accent text-chess-bg px-4 py-3 rounded-xl text-sm font-black hover:brightness-110 transition-all shadow-[0_0_12px_rgba(74,222,128,0.2)]"
            >
              Show Solution
            </button>
            {onNext && (
              <button
                onClick={() => {
                  setShowSolution(true);
                  // Brief delay to show the solution before moving on
                  setTimeout(() => onNext(false), 1200);
                }}
                className="bg-chess-surface/50 border border-chess-border/30 text-chess-text-secondary px-4 py-3 rounded-xl text-sm font-medium hover:bg-chess-surface/80 transition-colors"
              >
                Skip →
              </button>
            )}
          </div>
        ) : (showSolution || moveResult === 'correct') ? (
          <div className="bg-chess-accent/5 border border-chess-accent/20 rounded-xl p-4">
            <div className="text-[10px] text-chess-accent uppercase tracking-widest mb-1">Solution</div>
            <div className="text-lg font-black mb-2 flex flex-wrap items-center gap-1">
              {exercise.solutionSan.map((san, i) => {
                const isPlayer = isPlayerTurn(i);
                return (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-gray-600 text-sm">→</span>}
                    <span className={isPlayer ? 'text-chess-accent' : 'text-gray-400'}>
                      {san}
                    </span>
                  </span>
                );
              })}
            </div>
            <div className="text-sm text-chess-text-secondary leading-relaxed">
              {exercise.explanation}
            </div>
          </div>
        ) : null}

        {/* Next button moved to top-right header (see header row above) */}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 *  Lesson View — Step-by-step progression
 *
 *  Step 0:     Concept explanation (text only)
 *  Steps 1..N: Example positions (board + description + correct move + explanation)
 *  Step N+1:   Key takeaways (summary)
 * ══════════════════════════════════════════════════════════════ */

function LessonView({ lesson, onBack, onNext, hideHeader }: { lesson: Lesson; onBack: () => void; onNext?: () => void; hideHeader?: boolean }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [showMoveApplied, setShowMoveApplied] = useState(false);
  const [animatedFen, setAnimatedFen] = useState<string | null>(null);
  const { containerRef, boardSize } = useResponsiveBoardSize(320);

  const hasTakeaways = lesson.keyTakeaways.length > 0;

  // Total steps: 1 (concept) + N examples + 1? (takeaways)
  const totalSteps = 1 + lesson.examplePositions.length + (hasTakeaways ? 1 : 0);

  // Which step type are we on?
  const isConceptStep = stepIndex === 0;
  const isTakeawayStep = hasTakeaways && stepIndex === totalSteps - 1;
  const exampleIndex = !isConceptStep && !isTakeawayStep ? stepIndex - 1 : -1;
  const currentExample = exampleIndex >= 0 ? lesson.examplePositions[exampleIndex] : null;

  const canGoPrev = stepIndex > 0;
  const canGoNext = stepIndex < totalSteps - 1;
  const isLastStep = stepIndex === totalSteps - 1;

  // Reset move animation when navigating between steps
  useEffect(() => {
    setShowMoveApplied(false);
    setAnimatedFen(null);
  }, [stepIndex]);

  // Compute arrow for the best move (shown when move is applied)
  type ChessSquare = 'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'a6' | 'a7' | 'a8' | 'b1' | 'b2' | 'b3' | 'b4' | 'b5' | 'b6' | 'b7' | 'b8' | 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7' | 'c8' | 'd1' | 'd2' | 'd3' | 'd4' | 'd5' | 'd6' | 'd7' | 'd8' | 'e1' | 'e2' | 'e3' | 'e4' | 'e5' | 'e6' | 'e7' | 'e8' | 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6' | 'f7' | 'f8' | 'g1' | 'g2' | 'g3' | 'g4' | 'g5' | 'g6' | 'g7' | 'g8' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'h7' | 'h8';
  const moveArrow = useMemo((): [ChessSquare, ChessSquare, string][] | undefined => {
    if (!currentExample || showMoveApplied) return undefined;
    // Show arrow on the original position (before move applied) to indicate the move
    const moveUci = sanToUci(currentExample.fen, currentExample.correctMove);
    if (!moveUci) return undefined;
    return [[
      moveUci.slice(0, 2) as ChessSquare,
      moveUci.slice(2, 4) as ChessSquare,
      'rgba(74,222,128,0.8)',
    ]];
  }, [currentExample, showMoveApplied]);

  const handleToggleMove = useCallback(() => {
    if (!currentExample) return;
    if (showMoveApplied) {
      // Reset to original position
      setShowMoveApplied(false);
      setAnimatedFen(null);
    } else {
      // Apply the move and show result
      const moveUci = sanToUci(currentExample.fen, currentExample.correctMove);
      if (moveUci) {
        const newFen = applyMoveToFen(currentExample.fen, moveUci);
        if (newFen) {
          setAnimatedFen(newFen);
          setShowMoveApplied(true);
        }
      }
    }
  }, [currentExample, showMoveApplied]);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header — hidden when inside training session (StageHeader handles navigation) */}
      {!hideHeader && (
        <div className="flex items-center mb-4">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-chess-text transition-colors text-sm flex items-center gap-1"
          >
            ← Back
          </button>
          <div className="flex-1 text-right">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest">
              Step {stepIndex + 1} of {totalSteps}
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-xl font-black">{lesson.title}</h2>
        {lesson.stockfishVerified && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-chess-accent/10 text-chess-accent font-bold">
            ✓ Engine Verified
          </span>
        )}
      </div>
      <div className="text-sm text-gray-400 mb-4">
        {getThemeLabel(lesson.theme)} · {lesson.difficulty}
      </div>

      {/* Progress dots */}
      <div className="flex items-center gap-1.5 mb-6">
        {Array.from({ length: totalSteps }, (_, i) => (
          <button
            key={i}
            onClick={() => setStepIndex(i)}
            className={`h-1.5 rounded-full transition-all ${
              i === stepIndex
                ? 'w-6 bg-chess-accent'
                : i < stepIndex
                  ? 'w-1.5 bg-chess-accent/40'
                  : 'w-1.5 bg-chess-border/50'
            }`}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="min-h-[300px]">
        {/* Concept step */}
        {isConceptStep && (
          <div className="animate-fade-in">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">Concept</div>
            <div className="bg-chess-surface/30 border border-chess-border/30 rounded-xl p-5">
              <div className="text-sm text-chess-text whitespace-pre-wrap leading-relaxed">
                {lesson.conceptExplanation}
              </div>
            </div>
          </div>
        )}

        {/* Example position step */}
        {currentExample && (
          <div className="animate-fade-in">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">
              Example {exampleIndex + 1} of {lesson.examplePositions.length}
            </div>

            <div className="flex flex-col md:flex-row gap-4">
              <div ref={containerRef} className="w-full md:w-[320px] shrink-0">
                <ThemedChessboard
                  position={showMoveApplied && animatedFen ? animatedFen : currentExample.fen}
                  boardWidth={boardSize}
                  arePiecesDraggable={false}
                  customArrows={!showMoveApplied ? moveArrow : undefined}
                  customArrowColor="rgba(74,222,128,0.8)"
                  customBoardStyle={{ borderRadius: '8px' }}
                  animationDuration={300}
                />
              </div>

              <div className="flex-1">
                <div className="bg-chess-surface/30 border border-chess-border/30 rounded-xl p-4">
                  <p className="text-sm text-chess-text mb-3">
                    {currentExample.description}
                  </p>
                  <div className="text-sm text-chess-accent font-bold flex items-center gap-1.5 flex-wrap">
                    <span>Best: {currentExample.correctMove}</span>
                    {currentExample.stockfishVerified && (
                      <span className="text-[8px] px-1 py-0.5 rounded bg-chess-accent/10 text-chess-accent font-bold">
                        ✓ Verified
                      </span>
                    )}
                    {currentExample.stockfishVerified === false && (
                      <span className="text-[8px] px-1 py-0.5 rounded bg-gray-500/10 text-gray-500 font-bold">
                        Unverified
                      </span>
                    )}
                    <button
                      onClick={handleToggleMove}
                      className="text-[10px] px-2 py-0.5 rounded-lg bg-chess-accent/10 text-chess-accent hover:bg-chess-accent/20 transition-colors font-bold"
                    >
                      {showMoveApplied ? '↩ Reset' : '▶ Show on Board'}
                    </button>
                  </div>
                  <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                    {currentExample.explanation}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Takeaways step */}
        {isTakeawayStep && (
          <div className="animate-fade-in">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">Key Takeaways</div>
            <div className="bg-chess-accent/[0.03] border border-chess-accent/15 rounded-xl p-5">
              <ul className="space-y-3">
                {lesson.keyTakeaways.map((takeaway, i) => (
                  <li key={i} className="text-sm text-chess-text-secondary flex items-start gap-2.5">
                    <span className="text-chess-accent font-bold mt-0.5">{i + 1}.</span>
                    {takeaway}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex gap-3 mt-6">
        <button
          onClick={() => setStepIndex(i => i - 1)}
          disabled={!canGoPrev}
          className="px-5 py-2.5 rounded-xl bg-chess-surface/50 border border-chess-border/30 text-sm font-medium disabled:opacity-30 hover:bg-chess-surface/80 transition-colors"
        >
          ← Previous
        </button>
        <div className="flex-1" />
        {isLastStep ? (
          <button
            onClick={onNext ?? onBack}
            className="px-5 py-2.5 rounded-xl bg-chess-accent text-chess-bg text-sm font-black hover:brightness-110 transition-all shadow-[0_0_12px_rgba(74,222,128,0.2)]"
          >
            {onNext ? 'Next →' : 'Complete Lesson ✓'}
          </button>
        ) : (
          <button
            onClick={() => setStepIndex(i => i + 1)}
            disabled={!canGoNext}
            className="px-5 py-2.5 rounded-xl bg-chess-accent text-chess-bg text-sm font-black hover:brightness-110 transition-all shadow-[0_0_12px_rgba(74,222,128,0.2)] disabled:opacity-50"
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 *  Training Session — Inline guided training experience
 *  Drives the user through lessons → puzzles → game checks → milestones
 *  Auto-generates content when needed, tracks running accuracy
 * ══════════════════════════════════════════════════════════════ */

function TrainingSession({
  plan,
  planIndex,
  pattern,
  settings,
  exercises,
  lessons,
  snapshots,
  games,
  planState: fullPlanState,
  onSavePlanState,
  onBack,
}: {
  plan: import('@shared/types/training').TrainingPlan | null;
  planIndex: number;
  pattern: import('@shared/types/patterns').WeaknessPattern | null;
  settings: UserSettings;
  exercises: Exercise[];
  lessons: Lesson[];
  snapshots: import('@shared/types/patterns').PatternSnapshot[];
  games: GameRecord[];
  planState: TrainingPlanState | null;
  onSavePlanState: (state: TrainingPlanState) => void;
  onBack: () => void;
}) {
  // ── Compute initial progress from already-completed exercises in storage ──
  // This ensures re-entering a session mid-way resumes from where the user left off.
  const _theme = plan?.targetPattern;
  const completedForPlan = exercises.filter(
    e => plan && _theme && e.theme === _theme && e.generatedAt >= plan.createdAt && e.isCompleted
  );
  let puzzlesBeforeStage = 0;
  if (plan) {
    for (let i = 0; i < plan.currentStageIndex; i++) {
      if (plan.stages[i]?.type === 'puzzle') {
        puzzlesBeforeStage += Math.min(
          plan.stages[i].targetCount,
          completedForPlan.length - puzzlesBeforeStage
        );
      }
    }
  }
  const stageCompletedExercises = completedForPlan.slice(puzzlesBeforeStage);
  const initPuzzleCount = plan
    ? Math.min(plan.stages[plan.currentStageIndex]?.targetCount ?? 0, stageCompletedExercises.length)
    : 0;
  const initCorrect = stageCompletedExercises.slice(0, initPuzzleCount).filter(e => e.wasCorrect).length;

  const [generating, setGenerating] = useState(false);
  const [currentExercise, setCurrentExercise] = useState<Exercise | null>(null);
  const [currentLesson, setCurrentLesson] = useState<Lesson | null>(null);
  const servedIdsKey = `chess-dna-served-${plan?.id ?? 'default'}`;
  const [servedExerciseIds, setServedExerciseIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(servedIdsKey);
      const savedSet = saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
      for (const e of completedForPlan) savedSet.add(e.id);
      return savedSet;
    } catch {
      return new Set(completedForPlan.map(e => e.id));
    }
  });
  const [puzzleCount, setPuzzleCount] = useState(initPuzzleCount);
  const [sessionCorrect, setSessionCorrect] = useState(initCorrect);
  const [needsGeneration, setNeedsGeneration] = useState(false);
  const [stageComplete, setStageComplete] = useState(false);
  const [completedStageType, setCompletedStageType] = useState<string | null>(null);

  // Persist served exercise IDs to localStorage so they survive page refresh
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    try { localStorage.setItem(servedIdsKey, JSON.stringify([...servedExerciseIds])); } catch { /* noop */ }
  }, [servedExerciseIds, servedIdsKey]);

  // Delay auto-generation on mount to let storage settle (prevents duplicate requests
  // when re-entering a session after the previous generation saved in the background)
  const [mountReady, setMountReady] = useState(false);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const timer = setTimeout(() => setMountReady(true), 500);
    return () => clearTimeout(timer);
  }, []);

  const providerReady = hasAnyProvider(settings);

  // Compute player rating from most recent game (Fix 8)
  const playerRating = useMemo(() => {
    if (games.length === 0) return 1500;
    const sorted = [...games].sort((a, b) => b.playedAt - a.playedAt);
    return sorted[0].player.rating || 1500;
  }, [games]);

  // ── Null / no-plan guard ──
  if (!plan) {
    return (
      <div className="text-center py-16">
        <p className="text-chess-text-secondary text-sm">No training plan selected.</p>
        <button onClick={onBack} className="mt-4 text-chess-accent text-sm font-bold">← Back</button>
      </div>
    );
  }

  const currentStage = plan.stages[plan.currentStageIndex];
  const theme = plan.targetPattern;

  // ── No pattern available — general practice ──
  if (!theme) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <button onClick={onBack} className="text-chess-text-secondary hover:text-chess-text transition-colors text-sm mb-8 flex items-center gap-1">
          ← Back to plans
        </button>
        <div className="text-4xl mb-4">♟</div>
        <h2 className="text-lg font-black text-chess-text mb-2">{plan.targetPatternLabel}</h2>
        <p className="text-sm text-chess-text-secondary mb-6">
          This skill improves through general practice. Play games on chess.com and review your analysis to track improvement.
        </p>
        <div className="rounded-xl bg-chess-surface/30 border border-chess-border/30 p-4 text-left">
          <div className="text-[10px] text-chess-text-tertiary uppercase tracking-widest mb-2">Suggestions</div>
          <ul className="space-y-2 text-xs text-chess-text-secondary">
            <li>• Play rated games and analyze them here</li>
            <li>• Focus on taking your time with each move</li>
            <li>• Review your blunders in the game analysis view</li>
          </ul>
        </div>
      </div>
    );
  }

  // Exercises/lessons for this plan's theme
  const themeExercises = exercises
    .filter(e => e.theme === theme && e.generatedAt >= plan.createdAt)
    .sort((a, b) => a.generatedAt - b.generatedAt);

  const themeLessons = lessons
    .filter(l => l.theme === theme && l.generatedAt >= plan.createdAt)
    .sort((a, b) => a.generatedAt - b.generatedAt);

  // Available = not completed and not already served in this session
  const availableExercises = themeExercises.filter(e => !e.isCompleted && !servedExerciseIds.has(e.id));
  const availableLessons = themeLessons.filter(l => !l.isCompleted);

  // ── Advance to next stage (reset local state + persist plan progress) ──
  const advanceStage = () => {
    // Advance the plan's currentStageIndex and persist
    if (plan && fullPlanState) {
      const nextIndex = Math.min(plan.currentStageIndex + 1, plan.stages.length - 1);
      const updatedPlan = { ...plan, currentStageIndex: nextIndex };
      const updatedOptions = [...fullPlanState.options];
      updatedOptions[planIndex] = updatedPlan;
      onSavePlanState({ ...fullPlanState, options: updatedOptions });
    }

    setPuzzleCount(0);
    setSessionCorrect(0);
    setStageComplete(false);
    setCompletedStageType(null);
    setCurrentExercise(null);
    setCurrentLesson(null);
    setServedExerciseIds(new Set());
    setNeedsGeneration(false);
  };

  // ── Stage header helper with running accuracy ──
  const StageHeader = ({ label }: { label: string }) => (
    <>
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="text-chess-text-secondary hover:text-chess-text transition-colors text-sm flex items-center gap-1">
          ← Back
        </button>
        <div className="flex items-center gap-3">
          {currentStage?.type === 'puzzle' && puzzleCount > 0 && (
            <span className="text-[10px] text-chess-accent font-bold">
              ✓ {sessionCorrect}/{puzzleCount} · {Math.round((sessionCorrect / puzzleCount) * 100)}%
            </span>
          )}
          <span className="text-[10px] text-chess-text-tertiary">{label}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mb-4">
        {plan.stages.map((stage, i) => (
          <div
            key={stage.id}
            className={`h-1.5 rounded-full flex-1 transition-all ${
              i < plan.currentStageIndex ? 'bg-chess-accent'
              : i === plan.currentStageIndex ? 'bg-chess-accent/50'
              : 'bg-chess-muted/50'
            }`}
          />
        ))}
      </div>
    </>
  );

  // ── Generate content: try real-position puzzles first, fallback to AI ──
  const handleGenerate = async () => {
    if (generating || !pattern) return;
    setGenerating(true);
    try {
      if (currentStage?.type === 'puzzle' || currentStage?.type === undefined) {
        const remaining = Math.max(1, (currentStage?.targetCount ?? 3) - puzzleCount);

        // Try real-position puzzles first (zero hallucination), excluding already-served
        const realPuzzles = generateRealPositionPuzzles(
          pattern ? [pattern] : [],
          theme!,
          remaining,
          servedExerciseIds,
        );

        if (realPuzzles.length >= remaining) {
          // Enough real puzzles — use them
          for (const ex of realPuzzles) {
            await saveExercise(ex);
          }
          setCurrentExercise(realPuzzles[0]);
          setServedExerciseIds(prev => new Set([...prev, realPuzzles[0].id]));
          setNeedsGeneration(false);
        } else {
          // Not enough real puzzles — save what we have, then try AI for the rest
          for (const ex of realPuzzles) {
            await saveExercise(ex);
          }

          const aiNeeded = remaining - realPuzzles.length;
          if (providerReady && aiNeeded > 0) {
            const newExercises = await generateExercises(settings, pattern, playerRating, aiNeeded);
            if (Array.isArray(newExercises)) {
              for (const ex of newExercises) {
                await saveExercise(ex);
              }
            }
          }

          // Pick first available puzzle
          const firstPuzzle = realPuzzles[0];
          if (firstPuzzle) {
            setCurrentExercise(firstPuzzle);
            setServedExerciseIds(prev => new Set([...prev, firstPuzzle.id]));
            setNeedsGeneration(false);
          }
        }
      } else if (currentStage?.type === 'lesson') {
        if (!providerReady) return;
        const newLesson = await generateLesson(settings, pattern, playerRating);
        if (newLesson) {
          await saveLesson(newLesson);
          setCurrentLesson(newLesson);
          setNeedsGeneration(false);
        }
      }
    } catch (err) {
      console.error('[Chess DNA] Training session generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  // ── Auto-generate when no exercises available mid-session ──
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!mountReady) return; // Wait for storage to settle before triggering generation
    if (needsGeneration && !generating && pattern) {
      handleGenerate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsGeneration, generating, mountReady]);

  // ── Auto-pick next exercise when currentExercise is null ──
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!mountReady) return; // Wait for storage to settle before auto-picking/generating
    if (currentStage?.type === 'puzzle' && !currentExercise && !generating && !stageComplete) {
      if (puzzleCount >= (currentStage?.targetCount ?? 5)) {
        setCompletedStageType('puzzle');
        setStageComplete(true);
        return;
      }
      if (availableExercises.length > 0) {
        const next = availableExercises[0];
        setCurrentExercise(next);
        setServedExerciseIds(prev => new Set([...prev, next.id]));
      } else if (pattern && !needsGeneration) {
        setNeedsGeneration(true);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentExercise, puzzleCount, availableExercises.length, generating, stageComplete, mountReady]);

  // ── Auto-pick lesson ──
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!mountReady) return; // Wait for storage to settle before auto-picking/generating
    if (currentStage?.type === 'lesson' && !currentLesson && !generating && !stageComplete) {
      if (availableLessons.length > 0) {
        setCurrentLesson(availableLessons[0]);
      } else if (providerReady && pattern && !needsGeneration) {
        setNeedsGeneration(true);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLesson, availableLessons.length, generating, stageComplete, mountReady]);

  // ── Milestone stage ──
  if (currentStage?.type === 'milestone') {
    const accuracy = computeTrainingAccuracy(plan, exercises, snapshots);
    return (
      <div className="max-w-md mx-auto">
        <StageHeader label={`Final · Stage ${plan.currentStageIndex + 1}/${plan.stages.length}`} />
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🏆</div>
          <h2 className="text-lg font-black text-chess-text mb-1">Training Complete!</h2>
          <p className="text-sm text-chess-text-secondary">
            Great work on this pattern. Here are your results.
          </p>
        </div>
        <div className="rounded-xl bg-chess-surface/30 border border-chess-border/30 p-4 mb-4">
          <div className="flex gap-6">
            <div>
              <div className="text-[10px] text-chess-text-tertiary uppercase tracking-widest mb-0.5">Practice</div>
              <div className="text-lg font-bold text-chess-text">
                {accuracy.practiceTotal > 0 ? `${accuracy.practiceAccuracy}%` : '--'}
              </div>
              <div className="text-[10px] text-chess-text-tertiary">{accuracy.practiceCorrect}/{accuracy.practiceTotal} correct</div>
            </div>
            <div>
              <div className="text-[10px] text-chess-text-tertiary uppercase tracking-widest mb-0.5">Real Games</div>
              <div className="text-lg font-bold text-chess-text">
                {accuracy.gameAccuracyTrend.length > 0 ? `${accuracy.gameAccuracy}%` : '--'}
              </div>
              <div className="text-[10px] text-chess-text-tertiary">{accuracy.gameAccuracyTrend.length} games tracked</div>
            </div>
          </div>
          {accuracy.lastGame && (
            <div className={`mt-3 text-xs rounded-lg px-3 py-2 ${
              accuracy.lastGame.patternCount === 0
                ? 'bg-chess-accent/10 text-chess-accent'
                : 'bg-chess-blunder/10 text-chess-blunder'
            }`}>
              {accuracy.lastGame.details}
            </div>
          )}
        </div>
        <button
          onClick={onBack}
          className="w-full py-2.5 rounded-xl bg-chess-accent text-chess-bg font-bold text-sm hover:brightness-110 transition-all"
        >
          Back to Plans
        </button>
      </div>
    );
  }

  // ── Game-check stage — encourage real play ──
  if (currentStage?.type === 'game-check') {
    const accuracy = computeTrainingAccuracy(plan, exercises, snapshots);
    return (
      <div className="max-w-md mx-auto">
        <StageHeader label={`Game Check · Stage ${plan.currentStageIndex + 1}/${plan.stages.length}`} />
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">♟</div>
          <h2 className="text-lg font-black text-chess-text mb-1">Time to Play!</h2>
          <p className="text-sm text-chess-text-secondary">
            Put your training into practice. Play a game on chess.com, then come back to continue.
          </p>
        </div>
        <div className="rounded-xl bg-chess-surface/30 border border-chess-border/30 p-4 mb-4">
          <div className="text-[10px] text-chess-text-tertiary uppercase tracking-widest mb-2">Your Progress So Far</div>
          <div className="flex gap-6">
            <div>
              <div className="text-[10px] text-chess-text-tertiary mb-0.5">Practice Accuracy</div>
              <div className="text-lg font-bold text-chess-text">
                {accuracy.practiceTotal > 0 ? `${accuracy.practiceAccuracy}%` : '--'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-chess-text-tertiary mb-0.5">Puzzles Solved</div>
              <div className="text-lg font-bold text-chess-text">{accuracy.practiceTotal}</div>
            </div>
          </div>
        </div>
        <button
          onClick={() => {
            // Persist game-check completion to plan state in storage
            if (fullPlanState) {
              const updatedOptions = [...fullPlanState.options];
              const updatedPlan = { ...updatedOptions[planIndex], stages: updatedOptions[planIndex].stages.map(s => ({ ...s })) };
              const gcStage = updatedPlan.stages[updatedPlan.currentStageIndex];
              if (gcStage && gcStage.type === 'game-check') {
                gcStage.completedCount = 1;
              }
              updatedOptions[planIndex] = updatedPlan;
              onSavePlanState({ ...fullPlanState, options: updatedOptions });
            }
            advanceStage();
          }}
          className="w-full py-2.5 rounded-xl bg-chess-accent text-chess-bg font-bold text-sm hover:brightness-110 transition-all"
        >
          I've played a game →
        </button>
        <button
          onClick={onBack}
          className="w-full mt-2 py-2 rounded-xl text-chess-text-secondary text-sm hover:text-chess-text transition-colors"
        >
          Back to plans
        </button>
      </div>
    );
  }

  // ── Stage complete transition (Fix 4: meaningful feedback) ──
  if (stageComplete) {
    const pct = puzzleCount > 0 ? Math.round((sessionCorrect / puzzleCount) * 100) : 0;
    let emoji = '✓';
    let heading = 'Stage Complete!';
    let message = 'Great work! Moving to the next stage.';

    if (completedStageType === 'puzzle') {
      if (pct >= 80) {
        emoji = '🔥';
        heading = 'Excellent!';
        message = `${sessionCorrect}/${puzzleCount} correct (${pct}%) — You're mastering this pattern!`;
      } else if (pct >= 60) {
        emoji = '👍';
        heading = 'Good Progress!';
        message = `${sessionCorrect}/${puzzleCount} correct (${pct}%) — Keep practicing to solidify this.`;
      } else {
        emoji = '💪';
        heading = 'Keep Going!';
        message = `${sessionCorrect}/${puzzleCount} correct (${pct}%) — Every puzzle builds understanding.`;
      }
    } else if (completedStageType === 'lesson') {
      emoji = '📖';
      heading = 'Concept Learned!';
      message = 'Great — time to put this into practice with puzzles.';
    }

    return (
      <div className="max-w-md mx-auto text-center py-12">
        <StageHeader label={`Stage ${plan.currentStageIndex + 1}/${plan.stages.length}`} />
        <div className="text-4xl mb-3">{emoji}</div>
        <h2 className="text-lg font-black text-chess-text mb-2">{heading}</h2>
        <p className="text-sm text-chess-text-secondary mb-6">{message}</p>
        <button
          onClick={advanceStage}
          className="w-full py-2.5 rounded-xl bg-chess-accent text-chess-bg font-bold text-sm hover:brightness-110 transition-all"
        >
          Continue →
        </button>
      </div>
    );
  }

  // ── Puzzle stage ──
  if (currentStage?.type === 'puzzle') {
    // Show puzzle if we have one
    if (currentExercise) {
      return (
        <div>
          <StageHeader label={`Puzzle ${puzzleCount + 1}/${currentStage.targetCount} · Stage ${plan.currentStageIndex + 1}/${plan.stages.length}`} />
          <PuzzleView
            exercise={currentExercise}
            onBack={onBack}
            hideBackButton
            onNext={(wasCorrect) => {
              // Mark exercise as completed in storage so updatePlanProgress sees it
              const completed = { ...currentExercise, isCompleted: true, wasCorrect, attemptedAt: Date.now() };
              saveExercise(completed);
              setPuzzleCount(c => c + 1);
              if (wasCorrect) setSessionCorrect(c => c + 1);
              setCurrentExercise(null);
              // useEffect will auto-pick next or auto-generate
            }}
          />
        </div>
      );
    }

    // Loading / generating state
    if (generating || needsGeneration) {
      return (
        <div className="max-w-md mx-auto text-center py-12">
          <StageHeader label={`Stage ${plan.currentStageIndex + 1}/${plan.stages.length}`} />
          <div className="w-8 h-8 border-2 border-chess-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-chess-text-secondary">
            {pattern?.examplePositions?.length ? 'Preparing puzzles from your games...' : 'Generating puzzles...'}
          </p>
          <p className="text-[11px] text-chess-text-tertiary mt-2">This may take a few seconds</p>
        </div>
      );
    }

    // First entry — no exercises exist at all, no provider, and no real positions
    if (!providerReady && !(pattern?.examplePositions?.length)) {
      return (
        <div className="max-w-md mx-auto text-center py-12">
          <StageHeader label={`Stage ${plan.currentStageIndex + 1}/${plan.stages.length}`} />
          <div className="text-3xl mb-3">🧩</div>
          <h2 className="text-lg font-black text-chess-text mb-2">
            {plan.currentStageIndex === 0 ? 'Build pattern recognition' : 'Test your understanding'}
          </h2>
          <p className="text-sm text-chess-text-secondary mb-6">
            Add an API key in Settings to generate puzzles, or play more games so we can create puzzles from your real positions.
          </p>
          <button
            onClick={onBack}
            className="w-full py-2.5 rounded-xl bg-chess-surface/50 border border-chess-border/30 text-chess-text font-medium text-sm hover:bg-chess-surface/80 transition-colors"
          >
            ← Back
          </button>
        </div>
      );
    }

    // Waiting for auto-pick (brief flash)
    return (
      <div className="text-center py-16">
        <div className="w-6 h-6 border-2 border-chess-accent border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  // ── Lesson stage ──
  if (currentStage?.type === 'lesson') {
    if (currentLesson) {
      return (
        <div>
          <StageHeader label={`Lesson · Stage ${plan.currentStageIndex + 1}/${plan.stages.length}`} />
          <LessonView
            lesson={currentLesson}
            onBack={onBack}
            hideHeader
            onNext={() => {
              // Mark lesson as completed in storage so updatePlanProgress sees it
              saveLesson({ ...currentLesson, isCompleted: true });
              setCompletedStageType('lesson');
              setStageComplete(true);
            }}
          />
        </div>
      );
    }

    if (generating || needsGeneration) {
      return (
        <LessonLoadingProgress stageHeader={<StageHeader label={`Stage ${plan.currentStageIndex + 1}/${plan.stages.length}`} />} />
      );
    }

    if (!providerReady) {
      return (
        <div className="max-w-md mx-auto text-center py-12">
          <StageHeader label={`Stage ${plan.currentStageIndex + 1}/${plan.stages.length}`} />
          <div className="text-3xl mb-3">📖</div>
          <h2 className="text-lg font-black text-chess-text mb-2">Study Time</h2>
          <p className="text-sm text-chess-text-secondary mb-6">
            Add an API key in Settings to generate lessons.
          </p>
          <button
            onClick={onBack}
            className="w-full py-2.5 rounded-xl bg-chess-surface/50 border border-chess-border/30 text-chess-text font-medium text-sm hover:bg-chess-surface/80 transition-colors"
          >
            ← Back
          </button>
        </div>
      );
    }

    return (
      <div className="text-center py-16">
        <div className="w-6 h-6 border-2 border-chess-accent border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  // Fallback
  return (
    <div className="text-center py-16">
      <p className="text-chess-text-secondary text-sm">Unknown stage type.</p>
      <button onClick={onBack} className="mt-4 text-chess-accent text-sm font-bold">← Back</button>
    </div>
  );
}
