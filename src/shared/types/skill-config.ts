import type { GamePhase, MoveQuality } from './analysis';
import type { TacticalMotif } from './engine';
import type { BenchmarkRow } from '../../patterns/score-benchmarks';

/* ────────────────────────────────────────────────────────────
 *  Quality Bucket Scoring — fixed scores per move quality
 * ──────────────────────────────────────────────────────────── */

export interface QualityBucketScoring {
  /** Score (0-99) per quality category. null = exclude from average. */
  buckets: Partial<Record<MoveQuality, number | null>>;
}

/* ────────────────────────────────────────────────────────────
 *  Move Filter — defines which moves belong to a skill
 *  Each field is optional. Omitted = no filter on that axis.
 *  Multiple filters on a dimension use OR logic.
 * ──────────────────────────────────────────────────────────── */

export interface MoveFilter {
  /** Game phases to include */
  phases?: GamePhase[];
  /** Specific tactical motifs to match */
  tacticalMotifs?: TacticalMotif[];
  /** True = match any move where tacticalMotifs.length > 0 */
  hasTactics?: boolean;
  /** Player-perspective eval range (centipawns) */
  evalRange?: { min: number; max: number };
  /** Legal move count range (1 = forced, 30+ = complex) */
  complexityRange?: { min: number; max: number };
  /** Move characteristics to require */
  moveTypes?: ('capture' | 'check' | 'castling' | 'sacrifice')[];
  /** Skip positions with only 1 legal move */
  excludeForced?: boolean;
  /** Time spent range in seconds (requires clock data) */
  timeRange?: { min: number; max: number };
}

/* ────────────────────────────────────────────────────────────
 *  Dimension Config — a single skill dimension
 *  Score = average accuracy of moves matching the filters,
 *  optionally adjusted by opponent's actual game accuracy.
 * ──────────────────────────────────────────────────────────── */

export interface DimensionConfig {
  id: string;
  label: string;
  description: string;
  /** Weight for overall score (0-1, all weights should sum to ~1) */
  weight: number;
  /** Move filters — OR logic: a move matches if it passes ANY filter */
  filters: MoveFilter[];
  /** Scale score by opponent's actual accuracy (harder opponents = bonus) */
  opponentAdjust: boolean;
  /** Clamp final score to this range */
  clampMin: number;
  clampMax: number;
  /** Quality bucket scoring config. Falls back to DEFAULT_BUCKET_SCORES when omitted. */
  scoring?: QualityBucketScoring;
}

/* ────────────────────────────────────────────────────────────
 *  Full Skill Calculation Config
 * ──────────────────────────────────────────────────────────── */

export interface TierConfig {
  id: string;
  name: string;
  minScore: number;
  maxScore: number;
}

export interface SkillCalcConfigSchema {
  /** Baseline average accuracy (used as denominator for opponent adjustment) */
  baselineAccuracy: number; // default 50
  /** Skill dimensions */
  dimensions: DimensionConfig[];
  /** ELO anchor benchmarks (optional override) */
  benchmarks?: Record<number, BenchmarkRow>;
  /** Tier boundaries (optional override) */
  tiers?: TierConfig[];
}

/* ────────────────────────────────────────────────────────────
 *  Versioned config entity (stored in Base44)
 * ──────────────────────────────────────────────────────────── */

export type SkillCalcConfigStatus = 'draft' | 'published' | 'archived';

export interface SkillCalcConfigEntity {
  id: string;
  version: number;
  status: SkillCalcConfigStatus;
  authorEmail: string;
  label: string;
  config: SkillCalcConfigSchema;
  createdAt: number;
  publishedAt: number | null;
}

/* ────────────────────────────────────────────────────────────
 *  Sample player entity (for testing configs)
 * ──────────────────────────────────────────────────────────── */

export interface SamplePlayer {
  id: string;
  username: string;
  rating: number;
  label: string;
  addedBy: string;
  createdAt: number;
}
