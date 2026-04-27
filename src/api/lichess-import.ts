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

const entities = base44.entities as Record<string, any>;

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
  } = {},
): Promise<string[]> {
  const { maxGames = 30, timeClass = 'all', onProgress, guest = false } = options;

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
      return [];
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

    for (let i = 0; i < games.length; i++) {
      const { pgn, url: gameUrl } = games[i];
      const game = parsePgnToGameRecord(pgn, gameUrl, username);
      if (!game) continue;

      const { id: gameId, ...gameData } = game;

      if (batchSeenChessIds.has(gameId)) {
        report({ phase: 'saving', fetched: i + 1, total: games.length });
        continue;
      }

      // Check existing
      if (guest) {
        if (guestExistingIds!.has(gameId)) {
          report({ phase: 'saving', fetched: i + 1, total: games.length });
          continue;
        }
      } else {
        // Per-gameId filter — Base44 list() caps at 5000 records, so a bulk pre-fetch
        // misses games beyond the window and re-imports them as duplicates.
        try {
          const existing = await entities.Game.filter({ gameId });
          if (Array.isArray(existing) && existing.length > 0) {
            batchSeenChessIds.add(gameId);
            report({ phase: 'saving', fetched: i + 1, total: games.length });
            continue;
          }
        } catch (err) {
          console.warn('[Lichess Import] Dedup filter failed, skipping to avoid dupe:', err);
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
        } else {
          const saved = await entities.Game.create(gameRecord);
          savedIds.push(saved.id);
        }
        batchSeenChessIds.add(gameId);
      } catch (err) {
        console.warn('[Lichess Import] Failed to save game:', err);
      }

      report({ phase: 'saving', fetched: i + 1, total: games.length });
    }

    report({ phase: 'done', fetched: games.length, total: games.length, done: true, message: `Imported ${savedIds.length} games from Lichess` });
    return savedIds;

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    report({ phase: 'error', fetched: 0, total: 0, error: errMsg });
    return [];
  }
}
