import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { ChessBoard } from "../board/ChessBoard";
import { Background } from "../board/Background";
import { DiamondHighlight } from "../board/DiamondHighlight";
import { LightningBolts } from "../board/LightningBolts";
import { squareToXY } from "../board/fen";
import type { SpotlightShot as SpotlightShotProps } from "../storyboard/types";

export const SpotlightShot: React.FC<SpotlightShotProps> = ({
  fen,
  square,
  glowColor = "#22d3ee",
  caption,
  theme = "monoSlate",
  layingPiece,
  layingPieceColor = "#dc2626",
  electric = false,
  zoomScale = 1,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const boardSize = Math.min(width * 0.95, 900);
  const cell = boardSize / 8;

  const reveal = spring({ frame, fps, config: { damping: 14, stiffness: 90 } });
  const diamondDraw = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 60 },
  });
  const pulse = electric
    ? 1.1 + 0.6 * Math.sin((frame / fps) * Math.PI * 4)
    : 0.85 + 0.4 * Math.sin((frame / fps) * Math.PI * 2.5);
  const captionY = interpolate(reveal, [0, 1], [80, 0]);
  const breath = 1 + 0.012 * Math.sin((frame / fps) * Math.PI * 1.5);

  // For electric mode: animate zoom-in over the first ~0.6s, then hold.
  const effectiveZoom = electric
    ? interpolate(frame, [0, fps * 0.6], [1, zoomScale > 1 ? zoomScale : 1.8], {
        extrapolateRight: "clamp",
      })
    : zoomScale;

  // Compute centering offsets for the zoom (centered on the spotlight square)
  const sqCell = squareToXY(square, boardSize);
  const sqCx = sqCell.x + cell / 2;
  const sqCy = sqCell.y + cell / 2;
  const zoomOffsetX = (boardSize / 2 - sqCx) * (effectiveZoom - 1);
  const zoomOffsetY = (boardSize / 2 - sqCy) * (effectiveZoom - 1);

  // Continuous spin for the diamond when electric
  const diamondRotate = electric ? (frame / fps) * 360 * 0.45 : 0;

  // Camera shake on electric mode for added kinetic feel
  const shake = electric ? Math.sin(frame * 1.8) * 3 : 0;

  // Sparkle particles around the spotlight square
  const sparkleCount = electric ? 12 : 6;
  const sparkles = Array.from({ length: sparkleCount }, (_, i) => {
    const t = (frame / fps + i * 0.3) % 1.4;
    const angle = (i / sparkleCount) * Math.PI * 2 + frame * 0.03;
    return { t, angle };
  });

  return (
    <AbsoluteFill>
      <Background variant={electric ? "warm" : "blueglow"} />
      {/* Electric backdrop flicker */}
      {electric && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at ${width / 2}px ${height / 2}px, rgba(251,191,36,${0.15 + 0.1 * Math.sin(frame * 0.5)}) 0%, transparent 60%)`,
            pointerEvents: "none",
          }}
        />
      )}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            position: "relative",
            transform: `translate(${zoomOffsetX + shake}px, ${zoomOffsetY}px) scale(${effectiveZoom * breath})`,
            transformOrigin: "center center",
          }}
        >
          <ChessBoard
            fen={fen}
            size={boardSize}
            theme={theme}
            grayscale={electric ? 0.6 : 0.85}
            brightness={electric ? 0.7 : 0.55}
            saturate={electric ? 0.7 : 0.5}
            tilt={electric ? 2 : 4}
            glows={[{ square, color: glowColor, intensity: pulse }]}
            pieceOverrides={
              layingPiece
                ? [{ square: layingPiece, rotate: 90, glow: layingPieceColor, scale: 1.05 }]
                : []
            }
          />
          <DiamondHighlight
            squares={[square, square]}
            boardSize={boardSize}
            color={glowColor}
            progress={diamondDraw}
            fillSquare={square}
            rotate={diamondRotate}
          />
          {electric && (
            <LightningBolts
              square={square}
              boardSize={boardSize}
              color={glowColor}
              intensity={reveal}
              frame={frame}
            />
          )}
          {/* Sparkles */}
          {sparkles.map((s, i) => {
            const file = square.charCodeAt(0) - 97;
            const rank = Number(square[1]);
            const cx = file * cell + cell / 2;
            const cy = (8 - rank) * cell + cell / 2;
            const radius = cell * (0.6 + s.t * (electric ? 1.4 : 0.8));
            const px = cx + Math.cos(s.angle) * radius;
            const py = cy + Math.sin(s.angle) * radius;
            const sparkSize = electric ? 12 : 8;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: px - sparkSize / 2,
                  top: py - sparkSize / 2,
                  width: sparkSize,
                  height: sparkSize,
                  borderRadius: "50%",
                  background: glowColor,
                  boxShadow: `0 0 ${electric ? 30 : 20}px ${glowColor}`,
                  opacity: 1 - s.t,
                  pointerEvents: "none",
                }}
              />
            );
          })}
        </div>
      </AbsoluteFill>
      {caption && (
        <div
          style={{
            position: "absolute",
            bottom: 90,
            left: 0,
            right: 0,
            textAlign: "center",
            color: "white",
            fontFamily: "Impact, 'Arial Black', sans-serif",
            fontSize: 60,
            fontWeight: 900,
            letterSpacing: "0.08em",
            textShadow: `0 0 16px ${glowColor}, 0 0 36px ${glowColor}, 4px 4px 0 #000, 2px 2px 0 #000`,
            transform: `translateY(${captionY}px) skewX(-4deg)`,
            opacity: reveal,
            WebkitTextStroke: "1.5px #000",
            zIndex: 5,
          }}
        >
          {caption}
        </div>
      )}
    </AbsoluteFill>
  );
};
