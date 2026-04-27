/**
 * Attribution badges and disclaimers for chess platforms.
 */

type BadgeSize = 'xs' | 'sm' | 'md';

const SIZES: Record<BadgeSize, { icon: string; text: string }> = {
  xs: { icon: 'w-3 h-3', text: 'text-[8px]' },
  sm: { icon: 'w-3.5 h-3.5', text: 'text-[9px]' },
  md: { icon: 'w-4 h-4', text: 'text-[10px]' },
};

export function ChessComBadge({ size = 'sm' }: { size?: BadgeSize }) {
  const s = SIZES[size];
  return (
    <span className="inline-flex items-center gap-1 text-gray-500">
      <img src="/logos/chesscom.svg" alt="Chess.com" className={`${s.icon} rounded-sm`} />
      <span className={`${s.text} uppercase tracking-wide font-medium`}>Chess.com</span>
    </span>
  );
}

export function LichessBadge({ size = 'sm' }: { size?: BadgeSize }) {
  const s = SIZES[size];
  return (
    <span className="inline-flex items-center gap-1 text-gray-500">
      <img src="/logos/lichess.svg" alt="Lichess" className={`${s.icon} rounded-sm`} />
      <span className={`${s.text} uppercase tracking-wide font-medium`}>Lichess</span>
    </span>
  );
}

/**
 * Page-level disclaimer for data attribution.
 * Shows at the bottom of pages that display data from chess platforms.
 */
export function DataAttribution() {
  return (
    <div className="text-[10px] text-gray-600 text-center py-4 mt-4 border-t border-white/[0.04]">
      Game data provided by{' '}
      <a href="https://www.chess.com" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-gray-400">Chess.com</a>
      {' '}and{' '}
      <a href="https://lichess.org" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-gray-400">Lichess</a>
      {' '}public APIs. Chess DNA is not affiliated with or endorsed by these platforms.
    </div>
  );
}
