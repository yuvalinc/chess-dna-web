import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { ChessBoard } from "../board/ChessBoard";
import { Background } from "../board/Background";
import type { KenBurnsShot as KenBurnsShotProps } from "../storyboard/types";
import { squareToXY, type Square } from "../board/fen";

function squareCenter(sq: Square, size: number) {
  const { x, y } = squareToXY(sq, size);
  const cell = size / 8;
  return { x: x + cell / 2, y: y + cell / 2 };
}

function regionTransform(
  from: [Square, Square],
  to: [Square, Square],
  progress: number,
  boardSize: number,
  viewport: { w: number; h: number },
) {
  const interp = (a: number, b: number) => a + (b - a) * progress;

  const fromA = squareCenter(from[0], boardSize);
  const fromB = squareCenter(from[1], boardSize);
  const fromCx = (fromA.x + fromB.x) / 2;
  const fromCy = (fromA.y + fromB.y) / 2;
  const fromW = Math.abs(fromB.x - fromA.x) + boardSize / 8;
  const fromH = Math.abs(fromB.y - fromA.y) + boardSize / 8;

  const toA = squareCenter(to[0], boardSize);
  const toB = squareCenter(to[1], boardSize);
  const toCx = (toA.x + toB.x) / 2;
  const toCy = (toA.y + toB.y) / 2;
  const toW = Math.abs(toB.x - toA.x) + boardSize / 8;
  const toH = Math.abs(toB.y - toA.y) + boardSize / 8;

  const cx = interp(fromCx, toCx);
  const cy = interp(fromCy, toCy);
  const regionW = interp(fromW, toW);
  const regionH = interp(fromH, toH);

  const scale = Math.min(viewport.w / regionW, viewport.h / regionH) * 0.85;
  const tx = viewport.w / 2 - cx * scale;
  const ty = viewport.h / 2 - cy * scale;
  return { tx, ty, scale };
}

export const KenBurnsShot: React.FC<KenBurnsShotProps> = ({
  fen,
  fromSquares,
  toSquares,
  highlightFile,
  caption,
  theme = "monoSlate",
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const boardSize = 1000;
  const viewport = { w: width, h: height };

  const from = fromSquares ?? (["a1", "h8"] as [Square, Square]);
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], {
    extrapolateRight: "clamp",
  });
  const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

  const { tx, ty, scale } = regionTransform(from, toSquares, eased, boardSize, viewport);

  const fileHighlight = highlightFile
    ? Array.from({ length: 8 }, (_, i) => ({
        square: `${highlightFile}${i + 1}` as Square,
        color: "#dc2626",
        opacity: 0.5,
      }))
    : [];

  const captionOpacity = interpolate(frame, [fps * 0.4, fps * 0.8], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Faux motion blur — tiny shake-trail at fast progress moments
  const speed = Math.abs(eased - (frame > 0 ? eased : 0));
  const trailOpacity = Math.min(0.5, speed * 30);

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Background variant="redglow" />
      <div
        style={{
          position: "absolute",
          left: tx,
          top: ty,
          transformOrigin: "0 0",
          transform: `scale(${scale})`,
          filter: `blur(${trailOpacity * 4}px)`,
        }}
      >
        <ChessBoard
          fen={fen}
          size={boardSize}
          theme={theme}
          highlights={fileHighlight}
          saturate={1.25}
          contrast={1.1}
          tilt={3}
        />
      </div>
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
            fontSize: 70,
            fontWeight: 900,
            letterSpacing: "0.08em",
            textShadow:
              "0 0 16px #dc2626, 0 0 36px #dc2626, 4px 4px 0 #000, 2px 2px 0 #000",
            opacity: captionOpacity,
            transform: "skewX(-4deg)",
            WebkitTextStroke: "1.5px #000",
          }}
        >
          {caption}
        </div>
      )}
    </AbsoluteFill>
  );
};
