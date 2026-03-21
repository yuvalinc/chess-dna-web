import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useState, useCallback, useEffect } from 'react';
import { useTheme } from './ThemeContext';
import { useChessData } from '@/contexts/ChessDataContext';
import MiniAudioPlayer from '@/components/MiniAudioPlayer';
import type { TimeClass } from '@shared/types/game';

type Tab = 'dna' | 'training' | 'account';

const ALL_TIME_CLASSES: { id: TimeClass; label: string; icon: string }[] = [
  { id: 'bullet', label: 'Bullet', icon: '⚡' },
  { id: 'blitz', label: 'Blitz', icon: '♞' },
  { id: 'rapid', label: 'Rapid', icon: '♜' },
  { id: 'daily', label: 'Daily', icon: '♛' },
];

const BOTTOM_NAV: { id: Tab; label: string; icon: string; path: string }[] = [
  { id: 'dna', label: 'Your DNA', icon: '🧬', path: '/' },
  { id: 'training', label: 'Training', icon: '🧩', path: '/training' },
  { id: 'account', label: 'Profile', icon: '👤', path: '/settings' },
];

// Map URL paths → tabs
function pathToTab(path: string): Tab {
  if (path.startsWith('/training') || path.startsWith('/lessons') || path.startsWith('/exercises')) return 'training';
  if (path.startsWith('/settings')) return 'account';
  return 'dna';
}

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings, updateSettings } = useTheme();
  const [pillsOpen, setPillsOpen] = useState(false);
  const { journeyStage, availableTimeClasses } = useChessData();

  const activeTab = pathToTab(location.pathname);
  const selectedTimeClass = settings.selectedTimeClass ?? null;

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
  }, [selectedTimeClass, availableTimeClasses, handleTimeClassChange]);

  const handleTabClick = useCallback(
    (item: (typeof BOTTOM_NAV)[number]) => {
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

  const isDnaTab = activeTab === 'dna';
  const isFullyOnboarded = journeyStage >= 5;

  return (
    <div className="min-h-screen bg-chess-bg text-chess-text flex flex-col">
      {/* ── Floating game-type dropdown (upper-right) — only on DNA tab, S5+ ── */}
      {isDnaTab && isFullyOnboarded && (() => {
        const selectedTc = ALL_TIME_CLASSES.find((tc) => tc.id === selectedTimeClass);
        const displayIcon = selectedTc?.icon ?? '♟';
        const displayLabel = selectedTc?.label ?? 'Select';
        return (
          <div className="fixed top-3 right-3 z-50">
            <button
              onClick={() => setPillsOpen(!pillsOpen)}
              className="bg-chess-surface/90 backdrop-blur-md rounded-lg px-3 py-1.5 border border-chess-border/30 shadow-lg text-[11px] flex items-center gap-1.5 text-chess-accent font-semibold hover:bg-chess-surface transition-all"
            >
              <span>{displayIcon}</span>
              <span>{displayLabel}</span>
              <span className="text-[8px] text-gray-500 ml-0.5">{pillsOpen ? '▲' : '▼'}</span>
            </button>
            {pillsOpen && (
              <div className="absolute top-full right-0 mt-1 bg-chess-surface/95 backdrop-blur-md rounded-xl border border-chess-border/30 shadow-xl p-1.5 min-w-[120px]">
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
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Main content ── */}
      <main className={`flex-1 ${isDnaTab && isFullyOnboarded ? 'pt-10' : 'pt-4'} ${isFullyOnboarded ? 'pb-20' : 'pb-4'} px-4 sm:px-6 overflow-y-auto max-w-6xl mx-auto w-full`}>
        <Outlet />
      </main>

      {/* ── Mini audio player — sits above bottom nav ── */}
      {isFullyOnboarded && <MiniAudioPlayer />}

      {/* ── Bottom navigation bar — only visible after onboarding (S5+) ── */}
      {isFullyOnboarded && (
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-chess-surface/95 backdrop-blur-md border-t border-chess-border/40">
          <div className="max-w-6xl mx-auto flex">
            {BOTTOM_NAV.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleTabClick(item)}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-3 transition-colors ${
                    isActive ? 'text-chess-accent' : 'text-gray-500 hover:text-chess-text-secondary'
                  }`}
                >
                  <span className="text-xl">{item.icon}</span>
                  <span className="text-xs font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
