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
  /** When true, write imported games to localStorage instead of Base44. */
  guest?: boolean;
}

export function useChessComSync({
  username,
  enabled,
  intervalMs = SYNC_INTERVAL_MS,
  onNewGames,
  onSyncComplete,
  initialLastSyncAt,
  guest = false,
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

  // Track lastSyncAt in a ref so doSync can read the freshest value
  // without becoming a dependency that re-triggers the polling effect.
  const lastSyncAtRef = useRef(syncState.lastSyncAt);
  lastSyncAtRef.current = syncState.lastSyncAt;

  const doSync = useCallback(async () => {
    if (!username || syncingRef.current) return;

    syncingRef.current = true;
    setSyncState((prev) => ({ ...prev, isSyncing: true, error: null }));

    try {
      // sinceMs watermark — most polls find no games newer than this and
      // short-circuit inside importChessComGames before doing any Base44 call.
      const newGameIds = await importChessComGames(username, {
        maxGames: 30,
        timeClass: 'all',
        guest,
        sinceMs: lastSyncAtRef.current ?? undefined,
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
  }, [username, guest]);

  // Polling — paused when the tab is hidden so background tabs don't burn
  // chess.com calls (and don't risk Base44 calls if new games arrive while
  // the user isn't looking). We resume on visibilitychange below.
  useEffect(() => {
    if (!username || !enabled) return;

    let intervalId: number | null = null;

    const start = () => {
      if (intervalId != null) return;
      intervalId = window.setInterval(doSync, intervalMs);
    };

    const stop = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    // Initial sync on mount (only if tab is visible AND we haven't synced
    // recently). Without the recency check, every page reload fires a full
    // sync — which hits the chess.com API + 30 Base44 dedup filter calls
    // (one per recent game). For heavy users this means 100+ requests per
    // load, many of which Base44 then 429s. The recency check matches the
    // onVisibility handler below — both honor the same interval window.
    if (!document.hidden) {
      const last = lastSyncAtRef.current ?? 0;
      if (Date.now() - last > intervalMs) {
        doSync();
      }
      start();
    }

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Coming back to the tab: if it's been at least one interval since
        // the last sync, fire one immediately, then resume the timer.
        const last = lastSyncAtRef.current ?? 0;
        if (Date.now() - last > intervalMs) {
          doSync();
        }
        start();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [username, enabled, intervalMs, doSync]);

  const syncNow = useCallback(() => {
    doSync();
  }, [doSync]);

  return { ...syncState, syncNow };
}
