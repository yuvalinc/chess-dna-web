import { useRef, useState, useEffect } from 'react';

/**
 * Hook that returns a container ref and a responsive board size that tracks
 * the container's width via ResizeObserver, capped at `maxWidth`.
 *
 * Initial state is the smaller of `maxWidth` and the current viewport width
 * — using maxWidth alone caused mobile to render the board at 700px on
 * first paint and overflow horizontally. We also ignore zero-width
 * measurements (which fire when the container is briefly display:none, e.g.
 * the mobile "show/hide board" toggle), so the board doesn't snap back to
 * maxWidth and overflow when the parent re-appears.
 */
export function useResponsiveBoardSize(maxWidth: number = 560) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [boardSize, setBoardSize] = useState(() => {
    if (typeof window === 'undefined') return maxWidth;
    return Math.min(window.innerWidth, maxWidth);
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      // Skip zero-width events (display:none, off-screen tabs, etc.) so we
      // don't fall back to maxWidth and overflow on the next render.
      if (width <= 0) return;
      setBoardSize(Math.min(Math.floor(width), maxWidth));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxWidth]);

  return { containerRef, boardSize };
}
