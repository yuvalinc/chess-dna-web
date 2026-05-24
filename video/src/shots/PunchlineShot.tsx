import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, staticFile } from "remotion";
import { ChessBoard } from "../board/ChessBoard";
import { Background } from "../board/Background";
import { Sticker } from "../board/Sticker";
import type { PunchlineShot as PunchlineShotProps } from "../storyboard/types";
import { squareToXY, type Square } from "../board/fen";

function squareCenter(sq: Square, size: number) {
  const { x, y } = squareToXY(sq, size);
  const cell = size / 8;
  return { x: x + cell / 2, y: y + cell / 2 };
}

export const PunchlineShot: React.FC<PunchlineShotProps> = ({
  fen,
  zoomSquares,
  sticker,
  stickerKind = "warning",
  stickerSquare,
  theme = "monoSlate",
  layingPiece,
  layingPieceColor = "#dc2626",
  resignedPlayer,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const boardSize = 1200;

  const zoomProgress = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 60 },
  });

  const a = squareCenter(zoomSquares[0], boardSize);
  const b = squareCenter(zoomSquares[1], boardSize);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const regionW = Math.abs(b.x - a.x) + boardSize / 8;
  const regionH = Math.abs(b.y - a.y) + boardSize / 8;

  const targetScale = Math.min(width / regionW, height / regionH) * 0.85;
  const scale = interpolate(zoomProgress, [0, 1], [1, targetScale]);
  const tx = width / 2 - cx * scale;
  const ty = height / 2 - cy * scale;

  const stickerScale = spring({
    frame: frame - fps * 0.7,
    fps,
    config: { damping: 6, stiffness: 200 },
  });

  const shake =
    frame > fps * 0.7 && frame < fps * 1.1
      ? Math.sin(frame * 2.5) * 6
      : 0;

  // White flash at sticker drop
  const flash = interpolate(frame, [fps * 0.65, fps * 0.78, fps * 0.95], [0, 0.7, 0], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  // Sticker rendered in SCREEN space (not inside the zoomed board), so the zoom
  // can never clip it. We compute where the sticker square ends up on screen,
  // then place a fixed-size badge clamped inside the viewport.
  const stickerCenter = squareCenter(stickerSquare, boardSize);
  const stickerScreenX = tx + stickerCenter.x * scale + shake;
  const stickerScreenY = ty + stickerCenter.y * scale;
  const stickerSize = 280;
  // Offset so the badge sits next to the piece rather than directly over it.
  const offsetX = 90;
  const offsetY = 30;
  const PAD = 40;
  // Anchor at the piece, offset, then clamp so it never goes off-screen.
  const stickerLeft = Math.max(
    PAD,
    Math.min(
      width - stickerSize - PAD,
      stickerScreenX + offsetX - stickerSize / 2,
    ),
  );
  const stickerTop = Math.max(
    PAD,
    Math.min(
      height - stickerSize - PAD,
      stickerScreenY + offsetY - stickerSize / 2,
    ),
  );

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Background variant="redglow" />
      <div
        style={{
          position: "absolute",
          left: tx + shake,
          top: ty,
          transformOrigin: "0 0",
          transform: `scale(${scale})`,
        }}
      >
        <ChessBoard
          fen={fen}
          size={boardSize}
          theme={theme}
          saturate={1.3}
          contrast={1.15}
          pieceOverrides={
            layingPiece
              ? [{ square: layingPiece, rotate: 90, glow: layingPieceColor, scale: 1.05 }]
              : []
          }
        />
      </div>
      <AbsoluteFill style={{ background: "white", opacity: flash, pointerEvents: "none" }} />

      {/* Sticker — screen-space, fixed size, clamped */}
      {stickerScale > 0 && (
        <div
          style={{
            position: "absolute",
            left: stickerLeft,
            top: stickerTop,
            width: stickerSize,
            height: stickerSize,
            pointerEvents: "none",
            zIndex: 20,
          }}
        >
          <Sticker
            kind={stickerKind}
            label={sticker}
            size={stickerSize}
            scale={stickerScale * 1.1}
          />
        </div>
      )}

      {/* Resigning player badge — anchored under the laid-down king */}
      {resignedPlayer && (() => {
        const kingSquare = layingPiece ?? stickerSquare;
        const kingCenter = squareCenter(kingSquare, boardSize);
        const kingScreenX = tx + kingCenter.x * scale + shake;
        const kingScreenY = ty + kingCenter.y * scale;
        const badgeW = 340;
        const badgeH = 96;
        const badgeOffsetY = 220; // below the king (opposite side of RESIGNS sticker)
        const badgeLeft = Math.max(
          PAD,
          Math.min(width - badgeW - PAD, kingScreenX - badgeW / 2),
        );
        const badgeTop = Math.max(
          PAD,
          Math.min(height - badgeH - PAD, kingScreenY + badgeOffsetY),
        );
        const badgeProgress = spring({
          frame: frame - fps * 0.9,
          fps,
          config: { damping: 14, stiffness: 110 },
        });
        return (
          <div
            style={{
              position: "absolute",
              left: badgeLeft,
              top: badgeTop,
              width: badgeW,
              height: badgeH,
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "8px 22px 8px 8px",
              background: "rgba(0,0,0,0.85)",
              border: "3px solid #dc2626",
              borderRadius: 999,
              boxShadow: "0 12px 28px rgba(0,0,0,0.6), 0 0 24px rgba(220,38,38,0.6)",
              opacity: badgeProgress,
              transform: `translateY(${interpolate(badgeProgress, [0, 1], [40, 0])}px)`,
              pointerEvents: "none",
              zIndex: 21,
            }}
          >
            {resignedPlayer.photoUrl ? (
              <img
                src={resignedPlayer.photoUrl.startsWith("http")
                  ? resignedPlayer.photoUrl
                  : staticFile(resignedPlayer.photoUrl)}
                alt={resignedPlayer.name}
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: "3px solid #dc2626",
                  boxShadow: "0 0 14px rgba(220,38,38,0.7)",
                  filter: "grayscale(0.6)",
                }}
              />
            ) : (
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  background: "#1a1a1a",
                  border: "3px solid #dc2626",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontSize: 32,
                  fontWeight: 900,
                }}
              >
                {resignedPlayer.name[0]}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
              <div
                style={{
                  fontFamily: "'Helvetica Neue', sans-serif",
                  fontSize: 16,
                  color: "#fca5a5",
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                RESIGNED
              </div>
              <div
                style={{
                  fontFamily: "Impact, 'Arial Black', sans-serif",
                  fontSize: 32,
                  fontWeight: 900,
                  color: "white",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  textShadow: "2px 2px 0 #000",
                }}
              >
                {resignedPlayer.name}
              </div>
            </div>
          </div>
        );
      })()}
    </AbsoluteFill>
  );
};
