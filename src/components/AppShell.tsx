import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTheme } from './ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useChessData } from '@/contexts/ChessDataContext';
import { useTutorial } from '@/contexts/TutorialContext';
import { useT } from '@/i18n/index';
import SyncStatusIndicator from '@/components/SyncStatusIndicator';
import TutorialCoachmark from '@/components/TutorialCoachmark';
import { base44 } from '@/api/base44Client';
import { hasGuestSession, guestSessionRemainingMs } from '@shared/utils/guest-session';
import type { TimeClass } from '@shared/types/game';

type Tab = 'dna' | 'games' | 'training' | 'compare';

const TIME_CLASS_ICONS: Record<TimeClass, string> = {
  bullet: '\u26A1',
  blitz: '\u265E',
  rapid: '\u265C',
  daily: '\u265B',
};

/* SVG nav icons — white default, chess-accent when selected */
function DnaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

function AnalyzeIcon({ className }: { className?: string }) {
  // Chart-line in a frame — represents "Analyze" (the games review tab).
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <polyline points="7 14 11 10 14 13 18 8" />
    </svg>
  );
}

function ReplayIcon({ className }: { className?: string }) {
  // Play-in-a-circle — represents "Replays" (the Time Machine tab).
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CompareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Two bar chart columns side by side */}
      <rect x="3" y="10" width="4" height="11" rx="1" />
      <rect x="10" y="4" width="4" height="17" rx="1" />
      <rect x="17" y="8" width="4" height="13" rx="1" />
    </svg>
  );
}

const NAV_ICONS: Record<Tab, React.FC<{ className?: string }>> = {
  dna: DnaIcon,
  games: AnalyzeIcon,
  training: ReplayIcon,
  compare: CompareIcon,
};

// Bottom nav: DNA · Analyze · Replays. Compare keeps its route at /compare
// for deep-links / share-card flows but is no longer surfaced in the menu.
const BOTTOM_NAV_PATHS: { id: Tab; path: string }[] = [
  { id: 'dna', path: '/' },
  { id: 'games', path: '/games' },
  { id: 'training', path: '/timemachine' },
];

const TAB_LABEL_KEYS: Record<Tab, 'nav_dna' | 'nav_games' | 'nav_timemachine' | 'nav_compare'> = {
  dna: 'nav_dna',
  games: 'nav_games',
  training: 'nav_timemachine',
  compare: 'nav_compare',
};

// Map URL paths → tabs
function pathToTab(path: string): Tab {
  if (path.startsWith('/games')) return 'games';
  if (path.startsWith('/timemachine')) return 'training';
  if (path.startsWith('/compare')) return 'compare';
  return 'dna';
}

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings, updateSettings } = useTheme();
  const { t } = useT();
  const [pillsOpen, setPillsOpen] = useState(false);
  const { journeyStage, availableTimeClasses, analyzedCount, totalGameCount } = useChessData();
  const { isActive: tutorialActive, currentDef: tutorialDef } = useTutorial();

  const activeTab = pathToTab(location.pathname);
  const selectedTimeClass = settings.selectedTimeClass ?? null;

  // Build translated time class list
  const ALL_TIME_CLASSES = useMemo(() => [
    { id: 'bullet' as TimeClass, label: t('time_bullet'), icon: TIME_CLASS_ICONS.bullet },
    { id: 'blitz' as TimeClass, label: t('time_blitz'), icon: TIME_CLASS_ICONS.blitz },
    { id: 'rapid' as TimeClass, label: t('time_rapid'), icon: TIME_CLASS_ICONS.rapid },
    { id: 'daily' as TimeClass, label: t('time_daily'), icon: TIME_CLASS_ICONS.daily },
  ], [t]);

  const handleTimeClassChange = useCallback(
    (tc: TimeClass | null) => {
      updateSettings({ selectedTimeClass: tc });
    },
    [updateSettings],
  );

  // Auto-select first available time class if none selected
  useEffect(() => {
    if (!selectedTimeClass && availableTimeClasses.size > 0) {
      const first = ALL_TIME_CLASSES.find((tc) => availableTimeClasses.has(tc.id));
      if (first) handleTimeClassChange(first.id);
    }
  }, [selectedTimeClass, availableTimeClasses, handleTimeClassChange, ALL_TIME_CLASSES]);

  const handleTabClick = useCallback(
    (item: (typeof BOTTOM_NAV_PATHS)[number]) => {
      navigate(item.path);
      setPillsOpen(false);
    },
    [navigate],
  );

  const handleTimeClassPillClick = useCallback(
    (tc: TimeClass) => {
      if (availableTimeClasses.has(tc)) {
        handleTimeClassChange(selectedTimeClass === tc ? null : tc);
      } else {
        navigate('/settings');
      }
      setPillsOpen(false);
    },
    [availableTimeClasses, selectedTimeClass, handleTimeClassChange, navigate],
  );

  const { isAuthenticated } = useAuth();
  const isGuest = !isAuthenticated && hasGuestSession();

  const isDnaTab = activeTab === 'dna';
  const hasGames = journeyStage >= 1;
  // The DNA hero (with score + filter) renders for stages 2+ via the s2Continued
  // shortcut in Overview, so the chrome (top padding + game-type filter) needs
  // to follow the same threshold.
  const showHeroChrome = journeyStage >= 2;

  // Compute remaining guest time for display — single unit only so the
  // top popup stays compact: "Xd left" / "Xh left" / "Xm left".
  const [guestTimeLabel, setGuestTimeLabel] = useState('');
  useEffect(() => {
    if (!isGuest) return;
    const update = () => {
      const ms = guestSessionRemainingMs();
      if (ms <= 0) { setGuestTimeLabel(''); return; }
      const dayMs = 24 * 60 * 60 * 1000;
      if (ms >= dayMs) {
        setGuestTimeLabel(`${Math.ceil(ms / dayMs)}d left`);
        return;
      }
      const h = Math.floor(ms / 3600000);
      if (h >= 1) { setGuestTimeLabel(`${h}h left`); return; }
      const m = Math.max(1, Math.floor(ms / 60000));
      setGuestTimeLabel(`${m}m left`);
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, [isGuest]);

  // Dismissible top signup popup — once user clicks X, hide for the
  // session (returns on reload) so it stays gentle, not nagging.
  const [signupDismissed, setSignupDismissed] = useState(() => {
    try { return sessionStorage.getItem('chess-dna-signup-banner-dismissed') === '1'; }
    catch { return false; }
  });
  const dismissSignup = () => {
    setSignupDismissed(true);
    try { sessionStorage.setItem('chess-dna-signup-banner-dismissed', '1'); } catch { /* ignore */ }
  };

  return (
    <div className="min-h-screen bg-chess-bg text-chess-text flex flex-col">
      {/* ── Floating game-type dropdown (upper-right) — DNA + Games + Time Machine tabs, once hero is visible ── */}
      {(isDnaTab || activeTab === 'games' || activeTab === 'training' || activeTab === 'compare') && showHeroChrome && (() => {
        const selectedTc = ALL_TIME_CLASSES.find((tc) => tc.id === selectedTimeClass);
        const displayIcon = selectedTc?.icon ?? '♟';
        const displayLabel = selectedTc?.label ?? 'Select';
        return (
          <div className="app-time-filter fixed top-3 end-3 z-50">
            <button
              onClick={() => setPillsOpen(!pillsOpen)}
              className="bg-chess-surface/90 backdrop-blur-md rounded-lg px-3 py-1.5 border border-chess-border/30 shadow-lg text-[11px] flex items-center gap-1.5 text-chess-accent font-semibold hover:bg-chess-surface transition-all"
            >
              <span>{displayIcon}</span>
              <span>{displayLabel}</span>
              <span className="text-[10px] text-gray-500 ml-0.5">{pillsOpen ? '▲' : '▼'}</span>
            </button>
            {/* Analyze progress indicator — small row centered under the
                game-type filter when background analysis is in flight.
                Static green progress ring (no motion). */}
            {analyzedCount < totalGameCount && (() => {
              const pct = totalGameCount > 0 ? analyzedCount / totalGameCount : 0;
              const radius = 10;
              const circumference = 2 * Math.PI * radius;
              const dashOffset = circumference * (1 - pct);
              return (
                <div className="mt-1 flex justify-center">
                  <div className="inline-flex items-center gap-1.5 text-[10px] text-chess-text-secondary tabular-nums">
                    <svg
                      className="w-3 h-3 text-chess-accent"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r={radius} stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                      <circle
                        cx="12" cy="12" r={radius}
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        transform="rotate(-90 12 12)"
                      />
                    </svg>
                    <span>{analyzedCount}/{totalGameCount}</span>
                  </div>
                </div>
              );
            })()}
            {pillsOpen && (
              <div className="absolute top-full end-0 mt-1 bg-chess-surface/95 backdrop-blur-md rounded-xl border border-chess-border/30 shadow-xl p-1.5 min-w-[120px]">
                {ALL_TIME_CLASSES.map((tc) => {
                  const hasGames = availableTimeClasses.has(tc.id);
                  const isSelected = selectedTimeClass === tc.id;
                  return (
                    <button
                      key={tc.id}
                      onClick={() => handleTimeClassPillClick(tc.id)}
                      className={`w-full text-left text-[11px] px-2.5 py-1.5 rounded-md transition-all flex items-center gap-2 ${
                        isSelected
                          ? 'bg-chess-accent/15 text-chess-accent font-semibold'
                          : hasGames
                            ? 'text-chess-text-secondary hover:text-chess-text hover:bg-chess-overlay'
                            : 'text-chess-text-disabled'
                      }`}
                    >
                      <span>{tc.icon}</span>
                      {tc.label}
                      <span className={`w-1.5 h-1.5 rounded-full ml-auto ${hasGames ? 'bg-chess-accent' : 'bg-gray-500/40'}`} />
                    </button>
                  );
                })}
                {/* Sync status inside dropdown */}
                {settings.chesscomUsername && (
                  <div className="mt-1 pt-1.5 border-t border-chess-border/20 px-1">
                    <SyncStatusIndicator />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Main content ──
           pt-10 reserves room for the floating time-class pill in the
           top-right; it appears on every tab that shows the dropdown,
           so all of those tabs need the same top padding. */}
      <main className={`flex-1 pt-2 ${hasGames ? 'pb-20' : 'pb-4'} px-4 sm:px-6 overflow-y-auto max-w-6xl mx-auto w-full`}>
        {/* Chess DNA brand wordmark — inline at the top of every page,
            scrolls with content (not sticky). Hidden during the tutorial
            so coachmarks read clean. */}
        {!tutorialActive && (
          <div className="mb-3 inline-flex items-center gap-1.5 select-none">
            <img src="/favicon.png" alt="" className="w-5 h-5" />
            <span className="text-[12px] font-extrabold tracking-[1.5px] text-chess-text uppercase">Chess DNA</span>
          </div>
        )}
        <Outlet />
      </main>

      {/* ── Tutorial coachmark overlay — auto-fires on each main screen
            when settings.tutorialStep matches the screen's step. Persists
            across reloads via UserPreferences; resumes if user exits. ── */}
      <TutorialCoachmark />

      {/* ── Bottom navigation bar — visible once user has games (S1+).
            The `app-bottom-nav` class lets pages collapse the bar via a
            body-level attribute (see `body[data-focus-mode="true"]` rule
            in src/index.css). Used by GameDetail's focus mode.
            During the tutorial, raise the whole bar above the coachmark dim
            (z-[110] beats z-[100]) so the whole menu stays bright + clickable
            and the spotlight tab visibly pops. ── */}
      {/* Guest signup banner — full-width strip docked just above the
          bottom navigation (env safe-area aware). Hidden during the
          tutorial so coachmarks stay clean. */}
      {hasGames && isGuest && !signupDismissed && !tutorialActive && (
        <div
          className="fixed left-0 right-0 z-50 px-3"
          style={{
            // Sits right above the bottom-nav (~72px tall + safe-area).
            bottom: 'calc(env(safe-area-inset-bottom) + 72px)',
          }}
        >
          <div className="max-w-6xl mx-auto flex items-center justify-center gap-2 rounded-xl px-3 py-2 border border-chess-accent/30 shadow-[0_8px_24px_rgba(0,0,0,0.5)] bg-chess-surface/95 backdrop-blur-md">
            <span className="text-[11px] font-semibold text-chess-text whitespace-nowrap">
              Save progress
              {guestTimeLabel && <span className="text-chess-text-tertiary ml-1 font-normal">· {guestTimeLabel}</span>}
            </span>
            <button
              onClick={() => base44.auth.redirectToLogin(window.location.href)}
              className="shrink-0 bg-chess-accent text-chess-bg text-[11px] font-bold px-2.5 py-1 rounded-full hover:opacity-90 transition-all"
            >
              Sign Up
            </button>
            <button
              onClick={dismissSignup}
              aria-label="Dismiss"
              className="shrink-0 w-6 h-6 rounded-full text-chess-text-tertiary hover:text-chess-text hover:bg-chess-overlay flex items-center justify-center transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
      {hasGames && (
        <nav className={`app-bottom-nav fixed bottom-0 left-0 right-0 ${tutorialActive ? 'z-[110]' : 'z-50'} bg-chess-bg/98 backdrop-blur-md border-t border-chess-border/30 shadow-[0_-4px_16px_rgba(0,0,0,0.15)] pb-[env(safe-area-inset-bottom)]`}>
          <div className="max-w-6xl mx-auto flex">
            {BOTTOM_NAV_PATHS.map((item) => {
              const isActive = activeTab === item.id;
              // Highlight the nav tab whose page matches the live tutorial
              // step, so the user knows where in the app the spotlight lives.
              // Only when the user is currently ON that page (otherwise the
              // coachmark card isn't rendering and a lone glow is confusing).
              const isTutorialTab =
                tutorialActive &&
                tutorialDef?.page === item.path &&
                location.pathname === item.path;
              const Icon = NAV_ICONS[item.id];
              const showAccent = isActive || isTutorialTab;
              return (
                <button
                  key={item.id}
                  onClick={() => handleTabClick(item)}
                  data-track="nav_tab"
                  data-track-tab={item.id}
                  className={`relative flex-1 flex flex-col items-center gap-0.5 py-3 transition-colors ${
                    showAccent ? 'text-chess-accent' : 'text-chess-text-tertiary hover:text-chess-text'
                  }`}
                >
                  {showAccent && (
                    <span
                      className="absolute inset-x-3 inset-y-1.5 rounded-xl pointer-events-none"
                      style={{
                        background: 'rgba(74,222,128,0.14)',
                        boxShadow: '0 0 0 1px rgba(74,222,128,0.4), 0 0 18px rgba(74,222,128,0.35)',
                      }}
                    />
                  )}
                  <Icon className={`relative ${showAccent ? 'text-chess-accent' : 'text-chess-text-tertiary'}`} />
                  <span className={`relative text-xs ${showAccent ? 'font-bold text-chess-accent' : 'font-medium'}`}>
                    {t(TAB_LABEL_KEYS[item.id])}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
