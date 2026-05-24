// Two AK-47-style silhouettes flanking a square — meme effect for moving piece.
import { squareToXY, type Square } from "./fen";

export type GunOverlayProps = {
  square: Square;
  boardSize: number;
  flipped?: boolean;
  // 0..1 — animation progress for bounce-in
  progress?: number;
  // Tint color
  color?: string;
};

const RifleSVG: React.FC<{ size: number; color: string; flip?: boolean }> = ({
  size,
  color,
  flip,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    style={{
      transform: flip ? "scaleX(-1)" : undefined,
      filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.6))",
    }}
  >
    <defs>
      <linearGradient id={`gun-grad-${flip ? "f" : "n"}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#8a2c2c" />
        <stop offset="40%" stopColor={color} />
        <stop offset="100%" stopColor="#4a0606" />
      </linearGradient>
      <linearGradient id={`gun-wood-${flip ? "f" : "n"}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#6b3410" />
        <stop offset="100%" stopColor="#3a1a08" />
      </linearGradient>
    </defs>
    <g stroke="#000" strokeWidth="1.5" strokeLinejoin="round">
      {/* Wood stock */}
      <path
        d="M 10 50 L 28 48 L 32 56 L 14 60 Z"
        fill={`url(#gun-wood-${flip ? "f" : "n"})`}
      />
      {/* Main body */}
      <rect x="28" y="46" width="34" height="10" fill={`url(#gun-grad-${flip ? "f" : "n"})`} rx="1" />
      {/* Magazine — curved */}
      <path
        d="M 38 56 L 50 56 L 52 70 L 36 70 Z"
        fill={`url(#gun-grad-${flip ? "f" : "n"})`}
      />
      {/* Trigger grip */}
      <path d="M 50 56 L 56 56 L 54 64 L 52 64 Z" fill="#1a1a1a" />
      {/* Barrel */}
      <rect x="62" y="48" width="22" height="6" fill={`url(#gun-grad-${flip ? "f" : "n"})`} rx="1" />
      {/* Front sight */}
      <rect x="80" y="44" width="4" height="6" fill="#1a1a1a" />
      {/* Muzzle */}
      <rect x="84" y="49" width="6" height="4" fill="#0a0a0a" />
      {/* Rear sight */}
      <rect x="36" y="43" width="6" height="4" fill="#1a1a1a" />
      {/* Wood grip on bottom */}
      <path d="M 56 56 L 64 56 L 62 68 L 56 68 Z" fill={`url(#gun-wood-${flip ? "f" : "n"})`} />
    </g>
    {/* Muzzle flash on right side */}
    <g opacity="0.85">
      <polygon points="90,51 96,48 94,52 96,56 90,53" fill="#fde047" />
      <polygon points="92,51 98,50 96,52 98,54 92,53" fill="#f97316" />
    </g>
  </svg>
);

export const GunOverlay: React.FC<GunOverlayProps> = ({
  square,
  boardSize,
  flipped = false,
  progress = 1,
  color = "#dc2626",
}) => {
  const cell = boardSize / 8;
  const { x, y } = squareToXY(square, boardSize);
  const fx = flipped ? boardSize - x - cell : x;
  const fy = flipped ? boardSize - y - cell : y;
  // Center on the square
  const cx = fx + cell / 2;
  const cy = fy + cell / 2;

  const gunSize = cell * 1.4;
  // Slide-in from outside the square — left gun from left, right gun from right
  const slide = (1 - progress) * cell * 1.5;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        pointerEvents: "none",
        width: boardSize,
        height: boardSize,
      }}
    >
      {/* Left-side gun (pointing right toward the square) */}
      <div
        style={{
          position: "absolute",
          left: cx - gunSize - slide,
          top: cy - gunSize / 2,
          width: gunSize,
          height: gunSize,
          opacity: progress,
          transform: `rotate(${-12 + (1 - progress) * 30}deg)`,
          transformOrigin: "right center",
        }}
      >
        <RifleSVG size={gunSize} color={color} />
      </div>
      {/* Right-side gun (mirrored, pointing left toward the square) */}
      <div
        style={{
          position: "absolute",
          left: cx + slide,
          top: cy - gunSize / 2,
          width: gunSize,
          height: gunSize,
          opacity: progress,
          transform: `rotate(${12 - (1 - progress) * 30}deg)`,
          transformOrigin: "left center",
        }}
      >
        <RifleSVG size={gunSize} color={color} flip />
      </div>
    </div>
  );
};
