import { useState, useEffect } from 'react';
import { fetchAvatar, getCachedAvatar } from '@/api/chess-com-avatar';

interface PlayerAvatarProps {
  username: string;
  size?: number;
  className?: string;
}

/**
 * Shows the chess.com avatar for a player, with a letter fallback.
 * Fetches lazily and caches in memory.
 */
export default function PlayerAvatar({ username, size = 32, className = '' }: PlayerAvatarProps) {
  const cached = getCachedAvatar(username);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(cached ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (cached !== undefined) {
      setAvatarUrl(cached);
      return;
    }
    let cancelled = false;
    fetchAvatar(username).then((url) => {
      if (!cancelled) setAvatarUrl(url);
    });
    return () => { cancelled = true; };
  }, [username, cached]);

  const letter = username.charAt(0).toUpperCase();

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt={username}
        width={size}
        height={size}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }

  // Letter fallback
  return (
    <div
      className={`rounded-full bg-white/[0.08] flex items-center justify-center shrink-0 text-gray-400 font-semibold ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {letter}
    </div>
  );
}
