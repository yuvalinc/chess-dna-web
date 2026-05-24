/**
 * React hooks for Base44 entity operations.
 * These replace the Chrome extension's useStorage/useStorageByPrefix hooks.
 *
 * Guest-aware variants (useSmartEntityList, useSmartSingletonEntity, useSmartEntityCRUD)
 * automatically use localStorage when unauthenticated and Base44 when authenticated.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '../api/base44Client';
import { useAuth } from '../contexts/AuthContext';
import {
  getGuestEntities, createGuestEntity, updateGuestEntity, deleteGuestEntity,
  getGuestSingleton, setGuestSingleton,
} from '@shared/utils/guest-storage';

/** Retry helper: retries on 429 with exponential backoff.
 *  Bumped maxRetries 2→5 and baseDelay 1s→2s so a short Base44 rate-limit
 *  burst (which we hit during the chess.com import-on-boot path) recovers
 *  silently instead of failing the whole entity fetch. Total max wait:
 *  ~2 + 4 + 8 + 16 + 32 = 62s before giving up. */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5, baseDelay = 2000): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const is429 = err?.response?.status === 429 || String(err).includes('429') || String(err).includes('Too Many Requests');
      if (!is429 || attempt === maxRetries) throw err;
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`[useEntity] 429 rate limit — retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}

// ─── Pending-patch queue (singleton entities) ──────────────────────────
// On iOS WebView, the JS engine is suspended a few seconds after the app
// is backgrounded — any in-flight `entity.update()` fetch is killed before
// the response lands, but from JS's point of view nothing failed. The next
// launch then fetches a server record that's missing the just-applied
// patch and overwrites the local cache with the stale value. To keep the
// follow list (and other settings) durable, every update is appended to a
// per-entity pending queue in localStorage *before* the network call. On
// the next init we replay the queue on top of whatever the server returns
// and re-push it; entries are only removed once the server confirms.

type PendingPatch = { id: string; patch: Record<string, unknown>; ts: number };

function readPendingQueue(key: string): PendingPatch[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingPatch[]) : [];
  } catch { return []; }
}

function writePendingQueue(key: string, queue: PendingPatch[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(queue));
  } catch { /* quota / disabled — best-effort */ }
}

function appendPendingPatch(key: string, patch: Record<string, unknown>): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const queue = readPendingQueue(key);
  queue.push({ id, patch, ts: Date.now() });
  // Cap queue length to avoid unbounded growth in pathological offline use.
  // 50 patches is plenty for normal sessions; older ones get dropped first.
  const capped = queue.length > 50 ? queue.slice(queue.length - 50) : queue;
  writePendingQueue(key, capped);
  return id;
}

function removePendingPatch(key: string, id: string): void {
  const queue = readPendingQueue(key);
  writePendingQueue(key, queue.filter(p => p.id !== id));
}

/**
 * Fetch a single entity by ID. Returns [data, loading, error, refetch].
 */
export function useEntityById<T>(
  entityName: string,
  id: string | null,
): [T | null, boolean, Error | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    if (!id) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const entity = (base44.entities as Record<string, any>)[entityName];
      const result = await withRetry(() => entity.get(id));
      setData(result as T);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [entityName, id]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return [data, loading, error, fetch];
}

/**
 * Read a cached list synchronously. Returns null on miss / parse failure
 * / disabled storage — caller falls back to empty array + network fetch.
 *
 * Self-heals a prior bad cache where Game records were stripped to
 * `pgn: ''`: the ghost-record filter rejects those, collapsing the
 * user's data to 0 games and falsely re-triggering onboarding. If we
 * detect that pattern on read, discard the cache so the network fetch
 * rebuilds it cleanly with the current sentinel.
 */
function readListCache<T>(cacheKey: string | undefined): T[] | null {
  if (!cacheKey || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    if (cacheKey.startsWith('list-cache-Game-') && parsed.length > 0) {
      const sample = parsed[0] as Record<string, unknown>;
      if ('pgn' in sample && sample.pgn === '') {
        console.warn(`[useEntityList] Dropping stale Game cache (pgn='' would fail ghost-record filter)`);
        try { localStorage.removeItem(cacheKey); } catch { /* noop */ }
        return null;
      }
    }
    return parsed as T[];
  } catch { return null; }
}

/**
 * Persist a list to localStorage. Best-effort: on quota errors, attempts a
 * progressively smaller window (last N records) before giving up — the
 * tail of a sort:`-playedAt` list is usually the freshest and most-viewed
 * data, so a partial cache is still useful for fast first paint.
 */
function writeListCache<T>(cacheKey: string | undefined, items: T[]): void {
  if (!cacheKey || typeof localStorage === 'undefined') return;
  const tryWrite = (slice: T[]): boolean => {
    try {
      localStorage.setItem(cacheKey, JSON.stringify(slice));
      return true;
    } catch { return false; }
  };
  if (tryWrite(items)) return;
  // Quota fallback: try shrinking caps until something fits.
  for (const cap of [100, 50, 25, 10]) {
    if (items.length <= cap) continue;
    if (tryWrite(items.slice(0, cap))) {
      console.warn(`[useEntityList] list-cache quota exceeded — stored only first ${cap} of ${items.length} for key=${cacheKey}`);
      return;
    }
  }
  // Last resort: drop any prior cache so we don't keep stale data.
  try { localStorage.removeItem(cacheKey); } catch { /* noop */ }
}

/**
 * Fetch a list of entities with optional filters.
 * Returns [items, loading, error, refetch].
 *
 * `options.sort` + `options.limit` are passed to the Base44 SDK's
 * `entity.list(sort, limit, skip, fields)` so we can paginate from
 * server-side instead of pulling the entire collection. Critical for
 * fast first paint when the user has hundreds of games.
 *
 * `options.cacheKey`, when provided, enables stale-while-revalidate
 * caching: the most recent fetch is mirrored to localStorage and
 * rehydrated synchronously on next mount. The cached list paints
 * immediately while the network refetch runs in the background; the
 * spinner is suppressed on cache hits so users get instant feedback.
 * The transform pass runs at write-time, so the cache stores the
 * post-transform shape and reads skip the transform.
 */
export function useEntityList<T>(
  entityName: string,
  filters?: Record<string, unknown>,
  transform?: (raw: unknown) => T,
  skip?: boolean,
  options?: {
    sort?: string;
    limit?: number;
    cacheKey?: string;
    /** Strip heavy fields before persisting to localStorage. Keeps the
     *  in-memory state intact (full records), but the cached copy gets
     *  a slimmer projection — lets us fit more records in the ~5 MB
     *  quota. Stripped fields can be re-fetched on demand (e.g. PGN
     *  via `useEntityById` when a game detail opens). */
    cacheStrip?: (item: T) => T;
  },
): [T[], boolean, Error | null, () => void] {
  const cacheKey = options?.cacheKey;
  const [items, setItems] = useState<T[]>(() => readListCache<T>(cacheKey) ?? []);
  // If we have cached data, don't show a spinner — the network refetch
  // runs silently in the background and swaps in fresh data when ready.
  const [loading, setLoading] = useState(() => readListCache<T>(cacheKey) === null);
  const [error, setError] = useState<Error | null>(null);
  const hasLoadedOnce = useRef(false);

  const filterKey = JSON.stringify(filters ?? {});
  const sort = options?.sort;
  const limit = options?.limit;
  const cacheStrip = options?.cacheStrip;

  const fetch = useCallback(async () => {
    if (skip) return; // Don't fetch until ready (e.g. userId not yet loaded)
    // Only show loading spinner on first fetch — refetches update silently
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const entity = (base44.entities as Record<string, any>)[entityName];
      // Base44 SDK: list(sort, limit, skip, fields) for ordered pagination.
      // Filter API is `filter(query, sort, limit, skip, fields)` so sort+limit
      // pass through whether filters are provided or not — without this, a
      // filter call returns the FULL set unsorted, defeating pagination.
      const hasFilters = filters && Object.keys(filters).length > 0;
      const result = await withRetry(() =>
        hasFilters ? entity.filter(filters, sort, limit) : entity.list(sort, limit)
      );
      const arr = Array.isArray(result) ? result : [];
      console.log(`[useEntityList] ${entityName}: fetched ${arr.length} records (filter=${hasFilters ? filterKey : 'none'}, sort=${sort ?? '-'}, limit=${limit ?? '-'})`);
      const transformed = transform ? (arr.map(transform) as T[]) : (arr as T[]);
      setItems(transformed);
      const forCache = cacheStrip ? transformed.map(cacheStrip) : transformed;
      writeListCache(cacheKey, forCache);
      setError(null);
    } catch (err) {
      console.error(`[useEntityList] ${entityName}: fetch FAILED`, err);
      setError(err instanceof Error ? err : new Error(String(err)));
      // Keep existing items on error instead of clearing them
      // setItems([]);
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }, [entityName, filterKey, skip, sort, limit, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch();
  }, [fetch]);

  return [items, loading, error, fetch];
}

/**
 * CRUD operations for an entity.
 */
export function useEntityCRUD(entityName: string) {
  const entity = (base44.entities as Record<string, any>)[entityName];

  const create = useCallback(
    async <T>(data: Partial<T>): Promise<T> => {
      return await entity.create(data);
    },
    [entity],
  );

  const update = useCallback(
    async <T>(id: string, data: Partial<T>): Promise<T> => {
      return await entity.update(id, data);
    },
    [entity],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      return await entity.delete(id);
    },
    [entity],
  );

  return { create, update, remove };
}

/**
 * Singleton entity — for entities where there's only one record per user
 * (like UserPreferences, Pattern, TrainingPlan).
 * Auto-creates if not found.
 */
export function useSingletonEntity<T extends Record<string, unknown>>(
  entityName: string,
  defaults: T,
  transform?: (raw: Record<string, unknown>) => T,
  serialize?: (data: Record<string, unknown>) => Record<string, unknown>,
  userId?: string | null,
): [T, (patch: Partial<T>) => Promise<void>, boolean, () => void] {
  // Local cache of the full record data — keyed by entity name. Loaded
  // synchronously on mount so settings (theme, follow list, etc.) come back
  // instantly even if Base44 list()/get() fails or the auth header isn't
  // attached yet. Base44 sync still happens async; this is a durable
  // fallback layer on top, not a replacement.
  const dataCacheKey = `singleton-${entityName}-data`;
  const [data, setData] = useState<T>(() => {
    if (typeof localStorage === 'undefined') return defaults;
    try {
      const raw = localStorage.getItem(dataCacheKey);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<T>;
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  });
  const [recordId, setRecordId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchCount, setFetchCount] = useState(0);
  // Lock to prevent duplicate creates when several updates fire in rapid
  // succession before the first create's id has propagated to recordId.
  const creatingRef = useRef(false);

  // Mirror every data change to localStorage so the next mount can rehydrate
  // instantly. This is what makes follows survive an app close even if the
  // Base44 round-trip on next launch fails or returns stale results.
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(dataCacheKey, JSON.stringify(data));
    } catch { /* quota / disabled — best-effort */ }
  }, [data, dataCacheKey]);

  // Cache key for the user's record id. Surviving auth races / empty list()
  // returns is the difference between "follows persist" and "follows reset
  // every launch" — without this, list() coming back empty (because the auth
  // header hadn't been attached yet) makes init create a brand-new record
  // and the previous one becomes orphaned.
  const recordIdCacheKey = `singleton-${entityName}-recordId`;
  // Pending-patch queue key. Patches are appended on every update() *before*
  // the network call and removed only after the server confirms; on the
  // next init we replay the queue on top of whatever the server returns
  // and re-push it. This is what makes a follow-list addition survive iOS
  // backgrounding the app mid-fetch.
  const pendingQueueKey = `singleton-${entityName}-pending`;

  // Load or create on mount (and on refetch)
  useEffect(() => {
    // If userId is explicitly passed but null, wait for auth to resolve
    if (userId === null) return;

    let mounted = true;

    async function init() {
      try {
        const entity = (base44.entities as Record<string, any>)[entityName];
        let serverRecord: Record<string, unknown> | null = null;
        let foundRecordId: string | null = null;

        // Fast path: if a previous session cached the record id, fetch it
        // directly. This bypasses list() entirely, which is critical when
        // list() races with auth-header attachment and comes back empty.
        const cachedId = typeof localStorage !== 'undefined'
          ? localStorage.getItem(recordIdCacheKey)
          : null;
        if (cachedId) {
          try {
            const record = await entity.get(cachedId);
            if (!mounted) return;
            if (record) {
              serverRecord = record;
              foundRecordId = cachedId;
            }
          } catch {
            // Cached id is stale (record deleted server-side) — drop and
            // fall through to the list() path.
            try { localStorage.removeItem(recordIdCacheKey); } catch { /* noop */ }
          }
        }

        if (!serverRecord) {
          const list = await withRetry(() => entity.list());
          if (!mounted) return;

          // Find the record belonging to this user (by created_by_id).
          // If multiple records exist (RLS not working), pick the one matching this user.
          // If no match, pick one WITHOUT created_by_id (legacy data from before multi-user).
          // Then try anonymous-stamped records (auth-race orphans from prior launches).
          let matchedRecord: Record<string, unknown> | null = null;
          // All records owned by this user (for dedup + self-heal).
          let userOwnedRecords: Array<Record<string, unknown>> = [];
          if (Array.isArray(list) && list.length > 0) {
            if (userId) {
              // 1. Exact match by created_by_id — collect ALL matches so we
              //    can self-heal duplicates below.
              userOwnedRecords = list.filter((r: any) => r.created_by_id === userId);
              if (userOwnedRecords.length > 0) {
                // Pick the most recently updated one — that's the row the
                // user's app has been writing to.
                matchedRecord = [...userOwnedRecords].sort((a: any, b: any) =>
                  String(b.updated_date ?? '').localeCompare(String(a.updated_date ?? ''))
                )[0];
              }
              if (!matchedRecord) {
                // 2. Legacy record without created_by_id (pre-multi-user)
                matchedRecord = list.find((r: any) => !r.created_by_id) ?? null;
              }
              if (!matchedRecord) {
                // 3. Anonymous-stamped record — created by this app under an
                //    auth-attachment race in a prior launch. Recovering it
                //    here is the difference between "Magnus is still followed"
                //    and "follows reset every launch".
                matchedRecord = list.find((r: any) => r.created_by_id === 'anonymous') ?? null;
              }
            } else {
              // No userId (auth.me() hasn't returned yet, but token is
              // attached). Use the first record — but DO NOT create below
              // even if list is empty, since we can't tell whether the user
              // genuinely has no records or `list()` raced an auth header.
              matchedRecord = list[0];
            }
            if (matchedRecord && list.length > 1) {
              console.log(`[useSingletonEntity] ${entityName}: found ${list.length} records, picked id=${(matchedRecord as any)?.id} (created_by_id=${(matchedRecord as any)?.created_by_id ?? 'none'})`);
            }
          }

          if (matchedRecord) {
            serverRecord = matchedRecord;
            foundRecordId = (matchedRecord as any).id as string;
            try { if (foundRecordId) localStorage.setItem(recordIdCacheKey, foundRecordId); } catch { /* noop */ }

            // Self-heal: this user has more than one row owned by them.
            // Delete the older duplicates so we don't keep accumulating.
            // Fire-and-forget — no need to block init on cleanup. Bounded
            // by the count we found so we never delete the kept row.
            if (userOwnedRecords.length > 1) {
              const keptId = foundRecordId;
              const dupes = userOwnedRecords.filter(r => (r as any).id !== keptId);
              console.log(`[useSingletonEntity] ${entityName}: self-healing ${dupes.length} duplicate row(s) for userId=${userId}`);
              for (const dup of dupes) {
                try {
                  await entity.delete((dup as any).id);
                } catch (err) {
                  console.warn(`[useSingletonEntity] ${entityName}: failed to delete duplicate ${(dup as any).id}`, err);
                }
              }
            }
          } else if (fetchCount === 0) {
            // No matching record found — create a new one for this user, but
            // only if we have an auth token. Without one, the server stamps
            // the record `created_by_id: anonymous`, which can't be cleaned
            // up later.
            const hasToken = typeof localStorage !== 'undefined'
              && (localStorage.getItem('base44_access_token') || localStorage.getItem('token'));
            if (!hasToken) {
              console.log(`[useSingletonEntity] ${entityName}: no auth token yet, deferring create`);
              return;
            }
            // Defer when `userId` is undefined — we genuinely don't know
            // whether the user has existing rows yet (auth.me() hasn't
            // returned). Creating now is how duplicates accumulate: every
            // session that races auth.me() makes another orphan row.
            // The effect re-fires when `userId` becomes defined.
            if (userId === undefined) {
              console.log(`[useSingletonEntity] ${entityName}: deferring create until userId resolves`);
              return;
            }
            // Cross-tab lock — keyed by entityName + userId. If another tab
            // (same browser) is mid-create, defer. Without this, two tabs
            // opening at the same time each create a row → instant dup.
            const lockKey = `singleton-${entityName}-creating-${userId}`;
            const nowMs = Date.now();
            let lockedUntil = 0;
            try {
              lockedUntil = parseInt(localStorage.getItem(lockKey) ?? '0', 10) || 0;
            } catch { /* noop */ }
            if (lockedUntil > nowMs) {
              console.log(`[useSingletonEntity] ${entityName}: another tab is creating, deferring`);
              return;
            }
            try { localStorage.setItem(lockKey, String(nowMs + 10_000)); } catch { /* noop */ }
            try {
              console.log(`[useSingletonEntity] ${entityName}: no record found for userId=${userId}, creating new`);
              const created = await entity.create(serialize ? serialize(defaults) : defaults);
              if (!mounted) return;
              serverRecord = created;
              foundRecordId = created.id;
              try { if (foundRecordId) localStorage.setItem(recordIdCacheKey, foundRecordId); } catch { /* noop */ }
            } finally {
              try { localStorage.removeItem(lockKey); } catch { /* noop */ }
            }
          }
        }

        if (!serverRecord || !foundRecordId) return;

        // Apply server data, then replay any pending patches that didn't
        // make it to the server in a prior launch (iOS suspended the
        // fetch, network blip, etc.). Each patch overwrites the field
        // entirely, so replaying in order yields the right end state even
        // when several patches stack up.
        const transformed = transform ? transform(serverRecord) : serverRecord;
        let mergedData = { ...defaults, ...transformed } as T;
        const pending = readPendingQueue(pendingQueueKey);
        if (pending.length > 0) {
          console.log(`[useSingletonEntity] ${entityName}: replaying ${pending.length} pending patch(es) from prior launch`);
          for (const { patch } of pending) {
            mergedData = { ...mergedData, ...(patch as Partial<T>) };
          }
        }

        // One-time recovery for fields that previously got silently dropped
        // server-side (e.g. when a Base44 schema didn't yet declare them).
        // If the local cache has a non-empty array for a field that the
        // server returns empty/missing, the local copy is the only place
        // that data exists — push it up so it survives the setData() that
        // would otherwise overwrite the cache with the empty server value.
        let recoveryPatch: Record<string, unknown> = {};
        try {
          const cacheRaw = typeof localStorage !== 'undefined'
            ? localStorage.getItem(dataCacheKey) : null;
          if (cacheRaw) {
            const cached = JSON.parse(cacheRaw) as Record<string, unknown>;
            for (const key of Object.keys(cached)) {
              const localVal = cached[key];
              const serverVal = (mergedData as Record<string, unknown>)[key];
              if (
                Array.isArray(localVal) && localVal.length > 0
                && (!Array.isArray(serverVal) || serverVal.length === 0)
              ) {
                recoveryPatch[key] = localVal;
              }
            }
          }
        } catch { /* noop */ }
        if (Object.keys(recoveryPatch).length > 0) {
          console.log(`[useSingletonEntity] ${entityName}: recovering local-only array field(s):`, Object.keys(recoveryPatch));
          mergedData = { ...mergedData, ...(recoveryPatch as Partial<T>) };
        }

        setRecordId(foundRecordId);
        setData(mergedData);

        // Push the recovery patch up to the server so it survives next launch.
        if (Object.keys(recoveryPatch).length > 0) {
          try {
            await entity.update(foundRecordId, serialize ? serialize(recoveryPatch) : recoveryPatch);
            console.log(`[useSingletonEntity] ${entityName}: recovery push succeeded`);
          } catch (err) {
            console.warn(`[useSingletonEntity] ${entityName}: recovery push failed, will retry next launch`, err);
          }
        }

        // Re-push queued patches now that we're online and have a record id.
        // Stop on the first failure so we don't hammer a flaky network — the
        // remaining queue will be retried on the next init.
        for (const { id, patch } of pending) {
          try {
            await entity.update(foundRecordId, serialize ? serialize(patch) : patch);
            removePendingPatch(pendingQueueKey, id);
          } catch (err) {
            console.warn(`[useSingletonEntity] ${entityName}: failed to flush pending patch, will retry next launch`, err);
            break;
          }
        }
      } catch (err) {
        console.error(`[useSingletonEntity] Failed to load ${entityName}:`, err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    init();
    return () => { mounted = false; };
  }, [entityName, fetchCount, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(
    async (patch: Partial<T>) => {
      // Capture the post-merge data synchronously so we can persist it even
      // if `data` (closure value) is stale.
      let merged!: T;
      setData(prev => {
        merged = { ...prev, ...patch };
        return merged;
      });

      // Persist the merged data SYNCHRONOUSLY. The [data] effect above
      // does the same, but on iOS the JS engine can be suspended right
      // after setState — before the effect runs — so we'd lose the cache
      // write. Doing it here too is belt-and-suspenders.
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(dataCacheKey, JSON.stringify(merged));
        }
      } catch { /* noop */ }

      // Append to pending queue BEFORE awaiting the network call. If the
      // app is killed mid-fetch, init() on next launch will replay this.
      const patchId = appendPendingPatch(pendingQueueKey, patch as Record<string, unknown>);

      const entity = (base44.entities as Record<string, any>)[entityName];
      if (recordId) {
        try {
          await entity.update(recordId, serialize ? serialize(patch as Record<string, unknown>) : patch);
          removePendingPatch(pendingQueueKey, patchId);
        } catch (err) {
          console.error(`[useSingletonEntity] Failed to update ${entityName}:`, err);
          // Leave in pending queue for retry on next init.
        }
        return;
      }
      // No recordId — init never set one (e.g. its list/create call failed,
      // or update fired before init resolved). Without this fallback, the
      // patch is dropped silently and settings vanish on next launch.
      if (creatingRef.current) return;
      creatingRef.current = true;
      try {
        // Re-list before creating — if init's list() raced and missed the
        // user's existing row, creating here would make a duplicate (the
        // original cause of users like Dvir having 5 UserPreferences rows).
        // This second list() typically happens after auth has fully settled.
        try {
          const list = await entity.list();
          if (Array.isArray(list) && list.length > 0) {
            const existing = list.find((r: any) =>
              userId ? r.created_by_id === userId : !r.created_by_id
            ) ?? (userId ? null : list[0]);
            if (existing) {
              const id = (existing as any).id as string;
              setRecordId(id);
              try { localStorage.setItem(recordIdCacheKey, id); } catch { /* noop */ }
              // Apply the patch to the existing row instead of creating.
              await entity.update(id, serialize ? serialize(patch as Record<string, unknown>) : patch);
              removePendingPatch(pendingQueueKey, patchId);
              return;
            }
          }
        } catch (err) {
          console.warn(`[useSingletonEntity] ${entityName}: pre-create list() failed, will create`, err);
        }
        // Cross-tab lock so two tabs don't both create when init races.
        if (userId !== undefined) {
          const lockKey = `singleton-${entityName}-creating-${userId}`;
          const nowMs = Date.now();
          let lockedUntil = 0;
          try {
            lockedUntil = parseInt(localStorage.getItem(lockKey) ?? '0', 10) || 0;
          } catch { /* noop */ }
          if (lockedUntil > nowMs) {
            console.log(`[useSingletonEntity] ${entityName}: another tab is creating, dropping update patch (will retry next init)`);
            return;
          }
          try { localStorage.setItem(lockKey, String(nowMs + 10_000)); } catch { /* noop */ }
          try {
            const created = await entity.create(serialize ? serialize(merged as Record<string, unknown>) : merged);
            if (created?.id) {
              setRecordId(created.id);
              try { localStorage.setItem(recordIdCacheKey, created.id); } catch { /* noop */ }
              removePendingPatch(pendingQueueKey, patchId);
            }
          } finally {
            try { localStorage.removeItem(lockKey); } catch { /* noop */ }
          }
        } else {
          const created = await entity.create(serialize ? serialize(merged as Record<string, unknown>) : merged);
          if (created?.id) {
            setRecordId(created.id);
            try { localStorage.setItem(recordIdCacheKey, created.id); } catch { /* noop */ }
            removePendingPatch(pendingQueueKey, patchId);
          }
        }
      } catch (err) {
        console.error(`[useSingletonEntity] Failed to create ${entityName} on first update:`, err);
        // Keep in pending queue — next init may find/create a record and
        // flush it.
      } finally {
        creatingRef.current = false;
      }
    },
    [recordId, entityName, userId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const refetch = useCallback(() => {
    setFetchCount((c) => c + 1);
  }, []);

  return [data, update, loading, refetch];
}

// ─── Guest-aware hooks ──────────────────────────────────────────────

/**
 * Guest-aware entity list hook.
 * Uses localStorage for guests, Base44 for authenticated users.
 */
export function useSmartEntityList<T>(
  entityName: string,
  filters?: Record<string, unknown>,
  transform?: (raw: unknown) => T,
  skip?: boolean,
  options?: { sort?: string; limit?: number; cacheKey?: string; cacheStrip?: (item: T) => T },
): [T[], boolean, Error | null, () => void] {
  const { isAuthenticated, authResolved } = useAuth();

  // Base44 path: skip if guest or auth not resolved
  const skipBase44 = !isAuthenticated || !authResolved || !!skip;
  const [base44Items, base44Loading, base44Error, base44Refetch] = useEntityList<T>(
    entityName, filters, transform, skipBase44, options,
  );

  // Guest path
  const [guestItems, setGuestItems] = useState<T[]>([]);
  const [guestTick, setGuestTick] = useState(0);

  useEffect(() => {
    if (isAuthenticated || !authResolved) return;
    const items = getGuestEntities<T>(entityName);
    setGuestItems(transform ? items.map(i => transform(i as unknown)) : items);
  }, [entityName, isAuthenticated, authResolved, guestTick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!authResolved) {
    // Before auth resolves, surface any cached items the inner hook
    // rehydrated synchronously (keyed by JWT userId) so returning users
    // see their games on first paint without waiting on the migration /
    // me() round-trip. If there's no cache, fall through to the empty
    // loading state as before.
    if (base44Items.length > 0) return [base44Items, false, null, () => {}];
    return [[], true, null, () => {}];
  }
  if (isAuthenticated) return [base44Items, base44Loading, base44Error, base44Refetch];

  return [guestItems, false, null, () => setGuestTick(t => t + 1)];
}

/**
 * Guest-aware singleton entity hook.
 */
export function useSmartSingletonEntity<T extends Record<string, unknown>>(
  entityName: string,
  defaults: T,
  transform?: (raw: Record<string, unknown>) => T,
  serialize?: (data: Record<string, unknown>) => Record<string, unknown>,
  userId?: string | null,
): [T, (patch: Partial<T>) => Promise<void>, boolean, () => void] {
  const { isAuthenticated, authResolved } = useAuth();

  // Base44 path. We pass `undefined` (not `null`) once auth is resolved
  // even if userId hasn't been enriched yet, so the singleton hook can
  // start fetching in parallel with auth.me() instead of waiting for it.
  // The hook itself falls back to "first record / legacy non-scoped
  // record" until the userId match becomes available.
  const userIdParam = !isAuthenticated
    ? null
    : !authResolved
      ? null
      : (userId ?? undefined);
  const [base44Data, base44Update, base44Loading, base44Refetch] = useSingletonEntity<T>(
    entityName, defaults, transform, serialize, userIdParam,
  );

  // Guest path
  // We also fall back to the *authenticated* cache key when the guest
  // singleton is empty. This handles the case where a logged-in user's
  // token is wiped (iOS WebView storage eviction) while the rest of
  // localStorage survives — without this, they'd briefly see empty
  // settings instead of the data they had a moment ago.
  const authedCacheKey = `singleton-${entityName}-data`;
  const readAuthedCache = useCallback((): Partial<T> | null => {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(authedCacheKey);
      if (!raw) return null;
      return JSON.parse(raw) as Partial<T>;
    } catch { return null; }
  }, [authedCacheKey]);

  const [guestData, setGuestData] = useState<T>(() => {
    const stored = getGuestSingleton<T>(entityName);
    if (stored) return { ...defaults, ...stored };
    const authed = readAuthedCache();
    if (authed) return { ...defaults, ...authed };
    return defaults;
  });
  const [guestTick, setGuestTick] = useState(0);

  useEffect(() => {
    if (isAuthenticated) return;
    const stored = getGuestSingleton<T>(entityName);
    if (stored) {
      setGuestData(prev => ({ ...prev, ...stored }));
      return;
    }
    const authed = readAuthedCache();
    if (authed) setGuestData(prev => ({ ...prev, ...authed }));
  }, [entityName, isAuthenticated, guestTick, readAuthedCache]); // eslint-disable-line react-hooks/exhaustive-deps

  const guestUpdate = useCallback(async (patch: Partial<T>) => {
    setGuestData(prev => {
      const updated = { ...prev, ...patch };
      setGuestSingleton(entityName, updated);
      return updated;
    });
  }, [entityName]);

  const guestRefetch = useCallback(() => setGuestTick(t => t + 1), []);

  // Pre-resolve: surface whatever's already in cache so the follow list
  // (and theme, board, etc.) doesn't flash empty for a few hundred ms on
  // launch while AuthProvider settles. base44Data is initialised
  // synchronously from the localStorage cache in useSingletonEntity, so
  // returning it here is safe even though init() hasn't run yet.
  if (!authResolved) return [base44Data, async () => {}, true, () => {}];
  if (isAuthenticated) return [base44Data, base44Update, base44Loading, base44Refetch];

  return [guestData, guestUpdate, false, guestRefetch];
}

/**
 * Guest-aware CRUD operations.
 */
export function useSmartEntityCRUD(entityName: string) {
  const { isAuthenticated } = useAuth();
  const base44Crud = useEntityCRUD(entityName);

  const create = useCallback(
    async <T extends Record<string, unknown>>(data: Partial<T>): Promise<T> => {
      if (isAuthenticated) return base44Crud.create<T>(data);
      return createGuestEntity(entityName, data as T) as T;
    },
    [isAuthenticated, entityName, base44Crud],
  );

  const update = useCallback(
    async <T extends Record<string, unknown>>(id: string, data: Partial<T>): Promise<T> => {
      if (isAuthenticated) return base44Crud.update<T>(id, data);
      updateGuestEntity(entityName, id, data);
      return { id, ...data } as unknown as T;
    },
    [isAuthenticated, entityName, base44Crud],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (isAuthenticated) return base44Crud.remove(id);
      deleteGuestEntity(entityName, id);
    },
    [isAuthenticated, entityName, base44Crud],
  );

  return { create, update, remove };
}
