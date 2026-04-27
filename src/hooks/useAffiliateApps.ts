import { useMemo } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import type { AffiliateApp } from '@shared/types/affiliate';
import type { SkillDimensionId } from '@shared/types/patterns';
import { WeaknessTheme } from '@shared/types/patterns';

export interface RankedApp extends AffiliateApp {
  matchScore: number;
}

export function useAffiliateApps() {
  const [apps, loading] = useEntityList<AffiliateApp>('AffiliateApp');

  const activeApps = useMemo(
    () => apps.filter((a) => a.active).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
    [apps],
  );

  return { apps: activeApps, loading };
}

/**
 * Rank apps by how well they match a specific dimension and/or theme.
 * Returns sorted list with match scores (0-100).
 */
export function rankAppsForContext(
  apps: AffiliateApp[],
  dimensionId?: SkillDimensionId,
  theme?: WeaknessTheme,
): RankedApp[] {
  return apps
    .map((app) => {
      let score = 0;

      // Dimension match
      if (dimensionId && app.dimensions?.includes(dimensionId)) {
        score += 50;
      }

      // Theme match
      if (theme && app.themes?.includes(theme)) {
        score += 40;
      }

      // Bonus for having any dimensions/themes overlap
      if (app.dimensions?.length > 0) score += 5;
      if (app.themes?.length > 0) score += 5;

      return { ...app, matchScore: Math.min(score, 100) };
    })
    .sort((a, b) => b.matchScore - a.matchScore || (a.priority ?? 0) - (b.priority ?? 0));
}
