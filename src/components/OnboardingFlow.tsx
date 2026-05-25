/* ────────────────────────────────────────────────────────────────────────
 *  OnboardingFlow — 5-screen onboarding sequence per Claude Design.
 *
 *  Stage 0: <LandingScreen> → click Get Started → <ConnectScreen>
 *  Stage 1: <DecodingScreen>
 *  Stage 2: <UnlockScreen> → click Unlock → <RadarRevealScreen>
 *
 *  All screens preserve the existing import + analysis logic from
 *  Overview.tsx's Stage0Connect/Stage1Analysis/Stage2RadarReveal.
 * ──────────────────────────────────────────────────────────────────────── */
import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { CHESS_COM_API_BASE } from '@shared/constants';
import { fetchChessCom } from '@/api/chess-com-fetch';
import { countryToFlag, extractCountryCode } from '@/api/chess-com-leaderboard';
import { importChessComGames } from '@/api/chess-com-import';
import { analysisEvents } from '@/engine/analysis-events';
import { useT, SUPPORTED_LANGUAGES } from '@/i18n/index';
import SkillRadar from '@/components/SkillRadar';
import OrbitDnaLoader from '@/components/OrbitDnaLoader';
import { base44 } from '@/api/base44Client';
import { useChessData } from '@/contexts/ChessDataContext';
import { splitMultiGamePgn, parsePgnToGameRecord } from '@shared/utils/chess-utils';
import type { GameRecord, TimeClass } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { UserSettings } from '@shared/types/storage';
import type { CurrentPatterns } from '@shared/types/patterns';
import { calculateSkillProfile } from '@/patterns/skill-calculator';

type ImportSource = 'chesscom' | 'lichess' | 'pgn';

/** Short relative-time formatter, e.g. "3d ago", "2h ago", "today". */
function timeAgoShort(unixMs: number): string {
  const diffMs = Date.now() - unixMs;
  if (diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? 'yesterday' : `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

/* ════════════════════════════════════════════════════════════════════════
   1) LandingScreen — wordmark + lang pills + logo + tagline + GET STARTED
   ════════════════════════════════════════════════════════════════════════ */

interface LandingScreenProps {
  settings: UserSettings;
  onSettingsChange: (patch: Partial<UserSettings>) => Promise<void>;
  onGetStarted: () => void;
}

export function LandingScreen({ settings, onSettingsChange, onGetStarted }: LandingScreenProps) {
  const { t } = useT();

  return (
    <div className="min-h-[80vh] flex flex-col px-5 pt-2 pb-8 max-w-md mx-auto w-full">
      {/* Top bar — wordmark left + lang pills right */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-lg font-extrabold text-chess-accent tracking-tight">Chess DNA</span>
        <div className="flex items-center gap-1">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const active = settings.language === lang.code;
            return (
              <button
                key={lang.code}
                onClick={() => {
                  onSettingsChange({ language: lang.code } as Partial<UserSettings>);
                  try { localStorage.setItem('chess-dna-language', lang.code); } catch { /* ignore */ }
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
                  active
                    ? 'bg-chess-accent/10 text-chess-accent border border-chess-accent/45'
                    : 'text-chess-text-secondary border border-transparent hover:text-chess-text'
                }`}
              >
                {lang.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Centered content */}
      <div className="flex-1 flex flex-col items-center justify-center text-center pt-2">
        <div
          className="w-[138px] h-[138px] rounded-[28px] overflow-hidden mb-9 animate-scale-in"
          style={{ boxShadow: '0 0 48px rgba(74,222,128,0.18), 0 18px 32px rgba(0,0,0,0.5)' }}
        >
          <img src="/favicon.png" alt="Chess DNA" className="w-full h-full object-cover" />
        </div>

        <p className="text-lg font-bold text-chess-text leading-snug mb-7 max-w-[320px] animate-fade-in-up">
          {t('s0_desc')}
        </p>

        <button
          onClick={onGetStarted}
          data-track="landing_get_started"
          className="w-full max-w-[360px] py-4 rounded-full text-base font-extrabold tracking-wider uppercase transition-all animate-fade-in-up"
          style={{
            background: '#22c55e',
            color: '#062b14',
            boxShadow: '0 6px 22px rgba(34,197,94,0.35), inset 0 -2px 0 rgba(0,0,0,0.18)',
            animationDelay: '0.1s',
          }}
        >
          {t('s0_get_started')}
        </button>
      </div>

      {/* 3 pillars */}
      <div className="grid grid-cols-3 gap-2.5 mt-auto pt-6 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
        {[
          { label: t('s0_reveal'), icon: 'star' },
          { label: t('s0_patterns'), icon: 'search' },
          { label: t('s0_practice'), icon: 'loop' },
        ].map((p) => (
          <div
            key={p.label}
            className="bg-chess-surface/60 border border-chess-border/45 rounded-2xl px-2 pt-3.5 pb-3 text-center"
          >
            <div
              className="w-[38px] h-[38px] rounded-[10px] mx-auto mb-2 flex items-center justify-center text-chess-accent"
              style={{
                border: '1px solid rgba(74,222,128,0.22)',
                background: 'rgba(74,222,128,0.06)',
              }}
            >
              {p.icon === 'star' && <PillarIcon variant="star" />}
              {p.icon === 'search' && <PillarIcon variant="search" />}
              {p.icon === 'loop' && <PillarIcon variant="loop" />}
            </div>
            <div className="text-[11px] text-chess-text-secondary leading-tight font-medium">
              {p.label}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 text-center animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
        <a
          href="/learn/how-to-improve-at-chess.html"
          className="text-[12px] text-chess-text-secondary hover:text-chess-accent transition-colors"
        >
          Learn how to use Chess DNA to improve →
        </a>
      </div>
    </div>
  );
}

function PillarIcon({ variant }: { variant: 'star' | 'search' | 'loop' }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none' as const, stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (variant === 'star') {
    return (
      <svg {...common} strokeWidth="1.6">
        <polygon points="12 2 19.5 8 17.5 17 6.5 17 4.5 8" />
        <line x1="12" y1="2" x2="12" y2="12" /><line x1="19.5" y1="8" x2="12" y2="12" />
        <line x1="17.5" y1="17" x2="12" y2="12" /><line x1="6.5" y1="17" x2="12" y2="12" />
        <line x1="4.5" y1="8" x2="12" y2="12" />
      </svg>
    );
  }
  if (variant === 'search') {
    return (
      <svg {...common} strokeWidth="1.7">
        <circle cx="11" cy="11" r="7" />
        <line x1="20" y1="20" x2="16.5" y2="16.5" />
        <circle cx="11" cy="11" r="2.5" />
      </svg>
    );
  }
  return (
    <svg {...common} strokeWidth="1.7">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   2) ConnectScreen — multi-source picker + username + time-control picker
   ════════════════════════════════════════════════════════════════════════ */

interface ConnectScreenProps {
  isGuest: boolean;
  onSettingsChange: (patch: Partial<UserSettings>) => Promise<void>;
  onImportComplete: () => void;
  onBack: () => void;
}

const TC_OPTIONS: { id: TimeClass; label: string; sub: string }[] = [
  { id: 'bullet', label: 'Bullet', sub: '1+0' },
  { id: 'blitz', label: 'Blitz', sub: '5+0' },
  { id: 'rapid', label: 'Rapid', sub: '10+0' },
  { id: 'daily', label: 'Daily', sub: '∞' },
];

export function ConnectScreen({
  isGuest,
  onSettingsChange,
  onImportComplete,
  onBack,
}: ConnectScreenProps) {
  const { t } = useT();
  const [pgnModalOpen, setPgnModalOpen] = useState(false);
  const [username, setUsername] = useState('');
  // Source tab: Chess.com / Lichess / PGN. Default to Chess.com.
  const [source, setSource] = useState<ImportSource>('chesscom');
  // Username verification status — drives the inline ✓ / ✕ icon next to the
  // input so the user instantly knows we recognized their handle.
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'found' | 'notfound'>('idle');
  // Per-source verified usernames. When a username verifies as found we
  // record it here so a ✓ badge can render on that tab — and so switching
  // away and back restores what they typed last time.
  const [verifiedUsernames, setVerifiedUsernames] = useState<Partial<Record<'chesscom' | 'lichess', string>>>({});
  // Profile summary for the verified handle — used on step 2 above the CTA
  // so the user can sanity-check we picked the right account.
  const [profileSummary, setProfileSummary] = useState<{
    countryCode?: string;
    elo?: number;
    lastSeen?: number; // unix ms
  } | null>(null);
  // Two-stage flow: collect username first, then pick a time class. The
  // header back-arrow doubles as a stage-aware back: on step 2 it returns
  // to step 1; on step 1 it returns to the Landing screen.
  const [subStep, setSubStep] = useState<'username' | 'timeclass'>('username');
  const [startTimeClass, setStartTimeClass] = useState<TimeClass>('rapid');
  const [tcCounts, setTcCounts] = useState<Partial<Record<TimeClass, number>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<{
    phase: 'idle' | 'validating' | 'fetching' | 'done';
    fetched: number;
    total: number;
    error?: string;
  }>({ phase: 'idle', fetched: 0, total: 0 });

  const isFetching = fetchState.phase === 'fetching' || fetchState.phase === 'validating';
  const isDone = fetchState.phase === 'done';

  /* When the source tab changes: restore the previously-verified username
     for that tab (so the ✓ persists across tab switches), or clear if none. */
  useEffect(() => {
    if (source === 'pgn') {
      setUsername('');
      setUsernameStatus('idle');
      setTcCounts({});
      setProfileSummary(null);
      return;
    }
    const saved = verifiedUsernames[source];
    if (saved) {
      setUsername(saved);
      setUsernameStatus('found');
    } else {
      setUsername('');
      setUsernameStatus('idle');
      setTcCounts({});
      setProfileSummary(null);
    }
    // We intentionally only react to source changes here — verifiedUsernames
    // is read fresh each time but should not retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  /* Debounced username verification + per-time-class game counts. Hits the
     Chess.com or Lichess API depending on the active source tab. PGN tab
     has no username, so this is a no-op. */
  useEffect(() => {
    if (source === 'pgn') { setUsernameStatus('idle'); return; }
    const trimmed = username.trim();
    if (trimmed.length < 3) {
      setUsernameStatus('idle');
      setTcCounts({});
      return;
    }
    setUsernameStatus('checking');
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        if (source === 'chesscom') {
          // Fetch profile + stats in parallel — both are required for the
          // ✓ + the profile chip on step 2 (country, peak ELO, last seen).
          const [profileResp, statsResp] = await Promise.all([
            fetchChessCom(`${CHESS_COM_API_BASE}/player/${trimmed.toLowerCase()}`, {
              headers: { Accept: 'application/json' },
            }),
            fetchChessCom(`${CHESS_COM_API_BASE}/player/${trimmed.toLowerCase()}/stats`, {
              headers: { Accept: 'application/json' },
            }),
          ]);
          if (cancelled) return;
          if (!profileResp.ok || !statsResp.ok) { setUsernameStatus('notfound'); return; }
          const profile = await profileResp.json() as { country?: string; last_online?: number };
          const stats = await statsResp.json() as Record<string, { record?: { win?: number; loss?: number; draw?: number }; last?: { rating?: number } }>;
          if (cancelled) return;
          const counts: Partial<Record<TimeClass, number>> = {};
          const ratings: number[] = [];
          for (const tc of ['bullet', 'blitz', 'rapid', 'daily'] as TimeClass[]) {
            const key = `chess_${tc}`;
            const r = stats[key]?.record;
            if (r) counts[tc] = (r.win ?? 0) + (r.loss ?? 0) + (r.draw ?? 0);
            const rating = stats[key]?.last?.rating;
            if (typeof rating === 'number') ratings.push(rating);
          }
          setTcCounts(counts);
          setProfileSummary({
            countryCode: profile.country ? extractCountryCode(profile.country) : undefined,
            elo: ratings.length ? Math.max(...ratings) : undefined,
            lastSeen: profile.last_online ? profile.last_online * 1000 : undefined,
          });
          setUsernameStatus('found');
          setVerifiedUsernames(prev => ({ ...prev, chesscom: trimmed }));
        } else if (source === 'lichess') {
          const resp = await fetch(`https://lichess.org/api/user/${trimmed}`, {
            headers: { Accept: 'application/json' },
          });
          if (cancelled) return;
          if (!resp.ok) { setUsernameStatus('notfound'); return; }
          const data = await resp.json() as {
            perfs?: Record<string, { games?: number; rating?: number }>;
            profile?: { country?: string };
            seenAt?: number;
          };
          if (cancelled) return;
          const counts: Partial<Record<TimeClass, number>> = {};
          const perfMap: Record<TimeClass, string> = { bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', daily: 'correspondence' };
          const ratings: number[] = [];
          for (const tc of ['bullet', 'blitz', 'rapid', 'daily'] as TimeClass[]) {
            const games = data.perfs?.[perfMap[tc]]?.games;
            if (typeof games === 'number') counts[tc] = games;
            const rating = data.perfs?.[perfMap[tc]]?.rating;
            if (typeof rating === 'number') ratings.push(rating);
          }
          setTcCounts(counts);
          setProfileSummary({
            countryCode: data.profile?.country,
            elo: ratings.length ? Math.max(...ratings) : undefined,
            lastSeen: data.seenAt,
          });
          setUsernameStatus('found');
          setVerifiedUsernames(prev => ({ ...prev, lichess: trimmed }));
        }
      } catch {
        if (!cancelled) setUsernameStatus('idle');
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [username, source]);

  const handleConnect = async () => {
    const trimmed = username.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setFetchState({ phase: 'validating', fetched: 0, total: 0 });

    try {
      {
        const resp = await fetchChessCom(`${CHESS_COM_API_BASE}/player/${trimmed.toLowerCase()}`, {
          headers: { Accept: 'application/json' },
        });
        if (!resp.ok) {
          setError('Username not found on Chess.com');
          setFetchState({ phase: 'idle', fetched: 0, total: 0 });
          setLoading(false);
          return;
        }

        setFetchState({ phase: 'fetching', fetched: 0, total: 5 });
        // Try the user-picked time class first, then fall back to others
        const tried = new Set<TimeClass | 'all'>();
        const order: Array<TimeClass | 'all'> = [
          startTimeClass,
          ...(['rapid', 'blitz', 'bullet', 'daily', 'all'] as Array<TimeClass | 'all'>).filter((tc) => tc !== startTimeClass),
        ];
        let onboardingIds: string[] = [];
        let usedTimeClass: string = startTimeClass;
        for (const tc of order) {
          if (tried.has(tc)) continue;
          tried.add(tc);
          onboardingIds = await importChessComGames(trimmed, {
            timeClass: tc, maxGames: 5, guest: isGuest,
            onProgress: (progress) => {
              setFetchState({
                phase: progress.done ? 'done' : 'fetching',
                fetched: progress.fetched,
                total: progress.total || 5,
                error: progress.error,
              });
            },
          });
          if (onboardingIds.length > 0) { usedTimeClass = String(tc); break; }
        }

        await onSettingsChange({
          chesscomUsername: trimmed,
          onboardingGameIds: onboardingIds,
          onboardingTimeClass: usedTimeClass,
          selectedTimeClass: (usedTimeClass === 'all' ? null : usedTimeClass) as TimeClass | null,
        });
        onImportComplete();

        // Background import (other time classes) — fire and forget
        (async () => {
          try {
            for (const tc of ['rapid', 'blitz', 'bullet', 'daily'] as TimeClass[]) {
              if (tc === startTimeClass) continue;
              await importChessComGames(trimmed, { timeClass: tc, maxGames: 30, guest: isGuest });
            }
          } catch { /* ignore */ } finally {
            onSettingsChange({ bulkImportDone: true });
          }
        })();
      }
    } catch {
      setError('Could not connect. Check your internet.');
      setFetchState({ phase: 'idle', fetched: 0, total: 0 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100vh] flex flex-col px-5 pt-2 pb-8 max-w-md mx-auto w-full">
      {/* Heading — pinned to the top. Top row holds the Back button + step
          dots on a single horizontal line; the DNA icon sits below with
          generous spacing so it reads as the visual anchor. */}
      <div className="text-center mb-5 pt-2">
        <div className="relative flex items-center justify-center min-h-[28px]">
          <button
            onClick={subStep === 'timeclass' ? () => setSubStep('username') : onBack}
            className="absolute start-0 inline-flex items-center gap-1 text-chess-text-tertiary text-xs font-medium hover:text-chess-text transition-colors py-1.5 px-1"
            aria-label="Back"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rtl:rotate-180">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          {/* Step indicator — same horizontal line as the Back button */}
          <div className="flex items-center justify-center gap-1.5">
            <span
              className="rounded-full transition-all"
              style={{
                width: subStep === 'username' ? 18 : 6,
                height: 6,
                background: 'rgb(var(--chess-accent))',
                opacity: subStep === 'username' ? 1 : 0.55,
              }}
            />
            <span
              className="rounded-full transition-all"
              style={{
                width: subStep === 'timeclass' ? 18 : 6,
                height: 6,
                background: 'rgb(var(--chess-accent))',
                opacity: subStep === 'timeclass' ? 1 : 0.35,
              }}
            />
          </div>
        </div>
        <DnaIcon size={56} className="text-chess-accent mx-auto mt-7" />
      </div>

      {/* Step title — sits right under the heading so it doesn't get pushed
          down by the centered body. Per-step copy. */}
      <div className="text-center mb-2 px-2">
        {subStep === 'username' ? (
          <>
            <h2 className="text-2xl font-extrabold text-chess-text leading-tight">
              Bring your chess history
            </h2>
            <p className="text-[13px] text-chess-text-secondary mt-1.5 leading-snug">
              We pull your recent games history — the patterns are already in there.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-extrabold text-chess-text leading-tight">
              Where do you focus recently?
            </h2>
            <p className="text-[13px] text-chess-text-secondary mt-1.5 leading-snug">
              We'll start with your main format and sweep the rest in the background.
            </p>
          </>
        )}
      </div>

      {/* Body — flows top-to-bottom with breathing room between blocks.
          Footer is pinned to the bottom via its own mt-auto. */}
      <div className="flex flex-col gap-5 pt-3">
      {/* Step 1 — Source tabs + per-source content. */}
      {subStep === 'username' && (
        <>
          {/* Connector sentence — introduces the input ask. */}
          <p className="text-center text-[12px] text-chess-text-secondary mb-3">
            {source === 'pgn'
              ? 'Drop in a PGN file with your games.'
              : 'Add your username, no password needed.'}
          </p>

          {/* Source tab cards — 3-up grid. Each tab shows the source icon,
              the platform name, and a short label. A small ✓ badge appears
              in the corner of any tab whose username has already been
              verified, so the user knows that integration is "saved". */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {(['chesscom', 'lichess', 'pgn'] as ImportSource[]).map((s) => {
              const active = source === s;
              const label = s === 'chesscom' ? 'Chess.com' : s === 'lichess' ? 'Lichess' : 'PGN';
              const sub = s === 'pgn' ? 'Upload file' : 'Username';
              const verified = s !== 'pgn' && Boolean(verifiedUsernames[s]);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  data-track="connect_source_tab"
                  data-track-source={s}
                  className={`relative flex flex-col items-center justify-center gap-1.5 py-3.5 px-2 rounded-xl border transition-all ${
                    active
                      ? 'bg-chess-accent/[0.07] border-chess-accent shadow-[0_0_18px_rgba(74,222,128,0.22)]'
                      : 'bg-chess-surface/60 border-chess-border/40 hover:border-chess-border/70'
                  }`}
                >
                  {verified && (
                    <span
                      className="absolute top-1.5 end-1.5 inline-flex items-center justify-center rounded-full bg-chess-accent text-chess-bg shadow-[0_0_8px_rgba(74,222,128,0.5)]"
                      style={{ width: 16, height: 16 }}
                      aria-label="Username saved"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  )}
                  <SourceGlyph kind={s} active={active} />
                  <div className={`text-[13px] font-extrabold leading-tight mt-1 ${active ? 'text-chess-accent' : 'text-chess-text'}`}>
                    {label}
                  </div>
                  <div className="text-[10px] text-chess-text-tertiary leading-tight">
                    {sub}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Input section — labeled with the active source. */}
          {source !== 'pgn' ? (
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[1.6px] text-chess-text-tertiary mb-1.5">
                {source === 'chesscom' ? 'Chess.com username' : 'Lichess username'}
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && username.trim() && !isFetching && usernameStatus !== 'notfound') {
                      setSubStep('timeclass');
                    }
                  }}
                  placeholder={source === 'chesscom' ? 'magnus_carlsen' : 'DrNykterstein'}
                  disabled={isFetching || isDone}
                  autoFocus
                  className="w-full bg-chess-bg border border-chess-accent/40 rounded-xl px-3.5 py-3 pr-10 text-base text-chess-text placeholder:text-chess-text-tertiary/60 font-mono focus:outline-none focus:border-chess-accent disabled:opacity-50"
                />
                <div className="absolute end-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center">
                  {usernameStatus === 'checking' && (
                    <span className="inline-block w-4 h-4 border-[1.5px] border-chess-text-tertiary border-t-chess-accent rounded-full animate-spin" />
                  )}
                  {usernameStatus === 'found' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-chess-accent">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  {usernameStatus === 'notfound' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-chess-blunder">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                </div>
              </div>
              {usernameStatus === 'notfound' && (
                <p className="text-chess-blunder text-[11px] mt-1.5">
                  We couldn't find that handle on {source === 'chesscom' ? 'Chess.com' : 'Lichess'}.
                </p>
              )}
              {error && <p className="text-chess-blunder text-xs mt-2">{error}</p>}
            </div>
          ) : (
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[1.6px] text-chess-text-tertiary mb-1.5">
                Upload PGN
              </div>
              <button
                type="button"
                onClick={() => setPgnModalOpen(true)}
                className="w-full bg-chess-bg border border-chess-accent/40 rounded-xl py-3 text-sm font-bold text-chess-accent hover:bg-chess-accent/10 transition-all"
              >
                Choose .pgn file →
              </button>
            </div>
          )}

        </>
      )}

      {/* Time-control picker — primary "where do we start" choice (step 2).
          Header (START WITH / 5 games) lives above the card so the card itself
          is just the option grid. */}
      {subStep === 'timeclass' && (
        <>
          <div className="flex items-baseline justify-between mb-2.5 px-1">
            <div>
              <div className="text-[9px] text-chess-text-tertiary tracking-[1.8px] font-bold uppercase">
                Start with
              </div>
              <div className="text-xs text-chess-text-secondary mt-0.5">
                We'll import these first — others later.
              </div>
            </div>
            <span className="text-xs font-bold text-chess-accent tabular-nums">5 games</span>
          </div>
          <div className="bg-chess-surface rounded-xl p-3.5 border border-chess-border/30 mb-3">
            <div className="grid grid-cols-4 gap-1.5">
            {TC_OPTIONS.map((t) => {
              const active = t.id === startTimeClass;
              const count = tcCounts[t.id];
              return (
                <button
                  key={t.id}
                  onClick={() => setStartTimeClass(t.id)}
                  className={`py-2.5 px-1 rounded-[9px] text-center transition-all relative ${
                    active
                      ? 'bg-chess-accent/15 border border-chess-accent/40 shadow-[0_0_12px_rgba(74,222,128,0.18)]'
                      : 'bg-chess-bg border border-chess-border/30 hover:border-chess-border/50'
                  }`}
                >
                  <div className={`text-[13px] font-extrabold leading-tight ${active ? 'text-chess-accent' : 'text-chess-text'}`}>
                    {t.label}
                  </div>
                  {count != null && (
                    <div className={`text-[10px] tabular-nums mt-1 font-semibold ${active ? 'text-chess-text' : 'text-chess-text-tertiary'}`}>
                      {count}
                    </div>
                  )}
                </button>
              );
            })}
            </div>
          </div>

          {/* Profile chip — concise sanity-check that we picked the right
              account: country flag, peak ELO, last-seen freshness. Sits
              right above the CTA on step 2. */}
          {profileSummary && (() => {
            const { countryCode, elo, lastSeen } = profileSummary;
            const items: Array<{ key: string; node: ReactNode }> = [];
            if (countryCode) {
              items.push({
                key: 'country',
                node: (
                  <span className="flex items-center gap-1">
                    <span className="text-base leading-none">{countryToFlag(countryCode)}</span>
                    <span className="font-semibold uppercase tracking-wider">{countryCode}</span>
                  </span>
                ),
              });
            }
            if (typeof elo === 'number') {
              items.push({
                key: 'elo',
                node: (
                  <span>
                    <span className="font-extrabold text-chess-text tabular-nums">{elo}</span>
                    <span className="ms-1 uppercase tracking-wider text-[9px]">peak</span>
                  </span>
                ),
              });
            }
            if (typeof lastSeen === 'number') {
              items.push({ key: 'last', node: <span>Active {timeAgoShort(lastSeen)}</span> });
            }
            if (items.length === 0) return null;
            return (
              <div className="flex items-center justify-center gap-3 text-[11px] text-chess-text-secondary px-2 -mb-1">
                {items.map((it, i) => (
                  <span key={it.key} className="flex items-center gap-3">
                    {it.node}
                    {i < items.length - 1 && <span className="text-chess-border">·</span>}
                  </span>
                ))}
              </div>
            );
          })()}
        </>
      )}

      {/* CTA — step-aware. On step 1: Continue advances to step 2 for
          chesscom/lichess; on PGN it opens the upload modal. On step 2:
          imports the games. */}
      {subStep === 'username' ? (
        <button
          onClick={() => {
            if (source === 'pgn') {
              setPgnModalOpen(true);
            } else if (username.trim()) {
              setSubStep('timeclass');
            }
          }}
          disabled={source !== 'pgn' && usernameStatus !== 'found'}
          data-track="connect_continue"
          data-track-source={source}
          className="w-full bg-chess-accent text-chess-bg py-3.5 rounded-xl text-sm font-extrabold hover:brightness-110 transition-all shadow-[0_0_14px_rgba(74,222,128,0.3)] disabled:opacity-50"
        >
          Continue →
        </button>
      ) : (
        <button
          onClick={handleConnect}
          disabled={loading || isFetching || isDone || !username.trim()}
          data-track="connect_reveal_dna"
          data-track-source={source}
          data-track-timeclass={startTimeClass}
          className="w-full bg-chess-accent text-chess-bg py-3.5 rounded-xl text-sm font-extrabold hover:brightness-110 transition-all shadow-[0_0_14px_rgba(74,222,128,0.3)] disabled:opacity-50"
        >
          {loading && !isFetching ? t('onboarding_connecting') : 'Reveal my DNA →'}
        </button>
      )}

      {/* Marketing teaser — value props sit below the CTA, as a
          reassurance for users who might hesitate at the input. */}
      {subStep === 'username' && (
        <div className="mt-6 px-0.5">
          <div className="text-[10px] font-extrabold uppercase tracking-[1.6px] text-chess-accent mb-2.5">
            You're moments away from
          </div>
          <ul className="space-y-2">
            {[
              'Your full Chess DNA — 8 skills, scored',
              'AI breakdowns of every game you play',
              'The patterns quietly costing you rating',
              'Targeted practice on your weakest moves',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-[12.5px] text-chess-text leading-snug">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-chess-accent mt-[3px] shrink-0"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pgnModalOpen && (
        <PgnImportModal
          onClose={() => setPgnModalOpen(false)}
          onImportComplete={onImportComplete}
        />
      )}
      </div>

      <p className="text-[10px] text-chess-text-tertiary text-center mt-auto pt-5 leading-relaxed">
        Read-only · No password needed · Nothing stored on our servers
      </p>

      {/* Once the import starts, take over the screen with the Decoding loader so
          the user lands directly on the next stage (rather than watching an
          inline progress bar on the Connect screen). */}
      {(isFetching || isDone) && (
        <div className="fixed inset-0 z-[55] bg-chess-bg flex flex-col items-center justify-center px-6" data-theme="dark">
          <div className="relative">
            <div
              className="absolute -inset-20 pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(74,222,128,0.18), transparent 70%)', filter: 'blur(20px)' }}
            />
            <OrbitDnaLoader size={168} />
          </div>
          <h2 className="text-lg font-extrabold tracking-tight text-chess-text mt-6">Decoding your Chess DNA</h2>
          <p className="text-xs text-chess-text-secondary mt-1.5">Importing and analyzing every move</p>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   PgnImportModal — popup for uploading/pasting a PGN without leaving onboarding.
   ════════════════════════════════════════════════════════════════════════ */

interface PgnImportModalProps {
  onClose: () => void;
  onImportComplete: () => void;
}

function PgnImportModal({ onClose, onImportComplete }: PgnImportModalProps) {
  const { allGames, refetchGames } = useChessData();
  const [pgnText, setPgnText] = useState('');
  const [importState, setImportState] = useState<{
    phase: 'idle' | 'importing' | 'done';
    imported: number;
    total: number;
    error?: string;
  }>({ phase: 'idle', imported: 0, total: 0 });
  const [pgnGuideOpen, setPgnGuideOpen] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPgnText(reader.result);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImport = async () => {
    if (!pgnText.trim()) return;
    setImportState({ phase: 'importing', imported: 0, total: 0 });

    const pgns = splitMultiGamePgn(pgnText);
    if (pgns.length === 0) {
      setImportState({
        phase: 'done',
        imported: 0,
        total: 0,
        error: 'No valid PGN games found. Make sure each game starts with [Event "..."]',
      });
      return;
    }

    const existingFingerprints = new Set<string>();
    for (const g of allGames) {
      const fp = `${g.player?.username?.toLowerCase() ?? ''}|${g.opponent?.username?.toLowerCase() ?? ''}|${g.totalMoves}|${new Date(g.playedAt).toISOString().slice(0, 10)}`;
      existingFingerprints.add(fp);
      const fpRev = `${g.opponent?.username?.toLowerCase() ?? ''}|${g.player?.username?.toLowerCase() ?? ''}|${g.totalMoves}|${new Date(g.playedAt).toISOString().slice(0, 10)}`;
      existingFingerprints.add(fpRev);
    }

    const names = new Map<string, number>();
    for (const p of pgns) {
      const w = p.match(/\[White\s+"([^"]+)"\]/);
      const b = p.match(/\[Black\s+"([^"]+)"\]/);
      if (w) names.set(w[1], (names.get(w[1]) ?? 0) + 1);
      if (b) names.set(b[1], (names.get(b[1]) ?? 0) + 1);
    }
    let username = 'Player';
    let bestCount = 0;
    for (const [n, c] of names) {
      if (c > bestCount) { username = n; bestCount = c; }
    }

    const entities = (base44.entities as Record<string, any>);
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < pgns.length; i++) {
      const game = parsePgnToGameRecord(pgns[i], '', username);
      if (!game) continue;

      const fp = `${game.player.username.toLowerCase()}|${game.opponent.username.toLowerCase()}|${game.totalMoves}|${new Date(game.playedAt).toISOString().slice(0, 10)}`;
      if (existingFingerprints.has(fp)) {
        skipped++;
        setImportState({ phase: 'importing', imported: i + 1, total: pgns.length });
        continue;
      }

      try {
        await entities.Game.create({
          gameId: game.id,
          url: game.url || '',
          pgn: game.pgn,
          player: game.player,
          opponent: game.opponent,
          timeClass: game.timeClass,
          timeControl: game.timeControl,
          opening: game.opening,
          totalMoves: game.totalMoves,
          playedAt: game.playedAt,
          analyzedAt: null,
          analysisStatus: 'pending',
        });
        imported++;
        existingFingerprints.add(fp);
      } catch (err) {
        console.warn('[PGN Import] Failed to save game:', err);
      }
      setImportState({ phase: 'importing', imported: i + 1, total: pgns.length });
    }

    const msg = skipped > 0 && imported === 0
      ? `All ${skipped} game${skipped !== 1 ? 's' : ''} already exist.`
      : skipped > 0
        ? `${imported} imported, ${skipped} already existed.`
        : undefined;

    setImportState({ phase: 'done', imported, total: pgns.length, error: skipped > 0 && imported === 0 ? msg : undefined });
    if (imported > 0) {
      setPgnText('');
      setTimeout(() => {
        refetchGames();
        onImportComplete();
        onClose();
      }, 600);
    }
  };

  const isImporting = importState.phase === 'importing';

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-chess-bg border border-chess-border/40 rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-extrabold text-chess-text">Upload PGN</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-chess-text-secondary text-lg leading-none w-7 h-7 flex items-center justify-center"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <p className="text-[11px] text-chess-text-tertiary mb-3 leading-relaxed">
          Drop a .pgn file or paste the text below. We'll import every game and start analyzing.
        </p>

        <button
          onClick={() => setPgnGuideOpen((v) => !v)}
          className="text-[11px] text-chess-accent hover:brightness-110 mb-2"
        >
          {pgnGuideOpen ? '▼' : '▶'} How to export your games as PGN
        </button>
        {pgnGuideOpen && (
          <div className="bg-chess-surface/50 rounded-lg p-3 border border-chess-border/30 text-[11px] text-gray-400 space-y-2 mb-3">
            <div>
              <span className="font-bold text-gray-300">Chess.com:</span>{' '}
              <a href="https://www.chess.com/games/archive" target="_blank" rel="noopener noreferrer" className="text-chess-accent underline">chess.com/games/archive</a> → Select games → Download PGN
            </div>
            <div>
              <span className="font-bold text-gray-300">Lichess:</span>{' '}
              <a href="https://lichess.org" target="_blank" rel="noopener noreferrer" className="text-chess-accent underline">lichess.org/@/your-username</a> → Click games count → Download PGN
            </div>
          </div>
        )}

        <label className="block w-full text-center bg-chess-surface border border-chess-border/40 px-3 py-2.5 rounded-lg text-sm text-chess-text-secondary cursor-pointer hover:text-chess-text hover:border-chess-accent/40 transition-colors mb-3">
          Choose .pgn file
          <input type="file" accept=".pgn" onChange={handleFileUpload} className="hidden" />
        </label>

        <textarea
          value={pgnText}
          onChange={(e) => setPgnText(e.target.value)}
          placeholder={'Paste PGN here...\n\n[Event "Rated Blitz"]\n[White "Player1"]\n[Black "Player2"]\n...\n1. e4 e5 2. Nf3 ...'}
          rows={6}
          disabled={isImporting}
          className="w-full bg-chess-surface border border-chess-border/30 rounded-lg px-3 py-2 text-[11px] font-mono text-chess-text placeholder:text-gray-600 resize-y mb-3 disabled:opacity-60"
        />

        <button
          onClick={handleImport}
          disabled={!pgnText.trim() || isImporting}
          className="w-full bg-chess-accent text-chess-bg py-3 rounded-xl text-sm font-extrabold hover:brightness-110 transition-all shadow-[0_0_14px_rgba(74,222,128,0.3)] disabled:opacity-50"
        >
          {isImporting
            ? `Importing ${importState.imported}/${importState.total}...`
            : 'Import PGN games'}
        </button>

        {importState.phase === 'done' && importState.imported > 0 && (
          <p className="text-xs text-chess-accent mt-3 text-center">
            {importState.imported} game{importState.imported !== 1 ? 's' : ''} imported! Analyzing now...
          </p>
        )}
        {importState.phase === 'done' && importState.error && (
          <p className={`text-xs mt-3 text-center ${importState.imported > 0 ? 'text-amber-400' : 'text-chess-blunder'}`}>
            {importState.error}
          </p>
        )}
      </div>
    </div>
  );
}

function SourceGlyph({ kind, active }: { kind: ImportSource; active: boolean }) {
  if (kind === 'chesscom') {
    return (
      <div
        className="w-[38px] h-[38px] rounded-[9px] flex items-center justify-center"
        style={{
          background: active ? '#7fbf3f' : '#3a4a2e',
          border: active ? '1px solid rgba(255,255,255,0.18)' : '1px solid rgba(30,58,95,0.33)',
          boxShadow: active ? '0 4px 14px rgba(127,191,63,0.35)' : 'none',
        }}
      >
        <span className="text-white text-[22px] leading-none drop-shadow-sm">♞</span>
      </div>
    );
  }
  if (kind === 'lichess') {
    return (
      <div
        className="w-[38px] h-[38px] rounded-[9px] flex items-center justify-center"
        style={{
          background: active ? '#0e1726' : '#11161e',
          border: `1px solid ${active ? 'rgba(74,222,128,0.33)' : 'rgba(30,58,95,0.33)'}`,
        }}
      >
        <span className="text-white text-[22px] leading-none drop-shadow-sm">♝</span>
      </div>
    );
  }
  return (
    <div
      className="w-[38px] h-[38px] rounded-[9px] flex items-center justify-center text-[9px] font-extrabold tracking-wider"
      style={{
        background: active ? 'rgba(74,222,128,0.12)' : 'rgb(var(--chess-bg))',
        border: `1px dashed ${active ? 'rgba(74,222,128,0.55)' : 'rgba(30,58,95,0.55)'}`,
        color: active ? 'rgb(var(--chess-accent))' : 'rgb(var(--chess-text-secondary))',
      }}
    >
      PGN
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   3) DecodingScreen — orbit + DNA + slim progress + sneak-peek list
   ════════════════════════════════════════════════════════════════════════ */

interface DecodingScreenProps {
  games: GameRecord[];
  analyzedCount: number;
  analyzingCount: number;
  onUpdateSettings: (patch: Partial<UserSettings>) => Promise<void>;
}

const MIN_GAMES_FOR_UNLOCK = 5;

export function DecodingScreen({
  games,
  analyzedCount,
  analyzingCount,
  onUpdateSettings: _onUpdateSettings,
}: DecodingScreenProps) {
  void _onUpdateSettings;
  const totalGames = games.length;
  const [moveProgress, setMoveProgress] = useState<{ moveIndex: number; totalMoves: number } | null>(null);
  const [localAnalyzed, setLocalAnalyzed] = useState(0);

  useEffect(() => {
    return analysisEvents.on((event) => {
      if (event.type === 'progress') {
        setMoveProgress({ moveIndex: event.moveIndex, totalMoves: event.totalMoves });
      } else if (event.type === 'complete') {
        setLocalAnalyzed((prev) => prev + 1);
        setMoveProgress(null);
      } else if (event.type === 'all_complete') {
        setLocalAnalyzed(totalGames);
        setMoveProgress(null);
      }
    });
  }, [totalGames]);

  const effectiveAnalyzed = Math.max(analyzedCount, localAnalyzed);
  const currentGameFraction = moveProgress ? moveProgress.moveIndex / moveProgress.totalMoves : 0;
  const progressTarget = totalGames > MIN_GAMES_FOR_UNLOCK ? MIN_GAMES_FOR_UNLOCK : Math.max(totalGames, 1);
  const progressPct = Math.min(((effectiveAnalyzed + currentGameFraction) / progressTarget) * 100, 100);

  /* Build sneak-peek list — show up to 4 games with status */
  const peekGames = useMemo(() => {
    const sorted = [...games].sort((a, b) => {
      // Done first, then analyzing, then pending
      const aOrder = a.analysisStatus === 'complete' ? 0 : a.analysisStatus === 'analyzing' ? 1 : 2;
      const bOrder = b.analysisStatus === 'complete' ? 0 : b.analysisStatus === 'analyzing' ? 1 : 2;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (b.playedAt ?? 0) - (a.playedAt ?? 0);
    });
    return sorted.slice(0, 4);
  }, [games]);

  return (
    <div className="min-h-[80vh] flex flex-col justify-center px-5 pt-2 pb-7 max-w-md mx-auto w-full relative overflow-hidden">
      {/* Ambient glow */}
      <div
        className="absolute -top-32 left-1/2 -translate-x-1/2 w-[360px] h-[360px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(74,222,128,0.18), transparent 70%)', filter: 'blur(20px)' }}
      />

      {/* Orbit + DNA — same component used as the brand loader app-wide */}
      <div className="mx-auto mb-5 flex justify-center">
        <OrbitDnaLoader size={168} />
      </div>

      {/* Headline */}
      <div className="text-center mb-4 relative">
        <h2 className="text-lg font-extrabold tracking-tight text-chess-text">Decoding your Chess DNA</h2>
        <p className="text-xs text-chess-text-secondary mt-1.5">Importing and analyzing every move</p>
      </div>

      {/* Slim progress */}
      <div className="relative mb-4">
        <div className="flex justify-between text-[10px] text-chess-text-tertiary mb-1.5 tabular-nums">
          <span>{Math.round(progressPct)}% complete</span>
          <span>{effectiveAnalyzed} / {progressTarget} games</span>
        </div>
        <div className="h-1 rounded-full bg-chess-muted/60 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${progressPct}%`,
              background: 'linear-gradient(90deg, rgb(var(--chess-accent)), #3b82f6)',
              boxShadow: '0 0 8px rgba(74,222,128,0.5)',
            }}
          />
        </div>
      </div>

      {/* Sneak-peek list of games */}
      {peekGames.length > 0 && (
        <div className="relative">
          <div className="text-[9px] text-chess-text-tertiary tracking-[1.8px] uppercase font-bold mb-2">
            Recently analyzed
          </div>
          <div className="flex flex-col gap-1.5">
            {peekGames.map((g, i) => {
              const done = g.analysisStatus === 'complete';
              const active = g.analysisStatus === 'analyzing';
              const result = g.player.result;
              const resColor = result === 'win' ? 'rgb(var(--chess-accent))' : result === 'loss' ? 'rgb(var(--chess-blunder))' : 'rgb(var(--chess-text-tertiary))';
              const opp = g.opponent.username;
              return (
                <div
                  key={g.id ?? i}
                  className={`flex items-center gap-2.5 px-2.5 py-2.5 rounded-[10px] ${
                    active
                      ? 'bg-chess-accent/10 border border-chess-accent/30'
                      : 'bg-chess-surface border border-chess-border/30'
                  } ${done ? 'opacity-100' : active ? 'opacity-100' : 'opacity-50'}`}
                >
                  <div
                    className="w-4 h-4 rounded-[4px] flex items-center justify-center text-[9px] font-extrabold shrink-0"
                    style={{
                      background: done ? 'rgba(74,222,128,0.18)' : 'rgba(30,41,59,0.6)',
                      border: `1px solid ${done ? 'rgba(74,222,128,0.4)' : 'rgba(30,58,95,0.27)'}`,
                      color: done ? 'rgb(var(--chess-accent))' : 'rgb(var(--chess-text-tertiary))',
                    }}
                  >
                    {done ? '✓' : active ? '·' : ''}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-chess-text truncate">vs {opp}</div>
                    <div className="text-[10px] text-chess-text-tertiary truncate">
                      {g.opening?.name ?? 'Opening'} · {g.totalMoves ?? '—'} moves
                    </div>
                  </div>
                  {done && result && (
                    <span
                      className="text-[9px] font-extrabold tracking-wider uppercase px-1.5 py-0.5 rounded"
                      style={{ color: resColor, background: `${resColor}22` }}
                    >
                      {result === 'win' ? 'Win' : result === 'loss' ? 'Loss' : 'Draw'}
                    </span>
                  )}
                  {active && (
                    <span className="text-[9px] font-bold tracking-wider uppercase text-chess-accent tabular-nums flex items-center gap-1">
                      Analyzing
                      <span className="inline-block w-1 h-1 rounded-full bg-chess-accent animate-pulse" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {analyzingCount > 0 && (
        <p className="text-[10px] text-chess-text-tertiary text-center mt-3">
          Hang tight — usually takes a few minutes
        </p>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   4) UnlockScreen — Your Chess DNA is Ready CTA
   ════════════════════════════════════════════════════════════════════════ */

interface UnlockScreenProps {
  analyzedCount: number;
  totalGames: number;
  onUnlock: () => void;
}

export function UnlockScreen({ analyzedCount, totalGames, onUnlock }: UnlockScreenProps) {
  const { t } = useT();
  const [bursting, setBursting] = useState(false);
  const remaining = Math.max(0, totalGames - analyzedCount);

  const handle = () => {
    setBursting(true);
    setTimeout(onUnlock, 600);
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center text-center px-7 pt-10 pb-8 max-w-md mx-auto w-full relative">
      {bursting && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-32 h-32 rounded-full bg-chess-accent/30 animate-unlock-burst" />
          <div className="w-24 h-24 rounded-full bg-chess-accent/20 animate-unlock-burst" style={{ animationDelay: '0.1s' }} />
        </div>
      )}
      <div className="animate-scale-in">
        <div className="mb-4" style={{ filter: 'drop-shadow(0 0 24px rgba(74,222,128,0.6))' }}>
          <DnaIcon size={64} className="text-chess-accent inline-block" />
        </div>
        <h2 className="text-2xl font-black mb-2.5 max-w-[280px] mx-auto leading-tight text-chess-text">
          Your Chess DNA is Ready!
        </h2>
        <p className="text-sm text-chess-text-secondary mb-7 max-w-[260px] mx-auto">
          {analyzedCount} game{analyzedCount !== 1 ? 's' : ''} analyzed. Your Chess DNA profile is ready to be revealed.
        </p>
        <button
          onClick={handle}
          disabled={bursting}
          className="bg-chess-accent text-chess-bg px-9 py-4 rounded-[18px] text-base font-black hover:brightness-110 transition-all animate-pulse-glow disabled:opacity-80"
        >
          {t('overview_unlock')}
        </button>
        {remaining > 0 && (
          <p className="text-[11px] text-chess-text-secondary mt-4 flex items-center justify-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-chess-accent animate-pulse" />
            {remaining} more game{remaining !== 1 ? 's' : ''} analyzing in the background
          </p>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   5) RadarRevealScreen — gradual axis-by-axis reveal + explainer card
   ════════════════════════════════════════════════════════════════════════ */

interface RadarRevealScreenProps {
  games: GameRecord[];
  analyses: GameAnalysis[];
  onboardingTimeClass?: string | null;
  onContinue: () => void;
}

export function RadarRevealScreen({
  games,
  analyses,
  onboardingTimeClass,
  onContinue,
}: RadarRevealScreenProps) {
  const profile = useMemo(() => calculateSkillProfile(null, games, analyses), [games, analyses]);
  const [isFullyRevealed, setIsFullyRevealed] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const obCount = games.length || 5;
  const obTC = onboardingTimeClass ?? 'rapid';

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-5 pt-2 pb-8 max-w-md mx-auto w-full">
      <div className="text-center mb-3">
        <div className="flex items-center justify-center gap-2">
          <h2 className="text-[22px] font-black text-chess-text">
            Your <span className="text-chess-accent" style={{ textShadow: '0 0 12px rgba(74,222,128,0.6)' }}>Chess DNA</span>
          </h2>
          <button
            type="button"
            onClick={() => setShowInfo(true)}
            className="w-[22px] h-[22px] rounded-full text-[11px] font-bold flex items-center justify-center cursor-pointer text-chess-text-secondary hover:text-chess-accent hover:border-chess-accent/40 transition-colors"
            style={{ border: '1px solid rgba(30,58,95,0.33)', fontFamily: 'Georgia, serif' }}
            aria-label="How your Chess DNA is calculated"
          >
            i
          </button>
        </div>
        <p className="text-xs text-chess-text-secondary mt-1.5">
          Based on your last {obCount} {obTC} game{obCount !== 1 ? 's' : ''}
        </p>
      </div>

      <div
        className="rounded-[18px] p-5"
        style={{
          background: 'rgba(17,24,39,0.5)',
          border: '1px solid rgba(74,222,128,0.15)',
          boxShadow: '0 0 48px rgba(74,222,128,0.12), 0 0 0 1px rgba(74,222,128,0.05)',
        }}
      >
        <SkillRadar
          profile={profile}
          sequentialReveal
          onRevealComplete={() => setIsFullyRevealed(true)}
          size={300}
          compact
        />
      </div>

      {/* Explainer card */}
      {isFullyRevealed && (
        <div
          className="mt-4 w-full max-w-[360px] rounded-[14px] p-3.5 animate-fade-in-up"
          style={{
            background: 'rgba(17,24,39,0.4)',
            border: '1px solid rgba(30,58,95,0.33)',
          }}
        >
          <div className="flex items-center gap-2 mb-2.5">
            <div
              className="w-6 h-6 rounded-[7px] flex items-center justify-center text-chess-accent text-xs font-extrabold"
              style={{
                background: 'rgba(74,222,128,0.12)',
                border: '1px solid rgba(74,222,128,0.3)',
                fontFamily: 'Georgia, serif',
              }}
            >
              i
            </div>
            <span className="text-[11px] font-bold text-chess-text tracking-wide">
              How your radar is generated
            </span>
          </div>
          <div className="text-[11.5px] text-chess-text-secondary leading-relaxed">
            We run <b className="text-chess-text">an engine</b> on every move of your last {obCount} games.
            Each move is scored against the engine's best line and rolled up into the
            <b className="text-chess-text"> 8 axes</b> you see here.
          </div>
        </div>
      )}

      {/* Continue button */}
      <button
        onClick={onContinue}
        disabled={!isFullyRevealed}
        className="mt-5 w-full max-w-[360px] py-3.5 rounded-xl text-sm font-extrabold bg-chess-accent text-chess-bg hover:brightness-110 transition-all shadow-[0_0_14px_rgba(74,222,128,0.3)] disabled:opacity-40"
      >
        Continue →
      </button>

      {showInfo && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowInfo(false)}
        >
          <div
            className="bg-chess-bg border border-chess-border/40 rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-extrabold text-chess-text">How your Chess DNA is calculated</h3>
              <button
                onClick={() => setShowInfo(false)}
                className="text-gray-500 hover:text-chess-text-secondary text-lg leading-none w-7 h-7 flex items-center justify-center"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="text-[12px] text-chess-text-secondary leading-relaxed space-y-3">
              <p>
                We run <b className="text-chess-text">an engine</b> on every move of your last {obCount} {obTC} game{obCount !== 1 ? 's' : ''}.
                Each move is scored against the engine's best line and rolled up into your skill profile.
              </p>
              <p>
                Those collapse onto the <b className="text-chess-text">8 axes</b> of your radar:
                Openings, Tactics, Defense, Positional, Endgame, Calculation, Time Management, Resilience.
              </p>
              <p>
                Each axis is a 0–99 score; the overall number combines all eight (weighted, with bigger
                weights for Tactics, Defense, Calculation, and Endgame). As more of your games analyze
                in the background, the radar refines.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Shared icon
   ════════════════════════════════════════════════════════════════════════ */

function DnaIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g transform="rotate(45 12 12)">
        <path d="M8 2c0 6.5 8 12.5 8 19" />
        <path d="M16 2c0 6.5-8 12.5-8 19" />
        <line x1="9.2" y1="5.5" x2="14.8" y2="5.5" />
        <line x1="11" y1="8.5" x2="13" y2="8.5" />
        <line x1="11" y1="14.5" x2="13" y2="14.5" />
        <line x1="9.2" y1="17.5" x2="14.8" y2="17.5" />
      </g>
    </svg>
  );
}

/* Re-export types for convenience */
export type { CurrentPatterns };
