/**
 * Dual-write wrapper — Phase 3 of the Fly + Supabase migration.
 *
 * Wraps the entity CRUD operations so writes go to BOTH Base44 (authoritative)
 * AND Supabase (shadow). Reads still come from Base44 unwrapped.
 *
 * Per-entity feature flag (default OFF):
 *   VITE_DUAL_WRITE_GAME=true
 *   VITE_DUAL_WRITE_ANALYSIS=true
 *   VITE_DUAL_WRITE_PATTERN=true
 *   VITE_DUAL_WRITE_PATTERN_SNAPSHOT=true
 *   VITE_DUAL_WRITE_USER_PREFERENCES=true
 *   VITE_DUAL_WRITE_INSIGHT=true
 *
 * Failure semantics: Base44 is authoritative. If Supabase fails, we log
 * drift and continue — the user's write succeeds regardless. The drift log
 * drives Phase 5 verification.
 *
 * Nothing in production calls these yet. To enable dual-write for an entity:
 *   1. Set the flag in .env.local
 *   2. Refactor the relevant call site(s) to use dw{Create,Update,Delete}
 *   3. Monitor drift_log in Supabase for a few days
 */
import { rawEntities } from './base44-raw';
import {
  supabaseFetch,
  isSupabaseConfigured,
  SupabaseError,
} from './supabaseClient';
import { transformToSupabase, TABLE_MAP, type Entity } from './supabase-transform';

export type { Entity };

const FLAG_MAP: Record<Entity, string> = {
  Game: 'VITE_DUAL_WRITE_GAME',
  Analysis: 'VITE_DUAL_WRITE_ANALYSIS',
  Pattern: 'VITE_DUAL_WRITE_PATTERN',
  PatternSnapshot: 'VITE_DUAL_WRITE_PATTERN_SNAPSHOT',
  UserPreferences: 'VITE_DUAL_WRITE_USER_PREFERENCES',
  Insight: 'VITE_DUAL_WRITE_INSIGHT',
};

export function isDualWriteEnabled(entity: Entity): boolean {
  if (!isSupabaseConfigured()) return false;
  const flagName = FLAG_MAP[entity];
  const value = (import.meta.env[flagName] ?? '').toString().toLowerCase();
  return value === 'true' || value === '1';
}

/** Create in Base44, then mirror to Supabase if dual-write is enabled. */
export async function dwCreate<T extends { id: string }>(
  entity: Entity,
  data: Record<string, unknown>,
): Promise<T> {
  const result = await rawEntities[entity].create(data) as T;

  if (isDualWriteEnabled(entity)) {
    void mirrorCreate(entity, result).catch((err) => {
      console.warn(`[dual-write] ${entity}.create mirror failed:`, err);
    });
  }

  return result;
}

/** Update in Base44, then mirror to Supabase if dual-write is enabled. */
export async function dwUpdate<T extends { id: string }>(
  entity: Entity,
  id: string,
  data: Record<string, unknown>,
): Promise<T> {
  const result = await rawEntities[entity].update(id, data) as T;

  if (isDualWriteEnabled(entity)) {
    void mirrorUpdate(entity, id, result).catch((err) => {
      console.warn(`[dual-write] ${entity}.update mirror failed:`, err);
    });
  }

  return result;
}

/** Delete from Base44, then mirror to Supabase if dual-write is enabled. */
export async function dwDelete(entity: Entity, id: string): Promise<void> {
  await rawEntities[entity].delete(id);

  if (isDualWriteEnabled(entity)) {
    void mirrorDelete(entity, id).catch((err) => {
      console.warn(`[dual-write] ${entity}.delete mirror failed:`, err);
    });
  }
}

// ── Mirror operations ──

async function mirrorCreate(entity: Entity, base44Row: { id: string }): Promise<void> {
  const table = TABLE_MAP[entity];
  const userId = getUserIdFromToken();
  if (!userId) {
    await logDrift({
      entity, entityId: base44Row.id, operation: 'create',
      note: 'no user_id from JWT — skipped supabase write',
    });
    return;
  }

  const payload = transformToSupabase(entity, base44Row, userId);

  try {
    await supabaseFetch(`/${table}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (err) {
    await logDrift({
      entity, entityId: base44Row.id, operation: 'create',
      base44Value: base44Row, note: `supabase create failed: ${describeErr(err)}`,
    });
    throw err;
  }
}

async function mirrorUpdate(entity: Entity, id: string, base44Row: { id: string }): Promise<void> {
  const table = TABLE_MAP[entity];
  const userId = getUserIdFromToken();
  if (!userId) {
    await logDrift({
      entity, entityId: id, operation: 'update',
      note: 'no user_id from JWT — skipped supabase write',
    });
    return;
  }

  const payload = transformToSupabase(entity, base44Row, userId);

  try {
    // PostgREST: filter by id (singleton entities filter by user_id instead).
    const isSingleton = entity === 'Pattern' || entity === 'UserPreferences';
    const filter = isSingleton ? `?user_id=eq.${userId}` : `?id=eq.${id}`;
    await supabaseFetch(`/${table}${filter}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  } catch (err) {
    await logDrift({
      entity, entityId: id, operation: 'update',
      base44Value: base44Row, note: `supabase update failed: ${describeErr(err)}`,
    });
    throw err;
  }
}

async function mirrorDelete(entity: Entity, id: string): Promise<void> {
  const table = TABLE_MAP[entity];

  try {
    await supabaseFetch(`/${table}?id=eq.${id}`, {
      method: 'DELETE',
    });
  } catch (err) {
    await logDrift({
      entity, entityId: id, operation: 'delete',
      note: `supabase delete failed: ${describeErr(err)}`,
    });
    throw err;
  }
}

// ── Drift logging ──

interface DriftRecord {
  entity: Entity;
  entityId: string | null;
  operation: 'create' | 'update' | 'delete' | 'read';
  field?: string;
  base44Value?: unknown;
  supabaseValue?: unknown;
  note?: string;
}

export async function logDrift(record: DriftRecord): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const userId = getUserIdFromToken();
  if (!userId) return;

  try {
    await supabaseFetch('/drift_log', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        entity: record.entity,
        entity_id: record.entityId,
        operation: record.operation,
        field: record.field ?? null,
        base44_value: record.base44Value ?? null,
        supabase_value: record.supabaseValue ?? null,
        note: record.note ?? null,
      }),
    });
  } catch (err) {
    // Last-resort log: if even the drift log fails, console it.
    console.warn('[dual-write] drift log write failed:', err);
  }
}

// ── Helpers ──

function getUserIdFromToken(): string | null {
  try {
    const token =
      localStorage.getItem('base44_access_token') ??
      localStorage.getItem('token');
    if (!token) return null;
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return null;
    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/').padEnd(payloadB64.length + ((4 - (payloadB64.length % 4)) % 4), '=');
    const decoded = atob(padded);
    const payload = JSON.parse(decoded) as Record<string, unknown>;
    return (payload.sub ?? payload.userId ?? payload.user_id) as string | null;
  } catch {
    return null;
  }
}

function describeErr(err: unknown): string {
  if (err instanceof SupabaseError) return `${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
