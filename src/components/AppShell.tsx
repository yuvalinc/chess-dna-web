import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTheme } from './ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useChessData } from '@/contexts/ChessDataContext';
import { useT } from '@/i18n/index';
import MiniAudioPlayer from '@/components/MiniAudioPlayer';
import SyncStatusIndicator from '@/components/SyncStatusIndicator';
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

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M20 21a8 8 0 1 0-16 0" />
    </svg>
  );
}

function HourglassIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 22h14" />
      <path d="M5 2h14" />
      <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
      <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
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
  games: PersonIcon,
  training: HourglassIcon,
  compare: CompareIcon,
};

const BOTTOM_NAV_PATHS: { id: Tab; path: string }[] = [
  { id: 'dna', path: '/' },
  { id: 'games', path: '/games' },
  { id: 'training', path: '/timemachine' },
  { id: 'compare', path: '/compare' },
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
  if (path.startsWith('/timemachine') || path.startsWith('/training') || path.startsWith('/lessons') || path.startsWith('/exercises')) return 'training';
  if (path.startsWith('/compare')) return 'compare';
  return 'dna';
}

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings, updateSettings } = useTheme();
  const { t } = useT();
  const [pillsOpen, setPillsOpen] = useState(false);
  const { journeyStage, availableTimeClasses } = useChessData();

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
  const isFullyOnboarded = journeyStage >= 5;

  // Compute remaining guest time for display
  const [guestTimeLabel, setGuestTimeLabel] = useState('');
  useEffect(() => {
    if (!isGuest) return;
    const update = () => {
      const ms = guestSessionRemainingMs();
      if (ms <= 0) { setGuestTimeLabel(''); return; }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      setGuestTimeLabel(h > 0 ? `${h}h ${m}m left` : `${m}m left`);
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, [isGuest]);

  return (
    <div className="min-h-screen bg-chess-bg text-chess-text flex flex-col">
      {/* ── Floating game-type dropdown (upper-right) — DNA + Games + Time Machine tabs, S5+ ── */}
      {(isDnaTab || activeTab === 'games' || activeTab === 'training' || activeTab === 'compare') && isFullyOnboarded && (() => {
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
      <main className={`flex-1 ${(isDnaTab || activeTab === 'games' || activeTab === 'training' || activeTab === 'compare') && isFullyOnboarded ? 'pt-10' : 'pt-4'} ${hasGames && isGuest ? 'pb-32' : hasGames ? 'pb-24' : 'pb-4'} px-4 sm:px-6 overflow-y-auto max-w-6xl mx-auto w-full`}>
        <Outlet />
      </main>

      {/* ── Mini audio player — sits above bottom nav ── */}
      {isFullyOnboarded && <MiniAudioPlayer />}

      {/* ── Bottom navigation bar — visible once user has games (S1+).
            The `app-bottom-nav` class lets pages collapse the bar via a
            body-level attribute (see `body[data-focus-mode="true"]` rule
            in src/index.css). Used by GameDetail's focus mode. ── */}
      {hasGames && (
        <nav className="app-bottom-nav fixed bottom-0 left-0 right-0 z-50 bg-chess-bg/98 backdrop-blur-md border-t border-chess-border/30 shadow-[0_-4px_16px_rgba(0,0,0,0.15)] pb-[env(safe-area-inset-bottom)]">
          {/* Guest signup CTA — sits inside nav, above the tab buttons */}
          {isGuest && (
            <div className="flex items-center justify-between px-4 py-1.5 border-b border-chess-border/20 bg-chess-accent/[0.06]">
              <span className="text-[11px] text-gray-400 truncate">
                Save your progress
                {guestTimeLabel && <span className="text-gray-500 ml-1">· {guestTimeLabel}</span>}
              </span>
              <button
                onClick={() => base44.auth.redirectToLogin(window.location.href)}
                className="shrink-0 bg-chess-accent text-chess-bg text-[11px] font-semibold px-2.5 py-1 rounded-md hover:opacity-90 transition-all"
              >
                Sign Up
              </button>
            </div>
          )}
          <div className="max-w-6xl mx-auto flex">
            {BOTTOM_NAV_PATHS.map((item) => {
              const isActive = activeTab === item.id;
              const Icon = NAV_ICONS[item.id];
              return (
                <button
                  key={item.id}
                  onClick={() => handleTabClick(item)}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-3 transition-colors ${
                    isActive ? 'text-chess-accent' : 'text-chess-text-tertiary hover:text-chess-text'
                  }`}
                >
                  <Icon className={isActive ? 'text-chess-accent' : 'text-chess-text-tertiary'} />
                  <span className="text-xs font-medium">{t(TAB_LABEL_KEYS[item.id])}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
