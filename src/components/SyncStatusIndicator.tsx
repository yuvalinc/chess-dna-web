import { useChessData } from '@/contexts/ChessDataContext';
import { useT } from '@/i18n/index';

export default function SyncStatusIndicator() {
  const { isSyncing, lastSyncAt, syncError, syncNow } = useChessData();
  const { t } = useT();

  const timeAgo = (ts: number): string => {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return t('sync_just_now');
    if (diff < 3600) return t('sync_ago', { time: `${Math.floor(diff / 60)}m` });
    if (diff < 86400) return t('sync_ago', { time: `${Math.floor(diff / 3600)}h` });
    return t('sync_ago', { time: `${Math.floor(diff / 86400)}d` });
  };

  return (
    <button
      onClick={syncNow}
      disabled={isSyncing}
      className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-chess-surface/80 border border-chess-border/20 hover:bg-chess-surface transition-all disabled:opacity-60"
      title={syncError ? `Sync error: ${syncError}` : ''}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          isSyncing
            ? 'bg-chess-accent animate-pulse'
            : syncError
              ? 'bg-red-400'
              : 'bg-chess-accent'
        }`}
      />
      <span className="text-chess-text-secondary">
        {isSyncing
          ? t('games_analyzing')
          : lastSyncAt
            ? timeAgo(lastSyncAt)
            : ''}
      </span>
    </button>
  );
}
