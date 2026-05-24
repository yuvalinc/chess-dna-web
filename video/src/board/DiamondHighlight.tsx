import { squareToXY, type Square } from "./fen";

export type DiamondHighlightProps = {
  squares: [Square, Square];
  boardSize: number;
  color?: string;
  progress?: number;
  flipped?: boolean;
  fillSquare?: Square;
  rotate?: number;
};

export const DiamondHighlight: React.FC<DiamondHighlightProps> = ({
  squares,
  boardSize,
  color = "#22d3ee",
  progress = 1,
  flipped = false,
  fillSquare,
  rotate = 0,
}) => {
  const cell = boardSize / 8;
  const a = squareToXY(squares[0], boardSize);
  const b = squareToXY(squares[1], boardSize);

  const rect = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x) + cell,
    h: Math.abs(b.y - a.y) + cell,
  };
  if (flipped) {
    rect.x = boardSize - rect.x - rect.w;
    rect.y = boardSize - rect.y - rect.h;
  }

  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const half = Math.max(rect.w, rect.h) * 0.85;

  const points = [
    [cx, cy - half],
    [cx + half, cy],
    [cx, cy + half],
    [cx - half, cy],
  ];
  const path = `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]} L ${points[2][0]} ${points[2][1]} L ${points[3][0]} ${points[3][1]} Z`;

  // Each side ~half*sqrt(2), total perimeter ~ 4*half*sqrt(2)
  const perimeter = 4 * half * Math.SQRT2;
  const dashOffset = perimeter * (1 - progress);

  const fill = fillSquare ? squareToXY(fillSquare, boardSize) : null;
  const fx = fill && flipped ? boardSize - fill.x - cell : fill?.x ?? 0;
  const fy = fill && flipped ? boardSize - fill.y - cell : fill?.y ?? 0;

  return (
    <svg
      width={boardSize}
      height={boardSize}
      viewBox={`0 0 ${boardSize} ${boardSize}`}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        pointerEvents: "none",
        overflow: "visible",
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        transformOrigin: `${cx}px ${cy}px`,
      }}
    >
      <defs>
        <filter id="diamond-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {fill && (
        <rect
          x={fx}
          y={fy}
          width={cell}
          height={cell}
          fill={color}
          opacity={0.55 * progress}
          filter="url(#diamond-glow)"
        />
      )}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={8}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={perimeter}
        strokeDashoffset={dashOffset}
        opacity={0.95}
        filter="url(#diamond-glow)"
      />
      <path
        d={path}
        fill="none"
        stroke="white"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeDasharray={perimeter}
        strokeDashoffset={dashOffset}
        opacity={0.7 * progress}
      />
    </svg>
  );
};
