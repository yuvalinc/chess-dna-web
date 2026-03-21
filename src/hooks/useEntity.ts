/**
 * React hooks for Base44 entity operations.
 * These replace the Chrome extension's useStorage/useStorageByPrefix hooks.
 */
import { useState, useEffect, useCallback } from 'react';
import { base44 } from '../api/base44Client';

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

  const filterKey = JSON.stringify(filters ?? {});

  const fetch = useCallback(async () => {
    if (skip) return; // Don't fetch until ready (e.g. userId not yet loaded)
    setLoading(true);
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
        // RLS handles user scoping server-side — just list all
        const list = await withRetry(() => entity.list());
        if (!mounted) return;

        if (Array.isArray(list) && list.length > 0) {
          const record = transform ? transform(list[0]) : list[0];
          setRecordId(list[0].id);
          setData({ ...defaults, ...record } as T);
        } else if (fetchCount === 0) {
          // Only create default record on first load, not on refetch
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
