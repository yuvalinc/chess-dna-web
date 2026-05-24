import { memo, useEffect, useRef } from 'react';
import type { MoveAnalysis, MoveQuality } from '@shared/types/analysis';

interface MoveListProps {
  moves: MoveAnalysis[];
  currentMoveIndex: number;
  onMoveClick: (index: number) => void;
}

/* ── Quality → pill background + text ── */
const qualityPillStyles: Record<MoveQuality, { bg: string; text: string }> = {
  brilliant: { bg: 'bg-[#1baca6]/20', text: 'text-[#1baca6]' },
  great: { bg: 'bg-[#5c8bb0]/20', text: 'text-[#5c8bb0]' },
  best: { bg: '', text: 'text-chess-best' },
  excellent: { bg: '', text: 'text-chess-excellent' },
  good: { bg: '', text: 'text-gray-300' },
  book: { bg: 'bg-[#a88764]/15', text: 'text-[#a88764]' },
  forced: { bg: '', text: 'text-gray-500' },
  inaccuracy: { bg: 'bg-chess-inaccuracy/15', text: 'text-chess-inaccuracy' },
  mistake: { bg: 'bg-chess-mistake/15', text: 'text-chess-mistake' },
  miss: { bg: 'bg-chess-mistake/15', text: 'text-chess-mistake' },
  blunder: { bg: 'bg-chess-blunder/20', text: 'text-chess-blunder' },
};

/* Symbols removed — colors alone convey move quality */

const hasPill = (q: MoveQuality) =>
  q === 'brilliant' || q === 'great' || q === 'inaccuracy' || q === 'mistake' || q === 'miss' || q === 'blunder' || q === 'book';

function MoveList({ moves, currentMoveIndex, onMoveClick }: MoveListProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [currentMoveIndex]);

  return (
    <div
      className="flex items-center gap-x-1.5 px-2 py-2 font-mono text-[13px] whitespace-nowrap overflow-x-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {moves.map((move, i) => {
        const showNumber = move.color === 'white';
        const style = qualityPillStyles[move.quality];
        const isActive = currentMoveIndex === i;
        const showPill = hasPill(move.quality);

        return (
          <span key={i} className="inline-flex items-center gap-x-1">
            {showNumber && (
              <span className="text-[10px] text-gray-600 tabular-nums select-none">
                {move.moveNumber}.
              </span>
            )}
            <button
              ref={isActive ? activeRef : undefined}
              onClick={() => onMoveClick(i)}
              /* Larger hit area: px-2.5 py-1.5 gives roughly 36-40px tall
                 targets while still fitting a dense move list. The button
                 itself is the pill; the parent gap keeps siblings apart so
                 mobile users don't accidentally tap an adjacent move. */
              className={`px-2.5 py-1.5 rounded-md font-semibold transition-all active:scale-95 ${
                isActive
                  ? 'bg-chess-accent/25 text-white ring-1 ring-chess-accent/40'
                  : showPill
                    ? `${style.bg} ${style.text} hover:brightness-125`
                    : `${style.text} hover:bg-white/5`
              }`}
            >
              {move.moveSan}
            </button>
          </span>
        );
      })}
    </div>
  );
}

export default memo(MoveList);
