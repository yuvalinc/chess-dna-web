import type { RankTier } from '@shared/types/patterns';

/* ────────────────────────────────────────────────────────────
 *  Chess-piece rank tier system
 *  Maps skill scores (0-99) to chess piece tiers with
 *  personality, colors, and fun descriptions
 * ──────────────────────────────────────────────────────────── */

export const ALL_TIERS: RankTier[] = [
  {
    id: 'pawn',
    name: 'Pawn',
    icon: '♟',
    color: '#64748b',
    glowColor: 'rgba(100,116,139,0.3)',
    lightColor: '#475569',
    lightGlowColor: 'rgba(71,85,105,0.3)',
    minScore: 0,
    maxScore: 29,
    description: 'Every grandmaster was once a pawn. Your journey begins!',
    funTitle: 'Humble Beginnings',
    emoji: '🌱',
  },
  {
    id: 'knight',
    name: 'Knight',
    icon: '♞',
    color: '#f59e0b',
    glowColor: 'rgba(245,158,11,0.3)',
    lightColor: '#b45309',
    lightGlowColor: 'rgba(180,83,9,0.3)',
    minScore: 30,
    maxScore: 44,
    description: 'Tricky and unpredictable — you\'re learning to jump over obstacles!',
    funTitle: 'The L-Shaped Wonder',
    emoji: '🐴',
  },
  {
    id: 'bishop',
    name: 'Bishop',
    icon: '♝',
    color: '#eab308',
    glowColor: 'rgba(234,179,8,0.3)',
    lightColor: '#a16207',
    lightGlowColor: 'rgba(161,98,7,0.3)',
    minScore: 45,
    maxScore: 59,
    description: 'You see the diagonals others miss. Solid and sharp!',
    funTitle: 'Diagonal Destroyer',
    emoji: '⚡',
  },
  {
    id: 'rook',
    name: 'Rook',
    icon: '♜',
    color: '#22d3ee',
    glowColor: 'rgba(34,211,238,0.3)',
    lightColor: '#0891b2',
    lightGlowColor: 'rgba(8,145,178,0.3)',
    minScore: 60,
    maxScore: 74,
    description: 'A powerhouse on open files. You dominate the board!',
    funTitle: 'Tower of Power',
    emoji: '🏰',
  },
  {
    id: 'queen',
    name: 'Queen',
    icon: '♛',
    color: '#34d399',
    glowColor: 'rgba(52,211,153,0.3)',
    lightColor: '#059669',
    lightGlowColor: 'rgba(5,150,105,0.3)',
    minScore: 75,
    maxScore: 89,
    description: 'The most powerful piece on the board — feared by all!',
    funTitle: 'Royal Menace',
    emoji: '👑',
  },
  {
    id: 'king',
    name: 'King',
    icon: '♚',
    color: '#4ade80',
    glowColor: 'rgba(74,222,128,0.4)',
    lightColor: '#15803d',
    lightGlowColor: 'rgba(21,128,61,0.4)',
    minScore: 90,
    maxScore: 99,
    description: 'Legendary. You\'ve mastered the art of chess!',
    funTitle: 'Chess Deity',
    emoji: '🔥',
  },
];

/**
 * Get theme-appropriate color from a tier.
 */
export function getTierColor(tier: RankTier, theme: 'dark' | 'light'): string {
  return theme === 'light' ? tier.lightColor : tier.color;
}

/**
 * Get theme-appropriate glow color from a tier.
 */
export function getTierGlowColor(tier: RankTier, theme: 'dark' | 'light'): string {
  return theme === 'light' ? tier.lightGlowColor : tier.glowColor;
}

/**
 * Get the rank tier for a given score (0-99).
 */
export function getTierForScore(score: number): RankTier {
  const clamped = Math.max(0, Math.min(99, Math.round(score)));
  for (const tier of ALL_TIERS) {
    if (clamped >= tier.minScore && clamped <= tier.maxScore) {
      return tier;
    }
  }
  return ALL_TIERS[0]; // fallback to Pawn
}

/**
 * Get progress within the current tier as a percentage (0-100).
 * Useful for progress rings and bars.
 */
export function getTierProgress(score: number): number {
  const tier = getTierForScore(score);
  const range = tier.maxScore - tier.minScore;
  if (range === 0) return 100;
  return Math.round(((score - tier.minScore) / range) * 100);
}

/**
 * Get the next tier up (or null if already at King).
 */
export function getNextTier(score: number): RankTier | null {
  const currentTier = getTierForScore(score);
  const idx = ALL_TIERS.findIndex((t) => t.id === currentTier.id);
  if (idx < ALL_TIERS.length - 1) {
    return ALL_TIERS[idx + 1];
  }
  return null;
}

/**
 * Points needed to reach the next tier.
 */
export function pointsToNextTier(score: number): number {
  const tier = getTierForScore(score);
  return Math.max(0, tier.maxScore + 1 - score);
}

/**
 * Get a fun "level up" message when reaching a new tier.
 */
export function getTierUpMessage(tier: RankTier): string {
  const messages: Record<string, string> = {
    pawn: 'Welcome, brave pawn! Every chess legend starts here. 🌱',
    knight: '🐴 RANK UP! You\'ve unlocked the Knight — prepare for some serious L-shaped chaos!',
    bishop: '⚡ RANK UP! Bishop tier! You\'re cutting through the board like a laser!',
    rook: '🏰 RANK UP! Rook tier! You\'re an absolute TOWER of chess power!',
    queen: '👑 RANK UP! QUEEN TIER! The board trembles in your presence!',
    king: '🔥 RANK UP! KING TIER!! You\'ve achieved chess LEGEND status! 🎉🎉🎉',
  };
  return messages[tier.id] ?? 'Rank up!';
}

/**
 * Get a playful description of how close to next tier.
 */
export function getProgressQuip(score: number): string {
  const next = getNextTier(score);
  if (!next) return 'You\'re at the top. Bow down, mortals! 🔥';

  const pts = pointsToNextTier(score);
  if (pts <= 3) return `SO CLOSE to ${next.name}! Just ${pts} more point${pts === 1 ? '' : 's'}! 😤`;
  if (pts <= 8) return `${pts} points to ${next.name} — you can taste it! 🎯`;
  if (pts <= 15) return `${pts} points to ${next.name} — keep grinding! 💪`;
  return `${pts} points to ${next.name} — the journey continues! 🚀`;
}
