/**
 * Lichess game import module.
 * Fetches games from the Lichess public API and saves them as Base44 entities.
 * The Lichess API is open — no authentication needed.
 */
import { LICHESS_API_BASE } from '@shared/constants';
import type { TimeClass } from '@shared/types/game';
import { parsePgnToGameRecord } from '@shared/utils/chess-utils';
import { base44 } from '@/api/base44Client';
import { getGuestEntities, createGuestEntity } from '@shared/utils/guest-storage';
import { recordDedupEvent, recordDedupRun } from '@/utils/dedup-diagnostics';

const entities = base44.entities as Record<string, any>;

/**
 * Thrown when Lichess's API is unreachable or returns a non-OK status.
 * Mirrors {@link ChessComFetchError} — callers must NOT advance their
 * watermark when they see this, or games played during the failure window
 * get permanently skipped on subsequent successful syncs.
 */
export class LichessFetchError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'LichessFetchError';
  }
}

/** 7 days — same rationale as chess-com-import.ts. */
const WATERMARK_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface LichessImportProgress {
  phase: 'idle' | 'fetching' | 'saving' | 'done' | 'error';
  fetched: number;
  total: number;
  done?: boolean;
  error?: string;
  message?: string;
}

/**
 * Import games from Lichess for a given username.
 * Returns the list of newly saved game entity IDs.
 */
export async function importLichessGames(
  username: string,
  options: {
    maxGames?: number;
    timeClass?: TimeClass | 'all';
    onProgress?: (progress: LichessImportProgress) => void;
    guest?: boolean;
    /** See chess-com-import.ts — mirror this option for top-player/follow flows. */
    skipCrossUserDedup?: boolean;
    /** Watermark — skip games with `playedAt <= sinceMs` before any Base44 call. */
    sinceMs?: number;
  } = {},
): Promise<string[]> {
  const { maxGames = 30, timeClass = 'all', onProgress, guest = false, skipCrossUserDedup = false, sinceMs } = options;

  const report = (p: LichessImportProgress) => onProgress?.(p);

  try {
    report({ phase: 'fetching', fetched: 0, total: maxGames });

    // Build Lichess API URL
    // perfType maps: bullet, blitz, rapid, classical, correspondence
    const perfMap: Record<string, string> = {
      bullet: 'bullet',
      blitz: 'blitz',
      rapid: 'rapid',
      daily: 'correspondence',
    };
    const perfParam = timeClass !== 'all' && perfMap[timeClass] ? `&perfType=${perfMap[timeClass]}` : '';

    const url = `${LICHESS_API_BASE}/games/user/${username.toLowerCase()}?max=${maxGames}&pgnInJson=true&clocks=true&opening=true${perfParam}`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/x-ndjson',
      },
    });

    if (!response.ok) {
      const errMsg = response.status === 404
        ? `Player "${username}" not found on Lichess`
        : `Lichess API error: ${response.status}`;
      report({ phase: 'error', fetched: 0, total: 0, error: errMsg });
      // 404 is a real "no such user" answer — don't throw, just return.
      // Other statuses (5xx, 429, network) are transient: throw so the
      // polling caller doesn't advance its watermark past games never
      // actually fetched.
      if (response.status === 404) return [];
      throw new LichessFetchError(errMsg, response.status);
    }

    // Lichess returns NDJSON — each line is a JSON object with a pgn field
    const text = await response.text();
    const lines = text.trim().split('\n').filter(l => l.trim());

    const games: Array<{ pgn: string; url: string }> = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.pgn) {
          const gameUrl = `https://lichess.org/${obj.id}`;
          games.push({ pgn: obj.pgn, url: gameUrl });
        }
      } catch {
        // Skip malformed lines
      }
    }

    report({ phase: 'saving', fetched: games.length, total: games.length });

    // Within-batch dedup set + guest-mode pre-fetch
    const batchSeenChessIds = new Set<string>();
    let guestExistingIds: Set<string> | null = null;
    if (guest) {
      const guestGames = getGuestEntities<Record<string, unknown>>('Game');
      guestExistingIds = new Set(guestGames.map(g => (g.gameId ?? g.id) as string));
    }

    const savedIds: string[] = [];

    // Diagnostic counters — matches chess-com-import so the dedup admin panel
    // can compare apples to apples across sources.
    const runStart = Date.now();
    let runCreated = 0;
    let runExisted = 0;
    let runErrors = 0;

    for (let i = 0; i < games.length; i++) {
      const { pgn, url: gameUrl } = games[i];
      const game = parsePgnToGameRecord(pgn, gameUrl, username);
      if (!game) {
        recordDedupEvent({ source: 'lichess', username, gameId: '(parse-failed)', url: gameUrl, outcome: 'parse-failed' });
        runErrors++;
        report({ phase: 'saving', fetched: i + 1, total: games.length });
        continue;
      }

      const { id: gameId, ...gameData } = game;

      // Watermark filter — skip games already imported in a prior sync.
      // Same cost-cutting short-circuit as chess-com-import, with the same
      // 7-day grace period to survive transient sync failures that may
      // have advanced lastSyncAt past real games.
      const watermark = sinceMs != null ? sinceMs - WATERMARK_GRACE_MS : null;
      if (watermark != null && typeof gameData.playedAt === 'number' && gameData.playedAt <= watermark) {
        report({ phase: 'saving', fetched: i + 1, total: games.length });
        continue;
      }

      if (batchSeenChessIds.has(gameId)) {
        recordDedupEvent({ source: 'lichess', username, gameId, url: gameUrl, outcome: 'batch-dupe' });
        report({ phase: 'saving', fetched: i + 1, total: games.length });
        continue;
      }

      // Check existing
      if (guest) {
        if (guestExistingIds!.has(gameId)) {
          recordDedupEvent({ source: 'lichess', username, gameId, url: gameUrl, outcome: 'existed', existingCount: 1 });
          runExisted++;
          report({ phase: 'saving', fetched: i + 1, total: games.length });
          continue;
        }
      } else if (!skipCrossUserDedup) {
        // Per-gameId filter — Base44 list() caps at 5000 records, so a bulk pre-fetch
        // misses games beyond the window and re-imports them as duplicates.
        try {
          const existing = await entities.Game.filter({ gameId });
          const existingCount = Array.isArray(existing) ? existing.length : 0;
          if (existingCount > 0) {
            recordDedupEvent({ source: 'lichess', username, gameId, url: gameUrl, outcome: 'existed', existingCount });
            runExisted++;
            batchSeenChessIds.add(gameId);
            report({ phase: 'saving', fetched: i + 1, total: games.length });
            continue;
          }
        } catch (err) {
          console.warn('[Lichess Import] Dedup filter failed, skipping to avoid dupe:', err);
          recordDedupEvent({
            source: 'lichess', username, gameId, url: gameUrl, outcome: 'filter-error',
            error: err instanceof Error ? err.message : String(err),
          });
          runErrors++;
          report({ phase: 'saving', fetched: i + 1, total: games.length });
          continue;
        }
      }

      const gameRecord = {
        gameId,
        url: gameData.url,
        pgn: gameData.pgn,
        player: gameData.player,
        opponent: gameData.opponent,
        timeClass: gameData.timeClass,
        timeControl: gameData.timeControl,
        opening: gameData.opening,
        totalMoves: gameData.totalMoves,
        playedAt: gameData.playedAt,
        analyzedAt: null,
        analysisStatus: 'pending',
      };

      try {
        if (guest) {
          const created = createGuestEntity('Game', gameRecord as Record<string, unknown>);
          savedIds.push((created.id ?? created.gameId) as string);
          guestExistingIds!.add(gameId);
          recordDedupEvent({ source: 'lichess', username, gameId, url: gameUrl, outcome: 'created', existingCount: 0 });
          runCreated++;
        } else {
          // Same defensive checks as chess-com-import: refuse without a token,
          // and roll back any record the server stamps with anonymous owner.
          const hasToken = typeof localStorage !== 'undefined'
            && (localStorage.getItem('base44_access_token') || localStorage.getItem('token'));
          if (!hasToken) {
            recordDedupEvent({ source: 'lichess', username, gameId, url: gameUrl, outcome: 'no-auth' });
            runErrors++;
            continue;
          }
          const saved = await entities.Game.create(gameRecord);
          const stampedBy = (saved as { created_by_id?: string } | undefined)?.created_by_id;
          if (stampedBy === 'anonymous' || !stampedBy) {
            try { await entities.Game.delete(saved.id); } catch { /* best-effort */ }
            recordDedupEvent({
              source: 'lichess', username, gameId, url: gameUrl, outcome: 'anonymous-rolled-back',
              error: `server stamped created_by_id=${stampedBy ?? 'undefined'}`,
            });
            runErrors++;
            continue;
          }
          savedIds.push(saved.id);
          recordDedupEvent({ source: 'lichess', username, gameId, url: gameUrl, outcome: 'created' });
          runCreated++;
        }
        batchSeenChessIds.add(gameId);
      } catch (err) {
        recordDedupEvent({
          source: 'lichess', username, gameId, url: gameUrl, outcome: 'create-error',
          error: err instanceof Error ? err.message : String(err),
        });
        runErrors++;
      }

      report({ phase: 'saving', fetched: i + 1, total: games.length });
    }

    recordDedupRun({
      source: 'lichess',
      username,
      candidates: games.length,
      created: runCreated,
      existed: runExisted,
      errors: runErrors,
      durationMs: Date.now() - runStart,
    });
    report({ phase: 'done', fetched: games.length, total: games.length, done: true, message: `Imported ${savedIds.length} games from Lichess` });
    return savedIds;

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    report({ phase: 'error', fetched: 0, total: 0, error: errMsg });
    // Same as chess-com-import: propagate fetch failures so the polling
    // caller can keep its watermark in place.
    if (err instanceof LichessFetchError) throw err;
    return [];
  }
}
