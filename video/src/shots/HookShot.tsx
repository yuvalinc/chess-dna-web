import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { ChessBoard } from "../board/ChessBoard";
import { Background } from "../board/Background";
import { squareToXY } from "../board/fen";
import type { HookShot as HookShotProps } from "../storyboard/types";

export const HookShot: React.FC<HookShotProps> = ({
  fen,
  highlightSquare,
  sticker = "??",
  stickerKind = "blunder",
  theme = "pinkBerry",
  durationSec,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const totalFrames = Math.round(durationSec * fps);

  const boardSize = Math.min(width * 0.95, 900);

  // Phase A (0 → 60%): pulse highlight + sticker pop
  // Phase B (60% → 100%): SNAP ZOOM into the highlighted square
  const phaseB = Math.max(0, (frame - totalFrames * 0.55) / (totalFrames * 0.45));
  const eased = phaseB * phaseB; // ease-in for snap
  const zoom = interpolate(eased, [0, 1], [1, 3.2]);

  // Translate so highlightSquare stays roughly centered as we zoom
  const cell = boardSize / 8;
  const sq = squareToXY(highlightSquare, boardSize);
  const sqCx = sq.x + cell / 2;
  const sqCy = sq.y + cell / 2;
  const offsetX = (boardSize / 2 - sqCx) * (zoom - 1);
  const offsetY = (boardSize / 2 - sqCy) * (zoom - 1);

  const pulse = 0.55 + 0.35 * Math.sin((frame / fps) * Math.PI * 2.4);

  const stickerScale = spring({
    frame: frame - fps * 0.5,
    fps,
    config: { damping: 7, stiffness: 240 },
  });

  // Whoosh shake when zooming
  const shake = phaseB > 0.6 ? Math.sin(frame * 3.2) * 4 * (phaseB - 0.6) * 4 : 0;

  return (
    <AbsoluteFill>
      <Background variant="redglow" />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            transform: `translate(${offsetX + shake}px, ${offsetY}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: "none",
          }}
        >
          <ChessBoard
            fen={fen}
            size={boardSize}
            theme={theme}
            saturate={1.4}
            contrast={1.1}
            tilt={4}
            highlights={[{ square: highlightSquare, color: "#dc2626", opacity: pulse }]}
            stickers={
              stickerScale > 0
                ? [{ square: highlightSquare, label: sticker, kind: stickerKind, scale: stickerScale }]
                : []
            }
          />
        </div>
      </AbsoluteFill>
      {/* Radial vignette punching focus on the square as we zoom */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${width / 2}px ${height / 2}px, transparent ${interpolate(
            phaseB,
            [0, 1],
            [width * 0.5, width * 0.2],
          )}px, rgba(0,0,0,${interpolate(phaseB, [0, 1], [0.5, 0.85])}) 100%)`,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
