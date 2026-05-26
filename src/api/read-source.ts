/**
 * Read-source flag wrapper — Phase 6 of the Fly + Supabase migration.
 *
 * After shadow-read has confirmed parity, we flip per-entity reads from
 * Base44 to Supabase. Writes still go to both (dual-write), so we can flip
 * back instantly if anything goes wrong.
 *
 * Per-entity flag (default 'base44'):
 *   VITE_READ_FROM_GAME=supabase
 *   VITE_READ_FROM_ANALYSIS=supabase
 *   …same for Pattern, PatternSnapshot, UserPreferences, Insight
 *
 * Rollback: change the env var back to base44 (or unset it), redeploy.
 * Dual-write kept Base44 in sync, so the rollback is instant and safe.
 *
 * Nothing in production calls these yet. To flip an entity:
 *   1. Verify Phase 5 shadow-read drift is quiet for 3 consecutive days
 *   2. Set VITE_READ_FROM_<entity>=supabase in production env
 *   3. Refactor read call sites to use rsfGet/rsfList/rsfFilter
 *   4. Monitor errors for 24h before flipping the next entity
 */
import { base44 } from './base44Client';
import { supabaseFetch, isSupabaseConfigured } from './supabaseClient';
import { TABLE_MAP, transformFromSupabase, type Entity } from './supabase-transform';

type ReadSource = 'base44' | 'supabase';

const FLAG_MAP: Record<Entity, string> = {
  Game: 'VITE_READ_FROM_GAME',
  Analysis: 'VITE_READ_FROM_ANALYSIS',
  Pattern: 'VITE_READ_FROM_PATTERN',
  PatternSnapshot: 'VITE_READ_FROM_PATTERN_SNAPSHOT',
  UserPreferences: 'VITE_READ_FROM_USER_PREFERENCES',
  Insight: 'VITE_READ_FROM_INSIGHT',
};

export function getReadSource(entity: Entity): ReadSource {
  if (!isSupabaseConfigured()) return 'base44';
  const flagName = FLAG_MAP[entity];
  const value = (import.meta.env[flagName] ?? '').toString().toLowerCase();
  return value === 'supabase' ? 'supabase' : 'base44';
}

/** Read a single row by id from the configured source. */
export async function rsfGet<T extends { id: string }>(
  entity: Entity,
  id: string,
): Promise<T> {
  if (getReadSource(entity) === 'supabase') {
    return readSupabaseRow<T>(entity, id);
  }
  const entities = base44.entities as Record<string, { get: (id: string) => Promise<T> }>;
  return entities[entity]!.get(id);
}

/** List rows from the configured source. */
export async function rsfList<T extends { id: string }>(
  entity: Entity,
  sort?: string,
  limit?: number,
): Promise<T[]> {
  if (getReadSource(entity) === 'supabase') {
    return readSupabaseList<T>(entity, { sort, limit });
  }
  const entities = base44.entities as Record<string, {
    list: (sort?: string, limit?: number) => Promise<T[]>;
  }>;
  return entities[entity]!.list(sort, limit);
}

/** Filtered list from the configured source. */
export async function rsfFilter<T extends { id: string }>(
  entity: Entity,
  filters: Record<string, unknown>,
  sort?: string,
  limit?: number,
): Promise<T[]> {
  if (getReadSource(entity) === 'supabase') {
    return readSupabaseList<T>(entity, { filters, sort, limit });
  }
  const entities = base44.entities as Record<string, {
    filter: (f: Record<string, unknown>, sort?: string, limit?: number) => Promise<T[]>;
  }>;
  return entities[entity]!.filter(filters, sort, limit);
}

// ── Supabase reads ──

async function readSupabaseRow<T>(entity: Entity, id: string): Promise<T> {
  const table = TABLE_MAP[entity];
  const rows = await supabaseFetch<Record<string, unknown>[]>(
    `/${table}?id=eq.${id}&limit=1`,
  );
  if (rows.length === 0) {
    throw new Error(`${entity} ${id} not found in Supabase`);
  }
  return transformFromSupabase(entity, rows[0]!) as T;
}

async function readSupabaseList<T>(
  entity: Entity,
  opts: { filters?: Record<string, unknown>; sort?: string; limit?: number },
): Promise<T[]> {
  const table = TABLE_MAP[entity];
  const qs = buildQueryString(opts);
  const rows = await supabaseFetch<Record<string, unknown>[]>(`/${table}${qs}`);
  return rows.map((r) => transformFromSupabase(entity, r) as T);
}

function buildQueryString(opts: {
  filters?: Record<string, unknown>;
  sort?: string;
  limit?: number;
}): string {
  const parts: string[] = [];

  // Filters: { foo: 'bar' } → foo=eq.bar
  if (opts.filters) {
    for (const [key, val] of Object.entries(opts.filters)) {
      const snake = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        parts.push(`${snake}=eq.${encodeURIComponent(String(val))}`);
      }
    }
  }

  // Sort: '-created_date' → order=created_at.desc
  if (opts.sort) {
    const desc = opts.sort.startsWith('-');
    const col = (desc ? opts.sort.slice(1) : opts.sort).replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    parts.push(`order=${col}.${desc ? 'desc' : 'asc'}`);
  }

  if (opts.limit) parts.push(`limit=${opts.limit}`);

  return parts.length > 0 ? '?' + parts.join('&') : '';
}
