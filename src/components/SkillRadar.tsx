/* ────────────────────────────────────────────────────────────────────────
 *  SkillRadar — custom SVG implementation matching the Claude Design mock
 *  pixel-for-pixel.
 *
 *  Visual spec (from chessdna design bundle / atoms.jsx):
 *    - 8 axes by default, equally spaced, top axis at 12 o'clock
 *    - 4 concentric solid rings (25/50/75/99) with subtle stroke
 *    - Ring value labels (25/50/75/99) along the top axis
 *    - Long spokes from center to slightly past each ring (1.06×)
 *    - Spoke end-cap tick dots
 *    - Filled polygon: radial-gradient fill, tier-colored stroke
 *    - Vertex dots: colored per dimension's tier with halo + glow
 *    - Labels outside the radar: dimension name (semi) above, score
 *      (extra-bold + tier color + glow) below
 *    - Multi-word labels (e.g. "Time Mgmt") split across two lines
 *
 *  Interaction:
 *    - sequentialReveal: animates axes appearing one-by-one (every ~1.5s)
 *    - benchmarks: optional second polygon (dashed) for friend overlay
 *    - onDimensionClick: makes labels + dots clickable
 *
 *  Public API preserved from prior Recharts version.
 * ──────────────────────────────────────────────────────────────────────── */
import { useState, useEffect, useId, useMemo } from 'react';
import { useT } from '@/i18n/index';
import type { TranslationKey } from '@/i18n/locales/en';
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

const SKILL_LABEL_KEYS: Record<string, TranslationKey> = {
  openings: 'skill_openings', tactics: 'skill_tactics', defense: 'skill_defense',
  positional: 'skill_positional', endgame: 'skill_endgame', calculation: 'skill_calculation',
  time_management: 'skill_time_management', resilience: 'skill_resilience',
};

export default function SkillRadar({
  profile,
  size = 380,
  onDimensionClick,
  benchmarks,
  benchmarkLabel: _benchmarkLabel,
  animated = true,
  sequentialReveal = false,
  onRevealComplete,
  compact: _compact = false,
}: SkillRadarProps) {
  void _benchmarkLabel; void _compact;
  const uid = useId().replace(/:/g, '_');
  const { theme } = useTheme();
  const { t } = useT();

  const dimensions = profile.dimensions;
  const n = dimensions.length;
  // No-data state: when no games have been analyzed yet, every dimension
  // sits at the calculator's default of 50. Showing those numbers reads
  // as "your skills are 50/99" — misleading. Suppress the score labels
  // until real data arrives.
  const hasData = profile.gamesUsed > 0;

  /* Sequential-reveal state — when enabled, only the first `revealUntil`
     axes contribute to the polygon (others collapse to center). */
  const [revealUntil, setRevealUntil] = useState<number>(sequentialReveal ? 0 : n);
  useEffect(() => {
    if (!sequentialReveal) {
      setRevealUntil(n);
      return;
    }
    setRevealUntil(0);
    let count = 0;
    const interval = window.setInterval(() => {
      count++;
      setRevealUntil(count);
      if (count >= n) {
        window.clearInterval(interval);
        window.setTimeout(() => onRevealComplete?.(), 800);
      }
    }, 700);
    return () => window.clearInterval(interval);
  }, [sequentialReveal, n]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Number-tween for the score labels — adds a subtle grow-in once on mount.
     Goes from 0 to 1 over ~700ms with a cubic easing. */
  const [animProgress, setAnimProgress] = useState<number>(animated ? 0 : 1);
  const ratingKey = profile.overallRating;
  useEffect(() => {
    if (!animated) { setAnimProgress(1); return; }
    setAnimProgress(0);
    const start = performance.now();
    const duration = 700;
    let raf = 0;
    const tick = (now: number) => {
      const tt = Math.min(1, (now - start) / duration);
      setAnimProgress(1 - Math.pow(1 - tt, 3));
      if (tt < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animated, ratingKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Geometry constants — all tied to `size` so the radar scales cleanly. */
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.32; // outer ring radius for points

  const overallTier = useMemo(() => getTierForScore(profile.overallRating), [profile.overallRating]);
  const overallTierColor = getTierColor(overallTier, theme);

  /* Theme-aware ring/spoke stroke + label fill colors.
     Spokes are intentionally very faint per the Claude Design reference —
     they should hint at the cross structure without competing with the
     polygon and labels. */
  const RING_STROKE = theme === 'light' ? 'rgba(70, 90, 130, 0.38)' : 'rgba(120, 165, 220, 0.22)';
  const RING_STROKE_OUTER = theme === 'light' ? 'rgba(70, 90, 130, 0.5)' : 'rgba(120, 165, 220, 0.38)';
  const SPOKE_STROKE = theme === 'light' ? 'rgba(70, 90, 130, 0.18)' : 'rgba(120, 165, 220, 0.18)';
  const SPOKE_TICK = theme === 'light' ? 'rgba(70, 90, 130, 0.30)' : 'rgba(120, 165, 220, 0.32)';
  const RING_LABEL = theme === 'light' ? 'rgba(70, 90, 130, 0.55)' : 'rgba(148, 163, 184, 0.45)';
  const LABEL_NAME_FILL = theme === 'light' ? '#475569' : 'rgb(148, 163, 184)';

  /* Helper: cartesian point on the radar at axis `idx` with score `score`. */
  const pointFor = (idx: number, score: number): [number, number] => {
    const angle = (Math.PI * 2 * idx) / n - Math.PI / 2;
    const radius = (score / 99) * r;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  };
  const spokeEnd = (idx: number, factor = 1): [number, number] => {
    const angle = (Math.PI * 2 * idx) / n - Math.PI / 2;
    return [cx + Math.cos(angle) * r * factor, cy + Math.sin(angle) * r * factor];
  };
  const labelPos = (idx: number, factor: number): [number, number] => {
    const angle = (Math.PI * 2 * idx) / n - Math.PI / 2;
    return [cx + Math.cos(angle) * r * factor, cy + Math.sin(angle) * r * factor];
  };

  /* Polygon points — unrevealed axes collapse to center so the shape grows
     outward as `revealUntil` advances. */
  const polyPoints = dimensions.map((d, i) => {
    if (i < revealUntil) {
      const [px, py] = pointFor(i, d.score * animProgress);
      return `${px},${py}`;
    }
    return `${cx},${cy}`;
  }).join(' ');

  const benchmarkPoints = benchmarks
    ? dimensions.map((d, i) => {
        const score = benchmarks[d.id] ?? 0;
        const [px, py] = pointFor(i, score);
        return `${px},${py}`;
      }).join(' ')
    : null;

  const gradientId = `radarFill_${uid}`;

  /* Translation labels for the 8 stock dimensions. */
  const dimLabel = (id: string, fallback: string): string => {
    const key = SKILL_LABEL_KEYS[id];
    return key ? t(key) : fallback;
  };

  // No-data state: rendering the chart with all-50 scores misleads users into
  // thinking they have a profile. Show a small inline note instead until at
  // least one game has been analyzed.
  if (!hasData) {
    return (
      <div
        className="relative flex items-center justify-center text-center"
        style={{ width: size, height: size, maxWidth: '100%' }}
      >
        <p className="text-sm text-chess-text-tertiary px-6">
          Play 3+ games to see this chart
        </p>
      </div>
    );
  }

  return (
    <div className="relative" style={{ width: size, height: size, maxWidth: '100%' }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={overallTierColor} stopOpacity={0.4} />
            <stop offset="70%" stopColor={overallTierColor} stopOpacity={0.1} />
            <stop offset="100%" stopColor={overallTierColor} stopOpacity={0.02} />
          </radialGradient>
        </defs>

        {/* Concentric rings — solid, theme-aware */}
        {[0.25, 0.5, 0.75, 1].map((f, i) => (
          <circle
            key={`ring-${i}`}
            cx={cx} cy={cy} r={r * f}
            fill="none"
            stroke={i === 3 ? RING_STROKE_OUTER : RING_STROKE}
            strokeWidth={i === 3 ? 1.25 : 1}
          />
        ))}

        {/* Ring value labels (25 / 50 / 75 / 99) along the top axis */}
        {[0.25, 0.5, 0.75, 1].map((f, i) => (
          <text
            key={`rv-${i}`}
            x={cx + 4}
            y={cy - r * f + 3}
            fill={RING_LABEL}
            fontSize={Math.round(size * 0.028)}
            fontWeight={600}
            fontFamily="ui-monospace, SF Mono, monospace"
          >
            {Math.round(99 * f)}
          </text>
        ))}

        {/* Spokes — extend slightly past the outer ring */}
        {dimensions.map((_, i) => {
          const [x, y] = spokeEnd(i, 1.06);
          return (
            <line
              key={`spoke-${i}`}
              x1={cx} y1={cy} x2={x} y2={y}
              stroke={SPOKE_STROKE}
              strokeWidth={1}
            />
          );
        })}

        {/* Spoke end-cap tick dots */}
        {dimensions.map((_, i) => {
          const [x, y] = spokeEnd(i, 1.06);
          return (
            <circle key={`tick-${i}`} cx={x} cy={y} r={1.6} fill={SPOKE_TICK} />
          );
        })}

        {/* Benchmark overlay (drawn first so user line is on top) */}
        {benchmarkPoints && (
          <>
            <polygon
              points={benchmarkPoints}
              fill="#60a5fa"
              fillOpacity={0.08}
              stroke="#60a5fa"
              strokeWidth={1.6}
              strokeLinejoin="round"
              strokeDasharray="4 3"
            />
            {dimensions.map((d, i) => {
              const score = benchmarks?.[d.id] ?? 0;
              const [x, y] = pointFor(i, score);
              return (
                <circle
                  key={`bm-${i}`}
                  cx={x} cy={y} r={2.5}
                  fill="#60a5fa"
                  stroke="rgb(var(--chess-surface))"
                  strokeWidth={1}
                />
              );
            })}
          </>
        )}

        {/* Main polygon (you) */}
        <polygon
          points={polyPoints}
          fill={`url(#${gradientId})`}
          stroke={overallTierColor}
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Vertex dots — colored per dimension's own tier */}
        {dimensions.map((d, i) => {
          if (i >= revealUntil) return null;
          const [x, y] = pointFor(i, d.score * animProgress);
          const dimTier = getTierForScore(d.score);
          const dotColor = getTierColor(dimTier, theme);
          const dotGlow = getTierGlowColor(dimTier, theme);
          const handleClick = onDimensionClick ? () => onDimensionClick(d.id) : undefined;
          return (
            <g
              key={`dot-${d.id}`}
              style={{ cursor: onDimensionClick ? 'pointer' : 'default' }}
              onClick={handleClick}
            >
              <circle cx={x} cy={y} r={6} fill={dotColor} opacity={0.18} />
              <circle
                cx={x} cy={y} r={3.5}
                fill={dotColor}
                stroke="rgb(var(--chess-surface))"
                strokeWidth={1.5}
                style={{ filter: `drop-shadow(0 0 3px ${dotGlow})` }}
              />
            </g>
          );
        })}

        {/* Axis labels — name above, score below; multi-word labels split */}
        {dimensions.map((d, i) => {
          const isRevealed = i < revealUntil;
          const dimTier = getTierForScore(d.score);
          const dotColor = getTierColor(dimTier, theme);
          const dotGlow = getTierGlowColor(dimTier, theme);
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
          const dx = Math.cos(angle);
          const anchor: 'middle' | 'start' | 'end' =
            Math.abs(dx) < 0.3 ? 'middle' : dx > 0 ? 'start' : 'end';
          const [lx, ly] = labelPos(i, 1.32);
          const labelText = dimLabel(d.id, d.label);
          const words = labelText.split(' ');
          const nameSize = Math.max(10, Math.round(size * 0.034));
          const scoreSize = Math.max(14, Math.round(size * 0.057));

          const handleClick = onDimensionClick ? () => onDimensionClick(d.id) : undefined;

          return (
            <g
              key={`lbl-${d.id}`}
              style={{
                cursor: onDimensionClick ? 'pointer' : 'default',
                opacity: isRevealed ? 1 : 0.25,
                transition: 'opacity 0.6s ease-out',
              }}
              onClick={handleClick}
            >
              {words.length > 1 ? (
                <text
                  x={lx} y={ly - nameSize - 4}
                  textAnchor="middle"
                  fill={LABEL_NAME_FILL}
                  fontSize={nameSize}
                  fontWeight={600}
                >
                  <tspan x={lx} dy="0">{words[0]}</tspan>
                  <tspan x={lx} dy={nameSize + 1}>{words.slice(1).join(' ')}</tspan>
                </text>
              ) : (
                <text
                  x={lx} y={ly - 6}
                  textAnchor={anchor}
                  fill={LABEL_NAME_FILL}
                  fontSize={nameSize}
                  fontWeight={600}
                >
                  {labelText}
                </text>
              )}
              <text
                x={lx} y={ly + scoreSize - 2}
                textAnchor={anchor}
                fill={isRevealed ? dotColor : (theme === 'light' ? '#94a3b8' : '#334155')}
                fontSize={scoreSize}
                fontWeight={900}
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  filter: isRevealed ? `drop-shadow(0 0 4px ${dotGlow})` : 'none',
                }}
              >
                {isRevealed && hasData ? Math.round(d.score * animProgress) : ''}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
