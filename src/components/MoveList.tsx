import type { MoveAnalysis, MoveQuality } from '@shared/types/analysis';

interface MoveListProps {
  moves: MoveAnalysis[];
  currentMoveIndex: number;
  onMoveClick: (index: number) => void;
}

const qualityColors: Record<MoveQuality, string> = {
  brilliant: 'text-[#1baca6]',
  great: 'text-[#5c8bb0]',
  best: 'text-chess-best',
  excellent: 'text-chess-excellent',
  good: 'text-chess-text',
  book: 'text-[#a88764]',
  forced: 'text-gray-500',
  inaccuracy: 'text-chess-inaccuracy',
  mistake: 'text-chess-mistake',
  miss: 'text-chess-mistake',
  blunder: 'text-chess-blunder',
};

const qualitySymbols: Record<MoveQuality, string> = {
  brilliant: '!!',
  great: '!',
  best: '',
  excellent: '',
  good: '',
  book: '',
  forced: '',
  inaccuracy: '?!',
  mistake: '?',
  miss: '?',
  blunder: '??',
};

export default function MoveList({ moves, currentMoveIndex, onMoveClick }: MoveListProps) {
  return (
    <div className="flex items-baseline gap-x-0 px-2 py-1.5 text-sm whitespace-nowrap overflow-x-auto scrollbar-thin scrollbar-thumb-chess-border/30">
      {moves.map((move, i) => {
        const showNumber = move.color === 'white';
        const symbol = qualitySymbols[move.quality];
        const color = qualityColors[move.quality];
        const isActive = currentMoveIndex === i;

        return (
          <span key={i} className="inline-flex items-baseline">
            {showNumber && (
              <span className="text-[11px] text-gray-500 mr-0.5 tabular-nums">
                {move.moveNumber}.
              </span>
            )}
            <button
              onClick={() => onMoveClick(i)}
              className={`px-1 py-0.5 rounded transition-colors hover:bg-chess-surface/60 ${
                isActive ? 'bg-chess-accent/20 rounded' : ''
              } ${color}`}
            >
              {move.moveSan}
              {symbol && <span className="text-[10px]">{symbol}</span>}
            </button>
          </span>
        );
      })}
    </div>
  );
}
