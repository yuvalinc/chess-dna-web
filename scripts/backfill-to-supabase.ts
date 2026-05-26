/**
 * Backfill Base44 → Supabase for a single user.
 *
 * Phase 4 of the Fly + Supabase migration. Runs after dual-write is enabled
 * (Phase 3) — the dual-write picks up new writes from then on, but historical
 * rows need this script to be copied across.
 *
 * Usage:
 *   npx tsx scripts/backfill-to-supabase.ts \
 *     --base44-token <jwt> \
 *     --supabase-url https://<ref>.supabase.co \
 *     --supabase-service-key <service-role-key> \
 *     --entities Game,Analysis,Pattern,PatternSnapshot,UserPreferences,Insight \
 *     [--dry-run]
 *
 * - `--entities` is optional; defaults to all six.
 * - `--dry-run` skips Supabase writes, only reports counts.
 * - The user_id stamped on Supabase rows comes from the Base44 JWT's `sub`
 *   claim, so the script must be run with each user's own token.
 *
 * Idempotency:
 *   Uses PostgREST `Prefer: resolution=merge-duplicates` with `on_conflict=id`.
 *   Re-running for the same user is safe — existing rows are updated, not
 *   duplicated.
 *
 * The script is per-user. For an admin-driven multi-user migration we'd need
 * a separate orchestrator (out of scope for Phase 4 initial).
 */
import { createClient, type Base44Client } from '@base44/sdk';
import { transformToSupabase, TABLE_MAP, type Entity } from '../src/api/supabase-transform';

const ALL_ENTITIES: Entity[] = [
  'UserPreferences',
  'Pattern',
  'PatternSnapshot',
  'Insight',
  'Analysis',
  'Game',
];

const BATCH_SIZE = 50;          // PostgREST batch insert size
const LIST_PAGE_SIZE = 5000;    // Base44's documented per-page cap

// PostgREST rejects payloads with unknown columns. Filter to schema-known
// columns per table. Anything Base44 has that we don't want is silently dropped
// (e.g. internal `is_sample`, audit fields, etc.). If a real field gets dropped,
// add it both to the migration SQL and this list.
const ALLOWED_COLUMNS: Record<Entity, ReadonlySet<string>> = {
  Game: new Set([
    'id', 'user_id', 'game_id', 'player_username', 'url', 'pgn', 'player',
    'opponent', 'time_class', 'time_control', 'opening', 'total_moves',
    'played_at', 'analyzed_at', 'analysis_status',
  ]),
  Analysis: new Set([
    'id', 'user_id', 'game_id', 'chess_game_id', 'player_username',
    'moves', 'summary', 'analyzed_at', 'engine_depth', 'engine_version',
  ]),
  Pattern: new Set([
    'id', 'user_id', 'patterns', 'last_updated', 'games_in_window',
  ]),
  PatternSnapshot: new Set([
    'id', 'user_id', 'game_id', 'timestamp', 'themes',
  ]),
  UserPreferences: new Set([
    'id', 'user_id', 'settings',
  ]),
  Insight: new Set([
    'id', 'user_id', 'generated_at', 'game_ids', 'text', 'themes',
    'priority', 'is_read',
  ]),
};

function stripUnknownColumns(entity: Entity, row: Record<string, unknown>): Record<string, unknown> {
  const allowed = ALLOWED_COLUMNS[entity];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}

interface Args {
  base44Token: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  /** Base44 MongoDB ObjectId to filter rows by (`created_by_id`). Required
   *  because admin tokens see everyone's data; we only want this user's. */
  base44UserId: string;
  entities: Entity[];
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (name: string) => argv.includes('--' + name);

  const base44Token = get('base44-token') ?? process.env.BASE44_TOKEN;
  const supabaseUrl = get('supabase-url') ?? process.env.SUPABASE_URL;
  const supabaseServiceKey = get('supabase-service-key') ?? process.env.SUPABASE_SERVICE_KEY;
  const base44UserId = get('base44-user-id') ?? process.env.BASE44_USER_ID;
  const entitiesArg = get('entities');
  const entities = entitiesArg
    ? entitiesArg.split(',').map((s) => s.trim() as Entity)
    : ALL_ENTITIES;

  if (!base44Token) throw new Error('--base44-token or BASE44_TOKEN required');
  if (!supabaseUrl) throw new Error('--supabase-url or SUPABASE_URL required');
  if (!supabaseServiceKey) throw new Error('--supabase-service-key or SUPABASE_SERVICE_KEY required');
  if (!base44UserId) throw new Error('--base44-user-id or BASE44_USER_ID required (Mongo ObjectId of the Base44 user to backfill — find it by inspecting `created_by_id` on any row you created)');

  return {
    base44Token,
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    supabaseServiceKey,
    base44UserId,
    entities,
    dryRun: has('dry-run'),
  };
}

function decodeJwtSub(token: string): string {
  const [, payloadB64] = token.split('.');
  if (!payloadB64) throw new Error('Invalid JWT (no payload)');
  const padded = payloadB64
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(payloadB64.length + ((4 - (payloadB64.length % 4)) % 4), '=');
  const decoded = Buffer.from(padded, 'base64').toString('utf8');
  const payload = JSON.parse(decoded) as Record<string, unknown>;
  const sub = payload.sub ?? payload.userId ?? payload.user_id;
  if (!sub) throw new Error('JWT missing sub/userId claim');
  return String(sub);
}

async function fetchAllFromBase44(
  client: Base44Client,
  entity: Entity,
  base44UserId: string,
): Promise<Record<string, unknown>[]> {
  const entities = client.entities as Record<string, {
    list: (sort?: string, limit?: number) => Promise<unknown[]>;
    filter: (f: Record<string, unknown>, sort?: string, limit?: number) => Promise<unknown[]>;
  }>;
  const handler = entities[entity];
  if (!handler) throw new Error(`Unknown entity: ${entity}`);

  // Retry on 429 with exponential backoff. Base44 has aggressive rate limits.
  const rows = await withRetry(() => handler.filter(
    { created_by_id: base44UserId },
    '-created_date',
    LIST_PAGE_SIZE,
  ), `${entity}.filter`);

  if (rows.length === LIST_PAGE_SIZE) {
    console.warn(`[backfill] ${entity}: hit ${LIST_PAGE_SIZE}-row cap — older rows not backfilled. Acceptable for shadow-mode testing; revisit before final cutover.`);
  }

  return rows as Record<string, unknown>[];
}

/**
 * Retry a Base44 call on 429 with exponential backoff: 30s, 60s, 120s, 180s, 240s.
 * Falls through on success or non-429 errors.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const delays = [30_000, 60_000, 120_000, 180_000, 240_000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const is429 = status === 429 || String(err?.message ?? err).includes('429') || String(err?.message ?? err).toLowerCase().includes('rate limit');
      if (!is429 || attempt === delays.length) throw err;
      const delay = delays[attempt];
      console.warn(`[backfill] ${label}: 429 rate-limited, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${delays.length})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

async function upsertBatch(
  args: Args,
  entity: Entity,
  rows: Record<string, unknown>[],
): Promise<void> {
  const table = TABLE_MAP[entity];
  const url = `${args.supabaseUrl}/rest/v1/${table}?on_conflict=id`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${args.supabaseServiceKey}`,
      'apikey': args.supabaseServiceKey,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase upsert failed: ${res.status} ${detail}`);
  }
}

async function backfillEntity(
  args: Args,
  client: Base44Client,
  userId: string,
  entity: Entity,
): Promise<{ entity: Entity; fetched: number; written: number; errors: number }> {
  console.log(`\n[backfill] ${entity}: fetching from Base44 (filtered to created_by_id=${args.base44UserId})…`);
  let rows = await fetchAllFromBase44(client, entity, args.base44UserId);
  console.log(`[backfill] ${entity}: ${rows.length} rows fetched`);

  // Dedupe singleton entities (Supabase has UNIQUE(user_id) — duplicate Base44
  // rows for the same user would violate it). Keep the most-recently-updated.
  if (entity === 'UserPreferences' || entity === 'Pattern') {
    const before = rows.length;
    rows = [...rows].sort((a, b) => {
      const aT = String((a as any).updated_date ?? (a as any).created_date ?? '');
      const bT = String((b as any).updated_date ?? (b as any).created_date ?? '');
      return bT.localeCompare(aT);
    }).slice(0, 1);
    if (before > 1) {
      console.log(`[backfill] ${entity}: deduped ${before} → 1 (kept most-recent)`);
    }
  }

  if (rows.length === 0) {
    return { entity, fetched: 0, written: 0, errors: 0 };
  }

  // Transform + strip to schema-known columns.
  const transformed = rows
    .map((row) => {
      try {
        const result = transformToSupabase(entity, row, userId);
        if (!result.id) {
          console.warn(`[backfill] ${entity}: row missing id, skipping:`, row);
          return null;
        }
        return stripUnknownColumns(entity, result);
      } catch (err) {
        console.warn(`[backfill] ${entity}: transform failed for row:`, err);
        return null;
      }
    })
    .filter((r): r is Record<string, unknown> => r !== null);

  console.log(`[backfill] ${entity}: ${transformed.length} rows transformed`);

  if (args.dryRun) {
    console.log(`[backfill] ${entity}: DRY RUN — skipping Supabase writes`);
    return { entity, fetched: rows.length, written: 0, errors: 0 };
  }

  // Batch insert.
  let written = 0;
  let errors = 0;
  for (let i = 0; i < transformed.length; i += BATCH_SIZE) {
    const batch = transformed.slice(i, i + BATCH_SIZE);
    try {
      await upsertBatch(args, entity, batch);
      written += batch.length;
      process.stdout.write(`\r[backfill] ${entity}: ${written}/${transformed.length}`);
    } catch (err) {
      errors += batch.length;
      console.error(`\n[backfill] ${entity}: batch ${i}-${i + batch.length} failed:`, err);
    }
  }
  process.stdout.write('\n');

  return { entity, fetched: rows.length, written, errors };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const userId = decodeJwtSub(args.base44Token);
  console.log(`[backfill] User: ${userId}`);
  console.log(`[backfill] Supabase: ${args.supabaseUrl}`);
  console.log(`[backfill] Entities: ${args.entities.join(', ')}`);
  console.log(`[backfill] Dry run: ${args.dryRun}`);

  const client = createClient({ appId: '69a04516fd2be6e9fdd5fbde' });
  client.setToken(args.base44Token);

  const summary: Array<{ entity: Entity; fetched: number; written: number; errors: number }> = [];

  for (const entity of args.entities) {
    try {
      const result = await backfillEntity(args, client, userId, entity);
      summary.push(result);
    } catch (err) {
      console.error(`[backfill] ${entity} FATAL:`, err);
      summary.push({ entity, fetched: -1, written: 0, errors: 1 });
    }
  }

  console.log('\n[backfill] SUMMARY');
  console.log('─'.repeat(60));
  for (const s of summary) {
    console.log(`  ${s.entity.padEnd(20)} fetched=${s.fetched.toString().padStart(6)} written=${s.written.toString().padStart(6)} errors=${s.errors}`);
  }

  const totalErrors = summary.reduce((sum, s) => sum + s.errors, 0);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[backfill] FATAL:', err);
  process.exit(1);
});
