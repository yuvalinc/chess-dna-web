import { TIME_WINDOWS, type TimeWindowId } from '@/patterns/windowed-profile';
import { useT } from '@/i18n/index';
import type { TranslationKey } from '@/i18n/locales/en';

interface TimeWindowTabsProps {
  activeWindow: TimeWindowId;
  onWindowChange: (id: TimeWindowId) => void;
  /** Total analyzed games available — used to disable empty windows. */
  analyzedGameCount: number;
  /** All games, used to count how many fall inside each window's date range. */
  windowCounts?: Partial<Record<TimeWindowId, number>>;
}

const TAB_LABEL_KEYS: Record<TimeWindowId, TranslationKey> = {
  today: 'tab_today',
  week: 'tab_week',
  all: 'tab_all_time',
};

export default function TimeWindowTabs({
  activeWindow,
  onWindowChange,
  analyzedGameCount,
  windowCounts,
}: TimeWindowTabsProps) {
  const { t } = useT();
  return (
    <div className="grid rtl:grid-flow-col-dense grid-cols-3 gap-1 mb-3 p-1 bg-chess-surface/60 rounded-xl border border-chess-border/30">
      {TIME_WINDOWS.map((w) => {
        const isActive = activeWindow === w.id;
        const count = windowCounts?.[w.id];
        // Today / Week disabled when no games match; All Time enabled if any games.
        const hasGames = w.id === 'all'
          ? analyzedGameCount >= 1
          : count == null ? analyzedGameCount >= 1 : count >= 1;

        const labelKey = TAB_LABEL_KEYS[w.id];
        const label = labelKey ? t(labelKey) : w.label;

        return (
          <button
            key={w.id}
            onClick={() => hasGames && onWindowChange(w.id)}
            disabled={!hasGames}
            className={`px-3 py-2 rounded-[9px] text-[13px] font-semibold transition-all whitespace-nowrap ${
              isActive
                ? 'bg-chess-accent/15 text-chess-accent border border-chess-accent/40 shadow-[0_0_12px_rgba(74,222,128,0.18)]'
                : hasGames
                  ? 'text-chess-text-secondary hover:text-chess-text border border-transparent'
                  : 'text-chess-text-disabled border border-transparent cursor-not-allowed opacity-50'
            }`}
            title={!hasGames ? 'No games in this range yet' : undefined}
          >
            {label}
            {count != null && hasGames && !isActive && (
              <span className="ms-1.5 text-[10px] opacity-70 tabular-nums">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
