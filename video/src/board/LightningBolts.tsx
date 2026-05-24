import { squareToXY, type Square } from "./fen";

export type LightningBoltsProps = {
  square: Square;
  boardSize: number;
  color?: string;
  intensity?: number;
  frame: number;
  flipped?: boolean;
};

function jaggedPath(
  cx: number,
  cy: number,
  angle: number,
  length: number,
  segments: number,
  jitter: number,
  seed: number,
): string {
  // Pseudo-random based on seed + segment index
  let px = cx;
  let py = cy;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const perpX = -dy;
  const perpY = dx;
  let path = `M ${px.toFixed(1)} ${py.toFixed(1)}`;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const baseX = cx + dx * length * t;
    const baseY = cy + dy * length * t;
    const noise =
      ((Math.sin(seed * 99 + i * 17) * 43758.5453) % 1) * 2 * jitter - jitter;
    const x = baseX + perpX * noise * (1 - t * 0.6);
    const y = baseY + perpY * noise * (1 - t * 0.6);
    path += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    px = x;
    py = y;
  }
  return path;
}

export const LightningBolts: React.FC<LightningBoltsProps> = ({
  square,
  boardSize,
  color = "#fbbf24",
  intensity = 1,
  frame,
  flipped = false,
}) => {
  const cell = boardSize / 8;
  const { x, y } = squareToXY(square, boardSize);
  const fx = flipped ? boardSize - x - cell : x;
  const fy = flipped ? boardSize - y - cell : y;
  const cx = fx + cell / 2;
  const cy = fy + cell / 2;

  // 8 bolts radiating outward, flicker on/off
  const bolts = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2 + (frame * 0.04);
    const seed = i + Math.floor(frame / 6); // jitter regenerates every 6 frames
    const flicker = Math.sin(frame * 0.6 + i * 1.3) > 0 ? 1 : 0.25;
    return {
      path: jaggedPath(cx, cy, angle, cell * 2.2, 6, cell * 0.18, seed),
      opacity: flicker * intensity * 0.95,
    };
  });

  return (
    <svg
      width={boardSize}
      height={boardSize}
      viewBox={`0 0 ${boardSize} ${boardSize}`}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" }}
    >
      <defs>
        <filter id="lightning-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {bolts.map((b, i) => (
        <g key={i} filter="url(#lightning-glow)">
          <path
            d={b.path}
            stroke={color}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity={b.opacity * 0.6}
          />
          <path
            d={b.path}
            stroke="white"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity={b.opacity}
          />
        </g>
      ))}
    </svg>
  );
};
