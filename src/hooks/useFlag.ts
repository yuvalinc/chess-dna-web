import { useEffect, useState } from 'react';
import { fetchProfile, getCachedCountry } from '@/api/chess-com-avatar';
import { countryToFlag } from '@/api/chess-com-leaderboard';

/**
 * Returns the country flag emoji for a chess.com username, fetching the
 * profile (cached) on first call. Returns '' until the country is known
 * (or if the user has no public country set).
 */
export function useFlag(username: string | null | undefined): string {
  const [, forceUpdate] = useState(0);
  const code = username ? getCachedCountry(username) : null;
  useEffect(() => {
    if (!username) return;
    if (code !== undefined) return;
    let cancelled = false;
    fetchProfile(username).then(() => {
      if (!cancelled) forceUpdate((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [username, code]);
  return code ? countryToFlag(code) : '';
}
