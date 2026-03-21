/**
 * Friend profile — fetch, analyze, and compute a chess.com friend's skill profile.
 * All computation is in-memory (nothing saved to the database).
 */
import { CHESS_COM_API_BASE } from '@shared/constants';
import type { TimeClass, GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { SkillProfile } from '@shared/types/patterns';
import { parsePgnToGameRecord } from '@shared/utils/chess-utils';
import { analyzeGame } from '@/engine/game-analyzer';
import { computePatternsFromGames } from '@/patterns/windowed-profile';
import { calculateSkillProfile } from '@/patterns/skill-calculator';

export interface FriendProfile {
  username: string;
  elo: number;
  skillProfile: SkillProfile;
  gamesAnalyzed: number;
  timeClass: TimeClass | 'all';
}

export interface CachedFriendProfile extends FriendProfile {
  cachedAt: number;
}

export interface FriendAnalysisProgress {
  phase: 'fetching' | 'analyzing' | 'computing' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
  error?: string;
}

/* ── Friend profile cache (localStorage) ── */

const CACHE_PREFIX = 'chess-dna-friend-cache:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getCachedFriendProfile(username: string): CachedFriendProfile | null {
  try {
    const key = `${CACHE_PREFIX}${username.toLowerCase()}`;
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const parsed: CachedFriendProfile = JSON.parse(stored);
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function cacheFriendProfile(profile: FriendProfile): void {
  try {
    const key = `${CACHE_PREFIX}${profile.username.toLowerCase()}`;
    const cached: CachedFriendProfile = { ...profile, cachedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(cached));
  } catch {
    // localStorage full — silently ignore
  }
}

export function clearFriendCache(username: string): void {
  try {
    localStorage.removeItem(`${CACHE_PREFIX}${username.toLowerCase()}`);
  } catch {
    // ignore
  }
}

/**
 * Fetch a chess.com player's recent games, analyze with Stockfish, compute their 8-dimension profile.
 * Everything runs in-memory — nothing persisted (but callers can cache the result).
 */
export async function fetchFriendProfile(
  username: string,
  timeClass: TimeClass | 'all' = 'all',
  maxGames: number = 15,
  depth: number = 14,
  onProgress?: (p: FriendAnalysisProgress) => void,
): Promise<FriendProfile> {
  const report = (p: Omit<FriendAnalysisProgress, 'message'> & { message?: string }) => {
    const msg = p.message ?? `${p.phase} ${p.current}/${p.total}`;
    onProgress?.({ ...p, message: msg } as FriendAnalysisProgress);
  };

  // 1. Fetch games from chess.com API
  report({ phase: 'fetching', current: 0, total: 0, message: `Fetching ${username}'s games...` });

  const archivesRes = await fetch(
    `${CHESS_COM_API_BASE}/player/${username.toLowerCase()}/games/archives`,
  );
  if (!archivesRes.ok) {
    const err = `Player "${username}" not found on chess.com`;
    report({ phase: 'error', current: 0, total: 0, message: err, error: err });
    throw new Error(err);
  }

  const archivesData = (await archivesRes.json()) as { archives: string[] };
  const archives = archivesData.archives ?? [];
  if (archives.length === 0) {
    const err = `No games found for "${username}"`;
    report({ phase: 'error', current: 0, total: 0, message: err, error: err });
    throw new Error(err);
  }

  // Fetch from most recent archives, collect PGNs
  const collected: Array<{ pgn: string; url: string }> = [];
  const reversedArchives = [...archives].reverse();

  for (const archiveUrl of reversedArchives) {
    if (collected.length >= maxGames) break;
    try {
      const monthRes = await fetch(archiveUrl);
      if (!monthRes.ok) continue;
      const monthData = (await monthRes.json()) as {
        games: Array<{ url: string; pgn: string; time_class: string }>;
      };
      for (let i = (monthData.games?.length ?? 0) - 1; i >= 0; i--) {
        if (collected.length >= maxGames) break;
        const g = monthData.games[i];
        if (timeClass !== 'all' && g.time_class !== timeClass) continue;
        if (!g.pgn) continue;
        collected.push({ pgn: g.pgn, url: g.url });
      }
    } catch {
      // skip failed archives
    }
  }

  if (collected.length === 0) {
    const err = `No matching games found for "${username}"`;
    report({ phase: 'error', current: 0, total: 0, message: err, error: err });
    throw new Error(err);
  }

  // 2. Parse PGNs into GameRecord objects (in-memory only)
  const games: GameRecord[] = [];
  for (const { pgn, url } of collected) {
    const game = parsePgnToGameRecord(pgn, url, username);
    if (game) {
      // Mark as "complete" so skill calculator uses them
      games.push({ ...game, analysisStatus: 'complete' });
    }
  }

  report({ phase: 'fetching', current: games.length, total: games.length, message: `Fetched ${games.length} games` });

  if (games.length === 0) {
    const err = `Could not parse any games for "${username}"`;
    report({ phase: 'error', current: 0, total: 0, message: err, error: err });
    throw new Error(err);
  }

  // 3. Analyze each game with Stockfish (lower depth for speed)
  const analyses: GameAnalysis[] = [];
  const total = games.length;

  for (let i = 0; i < games.length; i++) {
    report({ phase: 'analyzing', current: i + 1, total, message: `Analyzing game ${i + 1} of ${total}...` });
    try {
      const analysis = await analyzeGame(games[i], depth);
      analyses.push(analysis);
    } catch (err) {
      console.warn(`[FriendProfile] Failed to analyze game ${i + 1}:`, err);
      // Skip failed analyses
    }
  }

  if (analyses.length === 0) {
    const err = 'Analysis failed for all games';
    report({ phase: 'error', current: 0, total: 0, message: err, error: err });
    throw new Error(err);
  }

  // 4. Compute patterns and skill profile
  report({ phase: 'computing', current: 0, total: 0, message: 'Computing skill profile...' });

  const patterns = computePatternsFromGames(games, analyses);
  const skillProfile = calculateSkillProfile(patterns, games, analyses);

  report({ phase: 'done', current: total, total, message: 'Done!' });

  return {
    username,
    elo: games[0]?.player.rating ?? 1200,
    skillProfile,
    gamesAnalyzed: analyses.length,
    timeClass,
  };
}
