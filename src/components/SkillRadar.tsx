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
import { useState, useEffect, useId, useMemo, useRef } from 'react';
import { useT } from '@/i18n/index';
import type { TranslationKey } from '@/i18n/locales/en';
import type { SkillProfile } from '@shared/types/patterns';
import { getTierForScore, getTierColor } from '@/patterns/rank-tiers';
import { useTheme } from './ThemeContext';

export interface RadarOverlay {
  id: string;
  label: string;
  profile: SkillProfile;
  color: string;
}

interface SkillRadarProps {
  profile: SkillProfile;
  size?: number;
  onDimensionClick?: (dimensionId: string, event?: React.MouseEvent) => void;
  benchmarks?: Record<string, number>;
  benchmarkLabel?: string;
  animated?: boolean;
  sequentialReveal?: boolean;
  onRevealComplete?: () => void;
  compact?: boolean;
  /** Additional polygons drawn on the same chart (e.g. multiple time
   *  frames). The primary `profile` still drives the score labels. */
  overlays?: RadarOverlay[];
  /** Optional label shown for the primary profile in the legend. If
   *  overlays are present and this is set, a legend is rendered below
   *  the SVG. */
  primaryLabel?: string;
  /** Color for the primary polygon (defaults to the overall tier color). */
  primaryColor?: string;
  /** Controlled visibility for the primary polygon. */
  primaryVisible?: boolean;
  /** Controlled set of overlay ids that should be drawn. */
  visibleOverlayIds?: Set<string>;
  /** Hide the built-in checkbox legend (useful when the parent renders
   *  its own legend somewhere else, e.g. below the tier-info line). */
  showLegend?: boolean;
}

const SKILL_LABEL_KEYS: Record<string, TranslationKey> = {
  openings: 'skill_openings', tactics: 'skill_tactics', defense: 'skill_defense',
  positional: 'skill_positional', endgame: 'skill_endgame', calculation: 'skill_calculation',
  time_management: 'skill_time_management', resilience: 'skill_resilience',
};

/* Lucide-style stroke icons in a 24×24 box, one per dimension. The radar
 * renders them in place of text labels around the chart. */
export function SkillIcon({
  id,
  size = 20,
  color = 'currentColor',
  strokeWidth = 1.6,
}: {
  id: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <SkillIconPaths id={id} />
    </svg>
  );
}

function SkillIconPaths({ id }: { id: string }) {
  switch (id) {
    case 'openings': /* bishop chess piece */
      return (
        <>
          <path d="M12 2.5c.7.8 1 1.5 1 2.3 0 .9-.5 1.5-1 1.7-.5-.2-1-.8-1-1.7 0-.8.3-1.5 1-2.3z" />
          <path d="M9 12c0-2.7 1.3-4.7 3-5.5 1.7.8 3 2.8 3 5.5" />
          <path d="M8 12h8" />
          <path d="M9 12v3h6v-3" />
          <path d="M7 15h10v3H7z" />
          <path d="M5 18h14v3H5z" />
        </>
      );
    case 'tactics': /* crossed swords */
      return (
        <>
          <path d="M14.5 17.5L3 6V3h3l11.5 11.5" />
          <path d="M13 19l6-6" />
          <path d="M16 16l4 4" />
          <path d="M19 21l2-2" />
          <path d="M9.5 17.5L21 6V3h-3L6.5 14.5" />
          <path d="M11 19l-6-6" />
          <path d="M8 16l-4 4" />
          <path d="M5 21l-2-2" />
        </>
      );
    case 'defense': /* shield */
      return (
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      );
    case 'positional': /* 3×3 grid */
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
        </>
      );
    case 'endgame': /* flag */
      return (
        <>
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </>
      );
    case 'calculation': /* calculator */
      return (
        <>
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <line x1="8" y1="6" x2="16" y2="6" />
          <line x1="8" y1="14" x2="8.01" y2="14" />
          <line x1="12" y1="14" x2="12.01" y2="14" />
          <line x1="16" y1="14" x2="16.01" y2="14" />
          <line x1="8" y1="18" x2="8.01" y2="18" />
          <line x1="12" y1="18" x2="12.01" y2="18" />
          <line x1="16" y1="18" x2="16.01" y2="18" />
        </>
      );
    case 'time_management': /* stopwatch / timer */
      return (
        <>
          <line x1="10" y1="2" x2="14" y2="2" />
          <line x1="12" y1="14" x2="15" y2="11" />
          <circle cx="12" cy="14" r="8" />
        </>
      );
    case 'resilience': /* activity / heartbeat */
      return (
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      );
    default:
      return null;
  }
}

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
  overlays,
  primaryLabel,
  primaryColor,
  primaryVisible: primaryVisibleProp,
  visibleOverlayIds: visibleOverlayIdsProp,
  showLegend = true,
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

  // Track container width so the radar fills the available space rather
  // than being clamped to a fixed `size`. The `size` prop becomes a
  // floor/initial value used until the first ResizeObserver tick, and a
  // ceiling so very-wide desktop columns don't blow up the chart.
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoSize, setAutoSize] = useState<number | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) setAutoSize(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Cap so very-wide desktop columns don't blow up the chart; on mobile
  // the container width is well under the cap and the radar just fills it.
  const renderSize = autoSize !== null ? Math.min(autoSize, 720) : size;

  /* Per-timeframe visibility — controlled by props when provided, otherwise
     fall back to internal state (primary visible, overlays hidden). */
  const [primaryVisibleInternal, setPrimaryVisibleInternal] = useState<boolean>(true);
  const [overlayVisibleIdsInternal, setOverlayVisibleIdsInternal] = useState<Set<string>>(
    () => new Set(),
  );
  const primaryVisible = primaryVisibleProp ?? primaryVisibleInternal;
  const overlayVisibleIds = visibleOverlayIdsProp ?? overlayVisibleIdsInternal;
  const togglePrimary = () => setPrimaryVisibleInternal((v) => !v);
  const toggleOverlay = (id: string) => {
    setOverlayVisibleIdsInternal((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  /* Geometry constants — all tied to `renderSize` (auto-fit to container). */
  const cx = renderSize / 2;
  const cy = renderSize / 2;
  const r = renderSize * 0.32; // outer ring radius for points

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

  /* Single, theme-aware color used for ALL vertex dots and ALL score
     numbers — replaces the previous per-tier coloring. Best/worst are still
     differentiated, but via a colored ring around the dot (see below). */
  const DOT_COLOR = theme === 'light' ? '#0f172a' : '#e2e8f0';
  const DOT_GLOW = theme === 'light' ? 'rgba(15, 23, 42, 0.35)' : 'rgba(226, 232, 240, 0.55)';

  /* Best / worst dimensions (by score). Used to draw a star/alert badge on
     the corresponding vertex inside the radar. */
  const { bestIdx, worstIdx } = useMemo(() => {
    if (dimensions.length === 0) return { bestIdx: -1, worstIdx: -1 };
    let bi = 0;
    let wi = 0;
    for (let i = 1; i < dimensions.length; i++) {
      if (dimensions[i].score > dimensions[bi].score) bi = i;
      if (dimensions[i].score < dimensions[wi].score) wi = i;
    }
    return { bestIdx: bi, worstIdx: wi };
  }, [dimensions]);
  const BEST_COLOR = '#22c55e'; // green
  const WORST_COLOR = '#f87171'; // red

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

  /* Overlay polygon points — one polygon per timeframe / extra profile.
   * Skip overlays that don't have real data (gamesUsed === 0); rendering
   * the all-50 default polygon would be misleading. */
  const overlayPolygons = (overlays ?? [])
    .filter((ov) => ov.profile.gamesUsed > 0)
    .map((ov) => {
      const dimById = new Map(ov.profile.dimensions.map((d) => [d.id, d]));
      const points = dimensions.map((d, i) => {
        const score = dimById.get(d.id)?.score ?? 0;
        const [px, py] = pointFor(i, score * animProgress);
        return `${px},${py}`;
      }).join(' ');
      return { ...ov, points };
    });

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
        ref={containerRef}
        className="relative flex items-center justify-center text-center w-full"
        style={{ aspectRatio: '1 / 1', maxWidth: 560 }}
      >
        <p className="text-sm text-chess-text-tertiary px-6">
          Play 3+ games to see this chart
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full" style={{ maxWidth: 720 }}>
      <svg
        width={renderSize}
        height={renderSize}
        viewBox={`0 0 ${renderSize} ${renderSize}`}
        style={{ display: 'block', margin: '0 auto', overflow: 'visible' }}
      >
        <defs>
          <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={primaryColor ?? overallTierColor} stopOpacity={0.7} />
            <stop offset="70%" stopColor={primaryColor ?? overallTierColor} stopOpacity={0.4} />
            <stop offset="100%" stopColor={primaryColor ?? overallTierColor} stopOpacity={0.25} />
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
            fontSize={Math.round(renderSize * 0.028)}
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

        {/* Timeframe overlays (drawn before the primary so it sits on top).
            Each overlay only renders when its checkbox is on. */}
        {overlayPolygons
          .filter((ov) => overlayVisibleIds.has(ov.id))
          .map((ov) => (
            <polygon
              key={`overlay-${ov.id}`}
              points={ov.points}
              fill={ov.color}
              fillOpacity={0.12}
              stroke={ov.color}
              strokeOpacity={0.7}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          ))}

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

        {/* Main polygon (you) — gated on the primary checkbox. */}
        {primaryVisible && (
          <polygon
            points={polyPoints}
            fill={`url(#${gradientId})`}
            stroke={primaryColor ?? overallTierColor}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        )}

        {/* Vertex dots — uniform color for all, with a gold ring for the
            best dimension and a red ring for the worst. */}
        {dimensions.map((d, i) => {
          if (i >= revealUntil) return null;
          const [x, y] = pointFor(i, d.score * animProgress);
          const isBest = i === bestIdx;
          const isWorst = i === worstIdx;
          const ringColor = isBest ? BEST_COLOR : isWorst ? WORST_COLOR : null;
          const handleClick = onDimensionClick ? (e: React.MouseEvent) => {
            // Don't let the browser shift focus/scroll the clicked SVG group
            // into view — that's what causes the "UI jump below" the radar.
            e.preventDefault();
            e.stopPropagation();
            onDimensionClick(d.id, e);
          } : undefined;
          return (
            <g
              key={`dot-${d.id}`}
              style={{ cursor: onDimensionClick ? 'pointer' : 'default' }}
              onClick={handleClick}
            >
              {ringColor && (
                <circle
                  cx={x} cy={y} r={8}
                  fill="none"
                  stroke={ringColor}
                  strokeWidth={2}
                  style={{ filter: `drop-shadow(0 0 4px ${ringColor})` }}
                />
              )}
              <circle cx={x} cy={y} r={6} fill={DOT_COLOR} opacity={0.18} />
              <circle
                cx={x} cy={y} r={3.5}
                fill={DOT_COLOR}
                stroke="rgb(var(--chess-surface))"
                strokeWidth={1.5}
                style={{ filter: `drop-shadow(0 0 3px ${DOT_GLOW})` }}
              />
            </g>
          );
        })}

        {/* Axis labels — icon centered at the label position. The radar
            polygon size is unchanged; only the labels swap from text to
            icons. Title attribute keeps the dimension name accessible. */}
        {dimensions.map((d, i) => {
          const isRevealed = i < revealUntil;
          const [lx, ly] = labelPos(i, 1.32);
          const labelText = dimLabel(d.id, d.label);
          const iconSize = Math.max(20, Math.round(renderSize * 0.075));
          const handleClick = onDimensionClick ? (e: React.MouseEvent) => {
            // Don't let the browser shift focus/scroll the clicked SVG group
            // into view — that's what causes the "UI jump below" the radar.
            e.preventDefault();
            e.stopPropagation();
            onDimensionClick(d.id, e);
          } : undefined;

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
              <title>{labelText}</title>
              {/* Transparent hit area — strokes alone don't capture clicks
                  on the empty interior of an icon. This circle ensures the
                  whole icon zone (and a small margin) opens the popup. */}
              <circle
                cx={lx} cy={ly}
                r={iconSize * 1.2}
                fill="transparent"
                pointerEvents="all"
              />
              <g
                transform={`translate(${lx - iconSize / 2}, ${ly - iconSize / 2}) scale(${iconSize / 24})`}
                fill="none"
                stroke={LABEL_NAME_FILL}
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                pointerEvents="none"
              >
                <SkillIconPaths id={d.id} />
              </g>
            </g>
          );
        })}
      </svg>

      {/* Legend with toggle checkboxes — rendered inside the radar by
          default, but the parent can hide it (showLegend={false}) and
          render <RadarLegend> elsewhere on the page. */}
      {showLegend && overlays && overlays.length > 0 && primaryLabel && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-chess-text-secondary">
          <LegendCheckbox
            color={primaryColor ?? overallTierColor}
            label={primaryLabel}
            checked={primaryVisible}
            onChange={togglePrimary}
          />
          {overlays.map((ov) => (
            <LegendCheckbox
              key={ov.id}
              color={ov.color}
              label={ov.label}
              checked={overlayVisibleIds.has(ov.id)}
              onChange={() => toggleOverlay(ov.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* Standalone legend so the host page can render it anywhere — e.g. below
 * the tier-info line — and still drive the radar's polygon visibility. */
export function RadarLegend({
  primaryLabel,
  primaryColor,
  primaryVisible,
  primaryDisabled = false,
  onTogglePrimary,
  overlays,
  visibleOverlayIds,
  disabledOverlayIds,
  onToggleOverlay,
}: {
  primaryLabel: string;
  primaryColor: string;
  primaryVisible: boolean;
  primaryDisabled?: boolean;
  onTogglePrimary: () => void;
  overlays: RadarOverlay[];
  visibleOverlayIds: Set<string>;
  disabledOverlayIds?: Set<string>;
  onToggleOverlay: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-chess-text-secondary">
      <LegendCheckbox
        color={primaryColor}
        label={primaryLabel}
        checked={primaryVisible}
        disabled={primaryDisabled}
        onChange={onTogglePrimary}
      />
      {overlays.map((ov) => (
        <LegendCheckbox
          key={ov.id}
          color={ov.color}
          label={ov.label}
          checked={visibleOverlayIds.has(ov.id)}
          disabled={disabledOverlayIds?.has(ov.id) ?? false}
          onChange={() => onToggleOverlay(ov.id)}
        />
      ))}
    </div>
  );
}

function LegendCheckbox({
  color,
  label,
  checked,
  disabled = false,
  onChange,
}: {
  color: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  const labelColor = disabled
    ? 'text-gray-600'
    : checked
      ? 'text-chess-text'
      : 'text-chess-text-tertiary';
  const wrapperClass = disabled
    ? 'inline-flex items-center gap-1.5 cursor-not-allowed select-none opacity-50'
    : 'inline-flex items-center gap-1.5 cursor-pointer select-none';
  return (
    <label className={wrapperClass} title={disabled ? 'Not enough data for this timeframe' : undefined}>
      <span
        className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded border transition-all ${
          checked ? '' : 'border-chess-border/60'
        }`}
        style={
          checked && !disabled
            ? { backgroundColor: color, borderColor: color, boxShadow: `0 0 6px ${color}88` }
            : { backgroundColor: 'transparent' }
        }
        aria-hidden="true"
      >
        {checked && !disabled && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0f172a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
      <span className={labelColor}>{label}</span>
    </label>
  );
}
