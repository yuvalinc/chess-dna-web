import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useT } from '@/i18n/index';
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { SkillProfile } from '@shared/types/patterns';
import SkillRadar from '../SkillRadar';
import PhaseAccuracyOverTimeChart from './PhaseAccuracyOverTimeChart';
import DimensionOverTimeChart from './DimensionOverTimeChart';

interface ChartGalleryProps {
  games: GameRecord[];
  analyses: GameAnalysis[];
  profile: SkillProfile;
  radarBenchmarks?: Record<string, number>;
  onDimensionClick?: (dimensionId: string) => void;
  onChartChange?: (index: number) => void;
}

interface ChartDef {
  title: string;
  subtitle: string;
}

export default function ChartGallery({
  games,
  analyses,
  profile,
  radarBenchmarks,
  onDimensionClick,
  onChartChange,
}: ChartGalleryProps) {
  const { t } = useT();
  const [activeIndex, setActiveIndex] = useState(0);

  // Three charts only — patterns moved out of the gallery (it's surfaced
  // elsewhere as a dedicated panel, and the embedded list crowded the
  // "swipe through your stats" mental model).
  const TOTAL_CHARTS = 3;

  const goTo = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(TOTAL_CHARTS - 1, idx));
      setActiveIndex(clamped);
      onChartChange?.(clamped);
    },
    [onChartChange],
  );

  const prev = useCallback(() => goTo(activeIndex - 1), [goTo, activeIndex]);
  const next = useCallback(() => goTo(activeIndex + 1), [goTo, activeIndex]);

  // Keyboard navigation (desktop)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prev, next]);

  // Touch-swipe navigation (mobile). A horizontal drag of >50px (and more
  // horizontal than vertical so we don't hijack page scroll) advances or
  // retreats one chart. The chart container is the swipe surface — small
  // areas like the dot indicators and arrow buttons keep their own taps.
  const touchRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const tch = e.touches[0];
    if (!tch) return;
    touchRef.current = { x: tch.clientX, y: tch.clientY, t: Date.now() };
  }, []);
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const tch = e.changedTouches[0];
    if (!tch) return;
    const dx = tch.clientX - start.x;
    const dy = tch.clientY - start.y;
    const elapsed = Date.now() - start.t;
    // Require a deliberate swipe: horizontal-dominant, > 50px, < 800ms.
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) || elapsed > 800) return;
    if (dx < 0) next();
    else prev();
  }, [next, prev]);

  const charts: ChartDef[] = useMemo(() => [
    {
      title: t('overview_skill_radar'),
      subtitle: t('overview_skill_radar_sub'),
    },
    {
      title: t('chart_phase_accuracy'),
      subtitle: t('chart_phase_accuracy_sub'),
    },
    {
      title: t('chart_skill_progression'),
      subtitle: t('chart_skill_progression_sub'),
    },
  ], [t]);

  const current = charts[activeIndex];

  return (
    <div className="space-y-2">
      {/* Header: arrows + title + counter */}
      <div className="flex items-center justify-between px-1">
        <button
          onClick={prev}
          disabled={activeIndex === 0}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-chess-text hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
          aria-label="Previous chart"
        >
          <span className="text-sm font-bold">&lsaquo;</span>
        </button>

        <div className="text-center flex-1 min-w-0">
          <div className="text-sm font-bold text-chess-text truncate">{current.title}</div>
          <div className="text-[10px] text-gray-500 truncate">{current.subtitle}</div>
        </div>

        <button
          onClick={next}
          disabled={activeIndex === TOTAL_CHARTS - 1}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-chess-text hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
          aria-label="Next chart"
        >
          <span className="text-sm font-bold">&rsaquo;</span>
        </button>
      </div>

      {/* Chart area — fixed min-height matches radar to prevent UI jumps.
          Swipe surface: horizontal touches advance/retreat the slide. */}
      <div
        className="relative min-h-[296px] md:min-h-[460px] flex items-center justify-center touch-pan-y select-none"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Chart 0: Skill Radar */}
        {activeIndex === 0 && (
          <div className="flex justify-center">
            <div className="rounded-2xl p-2 shrink-0">
              <div className="block md:hidden">
                <SkillRadar
                  profile={profile}
                  size={280}
                  compact
                  onDimensionClick={onDimensionClick}
                  benchmarks={radarBenchmarks}
                />
              </div>
              <div className="hidden md:block">
                <SkillRadar
                  profile={profile}
                  size={440}
                  onDimensionClick={onDimensionClick}
                  benchmarks={radarBenchmarks}
                />
              </div>
            </div>
          </div>
        )}

        {/* Chart 1: Phase Accuracy Over Time */}
        {activeIndex === 1 && (
          <div className="h-[220px] md:h-[380px] w-full">
            <PhaseAccuracyOverTimeChart games={games} analyses={analyses} />
          </div>
        )}

        {/* Chart 2: Dimension Over Time */}
        {activeIndex === 2 && (
          <div className="h-[220px] md:h-[380px] w-full">
            <DimensionOverTimeChart games={games} analyses={analyses} profile={profile} />
          </div>
        )}
      </div>

      {/* Dot indicators */}
      <div className="flex items-center justify-center gap-1.5">
        {Array.from({ length: TOTAL_CHARTS }).map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className={`rounded-full transition-all duration-300 ${
              i === activeIndex
                ? 'w-5 h-1.5 bg-chess-accent'
                : 'w-1.5 h-1.5 bg-gray-600 hover:bg-gray-400'
            }`}
            aria-label={`Go to chart ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
