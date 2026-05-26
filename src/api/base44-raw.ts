/**
 * Snapshot of the original Base44 entity CRUD methods, BOUND at module-load
 * time before anything can mutate `base44.entities`.
 *
 * Used by `dual-write.ts` and `shadow-read.ts` so they can call Base44
 * directly. If a future `base44-shadow-wrap.ts` ever monkey-patches
 * `base44.entities.<X>.create`, these bound wrappers still hit the original
 * SDK methods — no infinite recursion.
 *
 * Self-contained: does NOT modify `base44.entities` or `base44Client.ts`.
 * Importing this file has zero observable side effects.
 *
 * Add new entities here as soon as they're mirrored to Supabase.
 */
import { base44 } from './base44Client';

function snapshotHandler(handler: any) {
  return {
    create: (data: unknown) => handler.create(data),
    update: (id: string, data: unknown) => handler.update(id, data),
    delete: (id: string) => handler.delete(id),
    get: (id: string) => handler.get(id),
    list: (sort?: string, limit?: number) => handler.list(sort, limit),
    filter: (filters: Record<string, unknown>, sort?: string, limit?: number) =>
      handler.filter(filters, sort, limit),
  };
}

const _e = base44.entities as unknown as Record<string, any>;

export const rawEntities = {
  Game: snapshotHandler(_e.Game),
  Analysis: snapshotHandler(_e.Analysis),
  Pattern: snapshotHandler(_e.Pattern),
  PatternSnapshot: snapshotHandler(_e.PatternSnapshot),
  UserPreferences: snapshotHandler(_e.UserPreferences),
  Insight: snapshotHandler(_e.Insight),
};
