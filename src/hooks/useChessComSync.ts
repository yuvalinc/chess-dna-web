import { useState, useEffect, useRef, useCallback } from 'react';
import { importChessComGames } from '@/api/chess-com-import';
import { SYNC_INTERVAL_MS } from '@shared/constants';

export interface SyncState {
  isSyncing: boolean;
  lastSyncAt: number | null;
  lastSyncNewGames: number;
  error: string | null;
}

interface UseChessComSyncOptions {
  username: string | null;
  enabled: boolean;
  intervalMs?: number;
  onNewGames?: (gameIds: string[]) => void;
  /** Persist lastSyncAt to Base44 */
  onSyncComplete?: (lastSyncAt: number) => void;
  /** Initial lastSyncAt from Base44 */
  initialLastSyncAt?: number | null;
}

export function useChessComSync({
  username,
  enabled,
  intervalMs = SYNC_INTERVAL_MS,
  onNewGames,
  onSyncComplete,
  initialLastSyncAt,
}: UseChessComSyncOptions) {
  const [syncState, setSyncState] = useState<SyncState>({
    isSyncing: false,
    lastSyncAt: initialLastSyncAt ?? null,
    lastSyncNewGames: 0,
    error: null,
  });

  // Update lastSyncAt when initialLastSyncAt arrives from Base44
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initialLastSyncAt != null && !initializedRef.current) {
      initializedRef.current = true;
      setSyncState((prev) => ({ ...prev, lastSyncAt: initialLastSyncAt }));
    }
  }, [initialLastSyncAt]);

  const syncingRef = useRef(false);
  const onNewGamesRef = useRef(onNewGames);
  const onSyncCompleteRef = useRef(onSyncComplete);
  onNewGamesRef.current = onNewGames;
  onSyncCompleteRef.current = onSyncComplete;

  const doSync = useCallback(async () => {
    if (!username || syncingRef.current) return;

    syncingRef.current = true;
    setSyncState((prev) => ({ ...prev, isSyncing: true, error: null }));

    try {
      const newGameIds = await importChessComGames(username, {
        maxGames: 30,
        timeClass: 'all',
      });

      const now = Date.now();
      setSyncState({
        isSyncing: false,
        lastSyncAt: now,
        lastSyncNewGames: newGameIds.length,
        error: null,
      });

      onSyncCompleteRef.current?.(now);

      if (newGameIds.length > 0) {
        console.log(`[Chess DNA Sync] Found ${newGameIds.length} new games`);
        onNewGamesRef.current?.(newGameIds);
      }
    } catch (err) {
      console.error('[Chess DNA Sync] Failed:', err);
      setSyncState((prev) => ({
        ...prev,
        isSyncing: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      syncingRef.current = false;
    }
  }, [username]);

  // Track lastSyncAt in a ref for the visibility handler (avoids effect re-registration)
  const lastSyncAtRef = useRef(syncState.lastSyncAt);
  lastSyncAtRef.current = syncState.lastSyncAt;

  // Start polling interval
  useEffect(() => {
    if (!username || !enabled) return;

    // Initial sync on mount
    doSync();

    const id = setInterval(doSync, intervalMs);
    return () => clearInterval(id);
  }, [username, enabled, intervalMs, doSync]);

  // Sync when tab becomes visible again (after 30s+ away)
  useEffect(() => {
    if (!username || !enabled) return;

    const handler = () => {
      if (document.visibilityState === 'visible') {
        const last = lastSyncAtRef.current ?? 0;
        if (Date.now() - last > 30_000) {
          doSync();
        }
      }
    };

    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [username, enabled, doSync]);

  const syncNow = useCallback(() => {
    doSync();
  }, [doSync]);

  return { ...syncState, syncNow };
}
