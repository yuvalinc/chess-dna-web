import { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import {
  CHART_COLORS,
  AXIS_TICK,
  formatDate,
  buildTrainingImpactData,
  computeCorrelation,
  getCorrelationInfo,
  MIN_GAMES_FOR_CHARTS,
  type CorrelationInfo,
} from './chartUtils';

interface TrainingImpactChartProps {
  games: GameRecord[];
  analyses: GameAnalysis[];
}

export default function TrainingImpactChart({ games, analyses }: TrainingImpactChartProps) {
  const data = useMemo(() => buildTrainingImpactData(games, analyses), [games, analyses]);

  if (data.length < MIN_GAMES_FOR_CHARTS) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Play {MIN_GAMES_FOR_CHARTS}+ games to see this chart
      </div>
    );
  }

  const eloMin = Math.min(...data.map((d) => d.elo)) - 30;
  const eloMax = Math.max(...data.map((d) => d.elo)) + 30;

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
      <ComposedChart data={data} margin={{ top: 8, right: 35, bottom: 4, left: 0 }}>
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={AXIS_TICK}
          stroke={CHART_COLORS.axis}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="elo"
          orientation="left"
          domain={[eloMin, eloMax]}
          tick={{ ...AXIS_TICK, fill: CHART_COLORS.accent }}
          stroke={CHART_COLORS.axis}
          width={42}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="acc"
          orientation="right"
          domain={[0, 100]}
          tick={{ ...AXIS_TICK, fill: CHART_COLORS.blue }}
          stroke={CHART_COLORS.axis}
          width={32}
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
          formatter={(value: number, name: string) => {
            if (name === 'elo') return [`${value}`, 'ELO'];
            return [`${value}%`, 'Accuracy'];
          }}
        />
        <Area
          yAxisId="acc"
          type="monotone"
          dataKey="rollingAvg"
          stroke={CHART_COLORS.blue}
          fill={CHART_COLORS.blueBg}
          strokeWidth={1.5}
          name="rollingAvg"
          dot={false}
        />
        <Line
          yAxisId="elo"
          type="monotone"
          dataKey="elo"
          stroke={CHART_COLORS.accent}
          strokeWidth={2.5}
          name="elo"
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Compute correlation info for this chart's data (used by gallery for subtitle) */
export function getTrainingImpactCorrelation(
  games: GameRecord[],
  analyses: GameAnalysis[],
): CorrelationInfo {
  const data = buildTrainingImpactData(games, analyses);
  if (data.length < 3) return { r: 0, label: 'Weak →', color: '#94a3b8' };
  const r = computeCorrelation(
    data.map((d) => d.elo),
    data.map((d) => d.rollingAvg),
  );
  return getCorrelationInfo(r);
}
