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

/** Retry helper: retries on 429 with exponential backoff */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2, baseDelay = 1000): Promise<T> {
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
 * Fetch a list of entities with optional filters.
 * Returns [items, loading, error, refetch].
 */
export function useEntityList<T>(
  entityName: string,
  filters?: Record<string, unknown>,
  transform?: (raw: unknown) => T,
  skip?: boolean,
): [T[], boolean, Error | null, () => void] {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const hasLoadedOnce = useRef(false);

  const filterKey = JSON.stringify(filters ?? {});

  const fetch = useCallback(async () => {
    if (skip) return; // Don't fetch until ready (e.g. userId not yet loaded)
    // Only show loading spinner on first fetch — refetches update silently
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const entity = (base44.entities as Record<string, any>)[entityName];
      // Base44 SDK: list() takes (sort, limit, skip, fields) — NOT filters.
      // Use filter(query) for filtered queries.
      const hasFilters = filters && Object.keys(filters).length > 0;
      const result = await withRetry(() =>
        hasFilters ? entity.filter(filters) : entity.list()
      );
      const arr = Array.isArray(result) ? result : [];
      console.log(`[useEntityList] ${entityName}: fetched ${arr.length} records (filter=${hasFilters ? filterKey : 'none'})`);
      setItems(transform ? arr.map(transform) as T[] : arr as T[]);
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
  }, [entityName, filterKey, skip]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const [data, setData] = useState<T>(defaults);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchCount, setFetchCount] = useState(0);

  // Load or create on mount (and on refetch)
  useEffect(() => {
    // If userId is explicitly passed but null, wait for auth to resolve
    if (userId === null) return;

    let mounted = true;

    async function init() {
      try {
        const entity = (base44.entities as Record<string, any>)[entityName];
        const list = await withRetry(() => entity.list());
        if (!mounted) return;

        // Find the record belonging to this user (by created_by_id).
        // If multiple records exist (RLS not working), pick the one matching this user.
        // If no match, pick one WITHOUT created_by_id (legacy data from before multi-user).
        // If all records belong to other users, create a new one for this user.
        let matchedRecord: Record<string, unknown> | null = null;
        if (Array.isArray(list) && list.length > 0) {
          if (userId) {
            // 1. Exact match by created_by_id
            matchedRecord = list.find((r: any) => r.created_by_id === userId) ?? null;
            if (!matchedRecord) {
              // 2. Legacy record without created_by_id (pre-multi-user)
              matchedRecord = list.find((r: any) => !r.created_by_id) ?? null;
            }
            // If all records belong to OTHER users, don't use them — create a fresh one below
          } else {
            // No userId (guest mode) — use first record
            matchedRecord = list[0];
          }
          if (matchedRecord && list.length > 1) {
            console.log(`[useSingletonEntity] ${entityName}: found ${list.length} records, picked id=${(matchedRecord as any)?.id} (created_by_id=${(matchedRecord as any)?.created_by_id ?? 'none'})`);
          }
        }

        if (matchedRecord) {
          const record = transform ? transform(matchedRecord) : matchedRecord;
          setRecordId((matchedRecord as any).id);
          setData({ ...defaults, ...record } as T);
        } else if (fetchCount === 0) {
          // No matching record found — create a new one for this user
          console.log(`[useSingletonEntity] ${entityName}: no record found for userId=${userId}, creating new`);
          const created = await entity.create(serialize ? serialize(defaults) : defaults);
          if (!mounted) return;
          setRecordId(created.id);
          setData({ ...defaults, ...created } as T);
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
      setData(prev => ({ ...prev, ...patch }));

      if (recordId) {
        try {
          const entity = (base44.entities as Record<string, any>)[entityName];
          await entity.update(recordId, serialize ? serialize(patch as Record<string, unknown>) : patch);
        } catch (err) {
          console.error(`[useSingletonEntity] Failed to update ${entityName}:`, err);
        }
      }
    },
    [recordId, entityName], // eslint-disable-line react-hooks/exhaustive-deps
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
): [T[], boolean, Error | null, () => void] {
  const { isAuthenticated, authResolved } = useAuth();

  // Base44 path: skip if guest or auth not resolved
  const skipBase44 = !isAuthenticated || !authResolved || !!skip;
  const [base44Items, base44Loading, base44Error, base44Refetch] = useEntityList<T>(
    entityName, filters, transform, skipBase44,
  );

  // Guest path
  const [guestItems, setGuestItems] = useState<T[]>([]);
  const [guestTick, setGuestTick] = useState(0);

  useEffect(() => {
    if (isAuthenticated || !authResolved) return;
    const items = getGuestEntities<T>(entityName);
    setGuestItems(transform ? items.map(i => transform(i as unknown)) : items);
  }, [entityName, isAuthenticated, authResolved, guestTick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!authResolved) return [[], true, null, () => {}];
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

  // Base44 path
  const [base44Data, base44Update, base44Loading, base44Refetch] = useSingletonEntity<T>(
    entityName, defaults, transform, serialize, isAuthenticated ? (authResolved ? userId : null) : null,
  );

  // Guest path
  const [guestData, setGuestData] = useState<T>(() => {
    const stored = getGuestSingleton<T>(entityName);
    return stored ? { ...defaults, ...stored } : defaults;
  });
  const [guestTick, setGuestTick] = useState(0);

  useEffect(() => {
    if (isAuthenticated) return;
    const stored = getGuestSingleton<T>(entityName);
    if (stored) setGuestData(prev => ({ ...prev, ...stored }));
  }, [entityName, isAuthenticated, guestTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const guestUpdate = useCallback(async (patch: Partial<T>) => {
    setGuestData(prev => {
      const updated = { ...prev, ...patch };
      setGuestSingleton(entityName, updated);
      return updated;
    });
  }, [entityName]);

  const guestRefetch = useCallback(() => setGuestTick(t => t + 1), []);

  if (!authResolved) return [defaults, async () => {}, true, () => {}];
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
