import { useState, useEffect, useId, useMemo } from 'react';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { SkillProfile } from '@shared/types/patterns';
import { getTierForScore, getTierColor, getTierGlowColor } from '@/patterns/rank-tiers';
import { useTheme } from './ThemeContext';

interface SkillRadarProps {
  profile: SkillProfile;
  size?: number;
  onDimensionClick?: (dimensionId: string) => void;
  benchmarks?: Record<string, number>;
  benchmarkLabel?: string;
  animated?: boolean;
  sequentialReveal?: boolean;
  onRevealComplete?: () => void;
  compact?: boolean;
}

export default function SkillRadar({
  profile,
  size = 380,
  onDimensionClick,
  benchmarks,
  benchmarkLabel,
  animated = true,
  sequentialReveal = false,
  onRevealComplete,
  compact = false,
}: SkillRadarProps) {
  const uid = useId().replace(/:/g, '_');
  const { theme } = useTheme();
  const [animProgress, setAnimProgress] = useState(animated ? 0 : 1);
  const [revealedCount, setRevealedCount] = useState(sequentialReveal ? 0 : profile.dimensions.length);

  // Sequential reveal timer
  useEffect(() => {
    if (!sequentialReveal) {
      setRevealedCount(profile.dimensions.length);
      return;
    }
    setRevealedCount(0);
    const total = profile.dimensions.length;
    let count = 0;
    const interval = setInterval(() => {
      count++;
      setRevealedCount(count);
      if (count >= total) {
        clearInterval(interval);
        setTimeout(() => onRevealComplete?.(), 800);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [sequentialReveal, profile.dimensions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Animate only when the overall rating actually changes, not on every profile object change
  const ratingKey = profile.overallRating;
  useEffect(() => {
    if (!animated) { setAnimProgress(1); return; }
    setAnimProgress(0);
    const start = performance.now();
    const duration = 900;
    let raf: number;

    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimProgress(eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animated, ratingKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const tier = useMemo(() => getTierForScore(profile.overallRating), [profile.overallRating]);
  const tierColor = useMemo(() => getTierColor(tier, theme), [tier, theme]);

  const data = useMemo(() => profile.dimensions.map((dim, idx) => {
    const isRevealed = idx < revealedCount;
    const dimTier = getTierForScore(dim.score);
    return {
      dimension: dim.label,
      score: isRevealed ? Math.round(dim.score * animProgress) : 0,
      actualScore: isRevealed ? dim.score : 0,
      fullMark: 99,
      id: dim.id,
      benchmark: benchmarks?.[dim.id] ?? undefined,
      revealed: isRevealed,
      tierColor: getTierColor(dimTier, theme),
      tierGlowColor: getTierGlowColor(dimTier, theme),
    };
  }), [profile.dimensions, revealedCount, animProgress, theme, benchmarks]);

  const gradientId = `radarGrad_${uid}`;

  return (
    <div className="relative" style={{ width: size, height: size, maxWidth: '100%', maxHeight: '100vw' }}>
      {/* SVG defs for gradient */}
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <defs>
          <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={tierColor} stopOpacity={0.4} />
            <stop offset="70%" stopColor={tierColor} stopOpacity={0.1} />
            <stop offset="100%" stopColor={tierColor} stopOpacity={0.02} />
          </radialGradient>
        </defs>
      </svg>

      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <RadarChart cx="50%" cy="50%" outerRadius={compact ? '48%' : '42%'} data={data}>
          {/* Grid — subtle, no polygon, just rings */}
          <PolarGrid
            stroke="var(--chess-grid-stroke)"
            strokeDasharray="2 4"
            strokeOpacity={0.3}
            gridType="circle"
          />

          {/* Axis labels */}
          <PolarAngleAxis
            dataKey="dimension"
            tick={(props: PolarAngleAxisTickProps) => (
              <DimensionLabel
                {...props}
                data={data}
                onDimensionClick={onDimensionClick}
                compact={compact}
              />
            )}
          />

          {/* Scale — hidden ticks, grid circles handled by PolarGrid */}
          <PolarRadiusAxis angle={90} domain={[0, 99]} tick={false} axisLine={false} />

          {/* Benchmark overlay (friend comparison) */}
          {benchmarks && (
            <Radar
              name="Benchmark"
              dataKey="benchmark"
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              fill="#94a3b8"
              fillOpacity={0.08}
              dot={{ r: 2.5, fill: '#94a3b8', stroke: 'none' }}
              isAnimationActive={false}
            />
          )}

          {/* Main radar area */}
          <Radar
            name="Skills"
            dataKey="score"
            stroke={tierColor}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            fillOpacity={0.8}
            dot={(props: RadarDotProps) => {
              const { cx, cy, payload } = props;
              if (!payload.revealed) return <circle key={payload.id} cx={cx} cy={cy} r={0} />;
              return (
                <g key={payload.id}>
                  <circle cx={cx} cy={cy} r={6} fill={payload.tierColor} opacity={0.15} />
                  <circle
                    cx={cx} cy={cy} r={3.5}
                    fill={payload.tierColor}
                    stroke="rgb(var(--chess-surface))" strokeWidth={1.5}
                    style={{
                      filter: `drop-shadow(0 0 3px ${payload.tierGlowColor})`,
                      cursor: onDimensionClick ? 'pointer' : 'default',
                    }}
                    onClick={() => onDimensionClick?.(payload.id)}
                  />
                </g>
              );
            }}
            isAnimationActive={false}
          />

          {/* Tooltip */}
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload;
              if (!d.revealed) return null;
              return (
                <div className="bg-chess-bg border border-chess-border/60 rounded-xl px-4 py-3 shadow-2xl min-w-[170px]">
                  <div className="flex items-center gap-2 mb-1">
                    <span style={{ color: d.tierColor, fontSize: 16 }}>{getTierForScore(d.actualScore).icon}</span>
                    <span className="font-bold text-chess-text text-sm">{d.dimension}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black" style={{ color: d.tierColor }}>
                      {d.actualScore}
                    </span>
                    <span className="text-[10px] text-gray-500">{getTierForScore(d.actualScore).name}</span>
                  </div>
                  {d.benchmark !== undefined && (
                    <div className="mt-1.5 pt-1.5 border-t border-chess-border/40">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-500">{benchmarkLabel ?? 'ELO avg'}</span>
                        <span className="text-gray-400">{d.benchmark}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-500">Delta</span>
                        <span className={d.actualScore >= d.benchmark ? 'text-chess-accent' : 'text-chess-blunder'}>
                          {d.actualScore >= d.benchmark ? '+' : ''}{d.actualScore - d.benchmark}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Custom tick for dimension labels ── */


interface PolarAngleAxisTickProps {
  x: number;
  y: number;
  payload: { value: string; index: number };
  cx: number;
  cy: number;
}

interface DimensionLabelProps extends PolarAngleAxisTickProps {
  data: Array<{ dimension: string; score: number; actualScore: number; id: string; revealed: boolean; tierColor: string; tierGlowColor: string }>;
  onDimensionClick?: (dimensionId: string) => void;
  compact?: boolean;
}

function DimensionLabel({ x, y, payload, cx, cy, data, onDimensionClick, compact }: DimensionLabelProps) {
  const item = data[payload.index];
  if (!item) return null;

  const isRevealed = item.revealed;

  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const offsetFactor = compact ? 1.32 : 1.42;
  const labelX = cx + dx * offsetFactor;
  const labelY = cy + dy * offsetFactor;

  const textAnchor =
    Math.abs(dx) < dist * 0.3
      ? 'middle'
      : dx > 0
        ? 'start'
        : 'end';

  const titleSize = compact ? 11 : 12;
  const scoreSize = compact ? 16 : 20;

  return (
    <g
      onClick={() => onDimensionClick?.(item.id)}
      style={{
        cursor: onDimensionClick ? 'pointer' : 'default',
        opacity: isRevealed ? 1 : 0.25,
        transition: 'opacity 0.8s ease-out',
      }}
    >
      {/* Dimension name — split multi-word labels into two lines */}
      {item.dimension.includes(' ') ? (
        <text
          x={labelX}
          y={labelY - (compact ? 12 : 16)}
          textAnchor="middle"
          fill={isRevealed ? 'rgb(var(--chess-text-secondary))' : 'rgb(var(--chess-text-disabled))'}
          fontSize={titleSize}
          fontWeight={600}
        >
          <tspan x={labelX} dy="0">{item.dimension.split(' ')[0]}</tspan>
          <tspan x={labelX} dy={titleSize + 1}>{item.dimension.split(' ').slice(1).join(' ')}</tspan>
        </text>
      ) : (
        <text
          x={labelX}
          y={labelY - (compact ? 6 : 8)}
          textAnchor={textAnchor}
          fill={isRevealed ? 'rgb(var(--chess-text-secondary))' : 'rgb(var(--chess-text-disabled))'}
          fontSize={titleSize}
          fontWeight={600}
        >
          {item.dimension}
        </text>
      )}

      {/* Score — bold, large, tier-colored with glow */}
      <text
        x={labelX}
        y={labelY + (compact ? 10 : 14)}
        textAnchor={textAnchor}
        fill={isRevealed ? item.tierColor : '#334155'}
        fontSize={scoreSize}
        fontWeight={900}
        style={{
          filter: isRevealed ? `drop-shadow(0 0 4px ${item.tierGlowColor})` : 'none',
        }}
      >
        {isRevealed ? item.actualScore : ''}
      </text>
    </g>
  );
}

/* ── Types for recharts custom dot ── */

interface RadarDotProps {
  cx: number;
  cy: number;
  payload: { id: string; actualScore: number; revealed: boolean; tierColor: string; tierGlowColor: string };
}
