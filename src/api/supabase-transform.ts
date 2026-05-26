/**
 * Field transformation: Base44 row (camelCase + serialized arrays) → Supabase
 * row (snake_case + jsonb).
 *
 * Used by both:
 *   - src/api/dual-write.ts (browser, Phase 3)
 *   - scripts/backfill-to-supabase.ts (node, Phase 4)
 *
 * Keep entity-specific logic here so both call sites stay in sync.
 */

export type Entity =
  | 'Game'
  | 'Analysis'
  | 'Pattern'
  | 'PatternSnapshot'
  | 'UserPreferences'
  | 'Insight';

export const TABLE_MAP: Record<Entity, string> = {
  Game: 'games',
  Analysis: 'analyses',
  Pattern: 'patterns',
  PatternSnapshot: 'pattern_snapshots',
  UserPreferences: 'user_preferences',
  Insight: 'insights',
};

/**
 * Convert a Base44 row into a Supabase row. Stamps user_id on the result.
 *
 * Special cases:
 *   - UserPreferences: pack all settings into the `settings` jsonb column.
 *   - Analysis: deserialize `moves` (Base44 stores as string[]).
 *   - Pattern: deserialize `patterns` (Base44 stores as string[]).
 *   - PatternSnapshot: deserialize `themes` (Base44 stores as string[]).
 *   - Game / Insight: generic camelCase → snake_case.
 */
export function transformToSupabase(
  entity: Entity,
  row: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  // Strip Base44 metadata that doesn't apply server-side. `is_sample` is a
  // Base44-internal flag and the Supabase schema doesn't define it — including
  // it in a PATCH body triggers PGRST204 "Could not find the 'is_sample'
  // column of 'games' in the schema cache" and the mirror update is dropped.
  const clean = { ...row };
  delete clean.created_date;
  delete clean.updated_date;
  delete clean.created_by_id;
  delete clean.is_sample;

  if (entity === 'UserPreferences') {
    const { id, ...settings } = clean;
    return { id, user_id: userId, settings };
  }

  if (entity === 'Analysis') {
    const out = camelToSnake(clean);
    if (Array.isArray(out.moves)) {
      out.moves = out.moves.map((m: unknown) =>
        typeof m === 'string' ? safeJsonParse(m) : m,
      );
    }
    out.user_id = userId;
    return out;
  }

  if (entity === 'Pattern') {
    const out = camelToSnake(clean);
    if (Array.isArray(out.patterns)) {
      out.patterns = out.patterns.map((p: unknown) =>
        typeof p === 'string' ? safeJsonParse(p) : p,
      );
    }
    out.user_id = userId;
    return out;
  }

  if (entity === 'PatternSnapshot') {
    const out = camelToSnake(clean);
    if (Array.isArray(out.themes)) {
      out.themes = out.themes.map((t: unknown) =>
        typeof t === 'string' ? safeJsonParse(t) : t,
      );
    }
    out.user_id = userId;
    return out;
  }

  // Game, Insight — generic.
  const out = camelToSnake(clean);
  out.user_id = userId;
  return out;
}

export function camelToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const snake = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    out[snake] = val;
  }
  return out;
}

export function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = val;
  }
  return out;
}

export function safeJsonParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

/**
 * Inverse of transformToSupabase: convert a Supabase row back into Base44
 * shape so callers don't need to change.
 *
 *   - snake_case → camelCase
 *   - UserPreferences.settings → flat fields
 *   - Analysis.moves: object[] → string[] (Base44-style JSON-serialized)
 *   - Pattern.patterns: object[] → string[]
 *   - PatternSnapshot.themes: object[] → string[]
 *   - Strips Supabase-only metadata (user_id, created_at, updated_at)
 */
export function transformFromSupabase(
  entity: Entity,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const stripped = { ...row };
  delete stripped.user_id;
  delete stripped.created_at;
  delete stripped.updated_at;

  if (entity === 'UserPreferences') {
    const { id, settings } = stripped as { id: string; settings: Record<string, unknown> };
    return { id, ...(settings ?? {}) };
  }

  if (entity === 'Analysis') {
    const out = snakeToCamel(stripped);
    if (Array.isArray(out.moves)) {
      out.moves = out.moves.map((m) => (typeof m === 'string' ? m : JSON.stringify(m)));
    }
    return out;
  }

  if (entity === 'Pattern') {
    const out = snakeToCamel(stripped);
    if (Array.isArray(out.patterns)) {
      out.patterns = out.patterns.map((p) => (typeof p === 'string' ? p : JSON.stringify(p)));
    }
    return out;
  }

  if (entity === 'PatternSnapshot') {
    const out = snakeToCamel(stripped);
    if (Array.isArray(out.themes)) {
      out.themes = out.themes.map((t) => (typeof t === 'string' ? t : JSON.stringify(t)));
    }
    return out;
  }

  return snakeToCamel(stripped);
}
