import type { ComponentProps } from 'react';
import { Chessboard } from 'react-chessboard';

type CustomPieces = NonNullable<ComponentProps<typeof Chessboard>['customPieces']>;
type PieceCode = keyof CustomPieces;

const PIECE_CODES: PieceCode[] = [
  'wP', 'wN', 'wB', 'wR', 'wQ', 'wK',
  'bP', 'bN', 'bB', 'bR', 'bQ', 'bK',
];

// Bump when piece SVGs change so iOS WKWebView re-fetches instead of using
// its cached copy. WKWebView ignores normal cache-control invalidation, so
// new URL = guaranteed fresh fetch.
const PIECE_VERSION = '3';

// Resting piece scale — picked so the piece body fills most of the
// square (chess.com / lichess feel) while the SVG-baked shadow doesn't
// crowd into neighbors. Was 0.88; bumped 10% per design feedback.
const RESTING_SCALE = 0.97;
// On drag the piece scales up and lifts so its visual bottom sits at the
// touch point. With transform-origin: center, scale(S) puts the wrapper's
// bottom at squareCenter + S * squareWidth/2; translating up by that amount
// places the bottom right under the cursor / finger. The cburnett SVG
// reserves a sliver of empty space below the piece body for the ground
// shadow, so we trim the lift slightly so the piece body bottom (not the
// shadow ellipse) lands on the touch point.
const DRAG_SCALE = 1.5;
const DRAG_LIFT_RATIO = 0.65;

function ShadowedPiece({ code, squareWidth, isDragging = false }: { code: PieceCode; squareWidth: number; isDragging?: boolean }) {
  const scale = isDragging ? DRAG_SCALE : RESTING_SCALE;
  const liftPx = isDragging ? -squareWidth * DRAG_LIFT_RATIO : 0;
  return (
    <div
      style={{
        width: squareWidth,
        height: squareWidth,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        transform: `translateY(${liftPx}px) scale(${scale})`,
        transformOrigin: 'center',
        transition: isDragging ? 'transform 90ms ease-out' : 'transform 70ms ease-in',
        willChange: 'transform',
        zIndex: isDragging ? 50 : undefined,
      }}
    >
      <img
        src={`/pieces/cburnett/${code}.svg?v=${PIECE_VERSION}`}
        alt={code}
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          userSelect: 'none',
          filter: isDragging
            ? 'drop-shadow(0 6px 6px rgba(0,0,0,0.45)) drop-shadow(0 14px 22px rgba(0,0,0,0.4))'
            : 'drop-shadow(0 1px 1px rgba(0,0,0,0.35))',
        }}
      />
    </div>
  );
}

export const cburnettShadowPieces: CustomPieces = PIECE_CODES.reduce<CustomPieces>(
  (acc, code) => {
    acc[code] = ({ squareWidth, isDragging }) => (
      <ShadowedPiece code={code} squareWidth={squareWidth} isDragging={isDragging} />
    );
    return acc;
  },
  {},
);
