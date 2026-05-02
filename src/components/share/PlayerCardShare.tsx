/* ────────────────────────────────────────────────────────────────────────
 *  PlayerCardShare — the "Share DNA" modal opened from the Overview/DNA
 *  screen. Renders two card variants the user can toggle between:
 *
 *    • STATS — radar + 8 dimension scores + platform ratings
 *    • HERO  — large photo + dimension column + name/title
 *
 *  The user picks a mode, optionally adds a photo (Hero), then taps
 *  "Share card" to capture the card as PNG and hand it to the OS share
 *  sheet (or copy/download fallback on desktop).
 * ──────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SkillProfile, RankTier } from '@shared/types/patterns';
import type { GameRecord, TimeClass } from '@shared/types/game';
import { useChessData } from '@/contexts/ChessDataContext';
import { captureCardAsBlob, shareImage, downloadImage, copyImageToClipboard } from '@/utils/share-image';
import { fetchChessCom } from '@/api/chess-com-fetch';
import { CHESS_COM_API_BASE } from '@shared/constants';

const DIM_ABBR: Record<string, string> = {
  openings: 'OPN',
  tactics: 'TAC',
  defense: 'DEF',
  positional: 'POS',
  endgame: 'END',
  calculation: 'CLC',
  time_management: 'TIM',
  resilience: 'RES',
};

// Order matches the screenshot: OPN top, then clockwise.
const DIM_ORDER = ['openings', 'tactics', 'defense', 'positional', 'endgame', 'calculation', 'time_management', 'resilience'] as const;

const GRID_BG_STYLE: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
  backgroundSize: '32px 32px',
};

interface Props {
  profile: SkillProfile;
  tier: RankTier;
  playerElo: number;
  username: string;
  lichessUsername?: string | null;
  fideId?: string | null;
  onClose: () => void;
}

export default function PlayerCardShare({
  profile,
  tier,
  playerElo,
  username,
  lichessUsername,
  fideId,
  onClose,
}: Props) {
  const [mode, setMode] = useState<'stats' | 'hero'>('stats');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const orderedDims = useMemo(() => {
    const map = new Map(profile.dimensions.map((d) => [d.id, d]));
    return DIM_ORDER.map((id) => map.get(id)).filter((d): d is NonNullable<typeof d> => !!d);
  }, [profile.dimensions]);

  // Pull the latest rating per platform × time class from the user's games
  // (fast, offline). Then enrich asynchronously from the chess.com / lichess
  // public APIs so the card stays current even if the user hasn't imported
  // any games for that platform yet.
  const { allGames } = useChessData();
  const gameRatings = useMemo(() => derivePlatformRatings(allGames), [allGames]);
  const [apiRatings, setApiRatings] = useState<PlatformRatings>({ chesscom: [], lichess: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cc, li] = await Promise.allSettled([
        username ? fetchChessComRatings(username) : Promise.resolve([] as RatingEntry[]),
        lichessUsername ? fetchLichessRatings(lichessUsername) : Promise.resolve([] as RatingEntry[]),
      ]);
      if (cancelled) return;
      setApiRatings({
        chesscom: cc.status === 'fulfilled' ? cc.value : [],
        lichess: li.status === 'fulfilled' ? li.value : [],
      });
    })();
    return () => { cancelled = true; };
  }, [username, lichessUsername]);

  // API ratings win when present (more authoritative); fall back to ratings
  // derived from imported games when the API call hasn't finished or failed.
  const platformRatings: PlatformRatings = {
    chesscom: apiRatings.chesscom.length > 0 ? apiRatings.chesscom : gameRatings.chesscom,
    lichess: apiRatings.lichess.length > 0 ? apiRatings.lichess : gameRatings.lichess,
  };

  const onShare = async () => {
    if (!cardRef.current || busy) return;
    setBusy(true);
    try {
      const blob = await captureCardAsBlob(cardRef.current);
      const filename = `chess-dna-player-card-${username}.png`;
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await shareImage(blob, filename);
      } else {
        const ok = await copyImageToClipboard(blob);
        if (!ok) downloadImage(blob, filename);
      }
    } catch (err) {
      console.error('[player-card-share]', err);
    } finally {
      setBusy(false);
    }
  };

  const onPickPhoto = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setPhoto(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-sm flex flex-col"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-chess-text hover:bg-white/5 transition-colors"
          >
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <img src="/favicon.png" alt="" width={18} height={18} className="rounded-sm" />
          <span className="text-[12px] font-extrabold tracking-[2px] uppercase text-chess-text">
            Player card
          </span>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-1 bg-chess-surface/60 border border-chess-border/30 rounded-lg p-1">
          <ToggleButton active={mode === 'stats'} onClick={() => setMode('stats')}>Stats</ToggleButton>
          <ToggleButton active={mode === 'hero'} onClick={() => setMode('hero')}>Hero</ToggleButton>
        </div>
      </header>

      {/* Card body */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 flex items-start justify-center">
        <div ref={cardRef} data-share-card className="w-full max-w-md">
          {mode === 'stats' ? (
            <StatsCard
              profile={profile}
              tier={tier}
              playerElo={playerElo}
              username={username}
              lichessUsername={lichessUsername ?? null}
              fideId={fideId ?? null}
              orderedDims={orderedDims}
              platformRatings={platformRatings}
            />
          ) : (
            <HeroCard
              profile={profile}
              tier={tier}
              username={username}
              orderedDims={orderedDims}
              photo={photo}
              onPickPhoto={() => fileInputRef.current?.click()}
            />
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPickPhoto(file);
          }}
        />
      </div>

      {/* Bottom CTAs */}
      <div className="shrink-0 border-t border-chess-border/30 bg-chess-bg/95 backdrop-blur px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onShare}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl py-3 font-extrabold text-[13px] uppercase tracking-[1.4px] transition-all active:scale-95 bg-chess-accent text-black disabled:opacity-60"
          >
            {busy ? 'Preparing…' : 'Share card'}
          </button>
          <button
            onClick={() => setMode((m) => (m === 'stats' ? 'hero' : 'stats'))}
            className="flex items-center justify-center gap-2 rounded-xl py-3 font-extrabold text-[13px] uppercase tracking-[1.4px] transition-all active:scale-95 border border-chess-border/40 text-chess-text hover:border-chess-accent/40"
          >
            {mode === 'stats' ? (
              <>See hero <Arrow /></>
            ) : (
              <><ArrowBack /> See stats</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-md text-[11px] font-extrabold uppercase tracking-[1.4px] transition-colors ${
        active
          ? 'bg-chess-accent text-black'
          : 'text-chess-text-tertiary hover:text-chess-text'
      }`}
    >
      {children}
    </button>
  );
}

function Arrow() {
  return (
    <svg className="w-3.5 h-3.5 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="M13 5l7 7-7 7" />
    </svg>
  );
}

function ArrowBack() {
  return (
    <svg className="w-3.5 h-3.5 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" />
      <path d="M11 19l-7-7 7-7" />
    </svg>
  );
}

/* ─────────────── Stats card ─────────────── */
function StatsCard({
  profile,
  tier,
  playerElo,
  username,
  lichessUsername,
  fideId,
  orderedDims,
  platformRatings,
}: {
  profile: SkillProfile;
  tier: RankTier;
  playerElo: number;
  username: string;
  lichessUsername: string | null;
  fideId: string | null;
  orderedDims: SkillProfile['dimensions'];
  platformRatings: PlatformRatings;
}) {
  void playerElo;
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-chess-border/30 bg-chess-surface"
      style={GRID_BG_STYLE}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="flex items-center gap-1.5">
          <img src="/favicon.png" alt="" width={16} height={16} className="rounded-sm" />
          <span className="text-[11px] font-extrabold tracking-[1.5px] text-chess-text uppercase">Player card</span>
        </div>
      </div>

      {/* Score + name row */}
      <div className="flex items-start justify-between gap-3 px-4 pt-3">
        <div className="text-chess-accent font-black tabular-nums leading-none" style={{ fontSize: 'clamp(56px, 14vw, 80px)' }}>
          {profile.overallRating}
        </div>
        <div className="flex flex-col items-end text-right pt-2">
          <div className="text-[15px] font-extrabold uppercase tracking-[1.5px] text-chess-text truncate max-w-[180px]">
            {username}
          </div>
          <div className="mt-1.5 inline-flex items-center px-2 py-0.5 rounded-md border border-chess-accent/30 text-chess-accent text-[10px] font-extrabold uppercase tracking-[1.5px]">
            {tier.name}
          </div>
        </div>
      </div>

      {/* Radar + scores grid */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-3 items-center">
        <div className="rounded-xl bg-black/20 border border-chess-border/30 p-3">
          <Radar dims={orderedDims} />
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {orderedDims.map((d) => (
            <DimStat key={d.id} abbr={DIM_ABBR[d.id] ?? d.id.slice(0, 3).toUpperCase()} score={d.score} />
          ))}
        </div>
      </div>

      {/* Platform ratings — always render all three rows so the card has a
          consistent footprint. Each row falls back to its own empty state. */}
      <div className="px-4 pt-4 pb-4">
        <div className="text-[10px] font-extrabold uppercase tracking-[1.8px] text-chess-text-tertiary mb-2">
          Platform ratings
        </div>
        <div className="space-y-2">
          <PlatformRow
            label="Chess.com"
            subtitle={username || null}
            ratings={platformRatings.chesscom}
          />
          <PlatformRow
            label="Lichess"
            subtitle={lichessUsername || null}
            ratings={platformRatings.lichess}
          />
          <PlatformRow
            label="FIDE"
            subtitle={fideId || null}
            ratings={[]}
          />
        </div>
      </div>
    </div>
  );
}

function DimStat({ abbr, score }: { abbr: string; score: number }) {
  return (
    <div className="flex items-baseline justify-between border-b border-chess-border/20 pb-1.5">
      <div className="text-[10px] font-extrabold uppercase tracking-[1.8px] text-chess-text-tertiary">{abbr}</div>
      <div className="text-[20px] font-extrabold tabular-nums text-chess-text leading-none">{score}</div>
    </div>
  );
}

function PlatformRow({
  label,
  subtitle,
  ratings,
}: {
  label: string;
  subtitle: string | null;
  ratings: Array<{ tc: string; rating: number }>;
}) {
  // Always render the same 3-column shape (Bullet/Blitz/Rapid). Missing
  // values render as a dash so every platform's row has the same height.
  const tcs = ['Bullet', 'Blitz', 'Rapid'] as const;
  const byTc = new Map(ratings.map((r) => [r.tc, r.rating]));
  return (
    <div className="rounded-lg bg-black/20 border border-chess-border/20 p-2.5">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[11px] font-extrabold uppercase tracking-[1.4px] text-chess-text">{label}</span>
        <span className="text-[10px] text-chess-text-tertiary mx-1">—</span>
        <span className="text-[11px] font-bold text-chess-accent uppercase truncate">{subtitle ?? '—'}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tcs.map((tc) => {
          const rating = byTc.get(tc);
          return (
            <div key={tc} className="rounded-md bg-chess-surface/60 px-2 py-1.5 text-center">
              <div className={`text-[16px] font-extrabold tabular-nums leading-none ${rating ? 'text-chess-text' : 'text-chess-text-tertiary'}`}>
                {rating ?? '—'}
              </div>
              <div className="text-[9px] font-bold text-chess-text-tertiary uppercase tracking-[1.4px] mt-1">{tc}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────── Hero card ─────────────── */
function HeroCard({
  profile,
  tier,
  username,
  orderedDims,
  photo,
  onPickPhoto,
}: {
  profile: SkillProfile;
  tier: RankTier;
  username: string;
  orderedDims: SkillProfile['dimensions'];
  photo: string | null;
  onPickPhoto: () => void;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-chess-border/30 bg-chess-surface"
      style={GRID_BG_STYLE}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="flex items-center gap-1.5">
          <img src="/favicon.png" alt="" width={16} height={16} className="rounded-sm" />
          <span className="text-[11px] font-extrabold tracking-[1.5px] text-chess-text uppercase">Player card</span>
        </div>
      </div>

      {/* Photo + side scores */}
      <div className="flex gap-3 px-4 pt-4">
        <button
          type="button"
          onClick={onPickPhoto}
          className="flex-1 aspect-[3/4] rounded-xl border-2 border-dashed border-chess-accent/30 bg-black/20 flex flex-col items-center justify-center text-center px-4 overflow-hidden"
          style={photo ? { backgroundImage: `url(${photo})`, backgroundSize: 'cover', backgroundPosition: 'center', borderStyle: 'solid' } : undefined}
        >
          {!photo && (
            <>
              <div className="w-12 h-12 rounded-full bg-chess-accent/15 border border-chess-accent/30 flex items-center justify-center mb-2">
                <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-chess-accent">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
              <div className="text-[14px] font-extrabold text-chess-text">Add a photo</div>
              <div className="text-[11px] text-chess-text-tertiary mt-1 max-w-[220px]">
                Personalize your card with a portrait or tournament shot.
              </div>
            </>
          )}
        </button>

        {/* Vertical scores */}
        <div className="w-14 flex flex-col gap-2 rounded-xl border border-chess-accent/30 px-1 py-2 items-center">
          {orderedDims.map((d) => (
            <div key={d.id} className="text-center">
              <div className="text-[18px] font-extrabold tabular-nums text-chess-text leading-none">{d.score}</div>
              <div className="text-[9px] font-extrabold text-chess-accent uppercase tracking-[1.4px] mt-0.5">
                {DIM_ABBR[d.id] ?? d.id.slice(0, 3).toUpperCase()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Score + name */}
      <div className="px-4 pt-3 pb-4">
        <div className="text-chess-accent font-black tabular-nums leading-none" style={{ fontSize: 'clamp(56px, 14vw, 80px)' }}>
          {profile.overallRating}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[15px] font-extrabold uppercase tracking-[1.5px] text-chess-text truncate">
            {username}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-chess-accent/30 text-chess-accent text-[10px] font-extrabold uppercase tracking-[1.5px]">
            {tier.name}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Radar ─────────────── */
function Radar({ dims }: { dims: SkillProfile['dimensions'] }) {
  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 18;
  const n = dims.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i: number, t: number) => {
    const a = angle(i);
    return { x: cx + Math.cos(a) * r * t, y: cy + Math.sin(a) * r * t };
  };
  const polyPoints = dims
    .map((d, i) => {
      const p = point(i, Math.max(0, Math.min(1, d.score / 99)));
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');
  const ringPoints = (t: number) =>
    Array.from({ length: n }, (_, i) => {
      const p = point(i, t);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }).join(' ');

  // Pad the viewBox so axis labels sitting just outside the outer ring
  // don't get clipped on the left/right edges.
  const pad = 22;
  return (
    <svg viewBox={`${-pad} ${-8} ${size + pad * 2} ${size + 16}`} width="100%" className="block">
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <polygon key={t} points={ringPoints(t)} fill="none" stroke="rgba(252,211,77,0.12)" strokeWidth={1} />
      ))}
      {dims.map((_, i) => {
        const p = point(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(252,211,77,0.1)" strokeWidth={1} />;
      })}
      <polygon points={polyPoints} fill="rgba(252,211,77,0.18)" stroke="#fcd34d" strokeWidth={1.5} />
      {dims.map((d, i) => {
        const p = point(i, Math.max(0, Math.min(1, d.score / 99)));
        return <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#a855f7" />;
      })}
      {dims.map((d, i) => {
        const p = point(i, 1.18);
        return (
          <text
            key={d.id}
            x={p.x}
            y={p.y}
            fontSize="8"
            fontWeight="800"
            letterSpacing="0.5"
            fill="#94a3b8"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {DIM_ABBR[d.id] ?? d.id.slice(0, 3).toUpperCase()}
          </text>
        );
      })}
    </svg>
  );
}

/* ─────────────── Platform-rating derivation ─────────────── */

interface RatingEntry { tc: string; rating: number }
interface PlatformRatings { chesscom: RatingEntry[]; lichess: RatingEntry[] }

/** Fetch live chess.com per-time-class ratings from the public stats API.
 *  Returns an empty array on any error so the card silently falls back to
 *  game-derived ratings. */
async function fetchChessComRatings(username: string): Promise<RatingEntry[]> {
  try {
    const resp = await fetchChessCom(`${CHESS_COM_API_BASE}/player/${username.toLowerCase()}/stats`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return [];
    const data = await resp.json() as Record<string, { last?: { rating?: number } }>;
    const out: RatingEntry[] = [];
    for (const tc of ['bullet', 'blitz', 'rapid'] as const) {
      const rating = data[`chess_${tc}`]?.last?.rating;
      if (typeof rating === 'number' && rating > 0) {
        out.push({ tc: tc.charAt(0).toUpperCase() + tc.slice(1), rating });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Fetch live Lichess per-time-class ratings from the public user API. */
async function fetchLichessRatings(username: string): Promise<RatingEntry[]> {
  try {
    const resp = await fetch(`https://lichess.org/api/user/${username}`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { perfs?: Record<string, { rating?: number }> };
    const out: RatingEntry[] = [];
    for (const tc of ['bullet', 'blitz', 'rapid'] as const) {
      const rating = data.perfs?.[tc]?.rating;
      if (typeof rating === 'number' && rating > 0) {
        out.push({ tc: tc.charAt(0).toUpperCase() + tc.slice(1), rating });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Pick the most recent rating per (platform, time class) from the user's
 *  game history. We only show Bullet/Blitz/Rapid (skipping Daily) since
 *  those are the standard-display columns. */
function derivePlatformRatings(games: GameRecord[]): PlatformRatings {
  const tcs: TimeClass[] = ['bullet', 'blitz', 'rapid'];
  const sorted = [...games].sort((a, b) => b.playedAt - a.playedAt);
  const pickLatest = (predicate: (g: GameRecord) => boolean): RatingEntry[] => {
    const out: RatingEntry[] = [];
    for (const tc of tcs) {
      const g = sorted.find(
        (game) => predicate(game) && game.timeClass === tc && (game.player.rating ?? 0) > 0,
      );
      if (g) out.push({ tc: tc.charAt(0).toUpperCase() + tc.slice(1), rating: g.player.rating });
    }
    return out;
  };
  return {
    chesscom: pickLatest((g) => /chess\.com/i.test(g.url)),
    lichess: pickLatest((g) => /lichess\.org/i.test(g.url)),
  };
}
