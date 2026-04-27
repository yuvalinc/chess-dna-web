/**
 * /graph — exploratory analytics page for yuvalinc's chess.com games.
 *
 * Fetches recent games, runs them through the in-browser Stockfish worker,
 * then renders six charts probing accuracy + time-per-move correlations.
 *
 * Nothing is persisted to Base44 — raw games/analyses live in localStorage
 * with a 24h TTL so subsequent visits don't re-analyze.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  ScatterChart,
  Bar,
  Line,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
} from 'recharts';
import { CHESS_COM_API_BASE } from '@shared/constants';
import { fetchChessCom } from '@/api/chess-com-fetch';
import type { GameRecord, TimeClass } from '@shared/types/game';
import type { GameAnalysis, MoveAnalysis, MoveQuality } from '@shared/types/analysis';
import { parsePgnToGameRecord } from '@shared/utils/chess-utils';
import { analyzeGame } from '@/engine/game-analyzer';
import { cpLossToAccuracy } from '@/engine/uci-parser';
import { useTheme } from '@/components/ThemeContext';
import {
  CHART_COLORS,
  AXIS_TICK,
  formatDate,
} from '@/components/ChartGallery/chartUtils';

type TimeClassFilter = TimeClass | 'all';

const USERNAME = 'yuvalinc';
const MAX_GAMES = 15;
const ANALYSIS_DEPTH = 12;
const CACHE_KEY_PREFIX = `chess-dna-graph-cache:${USERNAME}:v2`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(tc: TimeClassFilter): string {
  return `${CACHE_KEY_PREFIX}:${tc}`;
}

/* ─────────────────────── Cache ─────────────────────── */

interface CachedData {
  games: GameRecord[];
  analyses: GameAnalysis[];
  cachedAt: number;
}

function loadCache(tc: TimeClassFilter): CachedData | null {
  try {
    const raw = localStorage.getItem(cacheKey(tc));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedData;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(tc));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(tc: TimeClassFilter, games: GameRecord[], analyses: GameAnalysis[]): void {
  try {
    const payload: CachedData = { games, analyses, cachedAt: Date.now() };
    localStorage.setItem(cacheKey(tc), JSON.stringify(payload));
  } catch {
    // Quota exceeded — not fatal, just means we re-analyze next visit
  }
}

/* ─────────────────────── Fetch + analyze ─────────────────────── */

interface Progress {
  phase: 'fetching' | 'analyzing' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
}

async function fetchAndAnalyze(
  timeClass: TimeClassFilter,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<{ games: GameRecord[]; analyses: GameAnalysis[] }> {
  const tcLabel = timeClass === 'all' ? '' : ` (${timeClass})`;
  onProgress({ phase: 'fetching', current: 0, total: 0, message: `Fetching ${USERNAME}'s games${tcLabel}…` });

  const archivesRes = await fetchChessCom(
    `${CHESS_COM_API_BASE}/player/${USERNAME}/games/archives`,
  );
  if (!archivesRes.ok) throw new Error(`Player "${USERNAME}" not found on chess.com`);

  const { archives = [] } = (await archivesRes.json()) as { archives: string[] };
  if (archives.length === 0) throw new Error(`No games for "${USERNAME}"`);

  const collected: Array<{ pgn: string; url: string }> = [];
  for (const archiveUrl of [...archives].reverse()) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (collected.length >= MAX_GAMES) break;
    try {
      const monthRes = await fetchChessCom(archiveUrl);
      if (!monthRes.ok) continue;
      const data = (await monthRes.json()) as {
        games: Array<{ url: string; pgn: string; time_class?: string }>;
      };
      for (let i = (data.games?.length ?? 0) - 1; i >= 0; i--) {
        if (collected.length >= MAX_GAMES) break;
        const g = data.games[i];
        if (!g?.pgn) continue;
        if (timeClass !== 'all' && g.time_class !== timeClass) continue;
        collected.push({ pgn: g.pgn, url: g.url });
      }
    } catch {
      /* skip month */
    }
  }

  if (collected.length === 0) throw new Error(`No ${timeClass === 'all' ? '' : timeClass + ' '}games found`);

  const games: GameRecord[] = [];
  for (const { pgn, url } of collected) {
    const game = parsePgnToGameRecord(pgn, url, USERNAME);
    if (game) games.push({ ...game, analysisStatus: 'complete' });
  }

  const analyses: GameAnalysis[] = [];
  for (let i = 0; i < games.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onProgress({
      phase: 'analyzing',
      current: i + 1,
      total: games.length,
      message: `Analyzing ${i + 1} / ${games.length}…`,
    });
    try {
      const analysis = await analyzeGame(games[i], ANALYSIS_DEPTH);
      analyses.push(analysis);
    } catch (err) {
      console.warn('[Graph] analyze failed:', err);
    }
  }

  if (analyses.length === 0) throw new Error('Analysis failed for all games');
  onProgress({ phase: 'done', current: games.length, total: games.length, message: 'Done' });
  return { games, analyses };
}

/* ─────────────────────── Palette ─────────────────────── */

const QUALITY_COLOR: Record<MoveQuality, string> = {
  brilliant: '#1baca6',
  great: '#5c8bb0',
  best: '#4ade80',
  excellent: '#38bdf8',
  good: '#cbd5e1',
  book: '#a88764',
  forced: '#94a3b8',
  inaccuracy: '#eab308',
  mistake: '#f59e0b',
  miss: '#f59e0b',
  blunder: '#e74c3c',
};

const PHASE_COLOR = {
  opening: '#3b82f6',
  middlegame: '#a855f7',
  endgame: '#f59e0b',
} as const;

/** Time buckets used by per-move charts. Order matters — fastest first. */
const TIME_BUCKETS: Array<{ label: string; min: number; max: number; color: string }> = [
  { label: '<1s',    min: 0,   max: 1,        color: '#e74c3c' }, // rushed
  { label: '1-3s',   min: 1,   max: 3,        color: '#f59e0b' },
  { label: '3-8s',   min: 3,   max: 8,        color: '#eab308' },
  { label: '8-20s',  min: 8,   max: 20,       color: '#4ade80' }, // sweet-spot
  { label: '20-60s', min: 20,  max: 60,       color: '#38bdf8' },
  { label: '>60s',   min: 60,  max: Infinity, color: '#a855f7' }, // deep think
];

function getBucketIndex(seconds: number): number {
  for (let i = 0; i < TIME_BUCKETS.length; i++) {
    const b = TIME_BUCKETS[i];
    if (seconds >= b.min && seconds < b.max) return i;
  }
  return TIME_BUCKETS.length - 1;
}

/* ─────────────────────── Helpers ─────────────────────── */

function playerMovesOf(games: GameRecord[], analyses: GameAnalysis[]): MoveAnalysis[] {
  const byId = new Map(games.map((g) => [g.id, g]));
  const out: MoveAnalysis[] = [];
  for (const a of analyses) {
    const g = byId.get(a.gameId);
    if (!g) continue;
    const playerColor = a.summary.playerColor;
    for (const m of a.moves) {
      if (m.color === playerColor && m.timeSpent != null && m.timeSpent > 0) {
        out.push(m);
      }
    }
  }
  return out;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, x) => s + x, 0) / nums.length;
}

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = avg(xs);
  const my = avg(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

/* ─────────────────────── Page ─────────────────────── */

export default function Graph() {
  const { settings } = useTheme();
  const timeClass: TimeClassFilter = settings.selectedTimeClass ?? 'all';

  const [data, setData] = useState<{ games: GameRecord[]; analyses: GameAnalysis[] } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Reset state when filter changes so the loading view shows again.
    setError(null);
    setData(null);
    setProgress(null);

    const cached = loadCache(timeClass);
    if (cached) {
      setData({ games: cached.games, analyses: cached.analyses });
      return;
    }

    const controller = new AbortController();
    fetchAndAnalyze(
      timeClass,
      (p) => !controller.signal.aborted && setProgress(p),
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        saveCache(timeClass, result.games, result.analyses);
        setData(result);
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        setError(err?.message ?? 'Failed');
      });
    return () => controller.abort();
  }, [timeClass]);

  return (
    <div className="max-w-5xl mx-auto py-4">
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-black text-chess-text">
          {USERNAME} — Game Analytics
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          Accuracy and time-per-move correlations from the last {MAX_GAMES}{' '}
          <span className="text-chess-accent">
            {timeClass === 'all' ? 'games' : `${timeClass} games`}
          </span>
          . Depth-{ANALYSIS_DEPTH} Stockfish analysis.
        </p>
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">
          Error: {error}
        </div>
      )}

      {!data && !error && <LoadingView progress={progress} />}

      {data && (
        <GraphsView games={data.games} analyses={data.analyses} />
      )}
    </div>
  );
}

/* ─────────────────────── Loading ─────────────────────── */

function LoadingView({ progress }: { progress: Progress | null }) {
  const pct = progress && progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
  return (
    <div className="bg-chess-surface border border-chess-border/30 rounded-2xl p-6 text-center">
      <div className="text-sm text-chess-text-secondary mb-2">
        {progress?.message ?? 'Loading…'}
      </div>
      <div className="h-2 bg-chess-bg/60 rounded-full overflow-hidden">
        <div
          className="h-full bg-chess-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[10px] text-gray-500 mt-2">
        Stockfish is analyzing every move — this takes ~30–60 seconds on first visit.
      </div>
    </div>
  );
}

/* ─────────────────────── Charts container ─────────────────────── */

function GraphsView({
  games,
  analyses,
}: {
  games: GameRecord[];
  analyses: GameAnalysis[];
}) {
  const playerMoves = useMemo(() => playerMovesOf(games, analyses), [games, analyses]);

  return (
    <div className="space-y-5">
      <SectionCard
        title="Accuracy per game"
        hint="How clean each game was — one dot per game, player-side only."
      >
        <AccuracyPerGameChart games={games} analyses={analyses} />
      </SectionCard>

      <SectionCard
        title="Per-move — accuracy vs time"
        hint="Pick a game. Bar height = accuracy %, bar color = time-bucket you spent on the move."
      >
        <PerMoveChart games={games} analyses={analyses} />
      </SectionCard>

      <SectionCard
        title="Time vs cpLoss — every move"
        hint={`Does thinking longer actually help? Pearson r = ${pearson(
          playerMoves.map((m) => m.timeSpent ?? 0),
          playerMoves.map((m) => m.cpLoss),
        ).toFixed(2)} (closer to 0 = no correlation).`}
      >
        <TimeVsCpLossScatter moves={playerMoves} />
      </SectionCard>

      <SectionCard
        title="Avg time by game phase"
        hint="Which phase do you spend the most thinking on?"
      >
        <TimePerPhaseChart moves={playerMoves} />
      </SectionCard>

      <SectionCard
        title="Avg time by move quality"
        hint="The tell-tale: did blunders come from rushed moves or over-thought ones?"
      >
        <TimePerQualityChart moves={playerMoves} />
      </SectionCard>

      <SectionCard
        title="Accuracy by time bucket"
        hint="Accuracy grouped by how long you spent on the move. Sweet-spot visible?"
      >
        <AccuracyByTimeBucketChart moves={playerMoves} />
      </SectionCard>
    </div>
  );
}

function SectionCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-chess-surface rounded-2xl border border-chess-border/30 p-4 sm:p-5">
      <header className="mb-3">
        <h2 className="text-sm font-bold text-chess-text">{title}</h2>
        {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
      </header>
      <div className="h-64 sm:h-72">{children}</div>
    </section>
  );
}

/* ─────────────────────── Chart: accuracy per game ─────────────────────── */

function AccuracyPerGameChart({
  games,
  analyses,
}: {
  games: GameRecord[];
  analyses: GameAnalysis[];
}) {
  const data = useMemo(() => {
    const byId = new Map(games.map((g) => [g.id, g]));
    return analyses
      .map((a) => {
        const g = byId.get(a.gameId);
        return g
          ? {
              date: g.playedAt,
              accuracy: a.summary.accuracy,
              acpl: a.summary.acpl,
              label: new Date(g.playedAt).toLocaleDateString(),
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.date - b.date);
  }, [games, analyses]);

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
      <ComposedChart data={data} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => formatDate(v as number)}
          tick={AXIS_TICK}
          stroke={CHART_COLORS.axis}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={[0, 100]}
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
        <ReferenceLine y={80} stroke={CHART_COLORS.accent} strokeDasharray="2 4" opacity={0.4} />
        <Bar dataKey="accuracy" fill={CHART_COLORS.accent} fillOpacity={0.35} />
        <Line
          type="monotone"
          dataKey="accuracy"
          stroke={CHART_COLORS.accent}
          strokeWidth={2}
          dot={{ r: 3, fill: CHART_COLORS.accent }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ─────────────────────── Chart: per-move time + accuracy ─────────────────────── */

function PerMoveChart({
  games,
  analyses,
}: {
  games: GameRecord[];
  analyses: GameAnalysis[];
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const sorted = useMemo(() => {
    const byId = new Map(games.map((g) => [g.id, g]));
    return analyses
      .map((a) => ({ a, g: byId.get(a.gameId) }))
      .filter((x): x is { a: GameAnalysis; g: GameRecord } => !!x.g)
      .sort((a, b) => b.g.playedAt - a.g.playedAt);
  }, [games, analyses]);

  const selected = sorted[selectedIdx];

  const data = useMemo(() => {
    if (!selected) return [];
    const playerColor = selected.a.summary.playerColor;
    return selected.a.moves
      .filter((m) => m.color === playerColor)
      .map((m) => {
        const time = m.timeSpent ?? 0;
        const bucketIdx = getBucketIndex(time);
        return {
          moveNumber: m.moveNumber,
          time,
          accuracy: Math.round(cpLossToAccuracy(m.cpLoss) * 10) / 10,
          quality: m.quality,
          bucketIdx,
          bucketLabel: TIME_BUCKETS[bucketIdx].label,
        };
      });
  }, [selected]);

  if (!selected) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <select
          value={selectedIdx}
          onChange={(e) => setSelectedIdx(Number(e.target.value))}
          className="bg-chess-bg border border-chess-border/40 rounded-md text-xs text-chess-text px-2 py-1"
        >
          {sorted.map((x, i) => {
            const r = x.g.player.result;
            const outcome = r === 'win' ? 'W' : r === 'loss' ? 'L' : 'D';
            return (
              <option key={x.g.id} value={i}>
                {new Date(x.g.playedAt).toLocaleDateString()} · {outcome} · acc {x.a.summary.accuracy}%
              </option>
            );
          })}
        </select>

        {/* Colour legend — one chip per time bucket. */}
        <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-gray-400">
          {TIME_BUCKETS.map((b) => (
            <span key={b.label} className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: b.color }} />
              {b.label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <BarChart data={data} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="moveNumber"
              tick={AXIS_TICK}
              stroke={CHART_COLORS.axis}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={AXIS_TICK}
              stroke={CHART_COLORS.axis}
              width={32}
              tickLine={false}
              axisLine={false}
              label={{ value: '%', fill: '#94a3b8', fontSize: 9, position: 'insideTopLeft' }}
            />
            <Tooltip
              contentStyle={{
                background: CHART_COLORS.tooltipBg,
                border: `1px solid ${CHART_COLORS.tooltipBorder}`,
                borderRadius: 8,
                fontSize: 11,
              }}
              formatter={(v: number | string, _k, p) => [
                `${v}% · ${p?.payload?.time ?? 0}s (${p?.payload?.bucketLabel ?? ''})`,
                'accuracy',
              ]}
              labelFormatter={(move) => `Move ${move}`}
            />
            <Bar dataKey="accuracy" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={TIME_BUCKETS[d.bucketIdx].color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─────────────────────── Chart: time vs cpLoss scatter ─────────────────────── */

function TimeVsCpLossScatter({ moves }: { moves: MoveAnalysis[] }) {
  const points = useMemo(
    () =>
      moves.map((m) => ({
        x: m.timeSpent ?? 0,
        y: Math.min(m.cpLoss, 600), // cap extreme outliers for readability
        z: 1,
        quality: m.quality,
      })),
    [moves],
  );

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
      <ScatterChart margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="x"
          name="seconds"
          tick={AXIS_TICK}
          stroke={CHART_COLORS.axis}
          tickLine={false}
          axisLine={false}
          label={{ value: 'time (s)', fill: '#94a3b8', fontSize: 10, position: 'insideBottomRight', offset: -2 }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="cpLoss"
          tick={AXIS_TICK}
          stroke={CHART_COLORS.axis}
          width={32}
          tickLine={false}
          axisLine={false}
          label={{ value: 'cpLoss', fill: '#94a3b8', fontSize: 10, position: 'insideTopLeft' }}
        />
        <ZAxis dataKey="z" range={[30, 30]} />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          contentStyle={{
            background: CHART_COLORS.tooltipBg,
            border: `1px solid ${CHART_COLORS.tooltipBorder}`,
            borderRadius: 8,
            fontSize: 11,
          }}
          formatter={(value: number | string, key: string) =>
            key === 'x' ? [`${value}s`, 'time'] : [value, key === 'y' ? 'cpLoss' : key]
          }
        />
        <Scatter data={points}>
          {points.map((p, i) => (
            <Cell key={i} fill={QUALITY_COLOR[p.quality]} fillOpacity={0.55} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/* ─────────────────────── Chart: avg time by phase ─────────────────────── */

function TimePerPhaseChart({ moves }: { moves: MoveAnalysis[] }) {
  const data = useMemo(() => {
    const phases: Array<'opening' | 'middlegame' | 'endgame'> = ['opening', 'middlegame', 'endgame'];
    return phases.map((p) => {
      const filtered = moves.filter((m) => m.phase === p);
      return {
        phase: p,
        avgTime: Math.round(avg(filtered.map((m) => m.timeSpent ?? 0)) * 10) / 10,
        avgAcc: Math.round(avg(filtered.map((m) => cpLossToAccuracy(m.cpLoss))) * 10) / 10,
        count: filtered.length,
      };
    });
  }, [moves]);

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
      <ComposedChart data={data} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
        <XAxis dataKey="phase" tick={AXIS_TICK} stroke={CHART_COLORS.axis} tickLine={false} axisLine={false} />
        <YAxis
          yAxisId="time"
          orientation="left"
          tick={AXIS_TICK}
          stroke={CHART_COLORS.axis}
          width={32}
          tickLine={false}
          axisLine={false}
          label={{ value: 's', fill: '#94a3b8', fontSize: 9, position: 'insideTopLeft' }}
        />
        <YAxis
          yAxisId="acc"
          orientation="right"
          domain={[0, 100]}
          tick={AXIS_TICK}
          stroke={CHART_COLORS.axis}
          width={32}
          tickLine={false}
          axisLine={false}
          label={{ value: '%', fill: '#94a3b8', fontSize: 9, position: 'insideTopRight' }}
        />
        <Tooltip
          contentStyle={{
            background: CHART_COLORS.tooltipBg,
            border: `1px solid ${CHART_COLORS.tooltipBorder}`,
            borderRadius: 8,
            fontSize: 11,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar yAxisId="time" dataKey="avgTime" name="avg seconds" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={PHASE_COLOR[d.phase]} />
          ))}
        </Bar>
        <Line
          yAxisId="acc"
          type="monotone"
          dataKey="avgAcc"
          name="avg accuracy %"
          stroke={CHART_COLORS.accent}
          strokeWidth={2}
          dot={{ r: 4, fill: CHART_COLORS.accent }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ─────────────────────── Chart: avg time by quality ─────────────────────── */

const QUALITY_ORDER: MoveQuality[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'forced',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
];

function TimePerQualityChart({ moves }: { moves: MoveAnalysis[] }) {
  const data = useMemo(
    () =>
      QUALITY_ORDER.map((q) => {
        const filtered = moves.filter((m) => m.quality === q);
        return {
          quality: q,
          avgTime: Math.round(avg(filtered.map((m) => m.timeSpent ?? 0)) * 10) / 10,
          count: filtered.length,
        };
      }).filter((d) => d.count > 0),
    [moves],
  );

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
      <BarChart data={data} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
        <XAxis
          dataKey="quality"
          tick={{ ...AXIS_TICK, fontSize: 9 }}
          stroke={CHART_COLORS.axis}
          tickLine={false}
          axisLine={false}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={50}
        />
        <YAxis
          tick={AXIS_TICK}
          stroke={CHART_COLORS.axis}
          width={32}
          tickLine={false}
          axisLine={false}
          label={{ value: 's', fill: '#94a3b8', fontSize: 9, position: 'insideTopLeft' }}
        />
        <Tooltip
          contentStyle={{
            background: CHART_COLORS.tooltipBg,
            border: `1px solid ${CHART_COLORS.tooltipBorder}`,
            borderRadius: 8,
            fontSize: 11,
          }}
          formatter={(v: number | string, _k, p) => [`${v}s · n=${p?.payload?.count ?? 0}`, 'avg time']}
        />
        <Bar dataKey="avgTime" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={QUALITY_COLOR[d.quality]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ─────────────────────── Chart: accuracy by time bucket ─────────────────────── */

function AccuracyByTimeBucketChart({ moves }: { moves: MoveAnalysis[] }) {
  const data = useMemo(
    () =>
      TIME_BUCKETS.map((b) => {
        const filtered = moves.filter((m) => {
          const t = m.timeSpent ?? 0;
          return t >= b.min && t < b.max;
        });
        return {
          bucket: b.label,
          color: b.color,
          avgAcc: Math.round(avg(filtered.map((m) => cpLossToAccuracy(m.cpLoss))) * 10) / 10,
          count: filtered.length,
        };
      }),
    [moves],
  );

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
      <BarChart data={data} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" />
        <XAxis dataKey="bucket" tick={AXIS_TICK} stroke={CHART_COLORS.axis} tickLine={false} axisLine={false} />
        <YAxis
          domain={[0, 100]}
          tick={AXIS_TICK}
          stroke={CHART_COLORS.axis}
          width={32}
          tickLine={false}
          axisLine={false}
          label={{ value: '%', fill: '#94a3b8', fontSize: 9, position: 'insideTopLeft' }}
        />
        <Tooltip
          contentStyle={{
            background: CHART_COLORS.tooltipBg,
            border: `1px solid ${CHART_COLORS.tooltipBorder}`,
            borderRadius: 8,
            fontSize: 11,
          }}
          formatter={(v: number | string, _k, p) => [`${v}% · n=${p?.payload?.count ?? 0}`, 'avg accuracy']}
        />
        <Bar dataKey="avgAcc" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
