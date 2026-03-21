import { useRef, useState, useEffect } from 'react';

/**
 * Hook that returns a container ref and a responsive board size
 * that tracks the container's width via ResizeObserver,
 * capped at `maxWidth`.
 */
export function useResponsiveBoardSize(maxWidth: number = 560) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [boardSize, setBoardSize] = useState(maxWidth);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const width = Math.min(entries[0].contentRect.width, maxWidth);
      setBoardSize(Math.floor(width) || maxWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxWidth]);

  return { containerRef, boardSize };
}
