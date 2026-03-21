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

  return (
    <div
      className="w-8 rounded-sm overflow-hidden relative flex flex-col border border-chess-border/40"
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

      {/* Score label */}
      <div
        className={`absolute left-0 right-0 text-center text-[10px] font-bold ${
          score >= 0 ? 'bottom-1 text-gray-800' : 'top-1 text-gray-200'
        }`}
      >
        {displayScore}
      </div>
    </div>
  );
}
