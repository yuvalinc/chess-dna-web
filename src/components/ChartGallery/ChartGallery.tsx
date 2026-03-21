import { useState, useMemo, useCallback, useEffect } from 'react';
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { SkillProfile } from '@shared/types/patterns';
import SkillRadar from '../SkillRadar';
import TrainingImpactChart, { getTrainingImpactCorrelation } from './TrainingImpactChart';
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
  subtitle: string | (() => React.ReactNode);
}

const TOTAL_CHARTS = 4;

export default function ChartGallery({
  games,
  analyses,
  profile,
  radarBenchmarks,
  onDimensionClick,
  onChartChange,
}: ChartGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);

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

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prev, next]);

  // Correlation info for chart 1 subtitle
  const correlation = useMemo(
    () => getTrainingImpactCorrelation(games, analyses),
    [games, analyses],
  );

  const charts: ChartDef[] = useMemo(
    () => [
      {
        title: 'Skill Radar',
        subtitle: 'Your 8-dimension skill profile',
      },
      {
        title: 'Training Impact',
        subtitle: '', // dynamic — rendered below
      },
      {
        title: 'Phase Accuracy',
        subtitle: 'Opening vs middlegame vs endgame trends',
      },
      {
        title: 'Skill Progression',
        subtitle: 'How your skills are evolving',
      },
    ],
    [],
  );

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
          {activeIndex === 1 ? (
            <div className="text-[10px] text-gray-500 truncate">
              Does better play = higher rating?{' '}
              <span className="font-semibold" style={{ color: correlation.color }}>
                {correlation.label}
              </span>
            </div>
          ) : (
            <div className="text-[10px] text-gray-500 truncate">
              {typeof current.subtitle === 'string' ? current.subtitle : null}
            </div>
          )}
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

      {/* Chart area — fixed min-height matches radar to prevent UI jumps */}
      <div className="relative min-h-[296px] flex items-center justify-center">
        {/* Chart 0: Skill Radar */}
        {activeIndex === 0 && (
          <div className="flex justify-center">
            <div className="rounded-2xl p-2 shrink-0">
              <div className="block sm:hidden">
                <SkillRadar
                  profile={profile}
                  size={280}
                  compact
                  onDimensionClick={onDimensionClick}
                  benchmarks={radarBenchmarks}
                />
              </div>
              <div className="hidden sm:block">
                <SkillRadar
                  profile={profile}
                  size={340}
                  onDimensionClick={onDimensionClick}
                  benchmarks={radarBenchmarks}
                />
              </div>
            </div>
          </div>
        )}

        {/* Chart 1: Training Impact */}
        {activeIndex === 1 && (
          <div className="h-[220px] w-full">
            <TrainingImpactChart games={games} analyses={analyses} />
          </div>
        )}

        {/* Chart 2: Phase Accuracy Over Time */}
        {activeIndex === 2 && (
          <div className="h-[220px] w-full">
            <PhaseAccuracyOverTimeChart games={games} analyses={analyses} />
          </div>
        )}

        {/* Chart 3: Dimension Over Time */}
        {activeIndex === 3 && (
          <div className="h-[220px] w-full">
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
