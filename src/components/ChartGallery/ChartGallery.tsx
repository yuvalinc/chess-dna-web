/* ChartGallery — only the Skill Radar.
 *
 * Earlier versions carouseled three charts (radar / phase accuracy over time
 * / dimension over time). The over-time charts have been removed; this
 * component now just renders the radar with its title/subtitle and the
 * responsive sizing that callers depended on.
 */
import { useEffect } from 'react';
import { useT } from '@/i18n/index';
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { SkillProfile } from '@shared/types/patterns';
import SkillRadar, { type RadarOverlay } from '../SkillRadar';

interface ChartGalleryProps {
  games: GameRecord[];
  analyses: GameAnalysis[];
  profile: SkillProfile;
  radarBenchmarks?: Record<string, number>;
  onDimensionClick?: (dimensionId: string, event?: React.MouseEvent) => void;
  onChartChange?: (index: number) => void;
  overlays?: RadarOverlay[];
  primaryLabel?: string;
  primaryColor?: string;
  primaryVisible?: boolean;
  visibleOverlayIds?: Set<string>;
  showLegend?: boolean;
}

export default function ChartGallery({
  games: _games,
  analyses: _analyses,
  profile,
  radarBenchmarks,
  onDimensionClick,
  onChartChange,
  overlays,
  primaryLabel,
  primaryColor,
  primaryVisible,
  visibleOverlayIds,
  showLegend,
}: ChartGalleryProps) {
  void _games;
  void _analyses;
  const { t } = useT();

  // Some callers track the active chart index for tutorial/analytics. With a
  // single chart we always emit 0 so consumers don't break.
  useEffect(() => {
    onChartChange?.(0);
  }, [onChartChange]);

  return (
    <div className="space-y-2">
      <div className="text-center px-1">
        <div className="text-sm font-bold text-chess-text truncate">{t('overview_skill_radar')}</div>
        <div className="text-[10px] text-gray-500 truncate">{t('overview_skill_radar_sub')}</div>
      </div>

      <div className="relative w-full flex flex-col items-center justify-center">
        <div className="w-full">
          <SkillRadar
            profile={profile}
            onDimensionClick={onDimensionClick}
            benchmarks={radarBenchmarks}
            overlays={overlays}
            primaryLabel={primaryLabel}
            primaryColor={primaryColor}
            primaryVisible={primaryVisible}
            visibleOverlayIds={visibleOverlayIds}
            showLegend={showLegend}
          />
        </div>
      </div>
    </div>
  );
}
