/**
 * Renders AI explanation text with clickable [a1]-[h8] square references.
 * Supports two formats:
 * 1. Plain text — rendered as a single paragraph
 * 2. Structured "Your move:" / "Best move:" — rendered as a swipeable gallery (one card at a time)
 *
 * Labels are always rendered in the app's language (not the AI's).
 * Text direction (RTL/LTR) is auto-detected.
 */

import { useRef, useState } from 'react';
import { useT } from '@/i18n/index';

// Labels in all supported languages — used to detect structured format in AI responses
const YOUR_MOVE_PATTERNS = /(?:your move|המהלך שלך|tu jugada)\s*[:：]\s*/i;
const BEST_MOVE_PATTERNS = /(?:best move|המהלך הטוב|la mejor jugada|mejor jugada)\s*[:：]\s*/i;

export default function ExplanationText({
  text,
  onSquareClick,
}: {
  text: string;
  onSquareClick: (sq: string) => void;
}) {
  const { t } = useT();

  // Strip any remaining markdown formatting
  const cleaned = text.replace(/\*\*/g, '').replace(/\*/g, '');

  // Detect if text contains Hebrew/Arabic chars for RTL
  const isRtl = /[\u0590-\u05FF\u0600-\u06FF]/.test(cleaned);

  // Try to parse structured format: "Your move: ... Best move: ..."
  const yourMoveMatch = cleaned.match(YOUR_MOVE_PATTERNS);
  const bestMoveMatch = cleaned.match(BEST_MOVE_PATTERNS);

  if (yourMoveMatch && bestMoveMatch) {
    const yourIdx = yourMoveMatch.index!;
    const bestIdx = bestMoveMatch.index!;

    let yourText: string;
    let bestText: string;

    if (yourIdx < bestIdx) {
      yourText = cleaned.slice(yourIdx + yourMoveMatch[0].length, bestIdx).trim();
      bestText = cleaned.slice(bestIdx + bestMoveMatch[0].length).trim();
    } else {
      bestText = cleaned.slice(bestIdx + bestMoveMatch[0].length, yourIdx).trim();
      yourText = cleaned.slice(yourIdx + yourMoveMatch[0].length).trim();
    }

    // Always use our own translated labels
    const yourLabel = t('explanation_your_move') || 'Your move';
    const bestLabel = t('explanation_best_move') || 'Best move';

    return (
      <MoveGallery
        yourLabel={yourLabel}
        bestLabel={bestLabel}
        yourText={yourText}
        bestText={bestText}
        isRtl={isRtl}
        onSquareClick={onSquareClick}
      />
    );
  }

  // Fallback: plain text format
  return <span className={isRtl ? 'text-right block' : ''} dir={isRtl ? 'rtl' : 'ltr'}><SquareRefs text={cleaned} onSquareClick={onSquareClick} /></span>;
}

/** Swipeable gallery for Your Move / Best Move cards. */
function MoveGallery({
  yourLabel,
  bestLabel,
  yourText,
  bestText,
  isRtl,
  onSquareClick,
}: {
  yourLabel: string;
  bestLabel: string;
  yourText: string;
  bestText: string;
  isRtl: boolean;
  onSquareClick: (sq: string) => void;
}) {
  const [active, setActive] = useState<0 | 1>(0);
  const touchStartX = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 40) return;
    const goNext = isRtl ? dx > 0 : dx < 0;
    setActive((prev) => (goNext ? (prev === 0 ? 1 : prev) : (prev === 1 ? 0 : prev)));
  };

  const cards = [
    { label: yourLabel, color: 'red', text: yourText },
    { label: bestLabel, color: 'accent', text: bestText },
  ] as const;
  const current = cards[active];
  const isYour = current.color === 'red';
  const cardBg = isYour ? 'bg-red-500/10 border-red-500/20' : 'bg-chess-accent/10 border-chess-accent/20';
  const labelColor = isYour ? 'text-red-400' : 'text-chess-accent';
  const dotActiveColor = isYour ? 'bg-red-400' : 'bg-chess-accent';

  const goPrev = () => setActive(0);
  const goNext = () => setActive(1);

  return (
    <div className={isRtl ? 'text-right' : ''} dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex items-stretch gap-1.5">
        <button
          onClick={goPrev}
          disabled={active === 0}
          aria-label={`Show ${yourLabel}`}
          className="shrink-0 w-8 flex items-center justify-center rounded-lg bg-white/[0.03] text-gray-400 disabled:opacity-20 hover:bg-white/[0.08] active:bg-white/[0.12] transition-all"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="rtl:rotate-180"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div
          key={active}
          className={`${cardBg} border rounded-lg px-3 py-2 flex-1 min-w-0 animate-fade-in`}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <span className={`text-[10px] font-bold ${labelColor} uppercase tracking-wide block mb-1`}>
            {current.label}
          </span>
          <span className="text-chess-text text-[12px] leading-relaxed">
            <SquareRefs text={current.text} onSquareClick={onSquareClick} />
          </span>
        </div>
        <button
          onClick={goNext}
          disabled={active === 1}
          aria-label={`Show ${bestLabel}`}
          className="shrink-0 w-8 flex items-center justify-center rounded-lg bg-white/[0.03] text-gray-400 disabled:opacity-20 hover:bg-white/[0.08] active:bg-white/[0.12] transition-all"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="rtl:rotate-180"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      <div className="flex items-center justify-center gap-1.5 mt-1.5">
        {cards.map((_, i) => (
          <button
            key={i}
            onClick={() => setActive(i as 0 | 1)}
            aria-label={`Go to card ${i + 1}`}
            className={`rounded-full transition-all duration-200 ${
              active === i
                ? `w-5 h-1.5 ${dotActiveColor}`
                : 'w-1.5 h-1.5 bg-gray-600 hover:bg-gray-400'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/** Renders text with clickable [square] references and word-by-word animation */
function SquareRefs({ text, onSquareClick }: { text: string; onSquareClick: (sq: string) => void }) {
  const parts = text.split(/(\[[A-Za-z]?x?[a-h][1-8][+#]?\])/g);
  let wordIndex = 0;

  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[([A-Za-z]?x?([a-h][1-8])[+#]?)\]$/);
        if (match) {
          const display = match[1];
          const square = match[2];
          const delay = wordIndex++ * 0.04;
          return (
            <button
              key={i}
              onClick={() => onSquareClick(square)}
              className="inline-flex items-center justify-center font-mono font-bold text-blue-400 bg-blue-500/15 px-1 rounded mx-0.5 hover:bg-blue-500/25 transition-colors cursor-pointer animate-word-blur-in"
              style={{ animationDelay: `${delay}s` }}
            >
              {display}
            </button>
          );
        }
        // Split plain text into words and animate each
        return part.split(/(\s+)/).map((word, j) => {
          if (/^\s+$/.test(word)) return <span key={`${i}-${j}`}>{word}</span>;
          const delay = wordIndex++ * 0.04;
          return (
            <span key={`${i}-${j}`} className="inline-block animate-word-blur-in" style={{ animationDelay: `${delay}s` }}>
              {word}
            </span>
          );
        });
      })}
    </>
  );
}
