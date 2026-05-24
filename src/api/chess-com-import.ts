/**
 * Chess.com game import module.
 * Fetches games from the Chess.com public API and saves them as Base44 entities.
 */
import { CHESS_COM_API_BASE } from '@shared/constants';
import type { TimeClass } from '@shared/types/game';
import { parsePgnToGameRecord } from '@shared/utils/chess-utils';
import { base44 } from '@/api/base44Client';
import { fetchChessCom } from '@/api/chess-com-fetch';
import { getGuestEntities, createGuestEntity } from '@shared/utils/guest-storage';
import { recordDedupEvent, recordDedupRun } from '@/utils/dedup-diagnostics';

const entities = base44.entities as Record<string, any>;

export interface ImportProgress {
  fetched: number;
  total: number;
  done: boolean;
  error?: string;
}

export interface ImportOptions {
  timeClass?: TimeClass | 'all';
  maxGames?: number;
  onProgress?: (progress: ImportProgress) => void;
  /** When true, save to localStorage instead of Base44 (for guest users) */
  guest?: boolean;
  /**
   * When true, skip the cross-user dedup check (the targeted
   * `entities.Game.filter({ gameId })` query). Use this for follow-flow
   * imports — top-player/friend games may already exist server-side from
   * another user's import, but the current user can't see them via
   * `entity.list()` (RLS / 5000-record cap), so the dedup blocks creation
   * and the user ends up with nothing in their library. Each user should
   * have their own copy of these records.
   */
  skipCrossUserDedup?: boolean;
  /**
   * Watermark — when set, games with `playedAt <= sinceMs - GRACE` are
   * skipped before any Base44 call. Cost-cutting for repeated polling:
   * a sync that finds no new games does zero Base44 calls.
   *
   * IMPORTANT: A 7-day grace period is subtracted so that if `lastSyncAt`
   * was silently bumped past actual games (e.g., chess.com 5xx during a
   * sync left lastSyncAt advanced but with no games imported), recent
   * games still pass through to the dedup filter. Without the grace, a
   * single transient chess.com failure could permanently lose games for
   * a user — exactly the bug reported by Shaked Ohana (2026-05-13):
   * "last sync from May 8 but I have more games".
   */
  sinceMs?: number;
}

/**
 * Thrown when chess.com's API is unreachable or returns a non-OK status.
 * Callers (notably `useChessComSync`) MUST NOT advance the `lastSyncAt`
 * watermark when they see this — otherwise games played during the failure
 * window get permanently skipped on subsequent successful syncs.
 */
export class ChessComFetchError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'ChessComFetchError';
  }
}

/** 7 days — see `sinceMs` docs above. */
const WATERMARK_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Import games from Chess.com for a given username.
 * Returns the IDs of newly imported games (not duplicates).
 */
export async function importChessComGames(
  username: string,
  options: ImportOptions = {},
): Promise<string[]> {
  const { timeClass = 'all', maxGames = 5, onProgress, guest = false, skipCrossUserDedup = false, sinceMs } = options;

  const report = (fetched: number, total: number, done: boolean, error?: string) => {
    onProgress?.({ fetched, total, done, error });
  };

  try {
    // 1. Get the list of monthly archives for the player
    // Use no-store to bypass CDN cache entirely and get the freshest data
    const archivesRes = await fetchChessCom(
      `${CHESS_COM_API_BASE}/player/${username.toLowerCase()}/games/archives`,
      { cache: 'no-store' },
    );

    if (!archivesRes.ok) {
      report(0, 0, true, `Failed to fetch archives: ${archivesRes.status}`);
      // Throw (don't silently return) so the polling caller doesn't advance
      // its watermark past games that were never actually fetched.
      throw new ChessComFetchError(
        `chess.com archives endpoint returned ${archivesRes.status}`,
        archivesRes.status,
      );
    }

    const archivesData = (await archivesRes.json()) as { archives: string[] };
    const archives = archivesData.archives ?? [];

    if (archives.length === 0) {
      report(0, 0, true, 'No games found for this player.');
      return [];
    }

    // 2. Fetch from most recent archives first until we have enough games
    const collected: Array<{ pgn: string; url: string }> = [];
    const reversedArchives = [...archives].reverse(); // newest first
    // Track whether at least one month fetch succeeded. If every month fetch
    // fails (network down, mass 5xx), we must throw so the sync caller
    // doesn't advance its watermark.
    let anyMonthSucceeded = false;
    let lastMonthError: unknown = null;

    for (const archiveUrl of reversedArchives) {
      if (collected.length >= maxGames) break;

      try {
        const monthRes = await fetchChessCom(archiveUrl, { cache: 'no-store' });
        if (!monthRes.ok) {
          lastMonthError = new ChessComFetchError(
            `monthly archive ${archiveUrl} returned ${monthRes.status}`,
            monthRes.status,
          );
          continue;
        }
        anyMonthSucceeded = true;

        const monthData = (await monthRes.json()) as {
          games: Array<{
            url: string;
            pgn: string;
            time_class: string;
            white: { username: string };
            black: { username: string };
          }>;
        };

        const monthGames = monthData.games ?? [];

        // Filter by time class if specified, iterate newest first
        for (let i = monthGames.length - 1; i >= 0; i--) {
          if (collected.length >= maxGames) break;

          const g = monthGames[i];

          // Filter by time class
          if (timeClass && timeClass !== 'all' && g.time_class !== timeClass) {
            continue;
          }

          // Skip games without PGN
          if (!g.pgn) continue;

          collected.push({ pgn: g.pgn, url: g.url });
        }
      } catch (err) {
        console.warn('[Chess DNA] Failed to fetch archive:', archiveUrl, err);
        lastMonthError = err;
      }
    }

    // If we never got a usable monthly response, treat as a fetch failure
    // (rather than "no games") so the caller doesn't advance its watermark.
    if (!anyMonthSucceeded) {
      throw new ChessComFetchError(
        `every chess.com monthly archive fetch failed: ${String(lastMonthError ?? 'unknown')}`,
      );
    }

    if (collected.length === 0) {
      report(0, 0, true, 'No matching games found.');
      return [];
    }

    // 3. Parse and save each game
    const total = collected.length;
    let saved = 0;
    const newGameIds: string[] = [];

    // Within-batch dedup set (prevents creating two copies in the same run).
    const batchSeenChessIds = new Set<string>();

    // Diagnostic counters — surfaced via dedup-diagnostics so we can see what
    // happened on a phone WebView without DevTools. Per-event records are
    // bounded by the ring buffer; only one summary per run is appended.
    const runStart = Date.now();
    let runCreated = 0;
    let runExisted = 0;
    let runErrors = 0;

    for (const { pgn, url } of collected) {
      try {
        const game = parsePgnToGameRecord(pgn, url, username);
        if (!game) {
          recordDedupEvent({ source: 'chess.com', username, gameId: '(parse-failed)', url, outcome: 'parse-failed' });
          runErrors++;
          saved++;
          report(saved, total, false);
          continue;
        }

        const { id: gameId, ...gameData } = game;

        // Watermark filter — skip games we've already imported in a prior sync.
        // Primary cost-cutting fix: most polls find no new games and
        // short-circuit here before doing any Base44 calls.
        //
        // The 7-day grace period (WATERMARK_GRACE_MS) is critical: it ensures
        // that even if `sinceMs` was silently bumped past a real game
        // (chess.com transient failure → empty result → caller advanced its
        // `lastSyncAt` anyway, in a prior buggy version), the game still
        // reaches the dedup filter on the next sync. Dedup is per-gameId, so
        // it's cheap; the watermark is just a fast-path.
        const watermark = sinceMs != null ? sinceMs - WATERMARK_GRACE_MS : null;
        if (watermark != null && typeof gameData.playedAt === 'number' && gameData.playedAt <= watermark) {
          saved++;
          report(saved, total, false);
          continue;
        }

        // Flat, server-filterable field that mirrors player.username.lowercase().
        // Base44 doesn't filter on nested fields, so without this we can't
        // ask "give me only Yuvalinc's games" — the 250 fetch window ends up
        // shared between the user's own games and any imported friend / top-
        // player games, with imports crowding out personal data.
        const playerUsername = (gameData.player?.username ?? '').toLowerCase();
        if (guest) {
          // Guest mode: dedup + save to localStorage
          const guestGames = getGuestEntities<Record<string, unknown>>('Game');
          const exists = guestGames.some(g => g.gameId === gameId);
          if (exists) {
            recordDedupEvent({ source: 'chess.com', username, gameId, url, outcome: 'existed', existingCount: 1 });
            runExisted++;
            saved++;
            report(saved, total, false);
            continue;
          }
          const created = createGuestEntity('Game', { ...gameData, gameId, playerUsername } as Record<string, unknown>);
          newGameIds.push((created.id ?? created.gameId) as string);
          recordDedupEvent({ source: 'chess.com', username, gameId, url, outcome: 'created', existingCount: 0 });
          runCreated++;
        } else {
          // Authenticated: dedup via targeted filter. Base44 list() caps at 5000 records,
          // so once the DB grows past that (or has many dupes), a bulk list misses recent
          // games and the sync keeps re-inserting them. A per-gameId filter is O(1) in DB
          // size and bounded to maxGames requests per run.
          if (batchSeenChessIds.has(gameId)) {
            recordDedupEvent({ source: 'chess.com', username, gameId, url, outcome: 'batch-dupe' });
            saved++;
            report(saved, total, false);
            continue;
          }
          let existingCount: number | undefined;
          if (!skipCrossUserDedup) {
            try {
              const existing = await entities.Game.filter({ gameId });
              existingCount = Array.isArray(existing) ? existing.length : 0;
              if (existingCount > 0) {
                recordDedupEvent({ source: 'chess.com', username, gameId, url, outcome: 'existed', existingCount });
                runExisted++;
                batchSeenChessIds.add(gameId);
                saved++;
                report(saved, total, false);
                continue;
              }
            } catch (err) {
              console.warn('[Chess DNA Import] Dedup filter failed, skipping to avoid dupe:', err);
              recordDedupEvent({
                source: 'chess.com', username, gameId, url, outcome: 'filter-error',
                error: err instanceof Error ? err.message : String(err),
              });
              runErrors++;
              saved++;
              report(saved, total, false);
              continue;
            }
          }

          // Defensive auth check: if there's no Base44 token in localStorage,
          // the SDK will create the record but the server will stamp it with
          // `created_by_id: "anonymous"` — which leaks orphan rows nobody can
          // clean up. Refuse and bail before issuing the call. This handles
          // the cold-start race where chess-com-sync fires before the SDK
          // has loaded auth into memory.
          const hasToken = typeof localStorage !== 'undefined'
            && (localStorage.getItem('base44_access_token') || localStorage.getItem('token'));
          if (!hasToken) {
            recordDedupEvent({ source: 'chess.com', username, gameId, url, outcome: 'no-auth' });
            runErrors++;
            saved++;
            report(saved, total, false);
            continue;
          }

          try {
            const created = await entities.Game.create({ ...gameData, gameId, playerUsername });
            // Sanity check: even with a token in localStorage, the server can
            // still stamp the record as `anonymous` if the SDK hasn't attached
            // the Authorization header yet. Detect that and immediately undo
            // — otherwise we'd be silently leaking the same orphan rows the
            // CSV showed accumulating ~30/launch.
            const stampedBy = (created as { created_by_id?: string } | undefined)?.created_by_id;
            if (stampedBy === 'anonymous' || !stampedBy) {
              try { await entities.Game.delete(created.id); } catch { /* best-effort */ }
              recordDedupEvent({
                source: 'chess.com', username, gameId, url, outcome: 'anonymous-rolled-back',
                error: `server stamped created_by_id=${stampedBy ?? 'undefined'}`,
              });
              runErrors++;
              saved++;
              report(saved, total, false);
              continue;
            }
            newGameIds.push(created.id);
            batchSeenChessIds.add(gameId);
            recordDedupEvent({ source: 'chess.com', username, gameId, url, outcome: 'created', existingCount });
            runCreated++;
          } catch (err) {
            recordDedupEvent({
              source: 'chess.com', username, gameId, url, outcome: 'create-error',
              error: err instanceof Error ? err.message : String(err),
            });
            runErrors++;
            throw err;
          }
        }
        saved++;
        report(saved, total, false);
      } catch (err) {
        console.warn('[Chess DNA] Failed to save game:', err);
        saved++;
        report(saved, total, false);
      }
    }

    // 4. Done
    recordDedupRun({
      source: 'chess.com',
      username,
      candidates: total,
      created: runCreated,
      existed: runExisted,
      errors: runErrors,
      durationMs: Date.now() - runStart,
    });
    report(saved, total, true);
    return newGameIds;
  } catch (err) {
    console.error('[Chess DNA] Import failed:', err);
    report(0, 0, true, `Unexpected error: ${String(err)}`);
    // Re-throw ChessComFetchError so the polling caller can leave its
    // watermark in place. Anything else (parse bugs, etc.) is swallowed
    // as before — those errors aren't worth derailing a whole sync.
    if (err instanceof ChessComFetchError) throw err;
    return [];
  }
}
