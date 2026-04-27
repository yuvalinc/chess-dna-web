/**
 * Chess.com leaderboard and player profile API.
 */
import { CHESS_COM_API_BASE } from '@shared/constants';
import { fetchChessCom } from '@/api/chess-com-fetch';

export interface LeaderboardPlayer {
  player_id: number;
  username: string;
  score: number;
  rank: number;
  country: string; // URL like "https://api.chess.com/pub/country/US"
  title?: string;  // GM, IM, FM, etc.
  name?: string;
  avatar?: string;
  url?: string;
}

export interface LeaderboardData {
  live_blitz: LeaderboardPlayer[];
  live_rapid: LeaderboardPlayer[];
  live_bullet: LeaderboardPlayer[];
  [key: string]: LeaderboardPlayer[];
}

// Module-level cache with TTL
let cachedLeaderboard: LeaderboardData | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const countryCache = new Map<string, string>();

/**
 * Fetch global leaderboard (top 50 per time class).
 * Cached for 5 minutes.
 */
export async function fetchLeaderboard(): Promise<LeaderboardData> {
  if (cachedLeaderboard && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedLeaderboard;
  }

  const res = await fetchChessCom(`${CHESS_COM_API_BASE}/leaderboards`);
  if (!res.ok) throw new Error(`Failed to fetch leaderboard: ${res.status}`);

  const data = await res.json();
  cachedLeaderboard = data;
  cachedAt = Date.now();
  return data;
}

/**
 * Extract 2-letter country code from a chess.com country URL.
 * e.g. "https://api.chess.com/pub/country/IL" → "IL"
 */
export function extractCountryCode(countryUrl: string): string {
  return countryUrl?.split('/').pop() ?? '';
}

/**
 * Convert 2-letter country code to flag emoji.
 * e.g. "US" → "🇺🇸"
 */
export function countryToFlag(code: string): string {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(
    ...([...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)),
  );
}

/**
 * Fetch a player's country code from their chess.com profile.
 * Cached per-username (never expires within session).
 */
export async function fetchPlayerCountry(username: string): Promise<string> {
  const key = username.toLowerCase();
  if (countryCache.has(key)) return countryCache.get(key)!;

  try {
    const res = await fetchChessCom(`${CHESS_COM_API_BASE}/player/${key}`);
    if (!res.ok) return '';
    const data = await res.json();
    const code = extractCountryCode(data.country ?? '');
    countryCache.set(key, code);
    return code;
  } catch {
    return '';
  }
}
