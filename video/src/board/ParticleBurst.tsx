// Generic particle burst — spawns N particles flying outward from a square.
// Used for captures (orange), brilliant moves (gold), mate (red), promotion (white),
// etc. All effects are procedurally generated (no asset deps).

import { squareToXY, type Square } from "./fen";

export type ParticleKind = "burst" | "confetti" | "sparkle" | "smoke" | "ring";

export type ParticleBurstProps = {
  square: Square;
  boardSize: number;
  flipped?: boolean;
  // 0..1 — life of the burst (1 = freshly spawned, 0 = faded out)
  life: number;
  // Animation seed — change across triggers to vary
  seed?: number;
  kind?: ParticleKind;
  color?: string;
  particleCount?: number;
};

function rand(seed: number, i: number, off = 0): number {
  // Cheap deterministic pseudo-random in [0,1)
  return (Math.sin(seed * 999 + i * 17.7 + off) * 43758.5453) % 1;
}

export const ParticleBurst: React.FC<ParticleBurstProps> = ({
  square,
  boardSize,
  flipped = false,
  life,
  seed = 1,
  kind = "burst",
  color = "#fbbf24",
  particleCount,
}) => {
  if (life <= 0.02) return null;
  const cell = boardSize / 8;
  const { x, y } = squareToXY(square, boardSize);
  const fx = flipped ? boardSize - x - cell : x;
  const fy = flipped ? boardSize - y - cell : y;
  const cx = fx + cell / 2;
  const cy = fy + cell / 2;

  const count = particleCount ?? (kind === "confetti" ? 24 : kind === "sparkle" ? 14 : 18);
  const t = 1 - life; // 0 = fresh, 1 = faded
  const maxRadius = cell * (kind === "ring" ? 1.6 : 2.2);

  // Render expanding ring (shockwave) for "ring" kind
  if (kind === "ring") {
    const ringR = maxRadius * t;
    return (
      <svg
        width={boardSize}
        height={boardSize}
        viewBox={`0 0 ${boardSize} ${boardSize}`}
        style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" }}
      >
        <circle
          cx={cx}
          cy={cy}
          r={ringR}
          fill="none"
          stroke={color}
          strokeWidth={8 * life}
          opacity={life * 0.85}
        />
        <circle
          cx={cx}
          cy={cy}
          r={ringR * 0.8}
          fill="none"
          stroke="white"
          strokeWidth={3 * life}
          opacity={life * 0.6}
        />
      </svg>
    );
  }

  return (
    <svg
      width={boardSize}
      height={boardSize}
      viewBox={`0 0 ${boardSize} ${boardSize}`}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" }}
    >
      {Array.from({ length: count }, (_, i) => {
        const angle =
          (i / count) * Math.PI * 2 + rand(seed, i, 1) * 0.6;
        const speed = 0.65 + rand(seed, i, 2) * 0.8;
        const radius = maxRadius * t * speed;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius + t * t * cell * 0.7; // slight gravity
        const partSize =
          kind === "confetti"
            ? cell * (0.08 + rand(seed, i, 3) * 0.08)
            : kind === "sparkle"
              ? cell * (0.04 + (1 - t) * 0.05)
              : cell * (0.08 + (1 - t) * 0.06);
        const opacity = Math.max(0, life - (kind === "smoke" ? 0.1 : 0));
        const fill =
          kind === "confetti"
            ? `hsl(${(i * 47 + seed * 23) % 360} 90% 60%)`
            : color;
        const rotate = rand(seed, i, 4) * 360 + t * 720;

        if (kind === "confetti") {
          return (
            <rect
              key={i}
              x={px - partSize / 2}
              y={py - partSize / 2}
              width={partSize}
              height={partSize * 0.6}
              fill={fill}
              opacity={opacity}
              transform={`rotate(${rotate} ${px} ${py})`}
              stroke="rgba(0,0,0,0.3)"
              strokeWidth="0.5"
            />
          );
        }

        if (kind === "sparkle") {
          // Four-pointed sparkle (✦)
          const s = partSize * 1.6;
          return (
            <polygon
              key={i}
              points={`${px},${py - s} ${px + s * 0.25},${py - s * 0.25} ${px + s},${py} ${px + s * 0.25},${py + s * 0.25} ${px},${py + s} ${px - s * 0.25},${py + s * 0.25} ${px - s},${py} ${px - s * 0.25},${py - s * 0.25}`}
              fill={fill}
              opacity={opacity}
            />
          );
        }

        if (kind === "smoke") {
          return (
            <circle
              key={i}
              cx={px}
              cy={py}
              r={partSize * (1 + t * 2)}
              fill={fill}
              opacity={opacity * 0.4}
            />
          );
        }

        // Default burst — round particles with glow
        return (
          <circle
            key={i}
            cx={px}
            cy={py}
            r={partSize}
            fill={fill}
            opacity={opacity}
            filter={`drop-shadow(0 0 ${partSize}px ${fill})`}
          />
        );
      })}
    </svg>
  );
};
