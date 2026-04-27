/**
 * Lightweight chess.com profile cache.
 * Fetches /pub/player/{username} once per user and caches the full profile
 * so avatar, country, and other fields are retrievable synchronously after
 * the first async call.
 */

import { fetchChessCom } from '@/api/chess-com-fetch';

const CHESS_COM_API = 'https://api.chess.com/pub';

export interface ChessComProfile {
  avatar: string | null;
  /** ISO country code if resolvable (e.g. 'US'), else null. */
  countryCode: string | null;
  /** Full country URL returned by chess.com (e.g. '.../country/US') — raw. */
  countryUrl: string | null;
}

const EMPTY_PROFILE: ChessComProfile = { avatar: null, countryCode: null, countryUrl: null };

const profileCache = new Map<string, ChessComProfile>();
const pendingFetches = new Map<string, Promise<ChessComProfile>>();

/** Fetch the chess.com profile for a username (cached). */
export async function fetchProfile(username: string): Promise<ChessComProfile> {
  const key = username.toLowerCase();
  if (profileCache.has(key)) return profileCache.get(key)!;
  if (pendingFetches.has(key)) return pendingFetches.get(key)!;

  const promise = (async () => {
    try {
      const res = await fetchChessCom(`${CHESS_COM_API}/player/${key}`, { cache: 'force-cache' });
      if (!res.ok) {
        profileCache.set(key, EMPTY_PROFILE);
        return EMPTY_PROFILE;
      }
      const data = await res.json();
      const countryUrl: string | null = data.country ?? null;
      // chess.com `country` field is a URL like 'https://api.chess.com/pub/country/US'
      // — the last segment is the ISO code.
      const countryCode = countryUrl
        ? (countryUrl.split('/').filter(Boolean).pop() ?? null)
        : null;
      const profile: ChessComProfile = {
        avatar: data.avatar ?? null,
        countryCode: countryCode && countryCode.length === 2 ? countryCode.toUpperCase() : null,
        countryUrl,
      };
      profileCache.set(key, profile);
      return profile;
    } catch {
      profileCache.set(key, EMPTY_PROFILE);
      return EMPTY_PROFILE;
    } finally {
      pendingFetches.delete(key);
    }
  })();

  pendingFetches.set(key, promise);
  return promise;
}

/** Back-compat: avatar-only async accessor. */
export async function fetchAvatar(username: string): Promise<string | null> {
  return (await fetchProfile(username)).avatar;
}

/** Prefetch profiles for multiple usernames (fire-and-forget). */
export function prefetchAvatars(usernames: string[]): void {
  for (const u of usernames) {
    if (!profileCache.has(u.toLowerCase())) fetchProfile(u);
  }
}

/** Synchronous accessors — return `undefined` when not yet fetched. */
export function getCachedAvatar(username: string): string | null | undefined {
  return profileCache.get(username.toLowerCase())?.avatar;
}
export function getCachedCountry(username: string): string | null | undefined {
  return profileCache.get(username.toLowerCase())?.countryCode;
}
export function getCachedProfile(username: string): ChessComProfile | undefined {
  return profileCache.get(username.toLowerCase());
}
