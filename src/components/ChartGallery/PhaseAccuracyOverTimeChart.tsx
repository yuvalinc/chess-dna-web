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
import { useT } from '@/i18n/index';
import {
  CHART_COLORS,
  AXIS_TICK,
  formatDate,
  buildPhaseAccuracyData,
  MIN_GAMES_FOR_CHARTS,
} from './chartUtils';

interface PhaseAccuracyOverTimeChartProps {
  games: GameRecord[];
  analyses: GameAnalysis[];
}

export default function PhaseAccuracyOverTimeChart({
  games,
  analyses,
}: PhaseAccuracyOverTimeChartProps) {
  const { t } = useT();
  const data = useMemo(() => buildPhaseAccuracyData(games, analyses), [games, analyses]);

  // Auto-fit Y domain to data amplitude with padding
  const yDomain = useMemo(() => {
    if (data.length === 0) return [0, 100] as [number, number];
    const allVals = data.flatMap((d) => [d.opening, d.middlegame, d.endgame]);
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const pad = Math.max(5, Math.round((max - min) * 0.15));
    return [Math.max(0, Math.floor((min - pad) / 5) * 5), Math.min(100, Math.ceil((max + pad) / 5) * 5)] as [number, number];
  }, [data]);

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
        <LegendItem color={CHART_COLORS.openingBlue} label={t('phase_opening')} />
        <LegendItem color={CHART_COLORS.accent} label={t('phase_middlegame')} />
        <LegendItem color={CHART_COLORS.endgamePurple} label={t('phase_endgame')} />
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
              formatter={(value: number, name: string) => {
                const phaseKey = `phase_${name}` as Parameters<typeof t>[0];
                return [`${value}%`, t(phaseKey)];
              }}
            />
            <Line
              type="monotone"
              dataKey="opening"
              stroke={CHART_COLORS.openingBlue}
              strokeWidth={2}
              dot={{ r: 2.5, fill: CHART_COLORS.openingBlue }}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="middlegame"
              stroke={CHART_COLORS.accent}
              strokeWidth={2}
              dot={{ r: 2.5, fill: CHART_COLORS.accent }}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="endgame"
              stroke={CHART_COLORS.endgamePurple}
              strokeWidth={2}
              dot={{ r: 2.5, fill: CHART_COLORS.endgamePurple }}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-2 h-[3px] rounded-sm" style={{ background: color }} />
      <span className="text-[10px] text-gray-400">{label}</span>
    </div>
  );
}
