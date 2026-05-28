/**
 * Lazy per-user backfill — fires once per login, in the background.
 *
 * Problem: shadow-mode dual-write only mirrors writes that happen AFTER the
 * shadow code shipped. Users who have historical data in Base44 from before
 * shadow-mode end up with a Supabase mirror that's missing their old games /
 * analyses / pattern snapshots. Once Phase 6 flips reads to Supabase, those
 * users would see an empty history.
 *
 * Fix: on each login (gated by a localStorage flag so it runs at most once
 * per user per day) compute a set-diff against Base44 and, if any entity is
 * short, page through the missing rows and write them to Supabase. The
 * whole thing runs async after auth resolves — it doesn't block the UI.
 *
 * Cost model: each user pays the backfill price once. For new users with
 * nothing in Base44 yet, the diff returns zero gap and we exit immediately.
 * For existing users with full history, the first login does the work and
 * subsequent logins are no-ops.
 *
 * Idempotent: writes use POST with `Prefer: resolution=merge-duplicates` and
 * `on_conflict=id`, so re-runs are safe.
 */
import { rawEntities } from './base44-raw';
import { supabaseFetch, isSupabaseConfigured, SupabaseError } from './supabaseClient';
import { transformToSupabase, TABLE_MAP, type Entity } from './supabase-transform';

const FLAG_KEY = 'chess-dna-lazy-backfill-last';
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h
const SUPABASE_PAGE = 1000;   // PostgREST default max per response
const BASE44_PAGE = 5000;     // Base44 documented max per response
const STAGGER_MS = 100;       // Throttle between writes to dodge Base44 rate limits

interface BackfillSummary {
  entity: Entity;
  base44Count: number;
  supabaseCount: number;
  missing: number;
  filled: number;
  errors: number;
}

function isRecentlyBackfilled(userEmail: string): boolean {
  try {
    const raw = localStorage.getItem(`${FLAG_KEY}:${userEmail}`);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markBackfilled(userEmail: string): void {
  try {
    localStorage.setItem(`${FLAG_KEY}:${userEmail}`, String(Date.now()));
  } catch {
    /* localStorage full — backfill will retry next login, fine */
  }
}

const ENTITIES: Entity[] = ['Game', 'Analysis', 'PatternSnapshot'];

/**
 * Public entry point. Call this AFTER auth.me() resolves.
 *
 * @param userEmail    the Supabase user_id we write rows under (JWT sub / email)
 * @param base44UserId the caller's Base44 ObjectId (auth.me().id). REQUIRED —
 *   we scope the Base44 read by `created_by_id = base44UserId` rather than
 *   calling `.list()`. For admin accounts `.list()` returns EVERY user's rows
 *   (RLS is bypassed for admins), and writing all of those under one email
 *   corrupts the mirror. Scoping by created_by_id is correct for admins and
 *   normal users alike.
 *
 * Returns immediately; backfill runs in the background. Never throws.
 */
export function startLazyBackfill(userEmail: string | null, base44UserId: string | null): void {
  if (!userEmail) return;
  if (!base44UserId) {
    // Without the caller's ObjectId we can't safely scope the Base44 read.
    // Skip rather than risk an admin-wide pull. Dual-write still mirrors new
    // writes; we just don't do the historical top-up this session.
    console.warn('[lazy-backfill] no base44UserId — skipping to avoid unscoped read');
    return;
  }
  if (!isSupabaseConfigured()) return;
  if (isRecentlyBackfilled(userEmail)) return;

  void runBackfill(userEmail, base44UserId)
    .then((summaries) => {
      const filled = summaries.reduce((s, x) => s + x.filled, 0);
      const errors = summaries.reduce((s, x) => s + x.errors, 0);
      if (filled > 0 || errors > 0) {
        console.log('[lazy-backfill] summary', { userEmail, summaries });
      }
      markBackfilled(userEmail);
    })
    .catch((err) => {
      console.warn('[lazy-backfill] fatal', err);
      // Don't mark — retry next login
    });
}

async function runBackfill(userEmail: string, base44UserId: string): Promise<BackfillSummary[]> {
  const summaries: BackfillSummary[] = [];
  for (const entity of ENTITIES) {
    try {
      summaries.push(await backfillEntity(entity, userEmail, base44UserId));
    } catch (err) {
      console.warn(`[lazy-backfill] ${entity} failed:`, err);
      summaries.push({ entity, base44Count: -1, supabaseCount: -1, missing: -1, filled: 0, errors: 1 });
    }
  }
  return summaries;
}

async function backfillEntity(entity: Entity, userEmail: string, base44UserId: string): Promise<BackfillSummary> {
  // Scope the Base44 read to THIS user's rows by created_by_id. Never use a
  // bare .list() here — admins would pull everyone's data and we'd write it
  // all under one email (this exact bug corrupted the mirror once).
  const base44Rows = await fetchOwnBase44(entity, base44UserId);
  if (base44Rows.length === 0) {
    return { entity, base44Count: 0, supabaseCount: 0, missing: 0, filled: 0, errors: 0 };
  }

  // Get all Supabase IDs for this user via paged GETs. Without paging,
  // PostgREST caps at 1000 and every row past that looks "missing".
  const supabaseIds = await fetchAllSupabaseIds(entity, userEmail);

  const missingRows = base44Rows.filter((r) => !supabaseIds.has(r.id));
  if (missingRows.length === 0) {
    return {
      entity,
      base44Count: base44Rows.length,
      supabaseCount: supabaseIds.size,
      missing: 0, filled: 0, errors: 0,
    };
  }

  // Backfill missing rows one at a time with a tiny stagger. Analyses can be
  // 50–100KB each; rapid concurrent inserts will hit Base44 rate limits and
  // Supabase 502s.
  let filled = 0, errors = 0;
  for (const row of missingRows) {
    try {
      await mirrorRow(entity, row, userEmail);
      filled++;
    } catch (err) {
      // 409 on a singleton — already present, fine
      if (err instanceof SupabaseError && err.status === 409) continue;
      errors++;
      console.warn(`[lazy-backfill] ${entity}.${(row as { id: string }).id} mirror failed:`, err);
    }
    if (STAGGER_MS > 0) await new Promise((r) => setTimeout(r, STAGGER_MS));
  }

  return {
    entity,
    base44Count: base44Rows.length,
    supabaseCount: supabaseIds.size,
    missing: missingRows.length,
    filled,
    errors,
  };
}

/**
 * Fetch this user's own rows from Base44, scoped by created_by_id. This is
 * the admin-safe path: `.list()` would return every user's rows for an admin
 * account, but `filter({ created_by_id })` always returns just the caller's.
 *
 * Tradeoff: legacy Base44 rows that predate the created_by_id field won't be
 * matched. That's acceptable — they're a vanishing edge case, and shadow-mode
 * still serves them from Base44. Far better than the admin-wide corruption
 * risk of a bare .list().
 */
async function fetchOwnBase44(entity: Entity, base44UserId: string): Promise<Array<{ id: string }>> {
  const handler = rawEntities[entity] as unknown as {
    filter: (f: Record<string, unknown>, sort?: string, limit?: number) => Promise<Array<{ id: string }>>;
  };
  const rows = await handler.filter({ created_by_id: base44UserId }, '-created_date', BASE44_PAGE);
  return rows.filter((r) => !!r?.id);
}

/**
 * Fetch all Supabase row IDs for a user, paged through PostgREST's offset
 * pagination. Stops when a page returns fewer than PAGE rows.
 */
async function fetchAllSupabaseIds(entity: Entity, userEmail: string): Promise<Set<string>> {
  const table = TABLE_MAP[entity];
  const ids = new Set<string>();
  for (let offset = 0; ; offset += SUPABASE_PAGE) {
    let page: Array<{ id: string }>;
    try {
      page = await supabaseFetch<Array<{ id: string }>>(
        `/${table}?select=id&user_id=eq.${encodeURIComponent(userEmail)}&offset=${offset}&limit=${SUPABASE_PAGE}`,
      );
    } catch (err) {
      console.warn(`[lazy-backfill] supabase id-page failed for ${entity} offset=${offset}:`, err);
      return ids; // Best effort — return what we have so far
    }
    if (!Array.isArray(page) || page.length === 0) break;
    for (const r of page) if (r.id) ids.add(r.id);
    if (page.length < SUPABASE_PAGE) break;
  }
  return ids;
}

async function mirrorRow(entity: Entity, base44Row: { id: string }, userEmail: string): Promise<void> {
  const table = TABLE_MAP[entity];
  const payload = transformToSupabase(entity, base44Row as Record<string, unknown>, userEmail);
  await supabaseFetch(`/${table}?on_conflict=id`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
}
