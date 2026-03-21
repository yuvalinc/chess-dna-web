/**
 * Chess.com game import module.
 * Fetches games from the Chess.com public API and saves them as Base44 entities.
 */
import { CHESS_COM_API_BASE } from '@shared/constants';
import type { TimeClass } from '@shared/types/game';
import { parsePgnToGameRecord } from '@shared/utils/chess-utils';
import { base44 } from '@/api/base44Client';

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
}

/**
 * Import games from Chess.com for a given username.
 * Returns the IDs of newly imported games (not duplicates).
 */
export async function importChessComGames(
  username: string,
  options: ImportOptions = {},
): Promise<string[]> {
  const { timeClass = 'all', maxGames = 5, onProgress } = options;

  const report = (fetched: number, total: number, done: boolean, error?: string) => {
    onProgress?.({ fetched, total, done, error });
  };

  try {
    // 1. Get the list of monthly archives for the player
    const archivesRes = await fetch(
      `${CHESS_COM_API_BASE}/player/${username.toLowerCase()}/games/archives`,
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
        const monthRes = await fetch(archiveUrl);
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

    for (const { pgn, url } of collected) {
      try {
        const game = parsePgnToGameRecord(pgn, url, username);
        if (!game) {
          saved++;
          report(saved, total, false);
          continue;
        }

        // Check if game already exists (Base44 uses `gameId` field, not `id`)
        // NOTE: Must use .filter() not .list() — SDK .list() takes (sort, limit, skip, fields)
        // RLS handles user scoping server-side — no need for created_by_id filter.
        let exists = false;
        try {
          const existing = await entities.Game.filter({ gameId: game.id });
          exists = Array.isArray(existing) && existing.length > 0;
          console.log(`[Chess DNA Import] Dedup check gameId=${game.id} → found=${existing?.length ?? 0} exists=${exists}`);
        } catch (dedupErr) {
          exists = false;
          console.warn('[Chess DNA Import] Dedup check failed:', dedupErr);
        }

        if (exists) {
          saved++;
          report(saved, total, false);
          continue;
        }

        // Save new game — map `id` → `gameId` for Base44 entity
        const { id: gameId, ...gameData } = game;
        console.log(`[Chess DNA Import] Creating game gameId=${gameId}...`);
        const created = await entities.Game.create({ ...gameData, gameId });
        newGameIds.push(created.id);
        console.log(`[Chess DNA Import] Created game id=${created.id}`);
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
