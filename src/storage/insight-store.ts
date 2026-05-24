/**
 * Storage layer for Insights.
 * RLS handles user scoping server-side — no need for created_by_id filter.
 */
import { base44 } from '../api/base44Client';
import type { Insight } from '@shared/types/ai';

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
