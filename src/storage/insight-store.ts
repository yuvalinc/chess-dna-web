/**
 * Storage layer for Lessons, Exercises, and Insights.
 * Replaces Chrome extension's storageSet/storageGetByPrefix with Base44 entity CRUD.
 * RLS handles user scoping server-side — no need for created_by_id filter.
 */
import { base44 } from '../api/base44Client';
import type { Insight, Lesson, Exercise } from '@shared/types/ai';

// Insights
export async function saveInsight(insight: Insight): Promise<void> {
  await (base44.entities as any).Insight.create(insight);
}

export async function getInsights(): Promise<Insight[]> {
  const records = await (base44.entities as any).Insight.list();
  return (Array.isArray(records) ? records : []).sort(
    (a: Insight, b: Insight) => b.generatedAt - a.generatedAt,
  );
}

export async function markInsightRead(id: string): Promise<void> {
  await (base44.entities as any).Insight.update(id, { isRead: true });
}

// Lessons
export async function saveLesson(lesson: Lesson): Promise<void> {
  // Map TS fields to Base44 schema: theme → themeId, serialize array-of-objects
  await (base44.entities as any).Lesson.create({
    ...lesson,
    themeId: lesson.theme,
    examplePositions: lesson.examplePositions.map((p) => JSON.stringify(p)),
    keyTakeaways: lesson.keyTakeaways,
  });
}

export async function getLessons(): Promise<Lesson[]> {
  const records = await (base44.entities as any).Lesson.list();
  return (Array.isArray(records) ? records : []).sort(
    (a: Lesson, b: Lesson) => b.generatedAt - a.generatedAt,
  );
}

// Exercises
export async function saveExercise(exercise: Exercise): Promise<void> {
  // Map TS fields to Base44 schema: theme → themeId, fen → position, solution[] → solution string
  await (base44.entities as any).Exercise.create({
    ...exercise,
    themeId: exercise.theme,
    position: exercise.fen,
    solution: JSON.stringify(exercise.solution),
    solutionSan: JSON.stringify(exercise.solutionSan),
  });
}

export async function getExercises(): Promise<Exercise[]> {
  const records = await (base44.entities as any).Exercise.list();
  return (Array.isArray(records) ? records : []).sort(
    (a: Exercise, b: Exercise) => b.generatedAt - a.generatedAt,
  );
}
