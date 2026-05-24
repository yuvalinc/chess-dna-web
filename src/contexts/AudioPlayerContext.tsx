/**
 * AudioPlayerContext — placeholder.
 *
 * The original audio-player context was removed from the build. This stub
 * preserves the AudioPlayerProvider import in App.tsx as a no-op pass-through
 * provider so the production build keeps working. Replace with the real
 * implementation when audio sessions are wired back up.
 */
import type { ReactNode } from 'react';

interface AudioPlayerProviderProps {
  children: ReactNode;
}

export function AudioPlayerProvider({ children }: AudioPlayerProviderProps) {
  return <>{children}</>;
}
