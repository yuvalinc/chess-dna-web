import type { SkillCalcConfigSchema, SkillCalcConfigEntity } from '@shared/types/skill-config';
import { base44 } from '../api/base44Client';

/* ────────────────────────────────────────────────────────────
 *  Default config — filter-based skill dimensions.
 *  Each dimension = "average accuracy on moves matching filters"
 * ──────────────────────────────────────────────────────────── */

export function getDefaultConfig(): SkillCalcConfigSchema {
  return {
    baselineAccuracy: 50,
    dimensions: [
      {
        id: 'openings',
        label: 'Openings',
        description: 'How accurately you handle opening positions — following principles and developing pieces.',
        weight: 0.12,
        filters: [{ phases: ['opening'], excludeForced: true }],
        opponentAdjust: true,
        clampMin: 0,
        clampMax: 99,
      },
      {
        id: 'tactics',
        label: 'Tactics',
        description: 'Your accuracy when tactical opportunities or threats exist — forks, pins, skewers, and combinations.',
        weight: 0.18,
        filters: [{ hasTactics: true, excludeForced: true }],
        opponentAdjust: true,
        clampMin: 0,
        clampMax: 99,
      },
      {
        id: 'defense',
        label: 'Defense',
        description: 'How well you defend when the position is worse — finding the best resources under pressure.',
        weight: 0.15,
        filters: [{ evalRange: { min: -10000, max: -50 }, excludeForced: true }],
        opponentAdjust: true,
        clampMin: 0,
        clampMax: 99,
      },
      {
        id: 'positional',
        label: 'Positional',
        description: 'Your accuracy in quiet middlegame positions without tactical fireworks.',
        weight: 0.13,
        filters: [{ phases: ['middlegame'], hasTactics: false, excludeForced: true }],
        opponentAdjust: true,
        clampMin: 0,
        clampMax: 99,
      },
      {
        id: 'endgame',
        label: 'Endgame',
        description: 'Your technique in endgames — king activity, pawn promotion, and converting advantages.',
        weight: 0.13,
        filters: [{ phases: ['endgame'], excludeForced: true }],
        opponentAdjust: true,
        clampMin: 0,
        clampMax: 99,
      },
      {
        id: 'calculation',
        label: 'Calculation',
        description: 'Your accuracy in complex positions with many candidate moves to consider.',
        weight: 0.15,
        filters: [{
          complexityRange: { min: 8, max: 999 },
          evalRange: { min: -500, max: 500 },
          excludeForced: true,
        }],
        opponentAdjust: true,
        clampMin: 0,
        clampMax: 99,
      },
      {
        id: 'time_management',
        label: 'Time Management',
        description: 'Your accuracy on moves made quickly — how well you perform under time pressure.',
        weight: 0.10,
        // Filter: moves where timeSpent is very low (fast/rushed moves)
        // This will only match moves that have clock data; others are skipped
        filters: [{ timeRange: { min: 0, max: 5 }, excludeForced: true }],
        opponentAdjust: false,
        clampMin: 0,
        clampMax: 99,
      },
      {
        id: 'resilience',
        label: 'Resilience',
        description: 'How well you fight back from losing positions — maintaining composure when behind.',
        weight: 0.07,
        filters: [{ evalRange: { min: -10000, max: -150 }, excludeForced: true }],
        opponentAdjust: true,
        clampMin: 0,
        clampMax: 99,
      },
    ],
  };
}

/* ────────────────────────────────────────────────────────────
 *  Published config loader — fetches from Base44 with cache
 * ──────────────────────────────────────────────────────────── */

let _cachedPublishedConfig: SkillCalcConfigSchema | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getPublishedConfig(): Promise<SkillCalcConfigSchema> {
  if (_cachedPublishedConfig && Date.now() - _cacheTimestamp < CACHE_TTL_MS) {
    return _cachedPublishedConfig;
  }

  try {
    const entity = (base44.entities as Record<string, any>)['SkillCalcConfig'];
    const results = await entity.filter({ status: 'published' });

    if (Array.isArray(results) && results.length > 0) {
      const raw = results[0];
      const config: SkillCalcConfigSchema =
        typeof raw.config === 'string' ? JSON.parse(raw.config) : raw.config;

      _cachedPublishedConfig = config;
      _cacheTimestamp = Date.now();
      console.log('[Chess DNA] Loaded published skill config v' + raw.version);
      return config;
    }
  } catch (err) {
    console.warn('[Chess DNA] Failed to load published skill config, using default:', err);
  }

  return getDefaultConfig();
}

export function invalidateConfigCache(): void {
  _cachedPublishedConfig = null;
  _cacheTimestamp = 0;
}

export async function getAllConfigs(): Promise<SkillCalcConfigEntity[]> {
  try {
    const entity = (base44.entities as Record<string, any>)['SkillCalcConfig'];
    const results = await entity.list();
    if (!Array.isArray(results)) return [];

    return results.map((raw: any) => ({
      ...raw,
      config: typeof raw.config === 'string' ? JSON.parse(raw.config) : raw.config,
    }));
  } catch (err) {
    console.error('[Chess DNA] Failed to list skill configs:', err);
    return [];
  }
}
