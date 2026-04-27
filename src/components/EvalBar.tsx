interface EvalBarProps {
  /** Centipawn score from white's perspective */
  score: number;
  /** Score type: 'cp' for centipawns, 'mate' for mate in N */
  scoreType: 'cp' | 'mate';
  /** Height of the bar in pixels */
  height?: number;
}

/**
 * Vertical evaluation bar, similar to Lichess.
 * White portion grows from the top when white is winning.
 */
export default function EvalBar({ score, scoreType, height = 400 }: EvalBarProps) {
  // Convert score to a percentage (0 = black winning, 100 = white winning)
  let whitePercent: number;
  let displayScore: string;

  if (scoreType === 'mate') {
    whitePercent = score > 0 ? 100 : 0;
    displayScore = `M${Math.abs(score)}`;
  } else {
    // Sigmoid-like function: maps cp to 0-100%
    // Using the win% formula: 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
    whitePercent = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * score)) - 1);
    whitePercent = Math.max(2, Math.min(98, whitePercent));

    const absScore = Math.abs(score);
    if (absScore >= 100) {
      displayScore = `${score > 0 ? '+' : ''}${(score / 100).toFixed(1)}`;
    } else {
      displayScore = `${score > 0 ? '+' : ''}${(score / 100).toFixed(2)}`;
    }
  }

  // The score label is rendered INSIDE the bar — anchored to whichever
  // side is winning (top of the white portion when white wins, bottom of
  // the black portion when black wins). Removes the dead row that used
  // to sit beneath the bar.
  const whiteWinning = whitePercent >= 50;

  return (
    <div className="shrink-0">
      <div
        className="w-7 rounded-sm overflow-hidden relative flex flex-col border border-chess-border/40"
        style={{ height }}
      >
        {/* Black portion (top) */}
        <div
          className="bg-[#333] transition-all duration-300 ease-out"
          style={{ height: `${100 - whitePercent}%` }}
        />
        {/* White portion (bottom) */}
        <div
          className="bg-[#f0f0f0] transition-all duration-300 ease-out flex-1"
        />

        {/* Score label inside the bar, on the winning side. */}
        <div
          className="absolute left-0 right-0 text-center text-[9px] font-bold tabular-nums select-none pointer-events-none"
          style={
            whiteWinning
              ? { bottom: 2, color: '#1a1a1a' }
              : { top: 2, color: '#f0f0f0' }
          }
        >
          {displayScore}
        </div>
      </div>
    </div>
  );
}
