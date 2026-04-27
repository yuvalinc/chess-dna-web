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
}

/**
 * Import games from Chess.com for a given username.
 * Returns the IDs of newly imported games (not duplicates).
 */
export async function importChessComGames(
  username: string,
  options: ImportOptions = {},
): Promise<string[]> {
  const { timeClass = 'all', maxGames = 5, onProgress, guest = false } = options;

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
      return [];
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

    for (const archiveUrl of reversedArchives) {
      if (collected.length >= maxGames) break;

      try {
        const monthRes = await fetchChessCom(archiveUrl, { cache: 'no-store' });
        if (!monthRes.ok) continue;

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
      }
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

    for (const { pgn, url } of collected) {
      try {
        const game = parsePgnToGameRecord(pgn, url, username);
        if (!game) {
          saved++;
          report(saved, total, false);
          continue;
        }

        const { id: gameId, ...gameData } = game;

        if (guest) {
          // Guest mode: dedup + save to localStorage
          const guestGames = getGuestEntities<Record<string, unknown>>('Game');
          const exists = guestGames.some(g => g.gameId === gameId);
          if (exists) {
            saved++;
            report(saved, total, false);
            continue;
          }
          const created = createGuestEntity('Game', { ...gameData, gameId } as Record<string, unknown>);
          newGameIds.push((created.id ?? created.gameId) as string);
        } else {
          // Authenticated: dedup via targeted filter. Base44 list() caps at 5000 records,
          // so once the DB grows past that (or has many dupes), a bulk list misses recent
          // games and the sync keeps re-inserting them. A per-gameId filter is O(1) in DB
          // size and bounded to maxGames requests per run.
          if (batchSeenChessIds.has(gameId)) {
            saved++;
            report(saved, total, false);
            continue;
          }
          try {
            const existing = await entities.Game.filter({ gameId });
            if (Array.isArray(existing) && existing.length > 0) {
              batchSeenChessIds.add(gameId);
              saved++;
              report(saved, total, false);
              continue;
            }
          } catch (err) {
            console.warn('[Chess DNA Import] Dedup filter failed, skipping to avoid dupe:', err);
            saved++;
            report(saved, total, false);
            continue;
          }

          const created = await entities.Game.create({ ...gameData, gameId });
          newGameIds.push(created.id);
          batchSeenChessIds.add(gameId);
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
    report(saved, total, true);
    return newGameIds;
  } catch (err) {
    console.error('[Chess DNA] Import failed:', err);
    report(0, 0, true, `Unexpected error: ${String(err)}`);
    return [];
  }
}
