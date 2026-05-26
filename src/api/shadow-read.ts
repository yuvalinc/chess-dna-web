/**
 * Shadow-read wrapper — Phase 5 of the Fly + Supabase migration.
 *
 * Wraps entity READ operations to fetch from BOTH Base44 (authoritative)
 * AND Supabase (shadow), compares results, logs drift. Returns the Base44
 * result to the caller — no UI behavior change.
 *
 * Per-entity feature flag (default OFF):
 *   VITE_SHADOW_READ_GAME=true
 *   VITE_SHADOW_READ_ANALYSIS=true
 *   …same for Pattern, PatternSnapshot, UserPreferences, Insight
 *
 * Drift is logged to the `drift_log` table (operation='read'). The Phase 6
 * read-source flip is gated on this table being quiet for 3 consecutive days.
 *
 * Nothing in production calls these yet. To enable shadow-read for an entity:
 *   1. Set the flag in .env.local
 *   2. Refactor relevant call sites to use sr{Get,List,Filter}
 *   3. Monitor drift_log
 */
import { rawEntities } from './base44-raw';
import { supabaseFetch, isSupabaseConfigured } from './supabaseClient';
import { TABLE_MAP, type Entity } from './supabase-transform';
import { logDrift } from './dual-write';

const FLAG_MAP: Record<Entity, string> = {
  Game: 'VITE_SHADOW_READ_GAME',
  Analysis: 'VITE_SHADOW_READ_ANALYSIS',
  Pattern: 'VITE_SHADOW_READ_PATTERN',
  PatternSnapshot: 'VITE_SHADOW_READ_PATTERN_SNAPSHOT',
  UserPreferences: 'VITE_SHADOW_READ_USER_PREFERENCES',
  Insight: 'VITE_SHADOW_READ_INSIGHT',
};

export function isShadowReadEnabled(entity: Entity): boolean {
  if (!isSupabaseConfigured()) return false;
  const flagName = FLAG_MAP[entity];
  const value = (import.meta.env[flagName] ?? '').toString().toLowerCase();
  return value === 'true' || value === '1';
}

/** Read a single row by id from Base44, optionally shadow-read from Supabase. */
export async function srGet<T extends { id: string }>(
  entity: Entity,
  id: string,
): Promise<T> {
  const base44Result = await rawEntities[entity].get(id) as T;

  if (isShadowReadEnabled(entity)) {
    void compareGet(entity, id, base44Result).catch((err) => {
      console.warn(`[shadow-read] ${entity}.get compare failed:`, err);
    });
  }

  return base44Result;
}

/** List rows from Base44, optionally shadow-read from Supabase. */
export async function srList<T extends { id: string }>(
  entity: Entity,
  sort?: string,
  limit?: number,
): Promise<T[]> {
  const base44Result = await rawEntities[entity].list(sort, limit) as T[];

  if (isShadowReadEnabled(entity)) {
    void compareList(entity, base44Result, { sort, limit }).catch((err) => {
      console.warn(`[shadow-read] ${entity}.list compare failed:`, err);
    });
  }

  return base44Result;
}

/** Filtered list from Base44, optionally shadow-read from Supabase. */
export async function srFilter<T extends { id: string }>(
  entity: Entity,
  filters: Record<string, unknown>,
  sort?: string,
  limit?: number,
): Promise<T[]> {
  const base44Result = await rawEntities[entity].filter(filters, sort, limit) as T[];

  if (isShadowReadEnabled(entity)) {
    void compareFilter(entity, base44Result, { filters, sort, limit }).catch((err) => {
      console.warn(`[shadow-read] ${entity}.filter compare failed:`, err);
    });
  }

  return base44Result;
}

// ── Compare helpers ──

async function compareGet(entity: Entity, id: string, base44Row: { id: string }): Promise<void> {
  const table = TABLE_MAP[entity];
  let supabaseRow: Record<string, unknown> | null = null;

  try {
    const rows = await supabaseFetch<Record<string, unknown>[]>(
      `/${table}?id=eq.${id}&limit=1`,
    );
    supabaseRow = rows[0] ?? null;
  } catch (err) {
    await logDrift({
      entity, entityId: id, operation: 'read',
      note: `supabase fetch failed: ${describeErr(err)}`,
    });
    return;
  }

  if (!supabaseRow) {
    await logDrift({
      entity, entityId: id, operation: 'read',
      base44Value: base44Row,
      note: 'row missing in supabase',
    });
    return;
  }

  // Compare key fields. Don't compare timestamps or jsonb-internal ordering.
  const diffs = compareRows(base44Row as Record<string, unknown>, supabaseRow, entity);
  if (diffs.length > 0) {
    for (const d of diffs) {
      await logDrift({
        entity, entityId: id, operation: 'read',
        field: d.field,
        base44Value: d.base44,
        supabaseValue: d.supabase,
      });
    }
  }
}

async function compareList(
  entity: Entity,
  base44Rows: { id: string }[],
  opts: { sort?: string; limit?: number },
): Promise<void> {
  const table = TABLE_MAP[entity];
  const qs = listQueryString(opts);

  let supabaseRows: Record<string, unknown>[];
  try {
    supabaseRows = await supabaseFetch<Record<string, unknown>[]>(`/${table}${qs}`);
  } catch (err) {
    await logDrift({
      entity, entityId: null, operation: 'read',
      note: `supabase list failed: ${describeErr(err)}`,
    });
    return;
  }

  if (base44Rows.length !== supabaseRows.length) {
    await logDrift({
      entity, entityId: null, operation: 'read',
      base44Value: { count: base44Rows.length },
      supabaseValue: { count: supabaseRows.length },
      note: 'list count mismatch',
    });
  }

  // Sample first N for spot-check.
  const sampleSize = Math.min(5, base44Rows.length);
  for (let i = 0; i < sampleSize; i++) {
    const b = base44Rows[i] as Record<string, unknown>;
    const s = supabaseRows.find((r) => r.id === b.id);
    if (!s) {
      await logDrift({
        entity, entityId: b.id as string, operation: 'read',
        base44Value: b, note: 'sample row missing in supabase list',
      });
      continue;
    }
    const diffs = compareRows(b, s, entity);
    for (const d of diffs) {
      await logDrift({
        entity, entityId: b.id as string, operation: 'read',
        field: d.field, base44Value: d.base44, supabaseValue: d.supabase,
        note: 'list sample drift',
      });
    }
  }
}

async function compareFilter(
  entity: Entity,
  base44Rows: { id: string }[],
  opts: { filters: Record<string, unknown>; sort?: string; limit?: number },
): Promise<void> {
  const table = TABLE_MAP[entity];
  const filterQs = filtersToPostgrest(opts.filters);
  const listQs = listQueryString({ sort: opts.sort, limit: opts.limit });
  const qs = filterQs + (listQs ? (filterQs.includes('?') ? '&' : '?') + listQs.slice(1) : '');

  let supabaseRows: Record<string, unknown>[];
  try {
    supabaseRows = await supabaseFetch<Record<string, unknown>[]>(`/${table}${qs}`);
  } catch (err) {
    await logDrift({
      entity, entityId: null, operation: 'read',
      note: `supabase filter failed: ${describeErr(err)} (filters=${JSON.stringify(opts.filters)})`,
    });
    return;
  }

  if (base44Rows.length !== supabaseRows.length) {
    await logDrift({
      entity, entityId: null, operation: 'read',
      base44Value: { count: base44Rows.length, filters: opts.filters },
      supabaseValue: { count: supabaseRows.length },
      note: 'filter count mismatch',
    });
  }
}

// ── Diff helpers ──

interface FieldDiff {
  field: string;
  base44: unknown;
  supabase: unknown;
}

// Fields to ignore in row-level comparison (different shapes between systems).
// `is_sample` is a Base44-internal flag that's dropped during transformToSupabase;
// without ignoring it here every Game/Analysis sample comparison logs spurious drift.
const IGNORED_FIELDS = new Set([
  'created_date', 'updated_date', 'created_by_id', 'is_sample',
  'created_at', 'updated_at', 'user_id',
]);

function compareRows(
  base44: Record<string, unknown>,
  supabase: Record<string, unknown>,
  _entity: Entity,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  // Walk Base44 keys; the snake_case equivalent is what's in supabase.
  for (const [key, b44Val] of Object.entries(base44)) {
    if (IGNORED_FIELDS.has(key)) continue;
    const snakeKey = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    if (IGNORED_FIELDS.has(snakeKey)) continue;
    const sbVal = supabase[snakeKey];

    if (!shallowEqual(b44Val, sbVal)) {
      diffs.push({ field: key, base44: b44Val, supabase: sbVal });
      if (diffs.length >= 10) break; // cap per-row drift to avoid log spam
    }
  }

  return diffs;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  // Both arrays: compare length + each item (deep-equal via JSON for jsonb).
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // Both objects: JSON-compare (good enough for jsonb columns).
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return false;
}

// Base44 column → Supabase column mapping for ORDER BY and filter keys.
// Base44 uses `created_date` / `updated_date`; Supabase uses `created_at` /
// `updated_at`. Without this map, `Analysis.list('-created_date', 800)`
// hits PostgREST with `?order=created_date.desc` which 400s with
// "column analyses.created_date does not exist".
const SB_COLUMN_MAP: Record<string, string> = {
  created_date: 'created_at',
  updated_date: 'updated_at',
};

function toSupabaseColumn(snakeKey: string): string {
  return SB_COLUMN_MAP[snakeKey] ?? snakeKey;
}

function listQueryString(opts: { sort?: string; limit?: number }): string {
  const params: string[] = [];
  if (opts.sort) {
    // Base44 sort: '-created_date' → desc, 'created_date' → asc.
    const desc = opts.sort.startsWith('-');
    const rawCol = (desc ? opts.sort.slice(1) : opts.sort).replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    const col = toSupabaseColumn(rawCol);
    params.push(`order=${col}.${desc ? 'desc' : 'asc'}`);
  }
  if (opts.limit) params.push(`limit=${opts.limit}`);
  return params.length > 0 ? '?' + params.join('&') : '';
}

function filtersToPostgrest(filters: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(filters)) {
    const snake = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    const col = toSupabaseColumn(snake);
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      parts.push(`${col}=eq.${encodeURIComponent(String(val))}`);
    }
  }
  return parts.length > 0 ? '?' + parts.join('&') : '';
}

function describeErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
