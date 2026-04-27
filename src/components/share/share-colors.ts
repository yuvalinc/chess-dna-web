/**
 * Hardcoded color constants for share card rendering.
 * html2canvas cannot resolve CSS custom properties (var(--chess-*)),
 * so share card components must use these hex values directly via inline styles.
 */

export const SHARE_COLORS = {
  // Backgrounds
  bg: '#0a0f1a',
  surface: '#111827',
  surfaceLight: '#1a2332',
  cardBorder: 'rgba(255,255,255,0.06)',

  // Text
  text: '#e8edf5',
  textSecondary: '#94a3b8',
  textTertiary: '#64748b',

  // Accent
  accent: '#4ade80',

  // Result colors
  win: '#4ade80',
  loss: '#ef4444',
  draw: '#94a3b8',

  // Move quality
  brilliant: '#1baca6',
  great: '#5c8bb0',
  best: '#22c55e',
  excellent: '#34d399',
  good: '#cbd5e1',
  book: '#a88764',
  inaccuracy: '#eab308',
  mistake: '#f59e0b',
  miss: '#f59e0b',
  blunder: '#ef4444',
  forced: '#64748b',

  // Misc
  watermark: 'rgba(255,255,255,0.15)',
  scrimTop: 'rgba(0,0,0,0.4)',
  scrimBottom: 'rgba(0,0,0,0.7)',
} as const;

export type MoveQualityKey = keyof typeof SHARE_COLORS;

/** Get result color hex */
export function getResultColor(result: string): string {
  if (result === 'win') return SHARE_COLORS.win;
  if (result === 'loss') return SHARE_COLORS.loss;
  return SHARE_COLORS.draw;
}

/** Get move quality color hex */
export function getQualityColor(quality: string): string {
  return (SHARE_COLORS as Record<string, string>)[quality] ?? SHARE_COLORS.textTertiary;
}
