import type { GamePhase } from './analysis';

export enum WeaknessTheme {
  // Tactical
  MISSED_FORK = 'missed_fork',
  MISSED_PIN = 'missed_pin',
  MISSED_SKEWER = 'missed_skewer',
  HANGING_PIECE = 'hanging_piece',
  BACK_RANK_WEAKNESS = 'back_rank_weakness',
  MISSED_TACTIC_OTHER = 'missed_tactic_other',

  // Positional
  PAWN_STRUCTURE = 'pawn_structure',
  PIECE_ACTIVITY = 'piece_activity',
  KING_SAFETY = 'king_safety',
  SPACE_CONTROL = 'space_control',

  // Phase-specific
  OPENING_INACCURACY = 'opening_inaccuracy',
  OPENING_SPECIFIC = 'opening_specific',
  MIDDLEGAME_TACTICS = 'middlegame_tactics',
  ENDGAME_TECHNIQUE = 'endgame_technique',
  ENDGAME_PAWN_PLAY = 'endgame_pawn_play',

  // Time-related
  TIME_PRESSURE_BLUNDER = 'time_pressure_blunder',
}

export interface PatternExample {
  gameId: string;
  moveIndex: number;
  fen: string;
  movePlayed: string;
  bestMove: string;
  cpLoss: number;
}

export interface WeaknessPattern {
  id: string;
  theme: WeaknessTheme;
  subTheme?: string;
  phase?: GamePhase;
  frequency: number;
  severity: number;
  occurrences: number;
  gamesAffected: number;
  trend: 'improving' | 'worsening' | 'stable';
  trendPercent: number;
  examplePositions: PatternExample[];
  firstSeen: number;
  lastSeen: number;
}

export interface PatternSnapshot {
  gameId: string;
  timestamp: number;
  themes: Array<{
    theme: WeaknessTheme;
    count: number;
    totalCpLoss: number;
  }>;
}

export interface CurrentPatterns {
  patterns: WeaknessPattern[];
  lastUpdated: number;
  gamesInWindow: number;
}

/* -- Opening Traps -- */

export interface TrapDefinition {
  id: string;
  name: string;
  /** Which side sets/initiates the trap. */
  setterSide: 'white' | 'black';
  /** ECO codes commonly associated with this trap (informational; not used for matching). */
  ecoCodes: string[];
  /** Move sequences that identify this trap. Each variant is an array of SAN
   *  moves starting from move 1. The detector matches a game if any variant
   *  is a prefix of the game's move list. */
  signatures: string[][];
  /** Short, user-facing description shown when the trap row is expanded. */
  description: string;
}

export interface TrapOccurrence {
  gameId: string;
  playedAt: number;
  /** 'win' | 'loss' | 'draw' — from the player's perspective. */
  result: 'win' | 'loss' | 'draw';
  /** True if the player set the trap; false if the player was on the receiving side. */
  playerWasSetter: boolean;
}

export interface TrapStat {
  trapId: string;
  trapName: string;
  /** 'used' = player set the trap; 'fellInto' = opponent set it on player. */
  side: 'used' | 'fellInto';
  occurrences: TrapOccurrence[];
  count: number;
  /** Wins / draws / losses from the player's perspective. */
  wins: number;
  draws: number;
  losses: number;
  lastSeen: number;
  /** 'Frequent' | 'Occasional' | 'Rare' — bucketed by absolute count. */
  frequencyBucket: 'frequent' | 'occasional' | 'rare';
}

export interface TrapStats {
  used: TrapStat[];
  fellInto: TrapStat[];
  /** Number of games scanned to produce these stats. */
  gamesScanned: number;
}

/* -- Skill Radar (FIFA-style) -- */

export type SkillDimensionId =
  | 'openings'
  | 'tactics'
  | 'defense'
  | 'positional'
  | 'endgame'
  | 'calculation'
  | 'time_management'
  | 'resilience';

export interface SkillDimension {
  id: SkillDimensionId;
  label: string;
  score: number; // 0-99
  trend: 'improving' | 'worsening' | 'stable';
  relatedThemes: WeaknessTheme[];
  description: string;
}

export interface SkillProfile {
  dimensions: SkillDimension[];
  overallRating: number; // 0-99 weighted average
  calculatedAt: number;
  gamesUsed: number;
}

/* -- Rank Tier (chess-piece gamification) -- */

export interface RankTier {
  id: string;
  name: string;
  icon: string;
  color: string;
  glowColor: string;
  lightColor: string;
  lightGlowColor: string;
  minScore: number;
  maxScore: number;
  description: string;
  funTitle: string;
  emoji: string;
}
