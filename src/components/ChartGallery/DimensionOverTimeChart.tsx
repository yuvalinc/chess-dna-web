import { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { SkillProfile } from '@shared/types/patterns';
import { getWeakestDimensions, getStrongestDimensions } from '@/patterns/skill-calculator';
import {
  CHART_COLORS,
  AXIS_TICK,
  formatDate,
  buildDimensionOverTimeData,
  MIN_GAMES_FOR_CHARTS,
} from './chartUtils';

/* ── Dimension colors ── */
const DIM_COLORS: Record<string, string> = {
  openings: '#4ade80',
  tactics: '#f59e0b',
  defense: '#e74c3c',
  positional: '#a855f7',
  endgame: '#3b82f6',
  calculation: '#38bdf8',
  time_management: '#fb923c',
  resilience: '#f472b6',
};

interface DimensionOverTimeChartProps {
  games: GameRecord[];
  analyses: GameAnalysis[];
  profile: SkillProfile;
}

export default function DimensionOverTimeChart({
  games,
  analyses,
  profile,
}: DimensionOverTimeChartProps) {
  // Pick 2 strongest + 2 weakest for the chart
  const selectedDims = useMemo(() => {
    const strong = getStrongestDimensions(profile, 2);
    const weak = getWeakestDimensions(profile, 2);
    // Deduplicate in case of overlap
    const ids = new Set<string>();
    const result: Array<{ id: string; label: string }> = [];
    for (const d of [...strong, ...weak]) {
      if (!ids.has(d.id)) {
        ids.add(d.id);
        result.push({ id: d.id, label: d.label });
      }
    }
    // If we have fewer than 4, add more from profile
    for (const d of profile.dimensions) {
      if (result.length >= 4) break;
      if (!ids.has(d.id)) {
        ids.add(d.id);
        result.push({ id: d.id, label: d.label });
      }
    }
    return result;
  }, [profile]);

  const selectedIds = useMemo(() => selectedDims.map((d) => d.id), [selectedDims]);

  const data = useMemo(
    () => buildDimensionOverTimeData(games, analyses, selectedIds),
    [games, analyses, selectedIds],
  );

  // Auto-fit Y domain to data amplitude with padding
  const yDomain = useMemo(() => {
    if (data.length === 0) return [10, 99] as [number, number];
    const allVals = data.flatMap((d) => selectedIds.map((id) => (d[id] as number) ?? 50));
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const pad = Math.max(5, Math.round((max - min) * 0.15));
    return [Math.max(0, Math.floor((min - pad) / 5) * 5), Math.min(99, Math.ceil((max + pad) / 5) * 5)] as [number, number];
  }, [data, selectedIds]);

  if (data.length < MIN_GAMES_FOR_CHARTS) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Play {MIN_GAMES_FOR_CHARTS}+ games to see this chart
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Legend */}
      <div className="flex justify-center gap-3 mb-1">
        {selectedDims.map((dim) => (
          <div key={dim.id} className="flex items-center gap-1">
            <div
              className="w-2 h-[3px] rounded-sm"
              style={{ background: DIM_COLORS[dim.id] ?? '#94a3b8' }}
            />
            <span className="text-[10px] text-gray-400">{dim.label}</span>
          </div>
        ))}
      </div>

      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={AXIS_TICK}
              stroke={CHART_COLORS.axis}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={yDomain}
              tick={AXIS_TICK}
              stroke={CHART_COLORS.axis}
              width={30}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                background: CHART_COLORS.tooltipBg,
                border: `1px solid ${CHART_COLORS.tooltipBorder}`,
                borderRadius: 8,
                fontSize: 11,
              }}
              labelFormatter={(val) => formatDate(val as number)}
            />
            {selectedDims.map((dim) => (
              <Line
                key={dim.id}
                type="monotone"
                dataKey={dim.id}
                name={dim.label}
                stroke={DIM_COLORS[dim.id] ?? '#94a3b8'}
                strokeWidth={2}
                dot={{ r: 2, fill: DIM_COLORS[dim.id] ?? '#94a3b8' }}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
