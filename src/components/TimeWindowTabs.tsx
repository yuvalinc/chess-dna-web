import { TIME_WINDOWS, type TimeWindowId } from '@/patterns/windowed-profile';
import { useT } from '@/i18n/index';

interface TimeWindowTabsProps {
  activeWindow: TimeWindowId;
  onWindowChange: (id: TimeWindowId) => void;
  analyzedGameCount: number;
}

export default function TimeWindowTabs({
  activeWindow,
  onWindowChange,
  analyzedGameCount,
}: TimeWindowTabsProps) {
  const { t } = useT();
  return (
    <div className="flex rtl:flex-row-reverse gap-1 mb-3">
      {TIME_WINDOWS.map((w) => {
        const isActive = activeWindow === w.id;
        // Ability tab: always enabled if any games exist (falls back to all available games)
        const hasEnough = w.id === 'ability'
          ? analyzedGameCount >= 1
          : analyzedGameCount >= w.gameCount;

        return (
          <button
            key={w.id}
            onClick={() => hasEnough && onWindowChange(w.id)}
            disabled={!hasEnough}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
              isActive
                ? 'bg-chess-accent/10 text-chess-accent border border-chess-accent/20'
                : hasEnough
                  ? 'text-gray-500 hover:text-chess-text-secondary hover:bg-white/[0.03] border border-transparent'
                  : 'text-gray-600/30 border border-transparent cursor-not-allowed'
            }`}
            title={!hasEnough ? `Need at least ${w.gameCount} analyzed games` : undefined}
          >
            {t(`tab_${w.id}` as Parameters<typeof t>[0])}
            {w.id === 'ability' && analyzedGameCount < w.gameCount ? (
              <span className="ms-1 text-[9px] opacity-60">{analyzedGameCount}</span>
            ) : (
              <span className="ms-1 text-[9px] opacity-60">{w.gameCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
