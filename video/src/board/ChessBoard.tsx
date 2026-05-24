import { staticFile } from "remotion";
import { THEMES, type ThemeName } from "./themes";
import { parseFen, squareToXY, type Square, type PieceCode } from "./fen";
import { Sticker, type StickerKind } from "./Sticker";
import { MemeIcon, type MemeKind } from "./MemeIcon";

export type SquareHighlight = {
  square: Square;
  color: string;
  opacity?: number;
};

export type SquareGlow = {
  square: Square;
  color: string;
  intensity?: number;
};

export type SquareSticker = {
  square: Square;
  label: string;
  kind?: StickerKind;
  scale?: number;
};

export type MovingPiece = {
  code: PieceCode;
  x: number;
  y: number;
  scale?: number;
  rotate?: number;
  opacity?: number;
  glow?: string;
  trail?: number;
};

export type MoveArrow = {
  from: Square;
  to: Square;
  color?: string;
  progress?: number;
};

export type PieceOverride = {
  square: Square;
  rotate?: number;
  scale?: number;
  glow?: string;
  opacity?: number;
};

export type SquareMeme = {
  square: Square;
  // Pick ONE: built-in SVG kind, emoji/text, or external image URL
  kind?: MemeKind;
  emoji?: string;
  imageUrl?: string;
  scale?: number;
  rotate?: number;
  opacity?: number;
  // If true, hides the FEN piece at this square (otherwise renders on top)
  replacePiece?: boolean;
};

export type ChessBoardProps = {
  fen: string;
  size: number;
  theme?: ThemeName;
  highlights?: SquareHighlight[];
  glows?: SquareGlow[];
  stickers?: SquareSticker[];
  hideAtSquares?: Square[];
  movingPieces?: MovingPiece[];
  arrows?: MoveArrow[];
  pieceOverrides?: PieceOverride[];
  squareMemes?: SquareMeme[];
  grayscale?: number;
  brightness?: number;
  saturate?: number;
  contrast?: number;
  flipped?: boolean;
  tilt?: number;
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;

export const ChessBoard: React.FC<ChessBoardProps> = ({
  fen,
  size,
  theme = "classicGreen",
  highlights = [],
  glows = [],
  stickers = [],
  hideAtSquares: hideAtSquaresProp = [],
  movingPieces = [],
  arrows = [],
  pieceOverrides = [],
  squareMemes = [],
  grayscale = 0,
  brightness = 1,
  saturate = 1.15,
  contrast = 1.05,
  flipped = false,
  tilt = 0,
}) => {
  const colors = THEMES[theme];
  const cell = size / 8;
  const pieces = parseFen(fen);

  // pieceOverrides hide the original FEN piece and re-render it at the same
  // square with rotation/glow. The rendered override is appended to movingPieces.
  const overrideSquares = pieceOverrides.map((p) => p.square);
  const memeReplaceSquares = squareMemes.filter((m) => m.replacePiece).map((m) => m.square);
  const hideAtSquares = [...hideAtSquaresProp, ...overrideSquares, ...memeReplaceSquares];
  const overrideMovingPieces: MovingPiece[] = [];
  for (const p of pieceOverrides) {
    const code = pieces[p.square];
    if (!code) continue;
    const { x, y } = squareToXY(p.square, size);
    overrideMovingPieces.push({
      code,
      x,
      y,
      rotate: p.rotate,
      scale: p.scale,
      glow: p.glow,
      opacity: p.opacity,
    });
  }
  const allMovingPieces = [...movingPieces, ...overrideMovingPieces];
  const filter = `grayscale(${grayscale}) brightness(${brightness}) saturate(${saturate}) contrast(${contrast})`;
  const transform = tilt
    ? `perspective(1800px) rotateX(${tilt}deg)`
    : undefined;

  const renderFiles = flipped ? [...FILES].reverse() : FILES;
  const renderRanks = flipped ? [...RANKS].reverse() : RANKS;

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        filter,
        transform,
        transformStyle: "preserve-3d",
        boxShadow:
          "0 30px 80px rgba(0,0,0,0.55), 0 10px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {/* Squares */}
      {renderRanks.map((rank, ri) =>
        renderFiles.map((file, fi) => {
          const sq = `${file}${rank}` as Square;
          const isLight = (fi + ri) % 2 === 0;
          return (
            <div
              key={sq}
              style={{
                position: "absolute",
                left: fi * cell,
                top: ri * cell,
                width: cell,
                height: cell,
                background: isLight ? colors.light : colors.dark,
              }}
            />
          );
        }),
      )}

      {/* Highlights */}
      {highlights.map((h, i) => {
        const { x, y } = squareToXY(h.square, size);
        const fx = flipped ? size - x - cell : x;
        const fy = flipped ? size - y - cell : y;
        return (
          <div
            key={`hl-${i}`}
            style={{
              position: "absolute",
              left: fx,
              top: fy,
              width: cell,
              height: cell,
              background: h.color,
              opacity: h.opacity ?? 0.7,
              mixBlendMode: "multiply",
            }}
          />
        );
      })}

      {/* Pieces (FEN-positioned) */}
      {Object.entries(pieces)
        .filter(([sq]) => !hideAtSquares.includes(sq as Square))
        .map(([sq, code]) => {
          const { x, y } = squareToXY(sq as Square, size);
          const fx = flipped ? size - x - cell : x;
          const fy = flipped ? size - y - cell : y;
          return (
            <img
              key={sq}
              src={staticFile(`pieces/cburnett/${code}.svg`)}
              alt={code}
              style={{
                position: "absolute",
                left: fx,
                top: fy,
                width: cell,
                height: cell,
                userSelect: "none",
                pointerEvents: "none",
                filter:
                  "drop-shadow(0 4px 6px rgba(0,0,0,0.55)) drop-shadow(0 1px 2px rgba(0,0,0,0.4))",
              }}
            />
          );
        })}

      {/* Move arrows (under moving pieces, over static pieces) */}
      {arrows.length > 0 && (
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
        >
          <defs>
            {arrows.map((a, i) => (
              <marker
                key={`m-${i}`}
                id={`arrowhead-${i}`}
                markerWidth="3"
                markerHeight="3"
                refX="2"
                refY="1.5"
                orient="auto"
              >
                <polygon points="0 0, 3 1.5, 0 3" fill={a.color ?? "#22d3ee"} />
              </marker>
            ))}
          </defs>
          {arrows.map((a, i) => {
            const fa = squareToXY(a.from, size);
            const ta = squareToXY(a.to, size);
            const fx1 = (flipped ? size - fa.x - cell : fa.x) + cell / 2;
            const fy1 = (flipped ? size - fa.y - cell : fa.y) + cell / 2;
            const fx2 = (flipped ? size - ta.x - cell : ta.x) + cell / 2;
            const fy2 = (flipped ? size - ta.y - cell : ta.y) + cell / 2;
            const dx = fx2 - fx1;
            const dy = fy2 - fy1;
            const len = Math.hypot(dx, dy);
            const p = Math.min(1, Math.max(0, a.progress ?? 1));
            const ex = fx1 + dx * p;
            const ey = fy1 + dy * p;
            return (
              <line
                key={`a-${i}`}
                x1={fx1}
                y1={fy1}
                x2={ex}
                y2={ey}
                stroke={a.color ?? "#22d3ee"}
                strokeWidth={cell * 0.18}
                strokeLinecap="round"
                opacity={0.85}
                markerEnd={p > 0.95 ? `url(#arrowhead-${i})` : undefined}
                style={{ filter: `drop-shadow(0 0 8px ${a.color ?? "#22d3ee"})` }}
              />
            );
          })}
        </svg>
      )}

      {/* Moving pieces (override coordinates, on top of static pieces) */}
      {allMovingPieces.map((mp, i) => {
        const fx = flipped ? size - mp.x - cell : mp.x;
        const fy = flipped ? size - mp.y - cell : mp.y;
        const scale = mp.scale ?? 1;
        const rotate = mp.rotate ?? 0;
        const glow = mp.glow
          ? `drop-shadow(0 0 ${cell * 0.25}px ${mp.glow}) drop-shadow(0 0 ${cell * 0.4}px ${mp.glow})`
          : "";
        const trail = mp.trail ?? 0;
        return (
          <img
            key={`mp-${i}`}
            src={staticFile(`pieces/cburnett/${mp.code}.svg`)}
            alt={mp.code}
            style={{
              position: "absolute",
              left: fx,
              top: fy,
              width: cell,
              height: cell,
              userSelect: "none",
              pointerEvents: "none",
              opacity: mp.opacity ?? 1,
              transform: `scale(${scale}) rotate(${rotate}deg)`,
              transformOrigin: "center center",
              filter: `drop-shadow(0 ${10 + trail * 8}px ${14 + trail * 16}px rgba(0,0,0,0.7)) ${glow}`,
              zIndex: 5,
            }}
          />
        );
      })}

      {/* Glows (rendered on top of pieces) */}
      {glows.map((g, i) => {
        const { x, y } = squareToXY(g.square, size);
        const fx = flipped ? size - x - cell : x;
        const fy = flipped ? size - y - cell : y;
        const intensity = g.intensity ?? 1;
        return (
          <div
            key={`gl-${i}`}
            style={{
              position: "absolute",
              left: fx,
              top: fy,
              width: cell,
              height: cell,
              borderRadius: 8,
              boxShadow: `
                0 0 ${20 * intensity}px ${4 * intensity}px ${g.color},
                0 0 ${60 * intensity}px ${10 * intensity}px ${g.color},
                inset 0 0 ${30 * intensity}px ${g.color}
              `,
              border: `2px solid ${g.color}`,
              pointerEvents: "none",
            }}
          />
        );
      })}

      {/* Square memes — emoji/image overlays on specific squares */}
      {squareMemes.map((m, i) => {
        const { x, y } = squareToXY(m.square, size);
        const fx = flipped ? size - x - cell : x;
        const fy = flipped ? size - y - cell : y;
        const scale = m.scale ?? 1;
        const rotate = m.rotate ?? 0;
        const opacity = m.opacity ?? 1;
        const src = m.imageUrl
          ? (m.imageUrl.startsWith("http") ? m.imageUrl : staticFile(m.imageUrl))
          : null;
        return (
          <div
            key={`mm-${i}`}
            style={{
              position: "absolute",
              left: fx,
              top: fy,
              width: cell,
              height: cell,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: `scale(${scale}) rotate(${rotate}deg)`,
              opacity,
              pointerEvents: "none",
              zIndex: 6,
            }}
          >
            {m.kind ? (
              <div style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))", width: cell * 0.92, height: cell * 0.92 }}>
                <MemeIcon kind={m.kind} size={cell * 0.92} />
              </div>
            ) : src ? (
              <img
                src={src}
                alt=""
                style={{
                  width: "92%",
                  height: "92%",
                  objectFit: "contain",
                  filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                }}
              />
            ) : (
              <span
                style={{
                  fontSize: cell * 0.78,
                  lineHeight: 1,
                  filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                }}
              >
                {m.emoji ?? "🔫"}
              </span>
            )}
          </div>
        );
      })}

      {/* Stickers */}
      {stickers.map((s, i) => {
        const { x, y } = squareToXY(s.square, size);
        const fx = flipped ? size - x - cell : x;
        const fy = flipped ? size - y - cell : y;
        return (
          <div
            key={`st-${i}`}
            style={{
              position: "absolute",
              left: fx + cell * 0.45,
              top: fy - cell * 0.25,
              pointerEvents: "none",
            }}
          >
            <Sticker
              kind={s.kind ?? "blunder"}
              label={s.label}
              size={cell * 0.85}
              scale={s.scale ?? 1}
            />
          </div>
        );
      })}

      {/* Outer border */}
      {colors.border && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: `4px solid ${colors.border}`,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
};
