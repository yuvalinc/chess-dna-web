import { useMemo } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { useAuth } from '@/contexts/AuthContext';
import type { GameRecord } from '@shared/types/game';

/**
 * Hook to get the player's latest ELO rating from their most recent game.
 * Falls back to 1200 if no games have ratings.
 */
export function usePlayerRating(): number {
  const { authResolved } = useAuth();
  // RLS handles user scoping server-side — no need for created_by_id filter
  const [allGames] = useEntityList<GameRecord>('Game', undefined, undefined, !authResolved);

  return useMemo(() => {
    const sorted = allGames
      .filter((g) => g.player?.rating)
      .sort((a, b) => b.playedAt - a.playedAt);
    return sorted[0]?.player?.rating ?? 1200;
  }, [allGames]);
}
